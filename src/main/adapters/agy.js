// Antigravity over `agy -p --output-format stream-json` — a one-shot channel
// that reports a numbered step timeline: ACTIVE/DONE/ERROR per step, tool
// steps with parameters and outputs, checkpoint steps, streamed
// agent_response deltas, and answers that link files as file:// URLs.
//
// The one fact that cost a real run to learn: without `--add-dir <cwd>` agy
// works in its own scratch workspace and never sees the folder. Do not lose
// the flag.

const { spawn } = require('child_process');
const { knownBin } = require('./../bin-cache.js');
const { capability, clip, safeEvent } = require('./../agent-events.js');

const CAPABILITY = {
  drive: true, interrupt: true, ask: false, channel: 'one-shot',
  note: 'headless: approvals run by its own config',
};

// The modes agy's flags can express, in the order the cycle walks them.
// skip-permissions is --dangerously-skip-permissions, not a --mode value.
const AGY_MODES = ['accept-edits', 'plan', 'skip-permissions'];

// agy's forty tools, keyed to what each one does. Anything unknown is other.
function agyToolKind(name) {
  const n = String(name || '');
  // the web ones first: read_url_content would otherwise read as a file read
  if (/^(read_url_content|search_web|browser_)/.test(n)) return 'fetch';
  if (/^(view_file|view_code_item|read_)/.test(n)) return 'read';
  if (/^(write_to_file|replace_file_content|edit|create_file|multi_edit)/.test(n)) return 'edit';
  if (/^(run_command|send_command|command_)/.test(n)) return 'execute';
  if (/^(grep_search|find_by_name|list_dir|codebase_search|search_)/.test(n)) return 'search';
  return 'other';
}

class AgyAdapter {
  constructor({ id, cwd, env, onEvent }) {
    this.id = id;
    this.cwd = cwd;
    this.env = env;
    this.onEvent = onEvent;
    this.closed = false;
    this.seq = 0;
    this.child = null;
    this.conversationId = null;
    this.hasHistory = false;   // --continue only helps once a turn has run
    this.turnStarted = 0;
    this.openSteps = new Map(); // step_index -> toolId
    this.responseText = new Map(); // step_index -> accumulated delta
  }

  emit(kind, payload) {
    if (this.closed) return;
    const e = safeEvent({ kind, id: `${this.id}:e${++this.seq}`, at: null, ...payload });
    if (e) this.onEvent(e);
  }

  emitInit() {
    this.emit('init', {
      capability: capability(CAPABILITY),
      agentSessionId: this.conversationId,
      commands: [],
      agentName: 'Antigravity',
      model: this.model || null,
      mode: this.mode || null,
      // every mode is a spawn flag on this channel, so all are available
      modes: AGY_MODES.map((id) => ({ id, available: true })),
    });
  }

  // Choices ride the next turn's flags — the channel is one-shot.
  setConfigOption(configId, value) {
    if (configId === 'model') this.model = String(value || '') || null;
    else if (configId === 'mode') this.mode = String(value || '') || null;
    else return;
    this.emitInit();
  }

  async start({ prompt, sid }) {
    // agy resumes with --continue (its own last conversation), not by id;
    // a restored sid means a turn has run here before.
    this.hasHistory = !!sid;
    this.conversationId = sid || null;
    // Displayed state IS sent state: the welcome shows accept-edits, so the
    // first turn spawns with --mode accept-edits. Before this seed the chip
    // said one thing and the flags said nothing.
    if (!this.mode) this.mode = AGY_MODES[0];
    this.emitInit();
    if (prompt) this.send(prompt);
    return true;
  }

  send(text) {
    if (this.child) { this.emit('note', { text: 'Still running — one task at a time on this channel.' }); return; }
    this.emit('user', { text });
    this.emit('status', { state: 'running' });
    this.turnStarted = Date.now();

    const args = ['-p', text, '--output-format', 'stream-json', '--add-dir', this.cwd];
    // --conversation resumes by id — found in agy --help after round 1
    // shipped with the blunter --continue.
    if (this.conversationId && this.hasHistory) args.push('--conversation', this.conversationId);
    else if (this.hasHistory) args.push('--continue');
    if (this.model) args.push('--model', this.model);
    // skip-permissions is agy's own flag, not a --mode value
    if (this.mode === 'skip-permissions') args.push('--dangerously-skip-permissions');
    else if (this.mode) args.push('--mode', this.mode);
    let child;
    try {
      child = spawn(knownBin('agy') || 'agy', args, { cwd: this.cwd, env: this.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.emit('error', { message: `Antigravity could not start: ${err.message}` });
      this.emit('status', { state: 'idle' });
      return;
    }
    this.child = child;
    child.on('error', (err) => {
      this.emit('error', { message: `Antigravity (agy) isn't installed or isn't on PATH (${err.message}).` });
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
      if (code && code !== 0 && !this.sawResult) {
        const hint = errBuf.trim().split('\n').pop() || '';
        this.emit('error', { message: `Antigravity exited (${code}).${hint ? ' ' + hint.slice(0, 200) : ''}` });
        this.emit('turn_end', { durationMs: this.turnStarted ? Date.now() - this.turnStarted : 0, costUsd: 0, ok: false });
      }
      this.finishTurn();
    });
  }

  // One parsed frame from agy's stream. Testable without a process.
  handleLine(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.event === 'init' && msg.conversation_id) {
      if (msg.conversation_id !== this.conversationId) {
        this.conversationId = msg.conversation_id;
        this.emitInit();
      }
      this.sawResult = false;
      return;
    }

    if (msg.event === 'step_update' && msg.step_update) { this.handleStep(msg.step_update); return; }

    if (msg.event === 'result' && msg.result) {
      const r = msg.result;
      this.sawResult = true;
      this.hasHistory = true; // --continue is now meaningful
      // The final response often repeats what the deltas already streamed;
      // only say it once.
      if (r.response && !this.streamedFinal) this.emit('assistant', { text: String(r.response) });
      // Failure is not prose: a status that is not success is an error row.
      if (r.status && r.status !== 'SUCCESS') {
        this.emit('error', { message: `The turn ended ${r.status}${r.response ? ': ' + String(r.response).slice(0, 200) : '.'}` });
      }
      const u = r.usage || {};
      this.emit('turn_end', {
        durationMs: Math.round((Number(r.duration_seconds) || 0) * 1000),
        tokens: Number(u.total_tokens) || 0,
        costUsd: 0, ok: r.status === 'SUCCESS',
      });
      return;
    }
  }

  handleStep(step) {
    const idx = step.step_index;
    switch (step.step_type) {
      case 'tool': {
        const toolId = `s${idx}`;
        const info = step.tool_info || {};
        if (step.state === 'ACTIVE' && !this.openSteps.has(idx)) {
          this.openSteps.set(idx, toolId);
          const e = safeEvent({
            kind: 'tool', id: `${this.id}:t:${toolId}`, at: null,
            toolId, name: String(step.tool_name || info.name || 'tool'),
            toolKind: agyToolKind(step.tool_name || info.name),
            input: info.parameters || {},
          });
          if (e && !this.closed) this.onEvent(e);
        }
        if (step.state === 'DONE' || step.state === 'ERROR') {
          this.openSteps.delete(idx);
          const failed = step.state === 'ERROR';
          const raw = failed
            ? String((info.error && (info.error.message || info.error.type)) || 'Tool error')
            : String(info.output || '');
          const { body, truncated } = clip(raw);
          this.emit('tool_result', { toolId, isError: failed, body, truncated });
        }
        return;
      }

      case 'agent_response': {
        // Deltas accumulate into one growing row per step.
        if (typeof step.text_delta === 'string' && step.text_delta) {
          const text = (this.responseText.get(idx) || '') + step.text_delta;
          this.responseText.set(idx, text);
          if (!this.closed) {
            const e = safeEvent({ kind: 'assistant', id: `${this.id}:r${idx}`, at: null, text });
            if (e) this.onEvent(e);
          }
          if (step.state === 'DONE') this.streamedFinal = true;
        }
        return;
      }

      case 'checkpoint':
        if (step.state === 'DONE') {
          const e = safeEvent({
            kind: 'tool', id: `${this.id}:t:c${idx}`, at: null,
            toolId: `c${idx}`, name: 'checkpoint · restore point', toolKind: 'checkpoint', input: {},
          });
          if (e && !this.closed) this.onEvent(e);
          this.emit('tool_result', { toolId: `c${idx}`, isError: false, body: '', truncated: false });
        }
        return;

      default:
        return; // user_input, unknown — the timeline's own bookkeeping
    }
  }

  finishTurn() {
    for (const [, toolId] of this.openSteps) this.emit('tool_result', { toolId, isError: false, body: '', truncated: false });
    this.openSteps.clear();
    this.responseText.clear();
    this.streamedFinal = false;
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

module.exports = { AgyAdapter, agyToolKind };
