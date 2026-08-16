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
    let head = '';
    try {
      const fd = fs.openSync(f.p, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      head = buf.slice(0, n).toString('utf8').split('\n')[0];
    } catch (_) { continue; }
    try {
      const meta = JSON.parse(head);
      const pay = meta && meta.payload;
      if (!pay || meta.type !== 'session_meta' || !pay.id) continue;
      if (cwd && pay.cwd && pay.cwd !== cwd) continue;
      out.push({ id: pay.id, title: '', preview: codexPreview(f.p), age: age(f.mtime, now) });
    } catch (_) {}
  }
  return out;
}

// The first thing the user actually typed, so the picker rows read as
// conversations instead of id prefixes. Machine-injected blocks (<environment
// _context>, <user_instructions>) are skipped; best-effort, '' on anything odd.
function codexPreview(file) {
  let chunk = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, 16384, 0);
    fs.closeSync(fd);
    chunk = buf.slice(0, n).toString('utf8');
  } catch (_) { return ''; }
  for (const line of chunk.split('\n').slice(1)) {
    let rec = null;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    const pay = rec && rec.payload;
    if (!pay || pay.type !== 'message' || pay.role !== 'user') continue;
    const blocks = Array.isArray(pay.content) ? pay.content : [];
    for (const b of blocks) {
      const text = String((b && (b.text != null ? b.text : b.input_text)) || '').trim();
      if (!text || text.startsWith('<')) continue;
      return text.length > 64 ? text.slice(0, 63) + '…' : text;
    }
  }
  return '';
}

function opencodeConversations({ cwd, home, now }) {
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
