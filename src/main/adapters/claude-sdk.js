// Claude Code over the Agent SDK (@anthropic-ai/claude-agent-sdk): the drive
// adapter. The card IS the interface — the composer sends turns, approvals are
// answered in place, esc interrupts. Auth rides the user's installed `claude`
// (subscription login); we never set a key.
//
// Grown from the first claude-driver: three things it threw away are kept now.
// A tool_result carries its body, a permission carries the displayName,
// description and suggestions the agent actually sent, and a rate limit that
// bites becomes a note on the card instead of vanishing.

const fs = require('fs');
const os = require('os');
const { claudeCandidates } = require('./../platform.js');
const { knownBin } = require('./../bin-cache.js');
const { capability, toolKindFor, clip, safeEvent } = require('./../agent-events.js');

// The SDK is ESM; main is CJS — load it once via dynamic import.
let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@anthropic-ai/claude-agent-sdk');
  return sdkPromise;
}

// Find the user's logged-in claude binary so the session runs on their
// subscription, not an API key. No fallback on purpose: packaged builds drop
// the SDK's own 265 MB copy of Claude Code (see electron-builder.yml).
//
// The scan goes first, and that ordering is the whole point. This used to be
// the hardcoded list alone, which meant a claude installed through nvm, volta,
// asdf, mise or bun read as "ready" in the launcher — which asks the login
// shell — and as "isn't installed on this Mac yet" in the card view, which came
// here. Same app, same second, two answers. The list stays as the floor: it is
// what answers before the first scan lands, and on a machine where the shell
// probe fails entirely.
function resolveClaudeExecutable({ home = os.homedir(), env = process.env, exists, detected } = {}) {
  const there = exists || ((p) => fs.existsSync(p));
  const scanned = detected === undefined ? knownBin('claude') : detected;
  const candidates = [
    env.CLAUDE_CODE_EXECUTABLE,
    scanned,
    ...claudeCandidates({ home, env }),
  ];
  for (const c of candidates) {
    try { if (c && there(c)) return c; } catch (_) {}
  }
  return null;
}

// An async-iterable input channel user turns are pushed into over the life of
// the session — canUseTool is only honoured in streaming-input mode, which is
// the whole reason approvals can be answered from the card at all.
function makeInputChannel() {
  const queue = [];
  let resolveNext = null;
  let ended = false;

  function push(text) {
    const msg = { type: 'user', message: { role: 'user', content: text } };
    if (resolveNext) { const r = resolveNext; resolveNext = null; r({ value: msg, done: false }); }
    else queue.push(msg);
  }
  function end() {
    ended = true;
    if (resolveNext) { const r = resolveNext; resolveNext = null; r({ value: undefined, done: true }); }
  }
  const iterator = {
    next() {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
      if (ended) return Promise.resolve({ value: undefined, done: true });
      return new Promise((res) => { resolveNext = res; });
    },
    return() { end(); return Promise.resolve({ value: undefined, done: true }); },
    [Symbol.asyncIterator]() { return this; },
  };
  return { iterator, push, end };
}

const CAPABILITY = { drive: true, interrupt: true, ask: true, commands: true, channel: 'agent sdk' };

class ClaudeSdkAdapter {
  constructor({ id, cwd, model, env, onEvent }) {
    this.id = id;
    this.cwd = cwd;
    this.model = model || undefined;
    this.env = env || undefined;
    this.onEvent = onEvent;
    this.sessionId = null;       // claude's own conversation id
    this.query = null;
    this.input = makeInputChannel();
    this.pendingPermissions = new Map(); // permissionId -> { resolve, input, suggestions }
    this.closed = false;
    this.seq = 0;
  }

  emit(kind, payload) {
    if (this.closed) return;
    const e = safeEvent({ kind, id: `${this.id}:e${++this.seq}`, at: null, ...payload });
    if (e) this.onEvent(e);
  }

  // sid: the tile's own conversation id. With a transcript on disk the session
  // resumes it; without one the id is pinned so the pty path can resume this
  // very conversation later — the same parity the --session-id spawn keeps.
  async start({ prompt, sid, hasTranscript }) {
    const { query } = await loadSdk();
    const exe = resolveClaudeExecutable();
    if (!exe) {
      this.emit('error', {
        message: 'Claude Code isn\'t installed on this Mac yet. Nami runs it on your own '
          + 'subscription, so it has to be installed and logged in. Already have it somewhere '
          + 'unusual? Set CLAUDE_CODE_EXECUTABLE to its path.',
      });
      this.emit('status', { state: 'idle' });
      return false;
    }

    const options = sdkOptions({
      cwd: this.cwd, model: this.model, env: this.env, exe, sid, hasTranscript,
      canUseTool: (toolName, input, opts) => this.askPermission(toolName, input, opts),
    });

    if (prompt) this.send(prompt);

    try {
      this.query = query({ prompt: this.input.iterator, options });
    } catch (err) {
      this.emit('error', { message: String(err && err.message ? err.message : err) });
      return false;
    }
    this.pump();
    return true;
  }

  async pump() {
    try {
      for await (const msg of this.query) {
        if (this.closed) break;
        this.handle(msg);
      }
    } catch (err) {
      if (!this.closed) this.emit('error', { message: String(err && err.message ? err.message : err) });
    }
    this.emit('status', { state: 'idle' });
  }

  // One SDK frame → vocabulary events. Wrapped by the caller's pump; anything
  // unrecognised falls through the default and costs nothing.
  handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.sessionId = msg.session_id || this.sessionId;
          const commands = Array.isArray(msg.slash_commands) ? msg.slash_commands.slice(0, 200) : [];
          this.emit('init', {
            capability: capability({ ...CAPABILITY, commands: commands.length > 0 }),
            agentSessionId: this.sessionId,
            commands,
            agentName: 'Claude Code',
            version: msg.claude_code_version || null,
            model: msg.model || null,
            mode: msg.permissionMode || 'default',
          });
        }
        break;

      case 'rate_limit_event': {
        const info = msg.rate_limit_info || {};
        // "allowed" arrives on nearly every turn; only a limit that bites is news.
        if (info.status && info.status !== 'allowed') {
          const when = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : '';
          this.emit('note', { text: `Rate limit reached${when ? ` — resets at ${when}` : ''}.` });
        }
        break;
      }

      case 'assistant': {
        const parentToolId = msg.parent_tool_use_id || null;
        const blocks = (msg.message && msg.message.content) || [];
        for (const b of blocks) {
          if (!b) continue;
          if (b.type === 'text' && b.text && b.text.trim()) {
            this.emit('assistant', { text: b.text, parentToolId });
          } else if (b.type === 'thinking' && b.thinking && b.thinking.trim()) {
            this.emit('thinking', { text: b.thinking, parentToolId });
          } else if (b.type === 'tool_use') {
            if (isTodoTool(b.name)) this.emit('plan', { todos: extractTodos(b.input) });
            else {
              this.emit('tool', {
                toolId: b.id || null, name: String(b.name || ''),
                toolKind: toolKindFor(b.name), input: b.input || {}, parentToolId,
              });
            }
          }
        }
        break;
      }

      case 'user': {
        const blocks = (msg.message && msg.message.content) || [];
        if (!Array.isArray(blocks)) break;
        for (const b of blocks) {
          if (!b || b.type !== 'tool_result') continue;
          const { body, truncated } = clip(blocksToText(b.content));
          this.emit('tool_result', { toolId: b.tool_use_id || null, isError: !!b.is_error, body, truncated });
        }
        break;
      }

      case 'result':
        this.sessionId = msg.session_id || this.sessionId;
        this.emit('turn_end', {
          durationMs: Number(msg.duration_ms || msg.duration_api_ms) || 0,
          costUsd: Number(msg.total_cost_usd) || 0,
          numTurns: Number(msg.num_turns) || 0,
          ok: !msg.is_error && msg.subtype !== 'error_during_execution',
        });
        if (msg.is_error && msg.result) this.emit('error', { message: String(msg.result) });
        this.emit('status', { state: 'idle' });
        break;

      default:
        break;
    }
  }

  // canUseTool, surfaced. The event carries what the agent sent — its own
  // title, its own description, one option per suggestion — and the promise
  // stays open until the card answers or the turn is cancelled.
  askPermission(toolName, input, opts) {
    return new Promise((resolve) => {
      const permissionId = `${this.id}:p${++this.seq}`;
      const suggestions = (opts && Array.isArray(opts.suggestions)) ? opts.suggestions : [];
      this.pendingPermissions.set(permissionId, { resolve, input, suggestions });

      const options = [{ id: 'allow', label: 'Allow' }];
      suggestions.forEach((s, i) => {
        const label = suggestionLabel(s, toolName, input);
        if (label) options.push({ id: `sugg:${i}`, label });
      });
      options.push({ id: 'deny', label: 'Deny' });

      this.emit('permission', {
        permissionId, toolName,
        title: (opts && (opts.displayName || opts.title)) || toolName,
        description: (opts && opts.description) || '',
        input: input || {},
        diff: permissionDiff(toolName, input),
        options,
      });

      if (opts && opts.signal && typeof opts.signal.addEventListener === 'function') {
        opts.signal.addEventListener('abort', () => {
          if (!this.pendingPermissions.has(permissionId)) return;
          this.pendingPermissions.delete(permissionId);
          this.emit('permission_resolved', { permissionId, optionId: 'cancelled' });
          resolve({ behavior: 'deny', message: 'Cancelled' });
        }, { once: true });
      }
    });
  }

  resolvePermission(permissionId, optionId) {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return;
    this.pendingPermissions.delete(permissionId);
    this.emit('permission_resolved', { permissionId, optionId });

    if (optionId === 'allow') {
      pending.resolve({ behavior: 'allow', updatedInput: pending.input });
    } else if (String(optionId).startsWith('sugg:')) {
      const s = pending.suggestions[Number(String(optionId).slice(5))];
      pending.resolve(s
        ? { behavior: 'allow', updatedInput: pending.input, updatedPermissions: [s] }
        : { behavior: 'allow', updatedInput: pending.input });
    } else {
      pending.resolve({ behavior: 'deny', message: 'Denied from the card.' });
    }
  }

  // The composer's mode chip: default → acceptEdits → plan, applied live.
  setConfigOption(configId, value) {
    if (configId !== 'mode' || !this.query) return;
    const apply = this.query.setPermissionMode && this.query.setPermissionMode(String(value));
    Promise.resolve(apply)
      .then(() => this.emit('init', {
        capability: capability(CAPABILITY), agentSessionId: this.sessionId,
        agentName: 'Claude Code', mode: String(value),
      }))
      .catch(() => this.emit('note', { text: `Could not switch to ${value} mode.` }));
  }

  send(text) {
    this.input.push(text);
    this.emit('user', { text });
    this.emit('status', { state: 'running' });
  }

  async interrupt() {
    try { if (this.query && this.query.interrupt) await this.query.interrupt(); } catch (_) {}
    this.emit('note', { text: 'Interrupted.' });
    this.emit('status', { state: 'idle' });
  }

  close() {
    this.closed = true;
    for (const [, pending] of this.pendingPermissions) {
      try { pending.resolve({ behavior: 'deny', message: 'Closed' }); } catch (_) {}
    }
    this.pendingPermissions.clear();
    try { this.input.end(); } catch (_) {}
    try { if (this.query && this.query.close) this.query.close(); } catch (_) {}
  }
}

function isTodoTool(name) { return name === 'TodoWrite' || name === 'TodoRead'; }

function extractTodos(input) {
  const list = (input && (input.todos || input.tasks)) || [];
  if (!Array.isArray(list)) return [];
  return list.map((t) => ({
    text: String((t && (t.content || t.text || t.title || t.description)) || t || ''),
    status: (t && t.status) || 'pending',
  }));
}

// tool_result content is a string on the simple path and blocks on the rest.
function blocksToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (typeof b === 'string' ? b : (b && b.type === 'text' ? String(b.text || '') : '')))
    .filter(Boolean)
    .join('\n');
}

// What the agent is asking to change, carried on the ask itself so you approve
// while looking at it. Derived from the call's own strings, never invented.
function permissionDiff(toolName, input) {
  const i = input || {};
  if (toolName === 'Write' && typeof i.content === 'string') {
    return { path: i.file_path || '', oldText: '', newText: i.content };
  }
  if ((toolName === 'Edit') && typeof i.new_string === 'string') {
    return { path: i.file_path || '', oldText: String(i.old_string || ''), newText: i.new_string };
  }
  if (toolName === 'MultiEdit' && Array.isArray(i.edits) && i.edits.length) {
    const e = i.edits[0];
    return { path: i.file_path || '', oldText: String(e.old_string || ''), newText: String(e.new_string || ''), more: i.edits.length - 1 };
  }
  return null;
}

// The second button is tool-dependent because the channel says so: addRules
// carries the rule text, setMode carries the mode.
function suggestionLabel(s, toolName, input) {
  if (!s || typeof s !== 'object') return '';
  if (s.type === 'addRules') {
    const rule = Array.isArray(s.rules) && s.rules[0] && s.rules[0].ruleContent;
    return rule ? `Always allow \`${short(rule, 40)}\`` : `Always allow ${toolName}`;
  }
  if (s.type === 'setMode') {
    if (s.mode === 'acceptEdits') return 'Accept edits all session';
    return s.mode ? `Switch to ${s.mode}` : '';
  }
  return '';
}

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// The parity checklist, as one pure function. The pty path spent years
// learning these; the SDK path must match it item for item or sessions
// orphan: the same conversation id (resume with a transcript, pinned
// without one), the same env (login PATH, stripInheritedClaude, stored
// keys — the caller passes sessionEnv's output), the user's own binary.
function sdkOptions({ cwd, model, env, exe, sid, hasTranscript, canUseTool }) {
  const options = {
    cwd,
    permissionMode: 'default',
    includePartialMessages: false,
    settingSources: ['project', 'user'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    pathToClaudeCodeExecutable: exe,
    canUseTool,
  };
  if (model) options.model = model;
  if (env) options.env = env;
  if (sid && hasTranscript) options.resume = sid;
  else if (sid) options.extraArgs = { 'session-id': sid };
  return options;
}

module.exports = { ClaudeSdkAdapter, resolveClaudeExecutable, sdkOptions };
