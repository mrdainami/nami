// /resume's list, per agent, read from each agent's real store shape (the
// fixtures mirror what is actually on disk: claude project transcripts,
// codex rollout session_meta heads, kimi's session_index, agy's .pb blobs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { listConversations } = require('../src/main/session-store.js');
const { projectSlug } = require('../src/main/claude-args');

function fixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-store-'));
  const cwd = '/repo/atlas';
  // claude: two transcripts for this project, one line each
  const cdir = path.join(home, '.claude', 'projects', projectSlug(cwd));
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(cdir, 'ses_old.jsonl'), JSON.stringify({ type: 'user', message: { content: 'hello' } }) + '\n');
  fs.writeFileSync(path.join(cdir, 'ses_new.jsonl'), JSON.stringify({ type: 'user', message: { content: 'newer' } }) + '\n');
  fs.utimesSync(path.join(cdir, 'ses_old.jsonl'), new Date(Date.now() - 86400e3), new Date(Date.now() - 86400e3));
  // codex: one rollout in this cwd, one elsewhere
  const xdir = path.join(home, '.codex', 'sessions', '2026', '08', '13');
  fs.mkdirSync(xdir, { recursive: true });
  fs.writeFileSync(path.join(xdir, 'rollout-a.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: 'th_here', cwd } }) + '\n');
  fs.writeFileSync(path.join(xdir, 'rollout-b.jsonl'),
    JSON.stringify({ type: 'session_meta', payload: { id: 'th_elsewhere', cwd: '/other' } }) + '\n');
  // kimi: index with one session here, one elsewhere, one duplicate
  const kdir = path.join(home, '.kimi-code');
  fs.mkdirSync(kdir, { recursive: true });
  fs.writeFileSync(path.join(kdir, 'session_index.jsonl'), [
    JSON.stringify({ sessionId: 's_here', sessionDir: kdir, workDir: cwd }),
    JSON.stringify({ sessionId: 's_elsewhere', sessionDir: kdir, workDir: '/other' }),
    JSON.stringify({ sessionId: 's_here', sessionDir: kdir, workDir: cwd }),
  ].join('\n') + '\n');
  // agy: two protobuf blobs, ids in the names
  const adir = path.join(home, '.gemini', 'antigravity', 'conversations');
  fs.mkdirSync(adir, { recursive: true });
  fs.writeFileSync(path.join(adir, 'conv-1.pb'), 'x');
  fs.writeFileSync(path.join(adir, 'conv-2.pb'), 'x');
  return { home, cwd };
}

test('claude lists this project\'s transcripts, newest first', () => {
  const { home, cwd } = fixtureHome();
  const { conversations } = listConversations({ agent: 'claude', cwd, home });
  assert.deepEqual(conversations.map((c) => c.id), ['ses_new', 'ses_old']);
  assert.ok(conversations.every((c) => c.age));
});

test('codex lists only rollouts whose session_meta cwd matches', () => {
  const { home, cwd } = fixtureHome();
  const { conversations } = listConversations({ agent: 'codex', cwd, home });
  assert.deepEqual(conversations.map((c) => c.id), ['th_here']);
});

test('kimi filters by workDir and dedupes the index', () => {
  const { home, cwd } = fixtureHome();
  const { conversations } = listConversations({ agent: 'kimi', cwd, home });
  assert.deepEqual(conversations.map((c) => c.id), ['s_here']);
});

test('agy lists ids from the blob names and says it cannot file by folder', () => {
  const { home, cwd } = fixtureHome();
  const res = listConversations({ agent: 'agy', cwd, home });
  assert.deepEqual(new Set(res.conversations.map((c) => c.id)), new Set(['conv-1', 'conv-2']));
  assert.match(res.note, /folder/);
});

test('an agent with no readable store returns an empty list and a note, never a throw', () => {
  const { conversations, note } = listConversations({ agent: 'hermes', cwd: '/x', home: '/nonexistent' });
  assert.deepEqual(conversations, []);
  assert.ok(note);
  const missing = listConversations({ agent: 'claude', cwd: '/x', home: '/nonexistent' });
  assert.deepEqual(missing.conversations, []);
});

// ---- opencode: the listable id is the whole ballgame ------------------------
// ACP session/load replays the picked conversation into the card, so this
// branch is what turns opencode resume from unreachable into real history.

function opencodeFixture(home, cwd) {
  const dir = path.join(home, '.local', 'share', 'opencode', 'storage', 'session', 'projhash1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ses_here.json'), JSON.stringify({
    id: 'ses_here', directory: cwd, title: 'rename the tracking flag',
    time: { created: 1, updated: Date.now() - 60e3 },
  }));
  fs.writeFileSync(path.join(dir, 'ses_untitled.json'), JSON.stringify({
    id: 'ses_untitled', directory: cwd, title: 'New session - 2026-08-08T08:43:19.705Z',
    time: { created: 1, updated: Date.now() - 3600e3 },
  }));
  fs.writeFileSync(path.join(dir, 'ses_elsewhere.json'), JSON.stringify({
    id: 'ses_elsewhere', directory: '/other', title: 'not this folder',
    time: { created: 1, updated: Date.now() },
  }));
  // newest-first comes from file mtimes; writes above land microseconds apart
  fs.utimesSync(path.join(dir, 'ses_untitled.json'), new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
}

test('opencode lists this folder\'s sessions, keeps real titles, drops the timestamp ones', () => {
  const { home, cwd } = fixtureHome();
  opencodeFixture(home, cwd);
  const res = listConversations({ agent: 'opencode', cwd, home });
  assert.deepEqual(res.conversations.map((c) => c.id), ['ses_here', 'ses_untitled']);
  assert.equal(res.conversations[0].title, 'rename the tracking flag');
  assert.equal(res.conversations[1].title, '', 'an auto "New session - <date>" is not a title');
  assert.match(res.note, /replays/);
});

test('codex rows carry the first real user message as a preview', () => {
  const { home, cwd } = fixtureHome();
  const xdir = path.join(home, '.codex', 'sessions', '2026', '08', '13');
  fs.appendFileSync(path.join(xdir, 'rollout-a.jsonl'), [
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: '<environment_context>machine stuff</environment_context>' }] } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: 'fix the flaky auth test' }] } }),
  ].join('\n') + '\n');
  const { conversations } = listConversations({ agent: 'codex', cwd, home });
  assert.equal(conversations[0].preview, 'fix the flaky auth test');
});

test('codex 0.147: a ~22KB session_meta line still lists — 4KB head reads missed every rollout', () => {
  const { home, cwd } = fixtureHome();
  const xdir = path.join(home, '.codex', 'sessions', '2026', '08', '16');
  fs.mkdirSync(xdir, { recursive: true });
  // the real CLI embeds its entire system prompt in base_instructions
  const meta = JSON.stringify({ type: 'session_meta', payload: {
    id: 'th_bigmeta', cwd, base_instructions: { text: 'You are Codex. '.repeat(1500) },
  } });
  assert.ok(meta.length > 8192, 'fixture must exceed the old 4KB head read');
  fs.writeFileSync(path.join(xdir, 'rollout-big.jsonl'), meta + '\n' +
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: 'wire up the tracking ping' }] } }) + '\n');
  const { conversations } = listConversations({ agent: 'codex', cwd, home });
  const big = conversations.find((c) => c.id === 'th_bigmeta');
  assert.ok(big, 'the rollout must survive a huge meta line');
  assert.equal(big.preview, 'wire up the tracking ping', 'preview reads from after the meta line');
});
