// Agents that speak the Agent Client Protocol — JSON-RPC over stdio. One
// client, two verified agents: `opencode acp` and `hermes acp`. Grown from
// _local/acp-probe.mjs, which is where every frame shape here was learned.
//
// ACP types its tool calls (read/edit/execute/…), streams prose as chunks, and
// asks permission with its own option list and its own diff — so this adapter
// mostly relays. The work is in the edges the captures forced: chunks coalesce
// into one growing row, a tool_call_update re-emits the same row, stderr goes
// to a ring buffer and never to a row, and calls still open when the turn ends
// are settled rather than left spinning (Hermes never completes its calls).

const { spawn } = require('child_process');
const { knownBin } = require('./../bin-cache.js');
const fs = require('fs');
const path = require('path');
const { capability, toolKindFor, clip, safeEvent, classifyFailure } = require('./../agent-events.js');

// agent id -> how to spawn its ACP endpoint. Growing this table is how
// another ACP agent gets cards.
const ACP_AGENTS = {
  opencode: { program: 'opencode', args: ['acp'], label: 'OpenCode' },
  hermes: { program: 'hermes', args: ['acp'], label: 'Hermes' },
};

const STDERR_CAP = 16 * 1024; // debug ring; stderr is not content

// The connect calls get deadlines because an ACP rpc only fails when the
// process EXITS — an agent that stays alive but never answers left the card
// on "Connecting — resuming…" forever (hermes, on a slow free-tier endpoint,
// in a real screenshot). A promise that never settles is not an error a
// try/catch can see; a race against the clock is.
const CONNECT_MS = 25000;
function withDeadline(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)}s`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

class AcpAdapter {
  constructor({ id, cwd, env, onEvent, agent }) {
    this.id = id;
    this.cwd = cwd;
    this.env = env;
    this.agent = agent;
    this.onEvent = onEvent;
    this.child = null;
    this.closed = false;
    this.seq = 0;
    this.rpcId = 0;
    this.pendingRpc = new Map();          // our id -> {resolve, reject}
    this.pendingPermissions = new Map();  // permissionId -> { rpcId, options }
    this.openCalls = new Map();           // toolCallId -> { name, toolKind, input, content: [] }
    this.sessionId = null;
    this.commands = [];
    this.models = null;                   // { current, options } from configOptions
    this.modes = null;                    // { current, options: [{id,name,desc}] } — see readModes
    this.authMethods = [];
    this.lastUsage = null;
    this.turnStarted = 0;
    this.stderrBuf = '';
    // Chunks coalesce: one growing row per burst; a tool call or a change of
    // channel (message ↔ thought) starts the next burst.
    this.burst = 0;
    this.burstKind = null;
    this.burstText = '';
  }

  emit(kind, payload) {
    if (this.closed) return;
    const e = safeEvent({ kind, id: `${this.id}:e${++this.seq}`, at: null, ...payload });
    if (e) this.onEvent(e);
  }

  _write(frame) {
    try { this.child.stdin.write(JSON.stringify(frame) + '\n'); } catch (_) {}
  }
  _rpc(method, params) {
    const id = ++this.rpcId;
    this._write({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => this.pendingRpc.set(id, { resolve, reject }));
  }
  _notify(method, params) { this._write({ jsonrpc: '2.0', method, params }); }
  _reply(id, result) { this._write({ jsonrpc: '2.0', id, result }); }
  _replyError(id, message) { this._write({ jsonrpc: '2.0', id, error: { code: -32000, message } }); }

  async start({ prompt, sid }) {
    const spec = ACP_AGENTS[this.agent];
    if (!spec) { this.emit('error', { message: `No ACP endpoint for '${this.agent}'.` }); return false; }

    try {
      this.child = spawn(knownBin(spec.program) || spec.program, spec.args, {
        cwd: this.cwd, env: this.env || process.env, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.emit('error', { message: `${spec.label} could not start: ${err.message}` });
      return false;
    }
    this.child.on('error', (err) => {
      // ENOENT lands here, not in spawn(): say what is missing, plainly.
      this.emit('error', { message: `${spec.label} isn't installed or isn't on PATH (${err.message}).` });
      this.emit('status', { state: 'idle' });
    });

    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg = null;
        try { msg = JSON.parse(line); } catch (_) { continue; } // half a frame costs that frame
        try { this.handleFrame(msg); } catch (_) {}             // and a bad one never costs the tile
      }
    });
    // Hermes logs heavily to stderr; it is debugging, never content.
    this.child.stderr.on('data', (d) => {
      this.stderrBuf = (this.stderrBuf + d.toString('utf8')).slice(-STDERR_CAP);
    });
    this.child.on('exit', (code) => {
      if (this.closed) return;
      if (code && code !== 0) {
        const hint = this.stderrBuf.trim().split('\n').pop() || '';
        this.emit('error', { message: `${spec.label} exited (${code}).${hint ? ' ' + hint.slice(0, 200) : ''}` });
      }
      // A turn cannot end that never will: whatever was awaiting this process
      // fails now, not after a timeout that never comes.
      for (const [id, pending] of this.pendingRpc) {
        this.pendingRpc.delete(id);
        pending.reject(new Error(`${spec.label} exited before answering.`));
      }
      this.emit('status', { state: 'idle' });
    });

    try {
      const init = await withDeadline(this._rpc('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: 'nami', version: '0' },
      }), CONNECT_MS, `${spec.label} initialize`);
      this.authMethods = (init && init.authMethods) || [];
      this.agentInfo = (init && init.agentInfo) || {};
      const canLoad = !!(init && init.agentCapabilities && init.agentCapabilities.loadSession);

      let sess = null;
      if (sid && canLoad) {
        // The same conversation, replayed: session/load re-sends the history
        // as ordinary updates, which become rows with no special path. A load
        // that fails OR stalls falls back to a fresh session — resuming must
        // degrade to "new conversation", never to "wait forever".
        try { sess = await withDeadline(this._rpc('session/load', { sessionId: sid, cwd: this.cwd, mcpServers: [] }), CONNECT_MS, `${spec.label} session/load`); } catch (_) {}
        if (sess) this.sessionId = sid;
        else this.emit('note', { text: `Couldn't reload the old conversation — starting a fresh one. The old history is still in ${spec.label}'s own terminal.` });
      }
      if (!this.sessionId) {
        sess = await withDeadline(this._rpc('session/new', { cwd: this.cwd, mcpServers: [] }), CONNECT_MS, `${spec.label} session/new`);
        this.sessionId = sess && (sess.sessionId || sess.session_id);
      }
      this.readModels(sess);
      this.readModes(sess);
      this.emitInit();
    } catch (err) {
      const msg = err && (err.message || err.data || JSON.stringify(err));
      this.emit('error', { message: `${spec.label} refused the session: ${String(msg).slice(0, 300)}` });
      // Where the protocol offers a repair, hand it over as a note.
      // Where the protocol offers a repair — hermes advertises
      // {args:["--setup"]} — the card offers that exact button.
      const term = this.authMethods.find((m) => Array.isArray(m.args));
      if (term) {
        this.emit('note', {
          text: `${spec.label} needs configuring before cards can drive it.`,
          action: { label: 'Configure in a terminal', command: `${spec.program} ${term.args.join(' ')}` },
        });
      }
      return false;
    }

    if (prompt) this.send(prompt);
    return true;
  }

  readModels(sess) {
    const opt = sess && Array.isArray(sess.configOptions)
      && sess.configOptions.find((o) => o && o.id === 'model' && Array.isArray(o.options));
    if (opt) {
      this.models = {
        current: opt.currentValue || null,
        options: opt.options.slice(0, 400).map((o) => ({ value: o.value, name: o.name || o.value })),
      };
    }
  }

  // The agent's own mode list, wherever it chose to say it. Two real shapes
  // (probed 2026-08-16): the ACP spec's result.modes {currentModeId,
  // availableModes} (hermes-style), and opencode's configOptions entry
  // {id:'mode', type:'select'} — the same envelope its models arrive in.
  // No modes said → this.modes stays null and the card grows no chip.
  readModes(sess) {
    const spec = sess && sess.modes && Array.isArray(sess.modes.availableModes) && sess.modes.availableModes.length
      ? sess.modes : null;
    if (spec) {
      this.modes = {
        current: spec.currentModeId || spec.availableModes[0].id,
        options: spec.availableModes.map((m) => ({ id: String(m.id), name: m.name || String(m.id), desc: String(m.description || '') })),
      };
      return;
    }
    const opt = sess && Array.isArray(sess.configOptions)
      && sess.configOptions.find((o) => o && o.id === 'mode' && Array.isArray(o.options) && o.options.length);
    if (opt) {
      this.modes = {
        current: opt.currentValue || opt.options[0].value,
        options: opt.options.map((o) => ({ id: String(o.value), name: o.name || String(o.value), desc: String(o.description || '') })),
      };
    }
  }

  emitInit() {
    this.emit('init', {
      capability: capability({
        drive: true, interrupt: true, ask: true,
        commands: this.commands.length > 0, models: !!this.models,
        channel: 'acp',
      }),
      agentSessionId: this.sessionId || null,
      commands: this.commands,
      models: this.models,
      model: (this.models && this.models.current) || null,
      mode: (this.modes && this.modes.current) || undefined,
      modes: this.modes
        ? this.modes.options.map((m) => ({ id: m.id, available: true, desc: m.desc }))
        : undefined,
      agentName: (this.agentInfo && this.agentInfo.name) || null,
      version: (this.agentInfo && this.agentInfo.version) || null,
      authMethods: this.authMethods,
    });
  }

  // One parsed JSON-RPC frame from the agent. Never throws on the unknown.
  handleFrame(msg) {
    if (!msg || typeof msg !== 'object') return;

    // A response to something we asked.
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && this.pendingRpc.has(msg.id)) {
      const p = this.pendingRpc.get(msg.id);
      this.pendingRpc.delete(msg.id);
      if (msg.error) p.reject(msg.error); else p.resolve(msg.result);
      return;
    }

    // A request FROM the agent.
    if (msg.id !== undefined && msg.method) { this.handleRequest(msg); return; }

    // A notification.
    if (msg.method === 'session/update') {
      const update = msg.params && msg.params.update;
      if (update && typeof update === 'object') this.handleUpdate(update);
    }
  }

  handleRequest(msg) {
    const params = msg.params || {};
    switch (msg.method) {
      case 'fs/read_text_file': {
        try {
          let content = fs.readFileSync(params.path, 'utf8');
          if (params.line || params.limit) {
            const lines = content.split('\n');
            const from = Math.max(0, (Number(params.line) || 1) - 1);
            content = lines.slice(from, params.limit ? from + Number(params.limit) : undefined).join('\n');
          }
          this._reply(msg.id, { content });
        } catch (err) {
          this._replyError(msg.id, String(err.message || err));
        }
        return;
      }
      case 'fs/write_text_file': {
        // The agent already holds its own permission gate; this one is ours:
        // a session is scoped to the folder it was opened in.
        const target = path.resolve(String(params.path || ''));
        const root = path.resolve(this.cwd) + path.sep;
        if (!target.startsWith(root)) { this._replyError(msg.id, 'Path is outside this session\'s folder.'); return; }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, String(params.content == null ? '' : params.content));
          this._reply(msg.id, {});
        } catch (err) {
          this._replyError(msg.id, String(err.message || err));
        }
        return;
      }
      case 'session/request_permission': {
        const tc = params.toolCall || {};
        const options = (Array.isArray(params.options) ? params.options : [])
          .map((o) => ({ id: String(o.optionId), label: String(o.name || o.optionId), kind: o.kind }));
        const permissionId = `${this.id}:p${++this.seq}`;
        this.pendingPermissions.set(permissionId, { rpcId: msg.id });
        // OpenCode titles a write ask with the file's whole absolute path;
        // the card wants a name, and the path once, as a link.
        const rawTitle = String(tc.title || 'Permission');
        const title = rawTitle.includes('/') ? (rawTitle.split('/').filter(Boolean).pop() || rawTitle) : rawTitle;
        this.emit('permission', {
          permissionId,
          toolName: title,
          title,
          description: '',
          input: tc.rawInput || {},
          diff: contentDiff(tc.content),
          options,
        });
        return;
      }
      default:
        // Tolerate what we do not know — an empty result, never a crash.
        this._reply(msg.id, {});
    }
  }

  handleUpdate(update) {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': this.chunk('assistant', update); return;
      case 'agent_thought_chunk': this.chunk('thinking', update); return;

      case 'tool_call': {
        this.breakBurst();
        const call = {
          name: String(update.title || 'tool'),
          toolKind: toolKindFor(update.kind, { typed: true }),
          input: update.rawInput || {},
          content: [],
        };
        this.openCalls.set(update.toolCallId, call);
        this.emitTool(update.toolCallId, call);
        this.absorbContent(update.toolCallId, update);
        this.finishIfDone(update.toolCallId, update);
        return;
      }

      case 'tool_call_update': {
        const call = this.openCalls.get(update.toolCallId);
        if (!call) return;
        // The update often knows more than the call did — opencode announces
        // `bash` and only the update says `ls`. Same row, better words.
        let better = false;
        if (update.title && update.title !== call.name) { call.name = String(update.title); better = true; }
        if (update.rawInput && Object.keys(update.rawInput).length > Object.keys(call.input).length) { call.input = update.rawInput; better = true; }
        if (update.kind) {
          const k = toolKindFor(update.kind, { typed: true });
          if (k !== call.toolKind) { call.toolKind = k; better = true; }
        }
        if (better) this.emitTool(update.toolCallId, call);
        this.absorbContent(update.toolCallId, update);
        this.finishIfDone(update.toolCallId, update);
        return;
      }

      case 'plan': {
        const entries = Array.isArray(update.entries) ? update.entries : [];
        this.emit('plan', {
          todos: entries.map((t) => ({
            text: String((t && (t.content || t.title)) || ''),
            status: (t && t.status) || 'pending',
          })),
        });
        return;
      }

      case 'available_commands_update': {
        const list = Array.isArray(update.availableCommands) ? update.availableCommands : [];
        // name AND description ride through — the menu shows what each does.
        this.commands = list
          .filter((c) => c && c.name)
          .slice(0, 200)
          .map((c) => ({ name: String(c.name), description: String(c.description || '') }));
        this.emitInit();
        return;
      }

      case 'usage_update':
        this.lastUsage = { used: Number(update.used) || 0, size: Number(update.size) || 0, cost: update.cost || null };
        // mid-turn usage feeds the working line live
        if (this.turnStarted) this.emit('status', { state: 'running', tokens: this.lastUsage.used });
        return;

      case 'current_mode_update': {
        // The agent changed its own mode (or confirmed ours): the chip follows.
        const id = update.currentModeId || update.current_mode_id;
        if (id && this.modes && this.modes.options.some((m) => m.id === id)) {
          this.modes.current = String(id);
          this.emitInit();
        }
        return; // a state change, never a row
      }

      case 'session_info_update':
        return; // real, just not rows

      default:
        return; // an update we have never seen costs nothing
    }
  }

  // ---- chunks → one growing row per burst -----------------------------------
  chunk(kind, update) {
    const text = update && update.content && update.content.type === 'text' ? String(update.content.text || '') : '';
    if (!text) return;
    if (this.burstKind !== kind) { this.burst++; this.burstKind = kind; this.burstText = ''; }
    this.burstText += text;
    // The id is stable across the burst, so the renderer grows one row.
    if (this.closed) return;
    const e = safeEvent({ kind, id: `${this.id}:b${this.burst}`, at: null, text: this.burstText });
    if (e) this.onEvent(e);
  }
  breakBurst() { this.burstKind = null; }

  emitTool(toolCallId, call) {
    if (this.closed) return;
    // Same id per call on purpose: buildRows updates the row in place.
    const e = safeEvent({
      kind: 'tool', id: `${this.id}:t:${toolCallId}`, at: null,
      toolId: toolCallId, name: call.name, toolKind: call.toolKind, input: call.input,
    });
    if (e) this.onEvent(e);
  }

  absorbContent(toolCallId, update) {
    const call = this.openCalls.get(toolCallId);
    if (!call || !Array.isArray(update.content)) return;
    for (const c of update.content) {
      if (!c) continue;
      if (c.type === 'content' && c.content && c.content.type === 'text') call.content.push(String(c.content.text || ''));
      else if (c.type === 'diff') call.diff = { path: String(c.path || ''), oldText: String(c.oldText || ''), newText: String(c.newText || '') };
    }
  }

  finishIfDone(toolCallId, update) {
    if (update.status !== 'completed' && update.status !== 'failed') return;
    const call = this.openCalls.get(toolCallId);
    if (!call) return;
    this.openCalls.delete(toolCallId);
    const { body, truncated } = clip(call.content.join('\n'));
    this.emit('tool_result', {
      toolId: toolCallId, isError: update.status === 'failed',
      body, truncated, diff: call.diff || null,
    });
  }

  // Pending is not permanent: whatever is still open when the turn ends
  // settles to done-unknown instead of spinning forever.
  settlePending() {
    for (const [toolCallId] of this.openCalls) {
      this.openCalls.delete(toolCallId);
      this.emit('tool_result', { toolId: toolCallId, isError: false, body: '', truncated: false });
    }
    this.breakBurst();
  }

  // ---- driving --------------------------------------------------------------
  send(text) {
    if (!this.sessionId) { this.emit('error', { message: 'No session to send into.' }); return; }
    this.emit('user', { text });
    this.emit('status', { state: 'running' });
    this.breakBurst();
    this.turnStarted = Date.now();
    this._rpc('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] })
      .then((result) => {
        // Failure is not prose: a provider error that arrived as the whole
        // answer becomes an error row, so the turn reads as what it was.
        const failure = classifyFailure(this.burstKind === 'assistant' ? this.burstText : '');
        if (failure) this.emit('error', { message: failure });
        this.settlePending();
        const usage = this.lastUsage;
        this.emit('turn_end', {
          durationMs: this.turnStarted ? Date.now() - this.turnStarted : 0,
          costUsd: usage && usage.cost && usage.cost.currency === 'USD' ? Number(usage.cost.amount) || 0 : 0,
          tokens: usage ? usage.used : 0,
          // ACP reports used/size directly — the honest context gauge.
          ctxPct: usage && usage.size > 0 ? Math.max(1, Math.min(99, 100 - Math.round((usage.used / usage.size) * 100))) : undefined,
          ok: !result || result.stopReason !== 'refusal',
        });
        if (result && result.stopReason && result.stopReason !== 'end_turn' && result.stopReason !== 'cancelled') {
          this.emit('note', { text: `Turn stopped: ${result.stopReason}.` });
        }
        this.emit('status', { state: 'idle' });
      })
      .catch((err) => {
        this.settlePending();
        if (!this.closed) {
          this.emit('error', { message: String(err && (err.message || err.data) || err).slice(0, 300) });
          this.emit('status', { state: 'idle' });
        }
      });
  }

  resolvePermission(permissionId, optionId) {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return;
    this.pendingPermissions.delete(permissionId);
    this._reply(pending.rpcId, { outcome: { outcome: 'selected', optionId } });
    this.emit('permission_resolved', { permissionId, optionId });
  }

  setConfigOption(configId, value) {
    if (!this.sessionId) return;
    // Mode has its own verb in the protocol. The chip only flips on the
    // agent's yes — opencode answers set_mode with {} and sends no
    // current_mode_update, so the success path re-inits by itself; an agent
    // that does notify just re-confirms the same state.
    if (configId === 'mode') {
      this._rpc('session/set_mode', { sessionId: this.sessionId, modeId: String(value) })
        .then(() => {
          if (this.modes && this.modes.options.some((m) => m.id === String(value))) this.modes.current = String(value);
          this.emitInit();
        })
        .catch((err) => this.emit('note', { text: `Could not switch mode: ${String(err && err.message || err).slice(0, 120)}` }));
      return;
    }
    this._rpc('session/set_config_option', { sessionId: this.sessionId, configId, value })
      .then((res) => { this.readModels(res); this.emitInit(); })
      .catch((err) => this.emit('note', { text: `Could not change ${configId}: ${String(err && err.message || err).slice(0, 120)}` }));
  }

  interrupt() {
    if (this.sessionId) this._notify('session/cancel', { sessionId: this.sessionId });
    this.emit('note', { text: 'Interrupted.' });
  }

  close() {
    this.closed = true;
    for (const [, pending] of this.pendingPermissions) {
      try { this._reply(pending.rpcId, { outcome: { outcome: 'cancelled' } }); } catch (_) {}
    }
    this.pendingPermissions.clear();
    try { if (this.child) this.child.kill(); } catch (_) {}
  }
}

function contentDiff(content) {
  if (!Array.isArray(content)) return null;
  const d = content.find((c) => c && c.type === 'diff');
  if (!d) return null;
  return { path: String(d.path || ''), oldText: String(d.oldText || ''), newText: String(d.newText || '') };
}

module.exports = { AcpAdapter, ACP_AGENTS, withDeadline };;
