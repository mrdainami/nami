// Codex over `codex exec --json` — a one-shot channel: each send spawns a
// turn, the stream is item.* frames, and the thread id lets the next send
// resume the same conversation. Codex has no file tools: everything is a
// shell command with an exit code, and it reports tokens, not dollars.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { knownBin } = require('./../bin-cache.js');
const { capability, clip, safeEvent } = require('./../agent-events.js');

const CAPABILITY = {
  drive: true, interrupt: true, ask: false, channel: 'one-shot',
  note: 'headless: approvals run by its own config',
};

// The CLI's own preset vocabulary (TUI /approvals, probed on 0.147.0), in
// cycle order, expressed as next-turn flags: 'auto' passes nothing — it is
// codex's default; 'read-only' maps to --sandbox read-only; 'full-access'
// is its dangerously- flag, warned amber in the card like every bypass.
// Pinned to the installed CLI — re-probe when bumping codex.
const CODEX_MODES = ['auto', 'read-only', 'full-access'];

// The models codex's own /model picker offers (v0.5x) — exec has no way to
// enumerate them, so the list is curated from the TUI's picker and the
// current one is read from ~/.codex/config.toml. A model this list doesn't
// know still works: /model <name> passes any value straight to --model.
const CODEX_MODELS = [
  { value: 'gpt-5.6-terra', name: 'gpt-5.6-terra', desc: 'balanced agentic coding model for everyday work' },
  { value: 'gpt-5.6-luna', name: 'gpt-5.6-luna', desc: 'fast and affordable agentic coding model' },
  { value: 'gpt-5.5', name: 'gpt-5.5', desc: 'frontier model for complex coding, research and real-world work' },
  { value: 'gpt-5.4-mini', name: 'gpt-5.4-mini', desc: 'small, fast and cost-efficient for simpler tasks' },
];

function readDefaultModel() {
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
    const m = /^\s*model\s*=\s*"([^"]+)"/m.exec(toml);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

// The current model always appears in its own picker, even when the curated
// list has never heard of it — a user-configured alias is not a rendering
// error.
function modelOptions(current) {
  const opts = CODEX_MODELS.slice();
  if (current && !opts.some((o) => o.value === current)) {
    opts.unshift({ value: current, name: current, desc: 'from your codex config' });
  }
  return opts;
}

function short(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// codex wraps every command in `/bin/zsh -lc "…"`; the row wants the command.
function unwrapShell(command) {
  const m = /^\S*(?:zsh|bash|sh)\s+-lc\s+([\s\S]+)$/.exec(String(command || ''));
  if (!m) return String(command || '');
  let inner = m[1].trim();
  if ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'"))) {
    inner = inner.slice(1, -1);
  }
  return inner;
}

class CodexAdapter {
  constructor({ id, cwd, env, onEvent }) {
    this.id = id;
    this.cwd = cwd;
    this.env = env;
    this.onEvent = onEvent;
    this.closed = false;
    this.seq = 0;
    this.child = null;
    this.threadId = null;
    this.model = null; // rides the next turn's flags — the channel is one-shot
    this.mode = 'auto'; // ditto: sandbox/approval flags on the next spawn
    this.turnStarted = 0;
  }

  emit(kind, payload) {
    if (this.closed) return;
    const e = safeEvent({ kind, id: `${this.id}:e${++this.seq}`, at: null, ...payload });
    if (e) this.onEvent(e);
  }

  emitInit() {
    const current = this.model || readDefaultModel() || CODEX_MODELS[0].value;
    this.emit('init', {
      capability: capability({ ...CAPABILITY, models: true }),
      agentSessionId: this.threadId,
      commands: [],
      model: current,
      models: { current, options: modelOptions(current) },
      mode: this.mode || 'auto',
      // every mode is a spawn flag on this channel, so all are available
      modes: CODEX_MODES.map((id) => ({ id, available: true })),
    });
  }

  // /model and /approvals on a one-shot channel: no live process to
  // instruct, but the exec flags exist — the choice is kept and every
  // following turn spawns with it. Same pattern as agy's mode.
  setConfigOption(configId, value) {
    if (configId === 'model') {
      this.model = String(value || '') || null;
      if (this.model) this.emit('note', { text: `model ${this.model} — applies from the next turn` });
    } else if (configId === 'mode') {
      this.mode = CODEX_MODES.includes(String(value)) ? String(value) : 'auto';
    } else return;
    this.emitInit();
  }

  // The next turn's argv, pure for the tests.
  turnArgs(text) {
    const args = this.threadId
      ? ['exec', 'resume', this.threadId, '--json', '--skip-git-repo-check']
      : ['exec', '--json', '--skip-git-repo-check'];
    if (this.model) args.push('--model', this.model);
    if (this.mode === 'full-access') args.push('--dangerously-bypass-approvals-and-sandbox');
    else if (this.mode === 'read-only') args.push('--sandbox', 'read-only');
    args.push(text);
    return args;
  }

  async start({ prompt, sid }) {
    this.threadId = sid || null;
    this.emitInit();
    if (prompt) this.send(prompt);
    return true;
  }

  send(text) {
    if (this.child) { this.emit('note', { text: 'Still running — one task at a time on this channel.' }); return; }
    this.emit('user', { text });
    this.emit('status', { state: 'running' });
    this.turnStarted = Date.now();

    const args = this.turnArgs(text);
    let child;
    try {
      child = spawn(knownBin('codex') || 'codex', args, { cwd: this.cwd, env: this.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.emit('error', { message: `Codex could not start: ${err.message}` });
      this.emit('status', { state: 'idle' });
      return;
    }
    this.child = child;
    child.on('error', (err) => {
      this.emit('error', { message: `Codex isn't installed or isn't on PATH (${err.message}).` });
      this.finishTurn(null);
    });

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg = null;
        try { msg = JSON.parse(line); } catch (_) { continue; }
        try { this.handleLine(msg); } catch (_) {}
      }
    });
    let errBuf = '';
    child.stderr.on('data', (d) => { errBuf = (errBuf + d.toString('utf8')).slice(-8192); });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.closed) return;
      if (code && code !== 0 && !this.sawTurnEnd) {
        const hint = errBuf.trim().split('\n').pop() || '';
        this.emit('error', { message: `Codex exited (${code}).${hint ? ' ' + hint.slice(0, 200) : ''}` });
      }
      this.finishTurn(null);
    });
  }

  // One parsed frame from `codex exec --json`. Testable without a process.
  handleLine(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'thread.started':
        if (msg.thread_id && msg.thread_id !== this.threadId) {
          this.threadId = msg.thread_id;
          this.emitInit(); // the id the next send resumes
        }
        return;

      case 'turn.started':
        this.sawTurnEnd = false;
        // the one frame that marks turn-start; the working line rides it
        this.emit('status', { state: 'running' });
        return;

      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const item = msg.item;
        if (!item || typeof item !== 'object') return;
        this.handleItem(item, msg.type === 'item.completed');
        return;
      }

      case 'turn.completed': {
        this.sawTurnEnd = true;
        const u = msg.usage || {};
        this.emit('turn_end', {
          durationMs: this.turnStarted ? Date.now() - this.turnStarted : 0,
          tokens: (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0),
          ok: true,
        });
        return;
      }

      case 'turn.failed':
        this.sawTurnEnd = true;
        this.emit('error', { message: String((msg.error && msg.error.message) || 'The turn failed.') });
        return;

      default:
        return;
    }
  }

  handleItem(item, completed) {
    switch (item.type) {
      case 'agent_message':
        if (item.text) this.emit('assistant', { text: String(item.text) });
        return;
      case 'reasoning':
        if (item.text) this.emit('thinking', { text: String(item.text) });
        return;
      case 'command_execution': {
        const command = unwrapShell(item.command);
        if (!this.openItems) this.openItems = new Set();
        if (!this.openItems.has(item.id)) {
          this.openItems.add(item.id);
          // Same id per item: the row updates in place when it completes.
          const e = safeEvent({
            kind: 'tool', id: `${this.id}:t:${item.id}`, at: null,
            toolId: item.id, name: short(command, 64), toolKind: 'execute',
            input: { command },
          });
          if (e && !this.closed) this.onEvent(e);
        }
        if (completed) {
          this.openItems.delete(item.id);
          const { body, truncated } = clip(String(item.aggregated_output || ''));
          this.emit('tool_result', {
            toolId: item.id,
            isError: item.exit_code != null && item.exit_code !== 0,
            body, truncated,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  finishTurn() {
    // Anything still open settles; the meter closed the turn already if the
    // stream said so.
    if (this.openItems) {
      for (const id of this.openItems) this.emit('tool_result', { toolId: id, isError: false, body: '', truncated: false });
      this.openItems.clear();
    }
    this.emit('status', { state: 'idle' });
  }

  resolvePermission() {} // headless cannot be asked

  interrupt() {
    // The one interrupt a one-shot has: stop the turn.
    if (this.child) { try { this.child.kill(); } catch (_) {} this.emit('note', { text: 'Stopped.' }); }
  }

  close() {
    this.closed = true;
    try { if (this.child) this.child.kill(); } catch (_) {}
  }
}

module.exports = { CodexAdapter, unwrapShell, modelOptions, CODEX_MODELS };
