// Codex over `codex exec --json` — a one-shot channel: each send spawns a
// turn, the stream is item.* frames, and the thread id lets the next send
// resume the same conversation. Codex has no file tools: everything is a
// shell command with an exit code, and it reports tokens, not dollars.

const { spawn } = require('child_process');
const { capability, clip, safeEvent } = require('./../agent-events.js');

const CAPABILITY = {
  drive: true, interrupt: true, ask: false, channel: 'one-shot',
  note: 'headless: approvals run by its own config',
};

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
    this.turnStarted = 0;
  }

  emit(kind, payload) {
    if (this.closed) return;
    const e = safeEvent({ kind, id: `${this.id}:e${++this.seq}`, at: null, ...payload });
    if (e) this.onEvent(e);
  }

  emitInit() {
    this.emit('init', {
      capability: capability(CAPABILITY),
      agentSessionId: this.threadId,
      commands: [],
    });
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

    const args = this.threadId
      ? ['exec', 'resume', this.threadId, '--json', '--skip-git-repo-check', text]
      : ['exec', '--json', '--skip-git-repo-check', text];
    let child;
    try {
      child = spawn('codex', args, { cwd: this.cwd, env: this.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
          costUsd: 0, ok: true,
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

module.exports = { CodexAdapter, unwrapShell };
