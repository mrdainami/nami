// The one vocabulary every agent adapter speaks, and the only thing the card
// renderer ever sees. Nothing in here knows what an agent is: an adapter turns
// its channel — SDK stream, ACP frames, a one-shot's JSONL — into these events,
// and the renderer draws them without asking where they came from.
//
//   { kind: 'user',        id, at, text, command? }
//   { kind: 'assistant',   id, at, text, parentToolId? }
//   { kind: 'thinking',    id, at, text, parentToolId? }
//   { kind: 'tool',        id, at, toolId, name, toolKind, input, parentToolId? }
//   { kind: 'tool_result', id, at, toolId, isError, body, truncated }
//   { kind: 'plan',        id, at, todos: [{ text, status }] }
//   { kind: 'permission',  id, at, permissionId, toolName, title, description,
//                          input, options: [{ id, label }], diff? }
//   { kind: 'permission_resolved', id, at, permissionId, optionId }
//   { kind: 'turn_end',    id, at, durationMs, tokens? }   (no cost: channels
//     report running totals/estimates, not per-turn spend — see cards-cost)
//   { kind: 'note',        id, at, text }          — rate limits, channel facts
//   { kind: 'error',       id, at, message }       — classified, never prose
//   { kind: 'init',        id, at, capability, claudeSessionId?, commands?, models? }
//   { kind: 'status',      id, at, state }         — 'running' | 'idle'
//
// The vocabulary is closed on purpose: safeEvent refuses a kind that is not
// listed, so a new adapter cannot invent one and quietly hand the renderer
// something it has never drawn.

const EVENT_KINDS = new Set([
  'user', 'assistant', 'thinking', 'tool', 'tool_result', 'turn_end',
  'plan', 'permission', 'permission_resolved', 'note', 'error', 'init', 'status',
  'intro', // the session introducing itself: agent, version, model, mode, folder
]);

// Rows are keyed to what a tool DID, never to what it is called — ACP already
// types its calls this way, and every other channel maps onto the same set.
const TOOL_KINDS = new Set([
  'read', 'edit', 'execute', 'search', 'fetch', 'think', 'checkpoint', 'other',
]);

// Claude-shaped tool names → kind. An adapter whose channel already speaks the
// typed vocabulary passes { typed: true } and the name is taken at its word.
function toolKindFor(name, opts) {
  const n = String(name || '');
  if (opts && opts.typed) return TOOL_KINDS.has(n) ? n : 'other';
  switch (n) {
    case 'Read': case 'NotebookRead': return 'read';
    case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'edit';
    case 'Bash': case 'BashOutput': case 'KillShell': return 'execute';
    case 'Grep': case 'Glob': return 'search';
    case 'WebFetch': case 'WebSearch': return 'fetch';
    default: return 'other';
  }
}

// What a channel can do, answered completely every time. The card renders what
// it is given and says so when a capability is missing — an adapter that skips
// a field gets the honest default, false.
function capability(caps) {
  const c = caps || {};
  return {
    drive: !!c.drive,          // the composer sends into a live conversation
    interrupt: !!c.interrupt,  // esc reaches the agent
    ask: !!c.ask,              // approvals can be answered from the card
    commands: !!c.commands,    // the agent publishes a slash-command list
    models: !!c.models,        // the agent publishes a model list
    channel: String(c.channel || ''),  // 'agent sdk' · 'acp' · 'one-shot' · …
    note: String(c.note || ''),        // the limitation, said plainly, or ''
  };
}

// A Read of a large file arrives here whole. The terminal shows one line and
// hides the rest behind ctrl+o; a card can show all of it, but not at any
// price — past this the body is cut and the event says so, so the UI can too.
const BODY_CAP = 20 * 1024;

function clip(s) {
  const text = String(s == null ? '' : s);
  return text.length > BODY_CAP
    ? { body: text.slice(0, BODY_CAP), truncated: true }
    : { body: text, truncated: false };
}

// The gate every adapter's output passes on its way to the renderer. A frame
// that is not an object, or claims a kind the vocabulary does not list, is
// dropped here — one bad frame costs that frame, never the tile.
function safeEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  if (!EVENT_KINDS.has(e.kind)) return null;
  return e;
}

// A short answer that is really the provider failing — Hermes returned
// "API call failed after 3 retries: HTTP 404: model: …" as ordinary assistant
// prose, and a naive card rendered it as the reply. Long texts never classify:
// an agent legitimately *discussing* an error writes paragraphs, not one line.
function classifyFailure(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t || t.length > 400) return null;
  if (/^API call failed\b/i.test(t)) return t;
  if (/^HTTP\s+\d{3}\b/.test(t)) return t;
  if (/^\d{3}\s+(Bad Gateway|Service Unavailable|Too Many Requests|Unauthorized|Forbidden|Not Found|Internal Server Error)\b/i.test(t)) return t;
  if (/^(request|api)\s+error\b/i.test(t)) return t;
  return null;
}

module.exports = { EVENT_KINDS, TOOL_KINDS, toolKindFor, capability, clip, BODY_CAP, safeEvent, classifyFailure };
