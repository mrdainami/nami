// Kimi Code over `kimi -p --output-format stream-json` — a one-shot channel
// with OpenAI-shaped frames: assistant tool_calls, role:"tool" results, and a
// session.resume_hint that lets the composer continue instead of restart.
// Its tool names are Claude-shaped (Read, Write, Bash…), so the ordinary
// name → kind mapping applies.

const { spawn } = require('child_process');
const { capability, toolKindFor, clip, safeEvent } = require('./../agent-events.js');

const CAPABILITY = {
  drive: true, interrupt: true, ask: false, channel: 'one-shot',
  note: 'headless: approvals run by its own config',
};

class KimiAdapter {
  constructor({ id, cwd, env, onEvent }) {
    this.id = id;
    this.cwd = cwd;
    this.env = env;
    this.onEvent = onEvent;
    this.closed = false;
    this.seq = 0;
    this.child = null;
    this.sessionId = null;
    this.turnStarted = 0;
    this.openCalls = new Set();
  }

  emit(kind, payload) {
    if (this.closed) return;
    const e = safeEvent({ kind, id: `${this.id}:e${++this.seq}`, at: null, ...payload });
    if (e) this.onEvent(e);
  }

  emitInit() {
    this.emit('init', {
      capability: capability(CAPABILITY),
      agentSessionId: this.sessionId,
      commands: [],
    });
  }

  async start({ prompt, sid }) {
    this.sessionId = sid || null;
    this.emitInit();
    if (prompt) this.send(prompt);
    return true;
  }

  send(text) {
    if (this.child) { this.emit('note', { text: 'Still running — one task at a time on this channel.' }); return; }
    this.emit('user', { text });
    this.emit('status', { state: 'running' });
    this.turnStarted = Date.now();

    // -p takes the prompt as its value — flags after it would be swallowed,
    // so the prompt comes right behind it and the format flag after.
    const args = this.sessionId
      ? ['-r', this.sessionId, '-p', text, '--output-format', 'stream-json']
      : ['-p', text, '--output-format', 'stream-json'];
    let child;
    try {
      child = spawn('kimi', args, { cwd: this.cwd, env: this.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.emit('error', { message: `Kimi could not start: ${err.message}` });
      this.emit('status', { state: 'idle' });
      return;
    }
    this.child = child;
    child.on('error', (err) => {
      this.emit('error', { message: `Kimi isn't installed or isn't on PATH (${err.message}).` });
      this.finishTurn();
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
      if (code && code !== 0) {
        const hint = errBuf.trim().split('\n').pop() || '';
        this.emit('error', { message: `Kimi exited (${code}).${hint ? ' ' + hint.slice(0, 200) : ''}` });
      }
      this.emit('turn_end', {
        durationMs: this.turnStarted ? Date.now() - this.turnStarted : 0,
        costUsd: 0, ok: !code,
      });
      this.finishTurn();
    });
  }

  // One parsed frame from kimi's stream. Testable without a process.
  handleLine(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.role === 'meta') {
      if (msg.type === 'session.resume_hint' && msg.session_id && msg.session_id !== this.sessionId) {
        this.sessionId = String(msg.session_id);
        this.emitInit(); // the id the next send resumes with -r
      }
      return;
    }

    if (msg.role === 'assistant') {
      if (Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          if (!call || !call.function) continue;
          let input = {};
          try { input = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
          this.openCalls.add(call.id);
          if (this.closed) continue;
          const e = safeEvent({
            kind: 'tool', id: `${this.id}:t:${call.id}`, at: null,
            toolId: call.id, name: String(call.function.name || 'tool'),
            toolKind: toolKindFor(call.function.name), input,
          });
          if (e) this.onEvent(e);
        }
      }
      if (typeof msg.content === 'string' && msg.content.trim()) this.emit('assistant', { text: msg.content });
      return;
    }

    if (msg.role === 'tool') {
      this.openCalls.delete(msg.tool_call_id);
      const { body, truncated } = clip(String(msg.content == null ? '' : msg.content));
      this.emit('tool_result', { toolId: msg.tool_call_id || null, isError: false, body, truncated });
      return;
    }
  }

  finishTurn() {
    for (const id of this.openCalls) this.emit('tool_result', { toolId: id, isError: false, body: '', truncated: false });
    this.openCalls.clear();
    this.emit('status', { state: 'idle' });
  }

  resolvePermission() {} // headless cannot be asked

  interrupt() {
    if (this.child) { try { this.child.kill(); } catch (_) {} this.emit('note', { text: 'Stopped.' }); }
  }

  close() {
    this.closed = true;
    try { if (this.child) this.child.kill(); } catch (_) {}
  }
}

module.exports = { KimiAdapter };
