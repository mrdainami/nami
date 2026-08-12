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
const fs = require('fs');
const path = require('path');
const { capability, toolKindFor, clip, safeEvent } = require('./../agent-events.js');

// agent id -> how to spawn its ACP endpoint. Growing this table is how
// another ACP agent gets cards.
const ACP_AGENTS = {
  opencode: { program: 'opencode', args: ['acp'], label: 'OpenCode' },
  hermes: { program: 'hermes', args: ['acp'], label: 'Hermes' },
};

const STDERR_CAP = 16 * 1024; // debug ring; stderr is not content

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
      this.child = spawn(spec.program, spec.args, {
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
      this.emit('status', { state: 'idle' });
    });

    try {
      const init = await this._rpc('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: 'nami', version: '0' },
      });
      this.authMethods = (init && init.authMethods) || [];
      const canLoad = !!(init && init.agentCapabilities && init.agentCapabilities.loadSession);

      let sess = null;
      if (sid && canLoad) {
        // The same conversation, replayed: session/load re-sends the history
        // as ordinary updates, which become rows with no special path.
        try { sess = await this._rpc('session/load', { sessionId: sid, cwd: this.cwd, mcpServers: [] }); } catch (_) {}
        if (sess) this.sessionId = sid;
      }
      if (!this.sessionId) {
        sess = await this._rpc('session/new', { cwd: this.cwd, mcpServers: [] });
        this.sessionId = sess && (sess.sessionId || sess.session_id);
      }
      this.readModels(sess);
      this.emitInit();
    } catch (err) {
      const msg = err && (err.message || err.data || JSON.stringify(err));
      this.emit('error', { message: `${spec.label} refused the session: ${String(msg).slice(0, 300)}` });
      // Where the protocol offers a repair, hand it over as a note.
      const term = this.authMethods.find((m) => Array.isArray(m.args));
      if (term) this.emit('note', { text: `Fix it in a terminal: ${spec.program} ${term.args.join(' ')}` });
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
        this.emit('permission', {
          permissionId,
          toolName: String(tc.title || 'tool'),
          title: String(tc.title || 'Permission'),
          description: (tc.locations && tc.locations[0] && tc.locations[0].path) || '',
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
        this.commands = list.map((c) => String(c && c.name || '')).filter(Boolean).slice(0, 200);
        this.emitInit();
        return;
      }

      case 'usage_update':
        this.lastUsage = { used: Number(update.used) || 0, size: Number(update.size) || 0, cost: update.cost || null };
        return;

      case 'current_mode_update':
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
        this.settlePending();
        const usage = this.lastUsage;
        this.emit('turn_end', {
          durationMs: this.turnStarted ? Date.now() - this.turnStarted : 0,
          costUsd: usage && usage.cost && usage.cost.currency === 'USD' ? Number(usage.cost.amount) || 0 : 0,
          tokens: usage ? usage.used : 0,
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

module.exports = { AcpAdapter, ACP_AGENTS };
