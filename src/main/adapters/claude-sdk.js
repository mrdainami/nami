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

// Which permission modes this session can actually enter — the renderer's
// chip offers exactly this list, never a hardcoded table. Settings (managed,
// user or project) can disable bypass outright; offering it anyway meant the
// switch silently failed. Reads are best-effort: an unreadable file changes
// nothing.
const MODE_IDS = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
function permissionModes({ cwd, home = os.homedir(), readFile } = {}) {
  const read = readFile || ((p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } });
  const files = [
    ['/Library/Application Support/ClaudeCode/managed-settings.json', 'disabled by managed settings'],
    [home + '/.claude/settings.json', 'disabled in ~/.claude/settings.json'],
    cwd ? [cwd + '/.claude/settings.json', 'disabled in project settings'] : null,
    cwd ? [cwd + '/.claude/settings.local.json', 'disabled in project settings'] : null,
  ].filter(Boolean);
  let bypassReason = '';
  for (const [file, why] of files) {
    const raw = read(file);
    if (!raw) continue;
    let s = null;
    try { s = JSON.parse(raw); } catch (_) { continue; }
    const v = s && (s.disableBypassPermissionsMode || (s.permissions && s.permissions.disableBypassPermissionsMode));
    if (v === 'disable') bypassReason = why;
  }
  return MODE_IDS.map((id) => (id === 'bypassPermissions' && bypassReason
    ? { id, available: false, reason: bypassReason }
    : { id, available: true }));
}

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
    this.permModes = permissionModes({ cwd });
    // Silent-approval bookkeeping: which tools the card was actually asked
    // about, and which toolIds map to which names — so the first edit or
    // command that runs unasked in default mode can say who allowed it.
    this.askedNames = new Set();
    this.toolNames = new Map();
    this.saidAutoAllow = false;
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
    // Force the CLI awake: with no first prompt the stream idles unbooted and
    // the init frame never comes — but these control calls boot it and hand
    // back the real command and model lists in one move.
    this.bootstrap();
    return true;
  }

  async bootstrap() {
    if (!this.query) return;
    try {
      const [cmds, models] = await Promise.all([
        this.query.supportedCommands ? this.query.supportedCommands() : [],
        this.query.supportedModels ? this.query.supportedModels() : [],
      ]);
      if (this.closed) return;
      this.richCommands = (Array.isArray(cmds) ? cmds : []).slice(0, 200).map((c) => ({
        name: String(c.name || ''), description: String(c.description || ''), argumentHint: String(c.argumentHint || ''),
      }));
      this.models = (Array.isArray(models) && models.length) ? {
        current: (this.initMeta && this.initMeta.model) || this.model || null,
        options: models.map((m) => ({ value: String(m.value || ''), name: String(m.displayName || m.value || '') })),
      } : null;
      this.emit('init', {
        capability: capability({ ...CAPABILITY, commands: this.richCommands.length > 0, models: !!this.models }),
        agentSessionId: this.sessionId,
        commands: this.richCommands,
        models: this.models,
        modes: this.permModes,
        ...(this.initMeta || { agentName: 'Claude Code', mode: 'default' }),
      });
    } catch (_) {}
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
        // The CLI streams a token estimate while it thinks; the working line
        // shows it live, the way the TUI's spinner does.
        if (msg.subtype === 'thinking_tokens' && msg.estimated_tokens) {
          this.emit('status', { state: 'running', tokens: Number(msg.estimated_tokens) || 0 });
        }
        if (msg.subtype === 'init') {
          this.sessionId = msg.session_id || this.sessionId;
          const commands = Array.isArray(msg.slash_commands) ? msg.slash_commands.slice(0, 200) : [];
          this.initMeta = {
            agentName: 'Claude Code',
            version: msg.claude_code_version || null,
            model: msg.model || null,
            mode: msg.permissionMode || 'default',
          };
          this.emit('init', {
            capability: capability({ ...CAPABILITY, commands: commands.length > 0 }),
            agentSessionId: this.sessionId,
            commands,
            modes: this.permModes,
            ...this.initMeta,
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
              if (b.id) this.toolNames.set(b.id, String(b.name || ''));
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
          this.noteSilentApproval(b);
        }
        break;
      }

      case 'result': {
        this.sessionId = msg.session_id || this.sessionId;
        // Context left, from the usage the channel reports: everything that
        // went in this turn against the 200k window.
        const u = msg.usage || {};
        const used = (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
        this.emit('turn_end', {
          durationMs: Number(msg.duration_ms || msg.duration_api_ms) || 0,
          costUsd: Number(msg.total_cost_usd) || 0,
          numTurns: Number(msg.num_turns) || 0,
          ctxPct: used > 0 ? Math.max(1, Math.min(99, 100 - Math.round(used / 2000))) : undefined,
          ok: !msg.is_error && msg.subtype !== 'error_during_execution',
        });
      }
        if (msg.is_error && msg.result) this.emit('error', { message: String(msg.result) });
        this.emit('status', { state: 'idle' });
        break;

      default:
        break;
    }
  }

  // What made cards look like forced bypass: settings allow-rules approve
  // before canUseTool is ever consulted, so an edit or command just… runs.
  // The first time that happens in default mode, one note says who allowed
  // it. Reads stay silent (the SDK allows those by design), asked tools stay
  // silent (the card answered), and other modes stay silent (the mode is the
  // approval). Once per session — a fact, not a nag.
  noteSilentApproval(b) {
    if (this.saidAutoAllow || b.is_error) return;
    const name = this.toolNames.get(b.tool_use_id);
    if (!name || this.askedNames.has(name)) return;
    const kind = toolKindFor(name);
    if (kind !== 'execute' && kind !== 'edit') return;
    if (((this.initMeta && this.initMeta.mode) || 'default') !== 'default') return;
    this.saidAutoAllow = true;
    this.emit('note', { text: `${name} ran without asking — allowed by your settings rules. Rule-approved calls run silently in cards too.` });
  }

  // canUseTool, surfaced. The event carries what the agent sent — its own
  // title, its own description, one option per suggestion — and the promise
  // stays open until the card answers or the turn is cancelled.
  askPermission(toolName, input, opts) {
    this.askedNames.add(String(toolName || ''));
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
      // Worded to keep the turn alive: a denial is feedback, not a wall.
      pending.resolve({ behavior: 'deny', message: 'The user declined this action — take a different approach or ask what they would prefer.' });
    }
  }

  // The composer's dials, applied live over the channel's own controls.
  setConfigOption(configId, value) {
    if (!this.query) return;
    if (configId === 'mode') {
      const apply = this.query.setPermissionMode && this.query.setPermissionMode(String(value));
      Promise.resolve(apply)
        .then(() => {
          this.initMeta = Object.assign(this.initMeta || {}, { mode: String(value) });
          this.emit('init', {
            capability: capability(CAPABILITY), agentSessionId: this.sessionId,
            models: this.models || undefined, modes: this.permModes,
            ...(this.initMeta || { agentName: 'Claude Code' }),
          });
        })
        .catch(() => {
          // The chip must never show a mode the agent refused: the note says
          // what happened and a re-init with the old mode reverts the display.
          this.emit('note', { text: `Could not switch to ${value} mode — staying in ${(this.initMeta && this.initMeta.mode) || 'default'}.` });
          this.emit('init', {
            capability: capability(CAPABILITY), agentSessionId: this.sessionId,
            models: this.models || undefined, modes: this.permModes,
            ...(this.initMeta || { agentName: 'Claude Code', mode: 'default' }),
          });
        });
      return;
    }
    if (configId === 'model') {
      const apply = this.query.setModel && this.query.setModel(String(value));
      Promise.resolve(apply)
        .then(() => {
          this.initMeta = Object.assign(this.initMeta || {}, { model: String(value) });
          if (this.models) this.models.current = String(value);
          this.emit('init', {
            capability: capability(CAPABILITY), agentSessionId: this.sessionId,
            models: this.models || undefined, modes: this.permModes,
            ...(this.initMeta || { agentName: 'Claude Code' }),
          });
        })
        .catch(() => this.emit('note', { text: `Could not switch model.` }));
    }
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

module.exports = { ClaudeSdkAdapter, resolveClaudeExecutable, sdkOptions, permissionModes };
