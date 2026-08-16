// A kimi session's wire log, read back as card events. Kimi files each
// session under ~/.kimi-code/sessions/<wd_slug>/<session_id>/agents/main/
// wire.jsonl and indexes it in session_index.jsonl ({sessionId, sessionDir}).
// Shapes verified against real wires on this Mac (protocol_version 1.5):
//
//   turn.prompt                       input[].text — what the user typed
//   context.append_loop_event
//     content.part  part.think|text   thinking / assistant prose (whole
//                                     parts, not char deltas)
//     tool.call                       toolCallId, name (Claude-shaped:
//                                     Bash, Read…), args
//     tool.result                     toolCallId, result.output
//   turn.ended                        durationMs
//
// Everything else (llm.request, usage.record, profile.bind, tools_snapshot,
// interaction.*) is protocol bookkeeping, not conversation.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { clip, toolKindFor } = require('./agent-events.js');

const MAX_EVENTS = 400;

// sessionDir comes from the same index the conversation lister reads.
function kimiWire(sessionId, home) {
  if (!sessionId) return null;
  let raw = '';
  try { raw = fs.readFileSync(path.join(home || os.homedir(), '.kimi-code', 'session_index.jsonl'), 'utf8'); } catch (_) { return null; }
  const lines = raw.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let rec = null;
    try { rec = JSON.parse(lines[i]); } catch (_) { continue; }
    if (rec && rec.sessionId === sessionId && rec.sessionDir) {
      const file = path.join(rec.sessionDir, 'agents', 'main', 'wire.jsonl');
      try { return fs.existsSync(file) ? file : null; } catch (_) { return null; }
    }
  }
  return null;
}

function parseKimiWire(lines) {
  const out = [];
  for (const line of lines || []) {
    let rec = line;
    if (typeof line === 'string') {
      if (!line.trim()) continue;
      try { rec = JSON.parse(line); } catch (_) { continue; }
    }
    if (!rec || typeof rec !== 'object') continue;
    const at = rec.time;

    if (rec.type === 'turn.prompt') {
      const text = (Array.isArray(rec.input) ? rec.input : [])
        .map((b) => String((b && b.text) || '')).join('\n').trim();
      if (text) out.push({ kind: 'user', at, text });
      continue;
    }
    if (rec.type === 'turn.ended') {
      out.push({ kind: 'turn_end', at, durationMs: Number(rec.durationMs) || 0 });
      continue;
    }
    if (rec.type !== 'context.append_loop_event' || !rec.event) continue;
    const e = rec.event;

    if (e.type === 'content.part' && e.part) {
      if (e.part.type === 'text') {
        const text = String(e.part.text || '').trim();
        if (text) out.push({ kind: 'assistant', at, text });
      } else if (e.part.type === 'think') {
        const text = String(e.part.think || '').trim();
        if (text) out.push({ kind: 'thinking', at, text });
      }
    } else if (e.type === 'tool.call') {
      out.push({
        kind: 'tool', at, toolId: e.toolCallId || e.uuid || null,
        name: String(e.name || ''), toolKind: toolKindFor(e.name),
        input: e.args || {},
      });
    } else if (e.type === 'tool.result') {
      const { body, truncated } = clip(String((e.result && e.result.output) || ''));
      out.push({
        kind: 'tool_result', at, toolId: e.toolCallId || null,
        isError: !!(e.result && e.result.isError), body, truncated,
      });
    }
  }
  const partial = out.length > MAX_EVENTS;
  return { events: out.slice(-MAX_EVENTS), partial };
}

function kimiBacklog(file) {
  const r = parseKimiWire(fs.readFileSync(file, 'utf8').split('\n'));
  return { events: r.events, partial: r.partial };
}

module.exports = { kimiWire, parseKimiWire, kimiBacklog };
