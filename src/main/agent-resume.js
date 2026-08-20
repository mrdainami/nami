// Resuming a run tile's conversation where claude got it for free. Claude
// pins --session-id at spawn, so a restore is --resume of an id Nami already
// knows. The other agents — kimi, codex, opencode, hermes, agy — run as plain
// `run` tiles (their bare bin typed into a shell) and all take a resume flag
// too (probed live 2026-08-20: each was given a codeword, resumed by id, and
// answered for it). Two gaps this module closes:
//
//   restore  — a run tile with a saved id is spawned with the resume line
//              (resumeCommand), guarded by the store actually holding that
//              session (sessionExists), the same philosophy as claude's
//              hasTranscript check in main.js.
//   discover — a terminal-only tile never learned its id (acpSid was only
//              ever set by the cards drive channel), so after a fresh spawn
//              main polls the agent's store for a session in the tile's
//              folder created at/after the spawn (startDiscovery).
//
// The stores, each verified against the real files on disk, not the docs:
//
//   kimi      ~/.kimi-code/session_index.jsonl — {sessionId, sessionDir,
//             workDir} per line; no timestamp in the line, stat sessionDir.
//   codex     ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl — line 1 is
//             session_meta with payload.session_id/.cwd/.timestamp. One thread
//             spans several rollouts (a new file per resume): match the id,
//             never the filename. Scans are bounded, newest files first.
//   opencode  ~/.local/share/opencode/opencode.db — SQLite, table
//             session(id, directory, time_created/ms). The old
//             storage/session/*/*.json layout is dead.
//   hermes    ~/.hermes/state.db — SQLite, table sessions(id, cwd, started_at
//             epoch-secs float). No source filter: cli rows DO carry the cwd
//             (the source='acp' filter in hermes-transcript.js serves the
//             card backlog, a different question).
//   agy       ~/.gemini/antigravity-cli/cache/last_conversations.json maps
//             cwd → latest conversation id; the conversation itself is
//             conversations/<id>.db. The old antigravity/conversations/*.pb
//             layout is dead.
//
// Everything is best-effort: any read or parse error means "unknown" (null /
// false), never a throw — a broken store must not break terminal spawn.

const fs = require('fs');
const path = require('path');
const os = require('os');

const AGENT_BINS = ['kimi', 'codex', 'opencode', 'hermes', 'agy'];

function statSafe(p) { try { return fs.statSync(p); } catch (_) { return null; } }
function listDirSafe(p) { try { return fs.readdirSync(p); } catch (_) { return []; } }

// A run tile Nami spawned as an agent carries exactly the bare bin; anything
// with arguments (or anything else) is not ours to resume or discover.
function agentForCommand(command) {
  const c = String(command || '').trim();
  return AGENT_BINS.includes(c) ? c : null;
}

// The interactive resume line, as probed (kimi -r is an undocumented alias of
// -S/--session that kimi itself prints as the resume hint). The sid is typed
// into a shell, so anything outside a safe charset is refused outright.
function resumeCommand(agent, sid) {
  const s = String(sid || '');
  if (!/^[\w.-]+$/.test(s)) return null;
  if (agent === 'kimi') return `kimi -r ${s}`;
  if (agent === 'codex') return `codex resume ${s}`;
  if (agent === 'opencode') return `opencode -s ${s}`;
  if (agent === 'hermes') return `hermes --resume ${s}`;
  if (agent === 'agy') return `agy --conversation ${s}`;
  return null;
}

// ---- the stores ------------------------------------------------------------

// Electron's node ships node:sqlite; opened read-only so a poll can never
// lock the agent's own writes. Unavailable or unreadable → null → "unknown".
function openSqliteRo(file) {
  let sqlite = null;
  try { sqlite = require('node:sqlite'); } catch (_) { return null; }
  if (!statSafe(file)) return null;
  try { return new sqlite.DatabaseSync(file, { readOnly: true }); } catch (_) { return null; }
}

function withDb(file, fn) {
  const db = openSqliteRo(file);
  if (!db) return null;
  try { return fn(db); } catch (_) { return null; }
  finally { try { db.close(); } catch (_) {} }
}

function opencodeDb(home) { return path.join(home, '.local', 'share', 'opencode', 'opencode.db'); }
function hermesDb(home) { return path.join(home, '.hermes', 'state.db'); }

function kimiSessions(home) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(home, '.kimi-code', 'session_index.jsonl'), 'utf8'); } catch (_) { return []; }
  const seen = new Set();
  const out = [];
  for (const line of raw.trim().split('\n')) {
    let rec = null;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    if (!rec || !rec.sessionId || seen.has(rec.sessionId)) continue;
    seen.add(rec.sessionId);
    const st = rec.sessionDir ? statSafe(rec.sessionDir) : null;
    out.push({ id: String(rec.sessionId), workDir: String(rec.workDir || ''), mtime: st ? st.mtimeMs : 0 });
  }
  return out;
}

// codex 0.147 embeds its entire system prompt in the session_meta line
// (~22KB), so "read a few KB, take line one" parses nothing. Read to the
// first newline, capped far above any real meta line — the cap only guards
// against a garbage file.
const LINE1_CAP = 256 * 1024;
function firstLine(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(LINE1_CAP);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (!n) return '';
    const nl = buf.indexOf(10);
    if (nl < 0 || nl >= n) return ''; // no newline inside the cap: not a rollout
    return buf.slice(0, nl).toString('utf8');
  } catch (_) {
    return '';
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

// Newest rollouts first, hard-capped: a year of daily codex use is thousands
// of files, and a discovery poll must stay cheap.
const CODEX_SCAN_CAP = 50;
function codexMetas(home) {
  const root = path.join(home, '.codex', 'sessions');
  const files = [];
  for (const y of listDirSafe(root)) for (const m of listDirSafe(path.join(root, y))) {
    for (const d of listDirSafe(path.join(root, y, m))) {
      for (const f of listDirSafe(path.join(root, y, m, d))) {
        if (!f.endsWith('.jsonl')) continue;
        const p = path.join(root, y, m, d, f);
        const st = statSafe(p);
        if (st) files.push({ p, mtime: st.mtimeMs });
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const f of files.slice(0, CODEX_SCAN_CAP)) {
    const line = firstLine(f.p);
    if (!line) continue;
    try {
      const meta = JSON.parse(line);
      const pay = meta && meta.payload;
      if (!pay || meta.type !== 'session_meta') continue;
      const id = pay.session_id || pay.id; // the field moved between versions
      if (!id) continue;
      out.push({ id: String(id), cwd: String(pay.cwd || ''), at: Date.parse(pay.timestamp) || f.mtime });
    } catch (_) {}
  }
  return out;
}

// agy files nothing by folder except this map, so discovery is a lookup plus
// an mtime check on the conversation db — the best its store allows.
function agyLatest(home, cwd) {
  const base = path.join(home, '.gemini', 'antigravity-cli');
  let map = null;
  try { map = JSON.parse(fs.readFileSync(path.join(base, 'cache', 'last_conversations.json'), 'utf8')); } catch (_) { return null; }
  const id = map && map[cwd];
  if (!id) return null;
  const st = statSafe(path.join(base, 'conversations', String(id) + '.db'));
  return st ? { id: String(id), mtime: st.mtimeMs } : null;
}

// ---- exists / find ----------------------------------------------------------

// "Is this saved id still in the agent's store" — the restore guard. Without
// it a restored-but-unused tile would die on a resume flag pointing at
// nothing.
function sessionExists(agent, cwd, sid, home = os.homedir()) {
  try {
    const s = String(sid || '');
    if (!s) return false;
    if (agent === 'kimi') return kimiSessions(home).some((r) => r.id === s);
    if (agent === 'codex') return codexMetas(home).some((r) => r.id === s);
    if (agent === 'opencode') {
      return !!withDb(opencodeDb(home), (db) => db.prepare('select 1 from session where id = ?').get(s));
    }
    if (agent === 'hermes') {
      return !!withDb(hermesDb(home), (db) => db.prepare('select 1 from sessions where id = ?').get(s));
    }
    if (agent === 'agy') {
      return !!statSafe(path.join(home, '.gemini', 'antigravity-cli', 'conversations', s + '.db'));
    }
  } catch (_) {}
  return false;
}

// The newest session this folder produced at/after sinceMs — what discovery
// is looking for. null when the store has none (yet).
function findSession(agent, cwd, sinceMs, home = os.homedir()) {
  try {
    const since = Number(sinceMs) || 0;
    if (agent === 'kimi') {
      let best = null;
      for (const r of kimiSessions(home)) {
        if (r.workDir !== cwd || r.mtime < since) continue;
        if (!best || r.mtime > best.mtime) best = r;
      }
      return best ? best.id : null;
    }
    if (agent === 'codex') {
      let best = null;
      for (const r of codexMetas(home)) {
        if (r.cwd !== cwd || r.at < since) continue;
        if (!best || r.at > best.at) best = r;
      }
      return best ? best.id : null;
    }
    if (agent === 'opencode') {
      return withDb(opencodeDb(home), (db) => {
        const rows = db.prepare('select id, time_created from session where directory = ? order by time_created desc').all(cwd);
        for (const r of rows) if (Number(r.time_created) >= since) return String(r.id);
        return null;
      });
    }
    if (agent === 'hermes') {
      return withDb(hermesDb(home), (db) => {
        const rows = db.prepare('select id, cwd, started_at from sessions order by started_at desc limit 200').all();
        for (const r of rows) {
          if (String(r.cwd || '') !== cwd) continue;
          if ((Number(r.started_at) || 0) * 1000 >= since) return String(r.id);
        }
        return null;
      });
    }
    if (agent === 'agy') {
      const r = agyLatest(home, cwd);
      return r && r.mtime >= since ? r.id : null;
    }
  } catch (_) {}
  return null;
}

// ---- discovery: which session did this tile just land in --------------------
// A fresh agent tile spawns, then the agent files its new session in its
// store within seconds. One shared, unref'd interval polls for every pending
// tile (the titleWatch pattern in main.js); a hit is reported once and the
// entry drops out; ten minutes without a hit gives up quietly.
const DISCOVER_MS = 3000;
const GIVE_UP_MS = 10 * 60 * 1000;
const pending = new Map(); // tile id -> { agent, cwd, sinceMs, onFound, home, added }
const claimed = new Set(); // sids already handed to a tile — never handed out twice
let discoverTimer = null;

// Two tiles of one agent in one folder spawned in the same moment would
// otherwise both be handed the same new session. Oldest tile (smallest
// sinceMs) polls first and a claimed sid is skipped, so the loser keeps
// waiting for the next session instead of double-resuming this one.
function sweepDiscovery() {
  const now = Date.now();
  const entries = [...pending.values()].sort((a, b) => a.sinceMs - b.sinceMs);
  for (const e of entries) {
    if (!pending.has(e.id)) continue; // stopped mid-sweep by an onFound
    if (now - e.added > GIVE_UP_MS) { pending.delete(e.id); continue; }
    const sid = findSession(e.agent, e.cwd, e.sinceMs, e.home);
    if (!sid || claimed.has(sid)) continue;
    claimed.add(sid);
    pending.delete(e.id);
    try { e.onFound(sid); } catch (_) {}
  }
  if (!pending.size && discoverTimer) { clearInterval(discoverTimer); discoverTimer = null; }
}

// Register a just-spawned tile; returns the stop function (wired to the pty's
// teardown in main.js). everyMs exists for tests — the shared timer keeps the
// interval it was created with.
function startDiscovery({ id, agent, cwd, sinceMs, onFound, home, everyMs } = {}) {
  if (!id || !AGENT_BINS.includes(agent)) return () => {};
  pending.set(id, { id, agent, cwd, sinceMs: Number(sinceMs) || Date.now(), onFound, home, added: Date.now() });
  if (!discoverTimer) {
    discoverTimer = setInterval(sweepDiscovery, everyMs || DISCOVER_MS);
    if (discoverTimer.unref) discoverTimer.unref(); // never hold the app open
  }
  return () => { pending.delete(id); };
}

module.exports = { AGENT_BINS, agentForCommand, resumeCommand, sessionExists, findSession, startDiscovery };
