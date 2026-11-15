const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const { claudeSpawnArgs, projectSlug, shellQuote } = require('./claude-args');
const { readTailTitle } = require('./session-title');
const { agentForCommand, resumeCommand, sessionExists, startDiscovery, readSessionTitle } = require('./agent-resume');
const { feedOscTitle } = require('./osc-title');
const { oneShotArgs, feedRunDone } = require('./run-done');
const { startSeedGate } = require('./seed-gate');
const { seedAgentForLaunch, initialPromptArgs, initialPromptEnv, seedHeld, withPromptArgs } = require('./seed-launch');
const { reachesCmd, shimSafe, shimSafeArgs, directLaunch } = require('./cmd-shim');
const { realProgram } = require('./real-program');
const { readLiveSession, liveSessionChanged } = require('./session-registry');
const { buildChildEnv, terminalLaunchPolicy, redactChildError } = require('./session-env');
const { agentRunCommandAllowed } = require('./agents-detect');
const { rememberBins, knownBin, resolveClaudeExecutable, resolveRunCommand, withSpawnFlags } = require('./bin-cache');
const { paneShell, scriptArgs } = require('./platform');
const { reportingArgs, feedCwd } = require('./shell-integration');
const { findPwsh } = require('./pwsh-find');
const { ptyCwd } = require('./pty-cwd');
const { userPath, refreshUserPath } = require('./user-path');
const { exitNote } = require('./exit-note');
const settingsStore = require('./settings');

const DEFAULT_BUFFER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB per session
const MAX_EXITED_SESSIONS = 50;
const TITLE_POLL_MS = 4000;
const STORE_AGENT = { antigravity: 'agy' };

let ptyModule = null;
try { ptyModule = require('@lydell/node-pty'); } catch (_) {
  try { ptyModule = require('node-pty'); } catch (_) {}
}

class CircularOutputBuffer {
  constructor({ maxBytes = DEFAULT_BUFFER_MAX_BYTES } = {}) {
    this._maxBytes = maxBytes;
    this._chunks = []; // { seq, data, bytes }
    this._totalBytes = 0;
    this._nextSeq = 1;
  }

  append(data) {
    if (!data) return null;
    const str = String(data);
    const bytes = Buffer.byteLength(str, 'utf8');
    const seq = this._nextSeq++;
    const chunk = { seq, data: str, bytes };

    this._chunks.push(chunk);
    this._totalBytes += bytes;

    while (this._totalBytes > this._maxBytes && this._chunks.length > 1) {
      const removed = this._chunks.shift();
      this._totalBytes -= removed.bytes;
    }

    return chunk;
  }

  replay(fromSeq = 0) {
    const minAvailable = this._chunks.length > 0 ? this._chunks[0].seq : this._nextSeq;
    const missed = this._chunks.filter(c => c.seq >= fromSeq);
    return {
      earliestSeq: minAvailable,
      nextSeq: this._nextSeq,
      chunks: missed.map(c => ({ seq: c.seq, data: c.data })),
    };
  }

  get nextSeq() {
    return this._nextSeq;
  }
}

class PtyExecutionService extends EventEmitter {
  constructor({
    pty = ptyModule,
    readSettings = () => ({}),
    platform = process.platform,
    env = process.env,
    homedir = os.homedir(),
    bufferMaxBytes = DEFAULT_BUFFER_MAX_BYTES,
    ptyCwdService = ptyCwd,
  } = {}) {
    super();
    this._pty = pty;
    this._readSettings = readSettings;
    this._platform = platform;
    this._env = env;
    this._homedir = homedir;
    this._bufferMaxBytes = bufferMaxBytes;
    this._ptyCwd = ptyCwdService;

    this._sessions = new Map(); // id -> { id, pty, buffer, ... }
    this._exitedBuffers = new Map(); // id -> { buffer, exitEvent } (bounded retention)
    this._deliberateKills = new Set();
    this._subscribers = new Map(); // id -> Set<subscriberCallback>
    this._titleWatch = new Map(); // id -> { file, pid, sid, cwd, agent, mtime, title }
    this._titleTimer = null;
    this._resizeLogN = 0;
  }

  get sessionCount() {
    return this._sessions.size;
  }

  getSession(id) {
    return this._sessions.get(id) || null;
  }

  getExitedSession(id) {
    return this._exitedBuffers.get(id) || null;
  }

  hasSession(id) {
    return this._sessions.has(id);
  }

  listSessions() {
    return [...this._sessions.keys()];
  }

  getSessionOwner(id) {
    const s = this._sessions.get(id);
    if (!s) return null;
    return s.owner || { type: 'desktop' };
  }

  listSessionSummaries() {
    const summaries = [];

    // Active/detached sessions
    for (const [id, s] of this._sessions) {
      const subs = this._subscribers.get(id);
      const subCount = subs ? subs.size : 0;
      const owner = s.owner || { type: 'desktop' };
      const tw = this._titleWatch.get(id);

      summaries.push({
        id,
        state: subCount > 0 ? 'attached' : 'detached',
        attachedCount: subCount,
        ownerType: owner.type,
        ownerDeviceId: owner.deviceId || null,
        cwd: s.cwd || null,
        kind: s.kind || null,
        title: (tw && tw.title) || null,
      });
    }

    // Exited retained sessions
    for (const [id, item] of this._exitedBuffers) {
      const ev = item.exitEvent || {};
      const owner = item.owner || { type: 'desktop' };
      summaries.push({
        id,
        state: 'exited',
        attachedCount: 0,
        ownerType: owner.type,
        ownerDeviceId: owner.deviceId || null,
        exitCode: typeof ev.code === 'number' ? ev.code : null,
        signal: ev.signal || null,
        deliberate: !!ev.deliberate,
        note: ev.note || null,
      });
    }

    return summaries;
  }

  subscribe(id, callback) {
    if (!this._subscribers.has(id)) {
      this._subscribers.set(id, new Set());
    }
    const set = this._subscribers.get(id);
    set.add(callback);
    return () => {
      set.delete(callback);
      if (!set.size) this._subscribers.delete(id);
    };
  }

  unsubscribeAll(id) {
    this._subscribers.delete(id);
  }

  _dispatch(id, event) {
    this.emit('event', event);
    const set = this._subscribers.get(id);
    if (set) {
      for (const cb of set) {
        try { cb(event); } catch (_) {}
      }
    }
  }

  sessionEnv(loginPath, launch, policy = this.sessionPolicy(launch)) {
    const env = Object.assign(
      buildChildEnv({ parentEnv: this._env, settings: this._readSettings(), ...policy }),
      { TERM: 'xterm-256color', FORCE_COLOR: '1' }
    );
    if (loginPath) env.PATH = loginPath;
    const theme = settingsStore.normalizeTheme(this._readSettings().theme);
    env.COLORFGBG = (theme === 'paper' || theme === 'glass' || theme === 'soft') ? '0;15' : '15;0';
    return env;
  }

  sessionPolicy(launch) {
    const policy = terminalLaunchPolicy(launch);
    if (launch?.kind === 'run' && policy.purpose === 'agent' && !agentRunCommandAllowed(launch, this._platform)) {
      return { purpose: 'terminal' };
    }
    return policy;
  }

  async create({
    id,
    cwd,
    cols,
    rows,
    kind,
    command,
    program,
    args,
    seed,
    cont,
    sid,
    acpSid,
    name,
    watchDone,
    oneShot,
    purpose,
    agentId,
    owner = { type: 'desktop' },
  }) {
    if (!this._pty) {
      const disabledMsg = '\r\n[node-pty unavailable — terminal disabled]\r\n';
      this._dispatch(id, { type: 'data', id, data: disabledMsg });
      return { ok: false, error: 'node-pty unavailable' };
    }

    const envPath = await userPath({ settings: this._readSettings(), env: this._env });
    const onWindows = this._platform === 'win32';
    const shellPath = paneShell(this._platform, this._env, onWindows ? findPwsh({ pathValue: envPath || undefined }) : '');
    const quote = (a) => shellQuote(a, shellPath);
    const claudeExe = resolveClaudeExecutable();
    const launch = { kind, purpose, agentId, program, command, args, watchDone, oneShot };
    const policy = this.sessionPolicy(launch);
    const seedAgent = seedAgentForLaunch(launch);

    const real = (found) => realProgram(found, { platform: this._platform, env: this._env, pathValue: envPath || undefined });
    const claudeRun = real(claudeExe);
    const seedProgram = kind === 'claude' ? claudeRun.file : real(knownBin(seedAgent)).file;
    const promptArgs = initialPromptArgs(seedAgent, seed, { program: seedProgram, platform: this._platform });
    const held = seedHeld(seedAgent, seed, { program: seedProgram, platform: this._platform });

    let file = shellPath;
    let spawnArgs = [];
    let afterStart = null;
    let claudeWatch = null;
    let echoLine = null;
    let discoverAgent = null;
    let storeWatch = null;

    if (kind === 'claude') {
      const transcript = sid && path.join(this._homedir, '.claude', 'projects', projectSlug(cwd), sid + '.jsonl');
      const hasTranscript = !!transcript && fs.existsSync(transcript);
      const claudeArgs = claudeSpawnArgs({ cont, sid, hasTranscript, name });
      if (transcript) claudeWatch = { transcript, sid, cwd };

      const extraArgs = Array.isArray(args) ? args : [];
      const ownArgs = shimSafeArgs([...claudeArgs, ...extraArgs], claudeRun.file, this._platform);
      if (claudeExe) {
        file = claudeRun.file;
        spawnArgs = [...claudeRun.args, ...ownArgs, ...promptArgs];
      } else {
        file = shellPath;
        const displayLine = ['claude', ...ownArgs].map(quote).join(' ');
        const line = displayLine + (promptArgs.length ? ' ' + promptArgs.map(quote).join(' ') : '');
        if (policy.purpose === 'agent' || promptArgs.length) {
          spawnArgs = scriptArgs(shellPath, line);
          echoLine = displayLine;
        } else {
          afterStart = line;
        }
      }
    } else if (kind === 'harness' && program) {
      file = program;
      spawnArgs = Array.isArray(args) ? args : [];
    } else if (kind === 'run' && command) {
      file = shellPath;
      const head = (/^[A-Za-z][\w.-]*/.exec(String(command)) || [''])[0];
      if (Array.isArray(args) && reachesCmd(real(knownBin(head)).file, this._platform) && args.some((a) => shimSafe(a) !== String(a))) {
        const notStartedMsg = `\r\n[not started: this agent's name has a character in it that cannot be handed to ${head} safely on Windows — one of " % & | < > ^ ! ( )]\r\n`;
        this._dispatch(id, { type: 'data', id, data: notStartedMsg });
        return { ok: false };
      }

      let bare = withSpawnFlags(command);
      let typed = resolveRunCommand(bare, shellPath, real);
      const agent = watchDone ? null : agentForCommand(command);
      if (agent) {
        if (cont && acpSid) {
          const resume = sessionExists(agent, cwd, acpSid) ? resumeCommand(agent, acpSid) : null;
          if (resume) {
            bare = withSpawnFlags(resume);
            typed = resolveRunCommand(bare, shellPath, real);
            storeWatch = { agent, sid: acpSid };
          }
        } else if (!acpSid) {
          discoverAgent = agent;
        }
      }

      const direct = (this._platform === 'win32' && !watchDone && (policy.purpose === 'agent' || promptArgs.length))
        ? directLaunch(bare, { real, knownBin, platform: this._platform })
        : null;
      typed = withPromptArgs(typed, promptArgs, { quote, shell: shellPath });
      if (direct) {
        file = direct.file;
        spawnArgs = [...direct.args, ...promptArgs];
        echoLine = command;
      } else if (watchDone) {
        spawnArgs = oneShotArgs(shellPath, typed);
        echoLine = command;
      } else if (policy.purpose === 'agent' || promptArgs.length) {
        spawnArgs = scriptArgs(shellPath, typed);
        echoLine = command;
      } else {
        afterStart = typed;
      }
    } else {
      file = shellPath;
    }

    const tellsCwd = onWindows && file === shellPath;
    if (tellsCwd) spawnArgs = reportingArgs(shellPath, spawnArgs);

    let p;
    try {
      p = this._pty.spawn(file, spawnArgs, {
        name: 'xterm-256color',
        cols: cols || 100,
        rows: rows || 30,
        cwd: (cwd && fs.existsSync(cwd)) ? cwd : this._homedir,
        env: initialPromptEnv(this.sessionEnv(envPath, launch, policy), seedAgent, seed),
      });
    } catch (err) {
      const errText = '\r\n[could not start: ' + redactChildError(err, { settings: this._readSettings(), parentEnv: this._env }) + ']\r\n';
      this._dispatch(id, { type: 'data', id, data: errText });
      return { ok: false, error: err.message };
    }

    const buffer = new CircularOutputBuffer({ maxBytes: this._bufferMaxBytes });
    const sessionRecord = {
      id,
      pty: p,
      buffer,
      pid: p.pid,
      cwd,
      tellsCwd,
      where: tellsCwd ? { buf: '', roots: [(cwd && fs.existsSync(cwd)) ? cwd : this._homedir, this._homedir] } : null,
      kind,
      watchDone,
      done: { buf: '' },
      osc: { last: null },
      reported: false,
      seedGate: null,
      stopDiscovery: null,
      owner: owner && owner.type === 'remote'
        ? { type: 'remote', deviceId: String(owner.deviceId || '') }
        : { type: 'desktop' },
    };

    this._sessions.set(id, sessionRecord);
    this._exitedBuffers.delete(id);

    if (claudeWatch) {
      this.watchTitle(id, claudeWatch.transcript, { pid: p.pid, sid: claudeWatch.sid, cwd: claudeWatch.cwd });
    }
    if (storeWatch) {
      this.watchTitle(id, null, { agent: storeWatch.agent, sid: storeWatch.sid, cwd });
    }

    if (discoverAgent) {
      sessionRecord.stopDiscovery = startDiscovery({
        id,
        agent: discoverAgent,
        cwd: (cwd && fs.existsSync(cwd)) ? cwd : this._homedir,
        sinceMs: Date.now(),
        onFound: (found) => {
          this._dispatch(id, { type: 'sid', id, sid: found });
          this.watchTitle(id, null, { agent: discoverAgent, sid: found, cwd });
        },
      });
    }

    if (echoLine) {
      const echoText = `\x1b[38;2;141;128;101m$ ${echoLine}\x1b[0m\r\n`;
      const chunk = buffer.append(echoText);
      this._dispatch(id, { type: 'data', id, data: echoText, seq: chunk?.seq });
    }

    p.onData((data) => {
      const chunk = buffer.append(data);
      this._dispatch(id, { type: 'data', id, data, seq: chunk?.seq });

      if (sessionRecord.seedGate) sessionRecord.seedGate.onData(data);

      if (sessionRecord.where && this._ptyCwd) {
        const at = feedCwd(sessionRecord.where, data);
        if (at) this._ptyCwd.tell(p.pid, at);
      }

      if (watchDone && !sessionRecord.reported) {
        const code = feedRunDone(sessionRecord.done, data);
        if (code !== null) {
          sessionRecord.reported = true;
          refreshUserPath();
          this._dispatch(id, { type: 'command-done', id, code });
        }
      }

      if (kind === 'claude') {
        const t = feedOscTitle(sessionRecord.osc, data);
        if (t) this._dispatch(id, { type: 'title', id, title: t });
      }
    });

    p.onExit(({ exitCode, signal }) => {
      if (sessionRecord.seedGate) {
        sessionRecord.seedGate.stop();
        sessionRecord.seedGate = null;
      }
      if (sessionRecord.stopDiscovery) {
        sessionRecord.stopDiscovery();
        sessionRecord.stopDiscovery = null;
      }
      if (sessionRecord.where && this._ptyCwd) {
        this._ptyCwd.forget(p.pid);
      }

      this._sessions.delete(id);
      this._titleWatch.delete(id);

      const deliberate = this._deliberateKills.delete(id);
      const note = exitNote({ code: exitCode, signal, deliberate });
      const exitEvent = { type: 'exit', id, code: exitCode, signal, deliberate, note };

      // Retain buffer for recently exited sessions up to limit
      this._exitedBuffers.set(id, { buffer, exitEvent, owner: sessionRecord.owner });
      if (this._exitedBuffers.size > MAX_EXITED_SESSIONS) {
        const oldestKey = this._exitedBuffers.keys().next().value;
        this._exitedBuffers.delete(oldestKey);
      }

      this._dispatch(id, exitEvent);
    });

    if (afterStart) {
      setTimeout(() => {
        try { p.write(afterStart + '\r'); } catch (_) {}
      }, 200);
    }

    if (seed && !promptArgs.length && ['kimi', 'hermes'].includes(seedAgent)) {
      sessionRecord.seedGate = startSeedGate({
        write: (s) => { try { p.write(s); } catch (_) {} },
        seed,
        agentId: seedAgent,
      });
      p.namiSeedGate = sessionRecord.seedGate;
    }

    return held ? { ok: true, seedHeld: true } : { ok: true };
  }

  write(id, data) {
    const s = this._sessions.get(id);
    if (!s || !s.pty) return false;
    if (s.pty.namiSeedGate) s.pty.namiSeedGate.onInput(data);
    try {
      s.pty.write(data);
      return true;
    } catch (_) {
      return false;
    }
  }

  resize(id, cols, rows) {
    if (this._env.NAMI_PTY_LOG) {
      this._resizeLogN++;
      const line = `${this._resizeLogN} ${id} ${cols}x${rows}\n`;
      try { fs.appendFileSync(this._env.NAMI_PTY_LOG, line); } catch (_) {}
      console.log('[term:resize]', line.trim());
    }
    const s = this._sessions.get(id);
    if (!s || !s.pty) return false;
    try {
      s.pty.resize(cols, rows);
      return true;
    } catch (_) {
      return false;
    }
  }

  kill(id) {
    const s = this._sessions.get(id);
    if (!s) return false;
    this._deliberateKills.add(id);
    this._titleWatch.delete(id);
    try {
      s.pty.kill();
    } catch (_) {}
    this._sessions.delete(id);
    return true;
  }

  shutdown() {
    if (this._titleTimer) {
      clearInterval(this._titleTimer);
      this._titleTimer = null;
    }
    const ids = [...this._sessions.keys()];
    for (const id of ids) {
      this.kill(id);
    }
  }

  replay(id, fromSeq = 0) {
    const s = this._sessions.get(id);
    if (s && s.buffer) return s.buffer.replay(fromSeq);
    const exited = this._exitedBuffers.get(id);
    if (exited && exited.buffer) return exited.buffer.replay(fromSeq);
    return { earliestSeq: 1, nextSeq: 1, chunks: [] };
  }

  watchTitle(id, file, { pid = null, sid = null, cwd = null, agent = null } = {}) {
    this._titleWatch.set(id, { file, mtime: 0, title: null, pid, sid, cwd, agent });
    this._retimeTitles();
  }

  watchTitleFromClient(id, agent, cwd, sid) {
    if (!id || !sid) return false;
    const key = STORE_AGENT[agent] || agent || 'claude';
    this.watchTitle(id, null, { agent: key, sid, cwd });
    return true;
  }

  dropTitleWatch(id) {
    this._titleWatch.delete(id);
    if (!this._titleWatch.size && this._titleTimer) {
      clearInterval(this._titleTimer);
      this._titleTimer = null;
    }
  }

  _retimeTitles() {
    if (this._titleTimer) return;
    this._titleTimer = setInterval(() => this._sweepTitles(), TITLE_POLL_MS);
    if (this._titleTimer.unref) this._titleTimer.unref();
  }

  _sweepTitles() {
    for (const [id, w] of this._titleWatch) {
      if (w.pid) {
        const live = readLiveSession(w.pid);
        if (live && liveSessionChanged(w.sid, live.sessionId)) {
          w.sid = live.sessionId;
          w.file = path.join(this._homedir, '.claude', 'projects', projectSlug(w.cwd), w.sid + '.jsonl');
          w.mtime = 0;
          this._dispatch(id, { type: 'sid', id, sid: w.sid });
        }
      }
      let title = null;
      if (w.file) {
        let stat = null;
        try { stat = fs.statSync(w.file); } catch (_) { continue; }
        if (stat.mtimeMs === w.mtime) continue;
        w.mtime = stat.mtimeMs;
        title = readTailTitle(w.file);
      } else if (w.agent && w.sid) {
        title = readSessionTitle(w.agent, w.cwd, w.sid, this._homedir);
      } else continue;

      if (!title || title === w.title) continue;
      w.title = title;
      this._dispatch(id, { type: 'title', id, title });
    }
    if (!this._titleWatch.size && this._titleTimer) {
      clearInterval(this._titleTimer);
      this._titleTimer = null;
    }
  }
}

module.exports = {
  PtyExecutionService,
  CircularOutputBuffer,
  DEFAULT_BUFFER_MAX_BYTES,
};
