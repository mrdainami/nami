// Where each agent keeps its past conversations, read so /resume can be a
// card control instead of a terminal errand. Each reader was written against
// the real store on disk, not the docs:
//
//   claude    ~/.claude/projects/<slug>/<sid>.jsonl        (title in the tail)
//   codex     ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (line 1: session_meta
//             with payload.id and payload.cwd; first user text = the preview)
//   kimi      ~/.kimi-code/session_index.jsonl             ({sessionId, workDir})
//   agy       ~/.gemini/antigravity/conversations/<id>.pb  (protobuf — ids and
//             mtimes only; agy has no per-folder story, and the note says so)
//   opencode  ~/.local/share/opencode/storage/session/<projectID>/<ses_*>.json
//             ({id, directory, title, time.updated} — one file per session).
//             This one matters twice over: ACP session/load replays the whole
//             conversation into the card, so a listable id here is the only
//             thing between opencode and real history.
//
// Everything is best-effort: an unreadable store returns an empty list and a
// note, never a throw — the picker says "nothing found", the tile lives on.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { projectSlug } = require('./claude-args');
const { readTailTitle } = require('./session-title');

const MAX = 9;

function age(mtimeMs, now) {
  const s = Math.max(0, ((now || Date.now()) - mtimeMs) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

function statSafe(p) { try { return fs.statSync(p); } catch (_) { return null; } }
function listDirSafe(p) { try { return fs.readdirSync(p); } catch (_) { return []; } }

function claudeConversations({ cwd, home, now }) {
  const dir = path.join(home, '.claude', 'projects', projectSlug(cwd));
  const out = [];
  for (const f of listDirSafe(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const st = statSafe(path.join(dir, f));
    if (!st) continue;
    out.push({ id: f.slice(0, -6), file: path.join(dir, f), mtime: st.mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, MAX).map((c) => ({
    id: c.id,
    title: (() => { try { return readTailTitle(c.file) || ''; } catch (_) { return ''; } })(),
    age: age(c.mtime, now),
  }));
}

function codexConversations({ cwd, home, now }) {
  // newest rollouts first; only the first line of each is read, and only
  // until enough conversations from this folder are found.
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
  for (const f of files) {
    if (out.length >= MAX) break;
    const first = readFirstLine(f.p);
    if (!first.line) continue;
    try {
      const meta = JSON.parse(first.line);
      const pay = meta && meta.payload;
      if (!pay || meta.type !== 'session_meta' || !pay.id) continue;
      if (cwd && pay.cwd && pay.cwd !== cwd) continue;
      out.push({ id: pay.id, title: '', preview: codexPreview(f.p, first.end), age: age(f.mtime, now) });
    } catch (_) {}
  }
  return out;
}

// codex 0.147 embeds its entire system prompt inside the session_meta line —
// ~22KB — so "read 4KB, take line one" parsed nothing and every rollout
// silently vanished from the picker. Read to the first newline, capped far
// above any real meta line; the cap only guards against a garbage file.
const LINE1_CAP = 256 * 1024;
function readFirstLine(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const chunks = [];
    let pos = 0;
    while (pos < LINE1_CAP) {
      const buf = Buffer.alloc(16384);
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (!n) break;
      const nl = buf.indexOf(10);
      if (nl >= 0 && nl < n) {
        chunks.push(buf.slice(0, nl));
        return { line: Buffer.concat(chunks).toString('utf8'), end: pos + nl + 1 };
      }
      chunks.push(buf.slice(0, n));
      pos += n;
      if (n < buf.length) break;
    }
    return { line: '', end: 0 }; // no newline inside the cap: not a rollout
  } catch (_) {
    return { line: '', end: 0 };
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

// The first thing the user actually typed, so the picker rows read as
// conversations instead of id prefixes. Reads a window starting AFTER the
// meta line (whose offset the caller already paid for) — a wide one, because
// codex front-loads skills_instructions and world_state records and the real
// prompt sits ~75KB in on 0.147. Machine-injected blocks
// (<environment_context>, <user_instructions>) are skipped; '' on anything odd.
function codexPreview(file, offset) {
  let chunk = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(LINE1_CAP);
    const n = fs.readSync(fd, buf, 0, buf.length, offset || 0);
    fs.closeSync(fd);
    chunk = buf.slice(0, n).toString('utf8');
  } catch (_) { return ''; }
  for (const line of chunk.split('\n')) {
    let rec = null;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    const pay = rec && rec.payload;
    if (!pay || pay.type !== 'message' || pay.role !== 'user') continue;
    const blocks = Array.isArray(pay.content) ? pay.content : [];
    for (const b of blocks) {
      const text = String((b && (b.text != null ? b.text : b.input_text)) || '').trim();
      if (!text || text.startsWith('<')) continue;
      // AGENTS.md rides in as a user message with no wrapper at all
      if (/^# AGENTS\.md instructions\b/.test(text)) continue;
      const one = text.replace(/\s+/g, ' ');
      return one.length > 64 ? one.slice(0, 63) + '…' : one;
    }
  }
  return '';
}

// opencode 1.1.42+ keeps sessions in SQLite (opencode.db, `session` table) —
// the JSON folder below stopped being written 2026-08-08 and only holds the
// old ones. Electron's Node ships node:sqlite, so the db is read directly,
// read-only, no native deps; any failure falls back to the legacy folder.
// parent_id filters out sub-sessions (a Task-spawned child is not a
// conversation the user resumes).
function opencodeConversations(args) {
  const fromDb = opencodeDbConversations(args);
  if (fromDb && fromDb.length) return fromDb;
  return opencodeJsonConversations(args);
}

function opencodeDbConversations({ cwd, home, now }) {
  let sqlite = null;
  try { sqlite = require('node:sqlite'); } catch (_) { return null; }
  const file = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
  if (!statSafe(file)) return null;
  let db = null;
  try {
    db = new sqlite.DatabaseSync(file, { readOnly: true });
    const rows = cwd
      ? db.prepare('select id, title, time_updated from session where parent_id is null and directory = ? order by time_updated desc limit ?').all(cwd, MAX)
      : db.prepare('select id, title, time_updated from session where parent_id is null order by time_updated desc limit ?').all(MAX);
    return rows.map((r) => ({
      id: String(r.id),
      title: /^New session - /.test(String(r.title || '')) ? '' : String(r.title || ''),
      age: age(Number(r.time_updated) || 0, now),
    }));
  } catch (_) {
    return null;
  } finally {
    if (db) { try { db.close(); } catch (_) {} }
  }
}

function opencodeJsonConversations({ cwd, home, now }) {
  const root = path.join(home, '.local', 'share', 'opencode', 'storage', 'session');
  const files = [];
  for (const proj of listDirSafe(root)) {
    const dir = path.join(root, proj);
    for (const f of listDirSafe(dir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(dir, f);
      const st = statSafe(p);
      if (st) files.push({ p, mtime: st.mtimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const f of files) {
    if (out.length >= MAX) break;
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(f.p, 'utf8')); } catch (_) { continue; }
    if (!rec || !rec.id) continue;
    if (cwd && rec.directory && rec.directory !== cwd) continue;
    // opencode titles its untouched sessions "New session - <ISO date>";
    // that is a timestamp wearing a title's clothes, not a name
    const title = /^New session - /.test(String(rec.title || '')) ? '' : String(rec.title || '');
    out.push({ id: rec.id, title, age: age((rec.time && rec.time.updated) || f.mtime, now) });
  }
  return out;
}

function kimiConversations({ cwd, home, now }) {
  let raw = '';
  try { raw = fs.readFileSync(path.join(home, '.kimi-code', 'session_index.jsonl'), 'utf8'); } catch (_) { return []; }
  const seen = new Set();
  const out = [];
  const lines = raw.trim().split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < MAX; i--) {
    let rec = null;
    try { rec = JSON.parse(lines[i]); } catch (_) { continue; }
    if (!rec || !rec.sessionId || seen.has(rec.sessionId)) continue;
    if (cwd && rec.workDir && rec.workDir !== cwd) continue;
    seen.add(rec.sessionId);
    const st = rec.sessionDir ? statSafe(rec.sessionDir) : null;
    out.push({ id: rec.sessionId, title: '', age: st ? age(st.mtimeMs, now) : '' });
  }
  return out;
}

function agyConversations({ home, now }) {
  const dir = path.join(home, '.gemini', 'antigravity', 'conversations');
  const out = [];
  for (const f of listDirSafe(dir)) {
    if (!f.endsWith('.pb')) continue;
    const st = statSafe(path.join(dir, f));
    if (st) out.push({ id: f.slice(0, -3), mtime: st.mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, MAX).map((c) => ({ id: c.id, title: '', age: age(c.mtime, now) }));
}

function listConversations({ agent, cwd, home = os.homedir(), now } = {}) {
  try {
    if (agent === 'claude') return { conversations: claudeConversations({ cwd, home, now }) };
    if (agent === 'codex') return { conversations: codexConversations({ cwd, home, now }) };
    if (agent === 'kimi') return { conversations: kimiConversations({ cwd, home, now }) };
    if (agent === 'opencode') {
      return {
        conversations: opencodeConversations({ cwd, home, now }),
        note: 'opencode replays the picked conversation into the card.',
      };
    }
    if (agent === 'agy') {
      return {
        conversations: agyConversations({ home, now }),
        note: 'Antigravity conversations aren\'t filed by folder — newest first, all folders.',
      };
    }
  } catch (_) {}
  return { conversations: [], note: 'This agent doesn\'t expose past conversations here — resume from its terminal.' };
}

module.exports = { listConversations };
