// A codex rollout (~/.codex/sessions/YYYY/MM/DD/rollout-…-<threadId>.jsonl),
// read back as card events — the history half of resume, which the live
// adapter cannot give (codex replays nothing over exec). Shapes verified
// against real rollouts on this Mac (cli 0.147):
//
//   response_item/message           role user|assistant|developer, blocks of
//                                   input_text / output_text / text
//   response_item/reasoning         summary[] of texts (often encrypted-only)
//   response_item/function_call     name, call_id, arguments (JSON string) —
//                                   exec_command carries { cmd }
//   response_item/function_call_output   call_id, output
//   response_item/custom_tool_call(+_output)  apply_patch rides here
//   response_item/web_search_call   a search the model ran
//   event_msg/task_started|task_complete     the turn's brackets
//
// Everything else (world_state, turn_context, token_count, item_completed…)
// is bookkeeping, not conversation. Injected user records — <environment_
// context>-style wrappers and the bare AGENTS.md block — are the CLI talking
// to itself and never render.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { clip } = require('./agent-events.js');
const { unwrapShell } = require('./adapters/codex.js');

// The card shows the recent window of a long history, like claude's backlog.
const MAX_EVENTS = 400;
// A rollout past this is read from its tail; the first partial line drops.
const READ_CAP = 8 * 1024 * 1024;

// The filename carries the thread id — no index needed, just the walk the
// conversation lister already does.
function codexRollout(threadId, home) {
  if (!threadId) return null;
  const suffix = `-${threadId}.jsonl`;
  const root = path.join(home || os.homedir(), '.codex', 'sessions');
  const list = (p) => { try { return fs.readdirSync(p); } catch (_) { return []; } };
  for (const y of list(root)) for (const m of list(path.join(root, y))) {
    for (const d of list(path.join(root, y, m))) {
      for (const f of list(path.join(root, y, m, d))) {
        if (f.endsWith(suffix)) return path.join(root, y, m, d, f);
      }
    }
  }
  return null;
}

function isInjectedUserText(text) {
  return text.startsWith('<') || /^# AGENTS\.md instructions\b/.test(text);
}

function blockTexts(content) {
  const out = [];
  for (const b of Array.isArray(content) ? content : []) {
    const t = b && (b.text != null ? b.text : b.input_text != null ? b.input_text : b.output_text);
    if (t) out.push(String(t));
  }
  return out;
}

function parseCodexRollout(lines) {
  const out = [];
  let taskStart = null;
  for (const line of lines || []) {
    let rec = line;
    if (typeof line === 'string') {
      if (!line.trim()) continue;
      try { rec = JSON.parse(line); } catch (_) { continue; }
    }
    if (!rec || typeof rec !== 'object') continue;
    const p = rec.payload || {};
    const at = rec.timestamp;

    if (rec.type === 'event_msg') {
      if (p.type === 'task_started') taskStart = Date.parse(rec.timestamp) || null;
      if (p.type === 'task_complete') {
        const end = Date.parse(rec.timestamp) || 0;
        out.push({ kind: 'turn_end', at, durationMs: taskStart && end ? Math.max(0, end - taskStart) : 0 });
        taskStart = null;
      }
      continue;
    }
    if (rec.type !== 'response_item') continue;

    switch (p.type) {
      case 'message': {
        const text = blockTexts(p.content).join('\n').trim();
        if (!text) break;
        if (p.role === 'user' && !isInjectedUserText(text)) out.push({ kind: 'user', at, text });
        else if (p.role === 'assistant') out.push({ kind: 'assistant', at, text });
        // developer messages are the harness, not the conversation
        break;
      }
      case 'reasoning': {
        // most reasoning is encrypted_content only; the summary, when it
        // exists, is the readable part
        const text = blockTexts(p.summary).join('\n').trim();
        if (text) out.push({ kind: 'thinking', at, text });
        break;
      }
      case 'function_call': {
        let args = {};
        try { args = JSON.parse(p.arguments || '{}'); } catch (_) {}
        const isExec = p.name === 'exec_command';
        out.push({
          kind: 'tool', at, toolId: p.call_id || p.id || null,
          name: isExec ? 'Bash' : String(p.name || ''),
          toolKind: isExec ? 'execute' : 'other',
          input: isExec ? { command: unwrapShell(String(args.cmd || '')) } : args,
        });
        break;
      }
      case 'custom_tool_call': {
        const isPatch = p.name === 'apply_patch';
        out.push({
          kind: 'tool', at, toolId: p.call_id || p.id || null,
          name: String(p.name || ''),
          toolKind: isPatch ? 'edit' : 'other',
          input: { input: String(p.input || '') },
        });
        break;
      }
      case 'web_search_call': {
        out.push({ kind: 'tool', at, toolId: p.call_id || p.id || null, name: 'web_search', toolKind: 'fetch', input: {} });
        break;
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const { body, truncated } = clip(String(p.output || ''));
        out.push({
          kind: 'tool_result', at, toolId: p.call_id || null,
          isError: /Process exited with code [1-9]/.test(body),
          body, truncated,
        });
        break;
      }
      default: break;
    }
  }
  const partial = out.length > MAX_EVENTS;
  return { events: out.slice(-MAX_EVENTS), partial };
}

// The whole backlog read, bounded: a giant rollout opens on its tail.
function codexBacklog(file) {
  const size = fs.statSync(file).size;
  let text;
  if (size > READ_CAP) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(READ_CAP);
    const n = fs.readSync(fd, buf, 0, READ_CAP, size - READ_CAP);
    fs.closeSync(fd);
    text = buf.slice(0, n).toString('utf8');
    text = text.slice(text.indexOf('\n') + 1); // first line is torn
  } else {
    text = fs.readFileSync(file, 'utf8');
  }
  const r = parseCodexRollout(text.split('\n'));
  return { events: r.events, partial: r.partial || size > READ_CAP };
}

module.exports = { codexRollout, parseCodexRollout, codexBacklog };
