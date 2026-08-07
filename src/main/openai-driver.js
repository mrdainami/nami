// Drives one agentic session against ANY OpenAI-compatible chat API (Ollama, LM Studio,
// vLLM, OpenRouter, Nous Hermes endpoints…). We own the loop the Claude Agent SDK provides
// for Claude: model proposes tool calls, the user approves risky ones, we execute and feed
// results back until the model answers in plain text. Emits the same paper-card event
// vocabulary as claude-driver. fetch is injectable so tests run without a server.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_ROUNDS = 30;          // tool rounds per user turn
const MAX_RESULT = 16000;       // chars of tool output fed back to the model

const TOOLS = [
  { type: 'function', function: { name: 'run_command', description: 'Run a shell command in the working directory. Returns stdout and stderr.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'The shell command to run' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'read_file', description: 'Read a text file. Path may be relative to the working directory.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a text file. Path may be relative to the working directory.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'List a directory. Path may be relative to the working directory.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
];

function systemPrompt(cwd) {
  return `You are a capable coding and research assistant working inside Dainami CLI, a desktop workbench. Your working directory is ${cwd}. Use the provided tools to inspect files and run commands when the task needs it; answer directly when it does not. Be concise and concrete. When you finish a task, summarize what you did in plain language.`;
}

class OpenAISession {
  // config: { baseUrl, model, apiKey?, name? }
  constructor({ id, cwd, config, onEvent, fetchImpl }) {
    this.id = id;
    this.cwd = cwd || process.cwd();
    this.config = config || {};
    this.onEvent = onEvent || (() => {});
    this.fetch = fetchImpl || fetch;
    this.messages = [{ role: 'system', content: systemPrompt(this.cwd) }];
    this.pendingPermissions = new Map();
    this.running = false;
    this.closed = false;
    this._permSeq = 0;
  }

  emit(kind, payload) { if (!this.closed) this.onEvent(Object.assign({ sessionId: this.id, kind }, payload)); }

  send(text) {
    if (this.closed) return;
    this.messages.push({ role: 'user', content: String(text) });
    this.emit('user_echo', { text: String(text) });
    if (!this.running) this.runLoop();
  }

  async runLoop() {
    this.running = true;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (this.closed) return;
        const msg = await this.callModel();
        if (this.closed) return;
        this.messages.push(msg);
        if (msg.content) this.emit('assistant', { text: String(msg.content) });
        const calls = msg.tool_calls || [];
        if (!calls.length) { this.emit('result', { ok: true }); this.running = false; return; }
        for (const call of calls) {
          const name = call.function && call.function.name;
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
          this.emit('tool', { toolId: call.id, name, label: toolLabel(name, args), detail: toolDetail(name, args) });
          let result;
          if (await this.needsPermission(name, args)) {
            const allowed = await this.askPermission(name, args);
            result = allowed ? await this.execTool(name, args) : { ok: false, out: 'The user denied this action. Continue without it or ask what to do instead.' };
          } else {
            result = await this.execTool(name, args);
          }
          this.emit('tool_result', { toolId: call.id, isError: !result.ok });
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: String(result.out).slice(0, MAX_RESULT) });
        }
      }
      this.emit('error', { message: `Stopped after ${MAX_ROUNDS} tool rounds — the model may be looping.` });
      this.emit('result', { ok: false });
    } catch (e) {
      this.emit('error', { message: e && e.message ? e.message : String(e) });
      this.emit('result', { ok: false });
    } finally {
      this.running = false;
    }
  }

  async callModel() {
    const base = String(this.config.baseUrl || '').replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const r = await this.fetch(base + '/chat/completions', {
      method: 'POST', headers,
      body: JSON.stringify({ model: this.config.model, messages: this.messages, tools: TOOLS }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`${this.config.model || 'model'} ${r.status}: ${t.slice(0, 200)}`);
    }
    const j = await r.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    if (!msg) throw new Error('Malformed response: no choices[0].message');
    return msg;
  }

  resolvePath(p) { return path.isAbsolute(p || '') ? p : path.resolve(this.cwd, p || '.'); }

  async needsPermission(name, args) {
    if (name === 'run_command' || name === 'write_file') return true;
    const target = this.resolvePath(args.path);
    return !target.startsWith(this.cwd); // reads inside the workspace are free
  }

  askPermission(name, args) {
    return new Promise((resolve) => {
      const pid = `${this.id}:ai:${++this._permSeq}`;
      this.pendingPermissions.set(pid, resolve);
      this.emit('permission', { permissionId: pid, toolName: name, label: toolLabel(name, args), summary: permissionSummary(name, args) });
    });
  }

  resolvePermission(permissionId, allow) {
    const resolve = this.pendingPermissions.get(permissionId);
    if (!resolve) return;
    this.pendingPermissions.delete(permissionId);
    resolve(!!allow);
  }

  async execTool(name, args) {
    try {
      if (name === 'run_command') {
        return await new Promise((resolve) => {
          execFile('/bin/zsh', ['-lc', String(args.command || '')], { cwd: this.cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            const out = [stdout, stderr].filter(Boolean).join('\n---stderr---\n') || (err ? String(err.message) : '(no output)');
            resolve({ ok: !err, out });
          });
        });
      }
      if (name === 'read_file') {
        const p = this.resolvePath(args.path);
        const stat = fs.statSync(p);
        if (stat.size > 512 * 1024) return { ok: false, out: 'File too large to read (' + stat.size + ' bytes).' };
        return { ok: true, out: fs.readFileSync(p, 'utf8') };
      }
      if (name === 'write_file') {
        const p = this.resolvePath(args.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(args.content == null ? '' : args.content));
        return { ok: true, out: 'Wrote ' + p };
      }
      if (name === 'list_dir') {
        const p = this.resolvePath(args.path);
        const rows = fs.readdirSync(p, { withFileTypes: true }).slice(0, 200)
          .map((e) => (e.isDirectory() ? e.name + '/' : e.name));
        return { ok: true, out: rows.join('\n') || '(empty)' };
      }
      return { ok: false, out: 'Unknown tool: ' + name };
    } catch (e) { return { ok: false, out: e.message }; }
  }

  close() {
    this.closed = true;
    for (const [, resolve] of this.pendingPermissions) resolve(false);
    this.pendingPermissions.clear();
  }
}

function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function toolLabel(name, args) {
  switch (name) {
    case 'run_command': return short(args.command || 'Running a command', 60);
    case 'read_file': return 'Reading ' + short(args.path, 40);
    case 'write_file': return 'Writing ' + short(args.path, 40);
    case 'list_dir': return 'Listing ' + short(args.path || '.', 40);
    default: return short(name, 40);
  }
}
function toolDetail(name, args) {
  if (name === 'run_command') return short(args.command || '', 60);
  return short(args.path || '', 50);
}
function permissionSummary(name, args) {
  switch (name) {
    case 'run_command': return 'Run: ' + short(args.command || '', 120);
    case 'write_file': return 'Create or overwrite ' + short(args.path, 90);
    case 'read_file': return 'Read (outside the workspace) ' + short(args.path, 90);
    case 'list_dir': return 'List (outside the workspace) ' + short(args.path, 90);
    default: return 'Use ' + name;
  }
}

module.exports = { OpenAISession, TOOLS };
