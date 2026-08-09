import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { migrateRecents, sortRecents, capRecents, rememberFolderIn, setPinnedIn, removeFrom } = require('../src/main/recents.js');

const row = (path, at, pinned = false) => ({ path, at, pinned });

test('a pre-pin state.json of bare paths still loads', () => {
  const out = migrateRecents(['/a', '/b']);
  assert.deepEqual(out, [{ path: '/a', at: 0, pinned: false }, { path: '/b', at: 0, pinned: false }]);
});

test('migration drops junk rather than carrying a half-formed row', () => {
  assert.deepEqual(migrateRecents([null, 42, {}, { path: '' }, '/ok']), [{ path: '/ok', at: 0, pinned: false }]);
  assert.deepEqual(migrateRecents(undefined), []);
  assert.deepEqual(migrateRecents({ nope: 1 }), []);
});

test('migration keeps a pin and coerces a bad timestamp to 0', () => {
  assert.deepEqual(migrateRecents([{ path: '/a', at: 'later', pinned: 1 }]), [{ path: '/a', at: 0, pinned: true }]);
});

test('pinned rows sort above recent ones however new the recent one is', () => {
  const out = sortRecents([row('/new', 900), row('/pin', 1, true)]);
  assert.deepEqual(out.map((r) => r.path), ['/pin', '/new']);
});

test('the cap evicts the oldest unpinned row', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row('/p' + i, i));
  const out = capRecents(rows);
  assert.equal(out.length, 8);
  assert.equal(out.at(-1).path, '/p2');   // /p0 and /p1 are the oldest, so they go
});

test('a pinned row survives a full list of newer folders', () => {
  const rows = [row('/home', 1, true), ...Array.from({ length: 12 }, (_, i) => row('/p' + i, 100 + i))];
  const out = capRecents(rows);
  assert.equal(out[0].path, '/home', 'pinned sorts first');
  assert.equal(out.filter((r) => !r.pinned).length, 8, 'the cap still applies to the rest');
  assert.ok(out.some((r) => r.path === '/home'), 'and never evicts the pin');
});

test('opening a folder moves it to the front without duplicating it', () => {
  let rows = [row('/a', 1), row('/b', 2)];
  rows = rememberFolderIn(rows, '/a', 99);
  assert.deepEqual(rows.map((r) => r.path), ['/a', '/b']);
  assert.equal(rows.filter((r) => r.path === '/a').length, 1);
  assert.equal(rows[0].at, 99);
});

test('opening a pinned folder does not silently unpin it', () => {
  const rows = rememberFolderIn([row('/a', 1, true)], '/a', 99);
  assert.equal(rows[0].pinned, true);
  assert.equal(rows[0].at, 99);
});

test('pinning an already-capped row keeps it and re-sorts', () => {
  const rows = capRecents(Array.from({ length: 8 }, (_, i) => row('/p' + i, i)));
  const out = setPinnedIn(rows, '/p3', true);
  assert.equal(out[0].path, '/p3');
  assert.equal(out.length, 8, 'pinning does not grow the list on its own');
});

test('unpinning drops the row back into the recent ordering', () => {
  const out = setPinnedIn([row('/pin', 1, true), row('/new', 50)], '/pin', false);
  assert.deepEqual(out.map((r) => r.path), ['/new', '/pin']);
});

test('pinning a path that is not in the list is a no-op, not a crash', () => {
  const rows = [row('/a', 1)];
  assert.deepEqual(setPinnedIn(rows, '/gone', true).map((r) => r.path), ['/a']);
});

test('remove takes the row out and leaves the rest alone', () => {
  assert.deepEqual(removeFrom([row('/a', 1), row('/b', 2)], '/a').map((r) => r.path), ['/b']);
  assert.deepEqual(removeFrom([row('/a', 1)], '/missing').map((r) => r.path), ['/a']);
});

test('a duplicated path in a hand-edited state.json collapses to one row', () => {
  const out = capRecents([row('/a', 5), row('/a', 1)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].at, 5, 'the first occurrence wins');
});
