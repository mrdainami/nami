// One live agent runtime per tile, whichever adapter its agent speaks. This is
// the registry and the router: it picks the adapter, owns the lifecycle, and
// is the single place a card's send / permission / interrupt / stop arrive.
//
// Pure of Electron on purpose — main.js hands in a `send(event)` callback and
// wires the IPC; everything here is testable without a window.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { ClaudeSdkAdapter } = require('./adapters/claude-sdk.js');
const { AcpAdapter } = require('./adapters/acp.js');
// The one slug rule claude itself uses — a private copy here already cost a
// live-empty backlog once, when `_local` slugged differently in two places.
const { projectSlug } = require('./claude-args.js');

// agent kind -> adapter class. One row per verified channel; growing this
// table is how a new agent gets cards.
const ADAPTERS = {
  claude: ClaudeSdkAdapter,
  opencode: AcpAdapter,
  hermes: AcpAdapter,
};

// The transcript claude would resume for this tile, if it exists yet.
function claudeTranscript(cwd, sid, home) {
  if (!sid) return null;
  const file = path.join(home || os.homedir(), '.claude', 'projects', projectSlug(cwd), sid + '.jsonl');
  try { return fs.existsSync(file) ? file : null; } catch (_) { return null; }
}

class AgentSessions {
  constructor() {
    this.sessions = new Map(); // tile id -> adapter instance
  }

  // Returns { ok, reason? }. ok:false means the tile should fall back to the
  // transcript watch rather than sit empty — the reason is for the card note.
  async start({ id, agent, cwd, sid, model, prompt, env, onEvent }) {
    const Adapter = ADAPTERS[agent];
    if (!Adapter) return { ok: false, reason: `no adapter for '${agent}'` };
    this.stop(id);

    const adapter = new Adapter({ id, cwd, model, env, onEvent, agent });
    this.sessions.set(id, adapter);
    const hasTranscript = agent === 'claude' && !!claudeTranscript(cwd, sid);
    const ok = await adapter.start({ prompt, sid, hasTranscript });
    if (!ok) { this.sessions.delete(id); return { ok: false, reason: 'could not start' }; }
    return { ok: true, resumed: hasTranscript };
  }

  send(id, text) { const s = this.sessions.get(id); if (s) s.send(text); return !!s; }
  config(id, configId, value) {
    const s = this.sessions.get(id);
    if (s && s.setConfigOption) s.setConfigOption(configId, value);
    return !!(s && s.setConfigOption);
  }
  permission(id, permissionId, optionId) {
    const s = this.sessions.get(id);
    if (s) s.resolvePermission(permissionId, optionId);
    return !!s;
  }
  interrupt(id) { const s = this.sessions.get(id); if (s) s.interrupt(); return !!s; }

  stop(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    this.sessions.delete(id);
    try { s.close(); } catch (_) {}
    return true;
  }

  // Tile close, window close and quit all land here — the same reap discipline
  // the ptys have, so no agent outlives the surface that was watching it.
  stopAll(filter) {
    for (const id of [...this.sessions.keys()]) {
      if (!filter || filter(id)) this.stop(id);
    }
  }

  has(id) { return this.sessions.has(id); }
  get size() { return this.sessions.size; }
}

module.exports = { AgentSessions, ADAPTERS, claudeTranscript };
