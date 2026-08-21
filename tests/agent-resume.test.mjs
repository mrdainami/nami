import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AGENT_BINS, agentForCommand, resumeCommand, sessionExists, findSession, startDiscovery } = require('../src/main/agent-resume.js');

// Fixture stores built the way each agent really writes them (see the header
// of agent-resume.js), in a throwaway home so nothing real is ever touched.
function mkhome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nami-resume-')); }
function put(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function setMtime(p, ms) { const d = new Date(ms); fs.utimesSync(p, d, d); }

const CWD = '/proj/a';
const OTHER = '/proj/b';

function kimiStore(home, rows) {
  const lines = [];
  for (const r of rows) {
    const dir = path.join(home, 'kimi-sessions', r.id);
    fs.mkdirSync(dir, { recursive: true });
    setMtime(dir, r.mtime);
    lines.push(JSON.stringify({ sessionId: r.id, sessionDir: dir, workDir: r.cwd }));
  }
  put(path.join(home, '.kimi-code', 'session_index.jsonl'), lines.join('\n') + '\n');
}

function codexStore(home, rows) {
  rows.forEach((r, i) => {
    const file = path.join(home, '.codex', 'sessions', '2026', '08', '20', `rollout-${i}.jsonl`);
    put(file, JSON.stringify({
      type: 'session_meta',
      payload: { session_id: r.id, cwd: r.cwd, timestamp: new Date(r.at).toISOString() },
    }) + '\n{"type":"turn_context"}\n');
  });
}

function agyStore(home, cwd, id, mtime) {
  const base = path.join(home, '.gemini', 'antigravity-cli');
  put(path.join(base, 'cache', 'last_conversations.json'), JSON.stringify({ [cwd]: id }));
  const db = path.join(base, 'conversations', id + '.db');
  put(db, 'not really sqlite — existence and mtime are all Nami reads');
  setMtime(db, mtime);
}

function opencodeStore(home, rows) {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(home, '.local', 'share', 'opencode', 'opencode.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('create table session (id text primary key, directory text, title text, time_created integer, time_updated integer)');
  for (const r of rows) {
    db.prepare('insert into session (id, directory, title, time_created, time_updated) values (?, ?, ?, ?, ?)')
      .run(r.id, r.cwd, '', r.at, r.at);
  }
  db.close();
}

function hermesStore(home, rows) {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(home, '.hermes', 'state.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('create table sessions (id text, source text, cwd text, started_at real)');
  for (const r of rows) {
    db.prepare('insert into sessions (id, source, cwd, started_at) values (?, ?, ?, ?)')
      .run(r.id, r.source || 'cli', r.cwd, r.at / 1000);
  }
  db.close();
}

// ---- command shapes ----------------------------------------------------------

test('agentForCommand knows exactly the six bare bins', () => {
  assert.deepEqual(AGENT_BINS, ['kimi', 'codex', 'opencode', 'hermes', 'agy', 'grok']);
  for (const b of AGENT_BINS) assert.equal(agentForCommand(b), b);
  assert.equal(agentForCommand('  kimi  '), 'kimi');
  assert.equal(agentForCommand('kimi -r abc'), null); // already a resume line
  assert.equal(agentForCommand('npm test'), null);
  assert.equal(agentForCommand('claude'), null);
  assert.equal(agentForCommand(''), null);
  assert.equal(agentForCommand(null), null);
  // The bare-bin rule is load-bearing, not incidental. grok spawns with
  // --minimal, and the flag is added at term:create (bin-cache.js withSpawnFlags)
  // precisely so this stays null-free of it: a tile's command is still the bin.
  // Loosening this to a first-word match would also start matching the resume
  // lines above, which moveToSurface assigns as commands.
  assert.equal(agentForCommand('grok --minimal'), null, 'a flagged line is not a fresh tile');
  assert.equal(agentForCommand('grok --resume s1'), null);
});

test('resumeCommand is the probed line per agent', () => {
  assert.equal(resumeCommand('kimi', 's1'), 'kimi -r s1');
  assert.equal(resumeCommand('codex', 's1'), 'codex resume s1');
  assert.equal(resumeCommand('opencode', 'ses_1'), 'opencode -s ses_1');
  assert.equal(resumeCommand('hermes', 's1'), 'hermes --resume s1');
  assert.equal(resumeCommand('agy', 'uuid-1'), 'agy --conversation uuid-1');
  assert.equal(resumeCommand('claude', 's1'), null);
});

test('resumeCommand refuses a sid that is not shell-safe', () => {
  // the line is typed into a shell — a metachar in the id is an injection
  assert.equal(resumeCommand('kimi', 'a; rm -rf ~'), null);
  assert.equal(resumeCommand('kimi', '$(whoami)'), null);
  assert.equal(resumeCommand('kimi', ''), null);
  assert.equal(resumeCommand('kimi', null), null);
  assert.equal(resumeCommand('kimi', 'ok-sid_1.2'), 'kimi -r ok-sid_1.2');
});

// ---- sessionExists -----------------------------------------------------------

test('sessionExists: kimi matches a sessionId in the index', () => {
  const home = mkhome();
  kimiStore(home, [{ id: 'k-1', cwd: CWD, mtime: 5000 }]);
  assert.equal(sessionExists('kimi', CWD, 'k-1', home), true);
  assert.equal(sessionExists('kimi', CWD, 'k-nope', home), false);
});

test('sessionExists: codex matches payload.session_id, not the filename', () => {
  const home = mkhome();
  codexStore(home, [{ id: 'cx-1', cwd: CWD, at: 5000 }]);
  assert.equal(sessionExists('codex', CWD, 'cx-1', home), true);
  assert.equal(sessionExists('codex', CWD, 'rollout-0', home), false);
});

test('sessionExists: opencode and hermes look the id up in SQLite', () => {
  const home = mkhome();
  opencodeStore(home, [{ id: 'ses_1', cwd: CWD, at: 5000 }]);
  hermesStore(home, [{ id: 'h-1', cwd: CWD, at: 5000 }]);
  assert.equal(sessionExists('opencode', CWD, 'ses_1', home), true);
  assert.equal(sessionExists('opencode', CWD, 'ses_nope', home), false);
  assert.equal(sessionExists('hermes', CWD, 'h-1', home), true);
  assert.equal(sessionExists('hermes', CWD, 'h-nope', home), false);
});

test('sessionExists: agy is the conversation db existing on disk', () => {
  const home = mkhome();
  agyStore(home, CWD, 'agy-1', 5000);
  assert.equal(sessionExists('agy', CWD, 'agy-1', home), true);
  assert.equal(sessionExists('agy', CWD, 'agy-nope', home), false);
});

test('a missing or broken store means unknown, never a throw', () => {
  const home = mkhome(); // nothing written at all
  for (const a of AGENT_BINS) assert.equal(sessionExists(a, CWD, 'x', home), false);
  for (const a of AGENT_BINS) assert.equal(findSession(a, CWD, 0, home), null);
  const garbage = mkhome();
  put(path.join(garbage, '.kimi-code', 'session_index.jsonl'), 'not json\n{"also":true}\n');
  assert.equal(findSession('kimi', CWD, 0, garbage), null);
});

// ---- findSession -------------------------------------------------------------

test('findSession: kimi matches by workDir and sessionDir mtime cutoff', () => {
  const home = mkhome();
  kimiStore(home, [
    { id: 'k-old', cwd: CWD, mtime: 2000 },
    { id: 'k-new', cwd: CWD, mtime: 9000 },
    { id: 'k-elsewhere', cwd: OTHER, mtime: 99999 },
  ]);
  assert.equal(findSession('kimi', CWD, 1000, home), 'k-new'); // newest wins
  assert.equal(findSession('kimi', CWD, 5000, home), 'k-new');
  assert.equal(findSession('kimi', CWD, 9001, home), null); // both too old
  assert.equal(findSession('kimi', OTHER, 1000, home), 'k-elsewhere');
  assert.equal(findSession('kimi', '/proj/none', 0, home), null);
});

test('findSession: codex matches payload.cwd and the meta timestamp', () => {
  const home = mkhome();
  const t1 = Date.parse('2026-08-20T10:00:00Z');
  const t2 = Date.parse('2026-08-20T11:00:00Z');
  codexStore(home, [
    { id: 'cx-old', cwd: CWD, at: t1 },
    { id: 'cx-new', cwd: CWD, at: t2 },
    { id: 'cx-elsewhere', cwd: OTHER, at: t2 + 1000 },
  ]);
  assert.equal(findSession('codex', CWD, t1, home), 'cx-new');
  assert.equal(findSession('codex', CWD, t2 + 1, home), null);
  assert.equal(findSession('codex', '/proj/none', 0, home), null);
});

test('findSession: opencode matches directory and time_created (ms)', () => {
  const home = mkhome();
  opencodeStore(home, [
    { id: 'ses_old', cwd: CWD, at: 2000 },
    { id: 'ses_new', cwd: CWD, at: 9000 },
    { id: 'ses_elsewhere', cwd: OTHER, at: 99999 },
  ]);
  assert.equal(findSession('opencode', CWD, 1000, home), 'ses_new');
  assert.equal(findSession('opencode', CWD, 9001, home), null);
  assert.equal(findSession('opencode', '/proj/none', 0, home), null);
});

test('findSession: hermes matches cwd and started_at (epoch secs), any source', () => {
  const home = mkhome();
  hermesStore(home, [
    { id: 'h-old', cwd: CWD, at: 2000 },
    { id: 'h-new', cwd: CWD, at: 9000, source: 'cli' }, // cli rows DO carry cwd
    { id: 'h-elsewhere', cwd: OTHER, at: 99999 },
  ]);
  assert.equal(findSession('hermes', CWD, 1000, home), 'h-new');
  assert.equal(findSession('hermes', CWD, 9001, home), null);
  assert.equal(findSession('hermes', '/proj/none', 0, home), null);
});

test('findSession: agy follows last_conversations.json plus the db mtime', () => {
  const home = mkhome();
  agyStore(home, CWD, 'agy-1', 9000);
  assert.equal(findSession('agy', CWD, 1000, home), 'agy-1');
  assert.equal(findSession('agy', CWD, 9001, home), null); // older than the spawn
  assert.equal(findSession('agy', OTHER, 0, home), null); // no mapping for this folder
});

// ---- startDiscovery -----------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('discovery reports a matching session once, then stops', async () => {
  const home = mkhome();
  kimiStore(home, []); // spawn-time store: nothing known yet
  const found = [];
  const stop = startDiscovery({ id: 't1', agent: 'kimi', cwd: CWD, sinceMs: 1000, home, everyMs: 15, onFound: (sid) => found.push(sid) });
  kimiStore(home, [{ id: 'k-1', cwd: CWD, mtime: 9000 }]); // the agent files its session
  await sleep(120);
  stop();
  assert.deepEqual(found, ['k-1']); // once, not every tick
});

test('discovery stays silent when nothing matches, and stop ends the polling', async () => {
  const home = mkhome();
  kimiStore(home, []);
  const found = [];
  const stop = startDiscovery({ id: 't2', agent: 'kimi', cwd: OTHER, sinceMs: 1000, home, everyMs: 15, onFound: (sid) => found.push(sid) });
  kimiStore(home, [{ id: 'k-1', cwd: CWD, mtime: 9000 }]); // another folder's session: not ours
  await sleep(60);
  stop();
  // a session appearing after stop must never be reported
  kimiStore(home, [{ id: 'k-1', cwd: CWD, mtime: 9000 }, { id: 'k-2', cwd: OTHER, mtime: 9500 }]);
  await sleep(60);
  assert.deepEqual(found, []);
});

test('a session the folder already had at spawn is never reported, however fresh its mtime', async () => {
  // the resume race: a neighbour tile resuming an OLD conversation bumps its
  // timestamps — fresh by the clock, but the id was known at spawn
  const home = mkhome();
  kimiStore(home, [{ id: 'k-old', cwd: CWD, mtime: 9000 }]);
  const found = [];
  const stop = startDiscovery({ id: 't3', agent: 'kimi', cwd: CWD, sinceMs: 1000, home, everyMs: 15, onFound: (sid) => found.push(sid) });
  kimiStore(home, [{ id: 'k-old', cwd: CWD, mtime: 999999 }]); // activity, same id
  await sleep(80);
  stop();
  assert.deepEqual(found, []);
});

test('two tiles in one folder never get the same session; the oldest claims it', async () => {
  const home = mkhome();
  kimiStore(home, []);
  const foundA = [];
  const foundB = [];
  // A spawned first (smaller sinceMs) — it must win; B keeps waiting for the
  // NEXT session rather than double-resuming this one.
  const stopA = startDiscovery({ id: 'tA', agent: 'kimi', cwd: CWD, sinceMs: 1000, home, everyMs: 15, onFound: (sid) => foundA.push(sid) });
  const stopB = startDiscovery({ id: 'tB', agent: 'kimi', cwd: CWD, sinceMs: 2000, home, everyMs: 15, onFound: (sid) => foundB.push(sid) });
  kimiStore(home, [{ id: 'k-shared', cwd: CWD, mtime: 9000 }]);
  await sleep(150);
  stopA(); stopB();
  assert.deepEqual(foundA, ['k-shared']);
  assert.deepEqual(foundB, []); // k-shared was claimed; B never re-receives it
});

test('two waiting tiles pair with arriving sessions oldest-first', async () => {
  // sessions are filed in spawn order, so oldest tile + oldest session belong
  // together — newest-first would hand A the conversation B is typing in
  const home = mkhome();
  kimiStore(home, []);
  const foundA = [];
  const foundB = [];
  const stopA = startDiscovery({ id: 'pA', agent: 'kimi', cwd: CWD, sinceMs: 1000, home, everyMs: 15, onFound: (sid) => foundA.push(sid) });
  const stopB = startDiscovery({ id: 'pB', agent: 'kimi', cwd: CWD, sinceMs: 2000, home, everyMs: 15, onFound: (sid) => foundB.push(sid) });
  kimiStore(home, [{ id: 'k-a', cwd: CWD, mtime: 5000 }]);
  await sleep(80);
  kimiStore(home, [{ id: 'k-a', cwd: CWD, mtime: 5000 }, { id: 'k-b', cwd: CWD, mtime: 8000 }]);
  await sleep(80);
  stopA(); stopB();
  assert.deepEqual(foundA, ['k-a']);
  assert.deepEqual(foundB, ['k-b']);
});

// ---- grok ------------------------------------------------------------------
// The simplest store of the seven: ~/.grok/sessions/<encodeURIComponent(cwd)>/
// <uuid>/, one directory per session. The cwd IS the directory name, so there
// is nothing to scan and no database to open — a readdir plus an mtime.
// Encoding verified against the five real folders on this Mac 2026-08-21;
// encodeURIComponent reproduced every one exactly.
function grokStore(home, rows) {
  for (const r of rows) {
    const dir = path.join(home, '.grok', 'sessions', encodeURIComponent(r.cwd), r.id);
    fs.mkdirSync(dir, { recursive: true });
    put(path.join(dir, 'chat_history.jsonl'), '{}\n');
    setMtime(dir, r.mtime);
  }
  // grok also drops this beside the session folders; it is not a session
  put(path.join(home, '.grok', 'sessions', encodeURIComponent(rows[0].cwd), 'prompt_history.jsonl'), '{}\n');
}

test('grok joins the resumable agents', () => {
  assert.ok(AGENT_BINS.includes('grok'));
  assert.equal(agentForCommand('grok'), 'grok');
});

test('resumeCommand: grok resumes by id', () => {
  assert.equal(resumeCommand('grok', '01a022b6-e47c-7f50-9f3a-005e1be7ca73'),
    'grok --resume 01a022b6-e47c-7f50-9f3a-005e1be7ca73');
  // the sid is typed into a shell, so anything outside the safe charset is refused
  assert.equal(resumeCommand('grok', 'a b; rm -rf /'), null);
  assert.equal(resumeCommand('grok', ''), null);
});

test('sessionExists: grok finds the id under its own folder only', () => {
  const home = mkhome();
  grokStore(home, [{ id: 'ses_1', cwd: CWD, mtime: 5000 }, { id: 'ses_2', cwd: OTHER, mtime: 5000 }]);
  assert.equal(sessionExists('grok', CWD, 'ses_1', home), true);
  assert.equal(sessionExists('grok', CWD, 'ses_2', home), false, 'another folder is not this folder');
  assert.equal(sessionExists('grok', CWD, 'ses_nope', home), false);
});

test('sessionExists: grok on a home with no store is false, never a throw', () => {
  assert.equal(sessionExists('grok', CWD, 'ses_1', mkhome()), false);
});

test('findSession: grok takes the newest session in this folder', () => {
  const home = mkhome();
  grokStore(home, [
    { id: 'ses_old', cwd: CWD, mtime: 1000 },
    { id: 'ses_new', cwd: CWD, mtime: 9000 },
    { id: 'ses_elsewhere', cwd: OTHER, mtime: 9500 },
  ]);
  assert.equal(findSession('grok', CWD, 500, home), 'ses_new');
  assert.equal(findSession('grok', CWD, 9500, home), null, 'nothing new enough');
});

test('findSession: grok ignores the prompt_history file sitting beside the sessions', () => {
  const home = mkhome();
  grokStore(home, [{ id: 'ses_1', cwd: CWD, mtime: 9000 }]);
  assert.equal(findSession('grok', CWD, 0, home), 'ses_1');
});

test('a cwd with spaces and unicode still finds its own sessions', () => {
  const home = mkhome();
  const odd = '/proj/My Things/café';
  grokStore(home, [{ id: 'ses_odd', cwd: odd, mtime: 4000 }]);
  assert.equal(sessionExists('grok', odd, 'ses_odd', home), true);
  assert.equal(findSession('grok', odd, 0, home), 'ses_odd');
});
