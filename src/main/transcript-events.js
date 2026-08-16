// A claude session's transcript, turned into the events a card can draw — pure,
// no IO. Callers hand in lines; transcript-tail.js does the reading.
//
// The file is ~/.claude/projects/<slug>/<sid>.jsonl, written by the running CLI
// as the turn happens. It is the same conversation the PTY is drawing, already
// structured, which is why cards need no second process and take nothing away:
// slash commands, /resume and the approval prompt all still live in the terminal.
//
// The vocabulary matches what claude-driver.js emits over the SDK, so a later
// SDK or ACP adapter renders through the same view with no second renderer:
//
//   { kind: 'user',        id, at, text, command? }
//   { kind: 'assistant',   id, at, text }
//   { kind: 'thinking',    id, at, text }
//   { kind: 'tool',        id, at, toolId, name, input }
//   { kind: 'tool_result', id, at, toolId, isError, body, truncated }
//   { kind: 'turn_end',    id, at, durationMs }
//   { kind: 'title',       title }
//
// Titles are reported for completeness, but the wiring ignores them: sweepTitles
// already owns the tile's name through session-title.js, and one name deserves
// one source.

const { compactNote } = require('./agent-events.js');

// A Read of a large file arrives here whole. The terminal shows one line and
// hides the rest behind ctrl+o; a card can show all of it, but not at any price
// — past this the body is cut and the event says so, so the UI can too.
const BODY_CAP = 20 * 1024;

// Records that exist for the CLI's own bookkeeping. None of them is anything
// that happened in the conversation.
const SKIP_TYPES = new Set([
  'attachment', 'mode', 'permission-mode', 'bridge-session',
  'file-history-snapshot', 'last-prompt', 'summary', 'queued-command',
]);

function clip(s) {
  const text = String(s == null ? '' : s);
  return text.length > BODY_CAP ? { body: text.slice(0, BODY_CAP), truncated: true } : { body: text, truncated: false };
}

// tool_result content is a string on the simple path and text blocks on the
// rest (an image read, a tool that returns several parts).
function blocksToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (typeof b === 'string' ? b : (b && b.type === 'text' ? String(b.text || '') : '')))
    .filter(Boolean)
    .join('\n');
}

// "<command-name>/build</command-name><command-args>the cards</command-args>"
// is how the CLI records a slash command. Shown raw it reads as markup; the
// user typed "/build the cards" and that is what the card should say.
function slashCommand(text) {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text);
  if (!name) return null;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text);
  const label = [name[1].trim(), args ? args[1].trim() : ''].filter(Boolean).join(' ');
  return label || null;
}

// Output the CLI printed for a slash command, and the reminders it injects, are
// written as user records but were never said by anyone.
function isMachineText(text) {
  return /^\s*<(local-command-stdout|local-command-stderr|system-reminder|command-message)\b/.test(text);
}

function userEvents(rec) {
  const content = rec.message && rec.message.content;

  if (typeof content === 'string') {
    const raw = content;
    if (isMachineText(raw)) return [];
    const cmd = slashCommand(raw);
    if (cmd) return [{ kind: 'user', at: rec.timestamp, text: cmd, command: true }];
    const text = raw.trim();
    return text ? [{ kind: 'user', at: rec.timestamp, text }] : [];
  }

  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === 'tool_result') {
      const { body, truncated } = clip(blocksToText(b.content));
      out.push({
        kind: 'tool_result', at: rec.timestamp,
        toolId: b.tool_use_id || null, isError: !!b.is_error, body, truncated,
      });
    } else if (b.type === 'text') {
      const raw = String(b.text || '');
      if (isMachineText(raw)) continue;
      const text = raw.trim();
      if (text) out.push({ kind: 'user', at: rec.timestamp, text });
    }
  }
  return out;
}

function assistantEvents(rec) {
  const content = (rec.message && rec.message.content) || [];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === 'text') {
      const text = String(b.text || '').trim();
      if (text) out.push({ kind: 'assistant', at: rec.timestamp, text });
    } else if (b.type === 'thinking') {
      const text = String(b.thinking || '').trim();
      if (text) out.push({ kind: 'thinking', at: rec.timestamp, text });
    } else if (b.type === 'tool_use') {
      out.push({ kind: 'tool', at: rec.timestamp, toolId: b.id || null, name: String(b.name || ''), input: b.input || {} });
    }
  }
  return out;
}

function recordEvents(rec) {
  if (!rec || typeof rec !== 'object') return [];
  // A Task tool spawns a subagent that writes its whole run into the same file.
  // Those turns belong to the sub-agent, not to the tile the user is watching.
  if (rec.isSidechain) return [];
  // isMeta marks text the CLI injected on the user's behalf.
  if (rec.isMeta) return [];
  // The compaction summary is written as a user record — rendering it made a
  // multi-kilobyte wall of text the user never typed appear as their bubble.
  // The compact_boundary note below is the honest trace of what happened.
  if (rec.isCompactSummary || rec.isVisibleInTranscriptOnly) return [];

  switch (rec.type) {
    case 'user': return userEvents(rec);
    case 'assistant': return assistantEvents(rec);
    case 'ai-title': return rec.aiTitle ? [{ kind: 'title', title: String(rec.aiTitle) }] : [];
    case 'custom-title': return rec.customTitle ? [{ kind: 'title', title: String(rec.customTitle) }] : [];
    case 'system':
      if (rec.subtype === 'turn_duration') {
        return [{ kind: 'turn_end', at: rec.timestamp, durationMs: Number(rec.durationMs) || 0 }];
      }
      if (rec.subtype === 'compact_boundary') {
        return [{ kind: 'note', at: rec.timestamp, text: compactNote(rec.compactMetadata || rec.compact_metadata) }];
      }
      return [];
    default: return [];
  }
}

// lines: JSONL strings (or already-parsed records). A line that does not parse
// is skipped rather than thrown: the tailer holds incomplete lines back, but a
// truncated file or a flush caught mid-write can still hand us half a record.
function parseTranscript(lines) {
  const out = [];
  for (const line of lines || []) {
    let rec = line;
    if (typeof line === 'string') {
      if (!line.trim()) continue;
      try { rec = JSON.parse(line); } catch (_) { continue; }
    }
    const events = recordEvents(rec);
    // One record can hold several blocks, so ids are only unique with the block
    // index on them. The common case — one event — keeps the record's own uuid,
    // which is what every other part of the app already calls this turn.
    events.forEach((e, i) => {
      if (e.kind === 'title') return;
      e.id = i === 0 ? (rec.uuid || null) : `${rec.uuid || 'rec'}#${i}`;
    });
    out.push(...events);
  }
  return out;
}

module.exports = { parseTranscript, BODY_CAP };
