// Hermes state.db read back as resume list + card events — schema mirrors
// the real ~/.hermes/state.db (probed 2026-08-16: session/load resumes the
// model but replays nothing, so history must come from here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { hermesSessions, hermesBacklog } = require('../src/main/hermes-transcript.js');
const { listConversations } = require('../src/main/session-store.js');

function fixtureDb() {
  let sqlite = null;
  try { sqlite = require('node:sqlite'); } catch (_) { return null; }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-hermes-'));
  fs.mkdirSync(path.join(home, '.hermes'), { recursive: true });
  const db = new sqlite.DatabaseSync(path.join(home, '.hermes', 'state.db'));
  db.exec('create table sessions (id text primary key, source text, title text, cwd text, origin_json text, model_config text, started_at real, last_activity_at real)');
  db.exec('create table messages (id integer primary key, session_id text, role text, content text, tool_calls text, tool_call_id text, tool_name text, timestamp real)');
  const s = db.prepare('insert into sessions values (?, ?, ?, ?, ?, ?, ?, ?)');
  // the real db carries the folder in model_config's JSON, not cwd/origin_json
  s.run('h1', 'acp', 'greeting run', null, null, '{"cwd": "/repo"}', 1786886000, 1786886100);
  s.run('h2', 'acp', 'elsewhere', null, null, '{"cwd": "/other"}', 1786886200, null);
  s.run('h3', 'telegram', 'not acp', null, null, '{"cwd": "/repo"}', 1786886300, null);
  const m = db.prepare('insert into messages (session_id, role, content, tool_calls, tool_call_id, tool_name, timestamp) values (?, ?, ?, ?, ?, ?, ?)');
  m.run('h1', 'user', 'hi', null, null, null, 1786886001);
  m.run('h1', 'assistant', '', JSON.stringify([{ id: 't1', call_id: 't1', function: { name: 'skills_list', arguments: '{}' } }]), null, null, 1786886002);
  m.run('h1', 'tool', '{"success": false, "error": "nope"}', null, 't1', 'skills_list', 1786886003);
  m.run('h1', 'assistant', 'Hello! Ready to work.', null, null, null, 1786886004);
  m.run('h1', 'system', 'prompt goo', null, null, null, 1786886000);
  db.close();
  return home;
}

test('hermes sessions list from state.db, acp-only, filtered by cwd', (t) => {
  const home = fixtureDb();
  if (!home) { t.skip('no node:sqlite'); return; }
  const r = listConversations({ agent: 'hermes', cwd: '/repo', home });
  assert.deepEqual(r.conversations.map((c) => c.id), ['h1'], 'other folders and non-acp sources drop');
  assert.equal(r.conversations[0].title, 'greeting run');
});

test('hermes history replays from messages — prose, tool calls, errored results', (t) => {
  const home = fixtureDb();
  if (!home) { t.skip('no node:sqlite'); return; }
  const b = hermesBacklog('h1', home);
  assert.deepEqual(b.events.map((e) => e.kind), ['user', 'tool', 'tool_result', 'assistant']);
  assert.equal(b.events[1].name, 'skills_list');
  assert.equal(b.events[2].isError, true, 'success:false reads as an errored row');
  assert.equal(b.events[3].text, 'Hello! Ready to work.');
});
