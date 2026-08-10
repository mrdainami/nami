// Drives one interactive Claude Code session through the Agent SDK (@anthropic-ai/claude-agent-sdk),
// turning its structured events into paper-card events for the renderer. No terminal — the card IS
// the interface. Auth rides the user's installed `claude` (subscription login); we never set a key.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { claudeCandidates } = require('./platform.js');

// The SDK is ESM; main is CJS — load it once via dynamic import.
let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@anthropic-ai/claude-agent-sdk');
  return sdkPromise;
}

// Find the user's logged-in claude binary so the session runs on their subscription, not an API key.
function resolveClaudeExecutable() {
  const candidates = claudeCandidates({ home: os.homedir(), env: process.env });
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (_) {}
  }
  // No fallback on purpose: packaged builds drop the SDK's own 265 MB copy of
  // Claude Code (see electron-builder.yml), and start() explains what to do.
  return null;
}

// An async-iterable input channel we can push user turns into over the life of the session.
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

class ClaudeSession {
  constructor({ id, cwd, model, agentName, onEvent }) {
    this.id = id;
    this.cwd = cwd;
    this.model = model || undefined;
    this.agentName = agentName || undefined;
    this.onEvent = onEvent;
    this.sessionId = null;      // Claude's own session id (for resume)
    this.query = null;
    this.input = makeInputChannel();
    this.pendingPermissions = new Map(); // id -> resolve
    this.closed = false;
  }

  emit(kind, payload) {
    if (!this.closed) this.onEvent({ sessionId: this.id, kind, ...payload });
  }

  async start(firstPrompt, resumeId) {
    const { query } = await loadSdk();
    const exe = resolveClaudeExecutable();

    // Packaged builds do not ship the SDK's own 265 MB copy of Claude Code: this
    // app runs on the user's logged-in `claude`, and a bundled binary with no
    // login could not sign in anyway. Say so plainly rather than letting the SDK
    // fail somewhere deeper looking for a file that isn't there.
    if (!exe) {
      this.emit('error', {
        message: 'Claude Code isn\'t installed on this Mac yet. Press ⌘N and pick "Claude Code". '
          + 'Nami runs it on your own subscription, so it has to be installed and logged in. '
          + 'Already have it somewhere unusual? Set CLAUDE_CODE_EXECUTABLE to its path.',
      });
      this.emit('result', { ok: false });
      return;
    }

    const options = {
      cwd: this.cwd,
      permissionMode: 'default',
      includePartialMessages: false,
      settingSources: ['project', 'user'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      canUseTool: (toolName, input, opts) => this.askPermission(toolName, input, opts),
    };
    if (this.model) options.model = this.model;
    options.pathToClaudeCodeExecutable = exe;
    if (resumeId) options.resume = resumeId;

    // Seed the first user turn.
    this.input.push(firstPrompt);

    try {
      this.query = query({ prompt: this.input.iterator, options });
    } catch (err) {
      this.emit('error', { message: String(err && err.message ? err.message : err) });
      return;
    }
    this.pump();
  }

  async pump() {
    try {
      for await (const msg of this.query) {
        if (this.closed) break;
        this.handle(msg);
      }
    } catch (err) {
      this.emit('error', { message: String(err && err.message ? err.message : err) });
    }
  }

  handle(msg) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.sessionId = msg.session_id || this.sessionId;
          this.emit('init', { claudeSessionId: this.sessionId, tools: msg.tools || msg.data?.tools });
        }
        break;

      case 'assistant': {
        const blocks = (msg.message && msg.message.content) || [];
        for (const b of blocks) {
          if (b.type === 'text' && b.text && b.text.trim()) {
            this.emit('assistant', { text: b.text });
          } else if (b.type === 'thinking' && b.thinking) {
            this.emit('thinking', { text: b.thinking });
          } else if (b.type === 'tool_use') {
            if (isTodoTool(b.name)) {
              this.emit('todos', { todos: extractTodos(b.input) });
            } else {
              this.emit('tool', { toolId: b.id, name: b.name, label: labelTool(b.name, b.input), detail: detailTool(b.name, b.input) });
            }
          }
        }
        break;
      }

      case 'user': {
        const blocks = (msg.message && msg.message.content) || [];
        for (const b of blocks) {
          if (b.type === 'tool_result') {
            this.emit('tool_result', { toolId: b.tool_use_id, isError: !!b.is_error });
          }
        }
        break;
      }

      case 'result':
        this.emit('result', {
          ok: msg.subtype === 'success',
          subtype: msg.subtype,
          text: msg.result || '',
          costUsd: msg.total_cost_usd || 0,
          numTurns: msg.num_turns || 0,
          claudeSessionId: msg.session_id || this.sessionId,
        });
        break;

      default:
        break;
    }
  }

  askPermission(toolName, input, opts) {
    return new Promise((resolve) => {
      const pid = `${this.id}:${toolName}:${Date.now()}:${Math.round(perfSeed())}`;
      this.pendingPermissions.set(pid, resolve);
      this.emit('permission', {
        permissionId: pid,
        toolName,
        label: labelTool(toolName, input),
        summary: permissionSummary(toolName, input),
      });
      if (opts && opts.signal) {
        opts.signal.addEventListener('abort', () => {
          if (this.pendingPermissions.has(pid)) {
            this.pendingPermissions.delete(pid);
            resolve({ behavior: 'deny', message: 'Cancelled' });
          }
        }, { once: true });
      }
    });
  }

  resolvePermission(permissionId, allow, note) {
    const resolve = this.pendingPermissions.get(permissionId);
    if (!resolve) return;
    this.pendingPermissions.delete(permissionId);
    if (allow) resolve({ behavior: 'allow' });
    else resolve({ behavior: 'deny', message: note || 'Not now.' });
  }

  send(text) {
    // If the query ended (a completed turn on single result), a fresh push keeps the same
    // streaming session alive; the SDK continues the conversation.
    this.input.push(text);
    this.emit('user_echo', { text });
  }

  async interrupt() {
    try { if (this.query && this.query.interrupt) await this.query.interrupt(); } catch (_) {}
    this.emit('interrupted', {});
  }

  close() {
    this.closed = true;
    for (const [pid, resolve] of this.pendingPermissions) resolve({ behavior: 'deny', message: 'Closed' });
    this.pendingPermissions.clear();
    try { this.input.end(); } catch (_) {}
    try { if (this.query && this.query.close) this.query.close(); } catch (_) {}
  }
}

// A monotonic-ish jitter that avoids Math.random (kept deterministic-friendly).
let _seed = 1;
function perfSeed() { _seed = (_seed * 48271) % 2147483647; return _seed % 1000; }

function isTodoTool(name) {
  return name === 'TodoWrite' || name === 'TaskCreate' || name === 'TaskUpdate' || name === 'TodoRead';
}
function extractTodos(input) {
  if (!input) return [];
  const list = input.todos || input.tasks || (Array.isArray(input) ? input : []);
  if (!Array.isArray(list)) return [];
  return list.map((t) => ({
    text: t.content || t.text || t.title || t.description || String(t),
    status: t.status || (t.completed ? 'completed' : 'pending'),
  }));
}

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function labelTool(name, input) {
  input = input || {};
  switch (name) {
    case 'Bash': return short(input.description || input.command || 'Running a command', 60);
    case 'Read': return `Reading ${baseName(input.file_path)}`;
    case 'Write': return `Writing ${baseName(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Editing ${baseName(input.file_path)}`;
    case 'Glob': return `Finding files (${short(input.pattern, 30)})`;
    case 'Grep': return `Searching for “${short(input.pattern, 30)}”`;
    case 'WebSearch': return `Searching the web`;
    case 'WebFetch': return `Reading ${short(input.url, 40)}`;
    case 'Task': return short(input.description || 'Running a sub-agent', 50);
    default: return short(name, 40);
  }
}
function detailTool(name, input) {
  input = input || {};
  if (name === 'Bash') return short(input.command || '', 60);
  if (input.file_path) return short(input.file_path, 50);
  if (input.pattern) return short(input.pattern, 40);
  if (input.url) return short(input.url, 40);
  return '';
}
function permissionSummary(name, input) {
  input = input || {};
  switch (name) {
    case 'Bash': return `Run: ${short(input.command || '', 120)}`;
    case 'Write': return `Create or overwrite ${short(input.file_path, 90)}`;
    case 'Edit': case 'MultiEdit': return `Edit ${short(input.file_path, 90)}`;
    case 'WebFetch': return `Fetch ${short(input.url, 90)}`;
    default: return `Use ${name}`;
  }
}
function baseName(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '(file)'; }

module.exports = { ClaudeSession, resolveClaudeExecutable };
