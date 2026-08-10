// Claude records every live session in ~/.claude/sessions/<pid>.json. Verified
// against a real PTY spawn (CLI 2.1.226): the file appears within seconds and
// its sessionId is the conversation claude is ACTUALLY in — which is not the id
// nami pinned with --session-id once the user runs /resume and picks another.
//
// Proven divergence, measured:
//   pinned c602aba0…  →  after /resume, live dddf8560…  →  pinned transcript never created
//
// That divergence is why a tile's label used to freeze on the typed prompt and
// why a restored tile silently started a blank conversation instead of resuming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLiveSession, liveSessionChanged } from '../src/main/session-registry.js';

const rec = (o) => JSON.stringify(Object.assign({
  pid: 4242, sessionId: 'dddf8560-3aad-4b62-9184-33ad8101ba20',
  cwd: '/Users/dev/code/nami', status: 'idle',
  name: 'dainami-cli-ff', nameSource: 'derived',
}, o));

const io = (text) => ({ read: () => { if (text === null) throw new Error('ENOENT'); return text; } });

test('reads the live session id and status for a pid', () => {
  const got = readLiveSession(4242, io(rec()));
  assert.equal(got.sessionId, 'dddf8560-3aad-4b62-9184-33ad8101ba20');
  assert.equal(got.status, 'idle');
});

test('a missing registry file is not an error, just no answer', () => {
  // The window between spawn and claude writing the file, and every non-claude
  // session, both land here. It must stay quiet.
  assert.equal(readLiveSession(4242, io(null)), null);
});

test('corrupt or half-written JSON is ignored rather than thrown', () => {
  assert.equal(readLiveSession(4242, io('{"sessionId": "dddf')), null);
  assert.equal(readLiveSession(4242, io('')), null);
});

test('a record with no sessionId is not usable', () => {
  assert.equal(readLiveSession(4242, io(JSON.stringify({ pid: 4242, status: 'idle' }))), null);
});

test('the derived registry name is never treated as a title', () => {
  // "dainami-cli-ff" is claude's folder-derived slug, not a name for the work.
  // Only nameSource other than "derived" means a human or claude chose it.
  const got = readLiveSession(4242, io(rec()));
  assert.equal(got.name, null);
  const named = readLiveSession(4242, io(rec({ name: 'build: dark mode', nameSource: 'custom' })));
  assert.equal(named.name, 'build: dark mode');
});

test('divergence is detected only when the live id is real and different', () => {
  assert.equal(liveSessionChanged('aaa', 'bbb'), true);
  assert.equal(liveSessionChanged('aaa', 'aaa'), false);
  assert.equal(liveSessionChanged('aaa', null), false, 'no reading yet is not a change');
  assert.equal(liveSessionChanged('aaa', ''), false);
});

test('a tile that never pinned an id adopts whatever claude is in', () => {
  assert.equal(liveSessionChanged(null, 'bbb'), true);
});
