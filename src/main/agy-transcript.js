// An antigravity CLI conversation, read back as card events. agy (1.1.13)
// writes under ~/.gemini/antigravity-cli/ — NOT ~/.gemini/antigravity/,
// which is the Antigravity IDE's old protobuf store (last touched Feb 2026
// on this Mac; listing it was why the picker showed months-old rows while
// a seconds-old chat sat invisible). The CLI keeps:
//
//   conversations/<id>.db                          one SQLite per conversation
//   brain/<id>/.system_generated/logs/transcript.jsonl   a step log:
//     USER_EXPLICIT/USER_INPUT   content wraps the prompt in <USER_REQUEST>
//                                plus <ADDITIONAL_METADATA>-style blocks
//     MODEL/PLANNER_RESPONSE     assistant prose
//     MODEL/<TOOL>               LIST_DIRECTORY, VIEW_FILE, GREP_SEARCH,
//                                SEARCH_WEB, RUN_COMMAND, GENERIC… — content
//                                is the tool's output behind two header lines
//     SYSTEM/*                   CHECKPOINT / CONVERSATION_HISTORY bookkeeping
//
// Shapes verified against real transcripts on this Mac (2026-08-16).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { clip } = require('./agent-events.js');

const MAX_EVENTS = 400;

function agyRoot(home) { return path.join(home || os.homedir(), '.gemini', 'antigravity-cli'); }

function agyTranscript(conversationId, home) {
  if (!conversationId) return null;
  const file = path.join(agyRoot(home), 'brain', String(conversationId), '.system_generated', 'logs', 'transcript.jsonl');
  try { return fs.existsSync(file) ? file : null; } catch (_) { return null; }
}

// The prompt rides inside <USER_REQUEST>; everything else in the content
// (<ADDITIONAL_METADATA>, <USER_SETTINGS_CHANGE>…) is the harness talking.
function userText(content) {
  const m = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(String(content || ''));
  if (m) return m[1].trim();
  const t = String(content || '').trim();
  return t.startsWith('<') ? '' : t;
}

// Tool outputs start with "Created At: …\nCompleted At: …" header lines.
function toolBody(content) {
  return String(content || '').replace(/^Created At: [^\n]*\n(Completed At: [^\n]*\n)?/, '').trim();
}

function toolKindForStep(type) {
  if (/VIEW_FILE|READ/.test(type)) return 'read';
  if (/SEARCH_WEB|BROWSER|URL/.test(type)) return 'fetch';
  if (/GREP|LIST|SEARCH|FIND/.test(type)) return 'search';
  if (/RUN_COMMAND|COMMAND/.test(type)) return 'execute';
  if (/WRITE|EDIT|REPLACE/.test(type)) return 'edit';
  return 'other';
}

function parseAgyTranscript(lines) {
  const out = [];
  for (const line of lines || []) {
    let rec = line;
    if (typeof line === 'string') {
      if (!line.trim()) continue;
      try { rec = JSON.parse(line); } catch (_) { continue; }
    }
    if (!rec || typeof rec !== 'object') continue;
    const at = rec.created_at;

    if (rec.source === 'USER_EXPLICIT' && rec.type === 'USER_INPUT') {
      const text = userText(rec.content);
      if (text) out.push({ kind: 'user', at, text });
    } else if (rec.source === 'MODEL' && rec.type === 'PLANNER_RESPONSE') {
      const text = String(rec.content || '').trim();
      if (text) out.push({ kind: 'assistant', at, text });
    } else if (rec.source === 'MODEL' && rec.type) {
      // every other MODEL step is a tool with its output in content
      const name = String(rec.type).toLowerCase();
      const toolId = `agy:${rec.step_index != null ? rec.step_index : out.length}`;
      out.push({ kind: 'tool', at, toolId, name, toolKind: toolKindForStep(rec.type), input: {} });
      const { body, truncated } = clip(toolBody(rec.content));
      if (body) out.push({ kind: 'tool_result', at, toolId, isError: rec.status === 'ERROR', body, truncated });
    }
    // SYSTEM/* (CHECKPOINT, CONVERSATION_HISTORY) is bookkeeping
  }
  const partial = out.length > MAX_EVENTS;
  return { events: out.slice(-MAX_EVENTS), partial };
}

function agyBacklog(file) {
  const r = parseAgyTranscript(fs.readFileSync(file, 'utf8').split('\n'));
  return { events: r.events, partial: r.partial };
}

module.exports = { agyRoot, agyTranscript, parseAgyTranscript, agyBacklog };
