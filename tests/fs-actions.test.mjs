import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { newFile, newFolder, movePath, trashPath } = require('../src/main/fs-actions.js');

const ROOT = '/proj';
function fakeOps(existing = []) {
  const calls = { writes: [], mkdirs: [], renames: [] };
  return {
    calls,
    exists: (p) => existing.includes(p),
    mkdir: (p) => calls.mkdirs.push(p),
    writeFile: (p) => calls.writes.push(p),
    rename: (a, b) => calls.renames.push([a, b]),
  };
}

test('newFile creates inside the root and refuses outside or existing', () => {
  const ops = fakeOps(['/proj/docs/dup.md']);
  assert.equal(newFile({ root: ROOT, dir: '/proj/docs', name: 'a.md', ops }).ok, true);
  assert.deepEqual(ops.calls.writes, ['/proj/docs/a.md']);
  assert.equal(newFile({ root: ROOT, dir: '/etc', name: 'a.md', ops }).ok, false);
  assert.equal(newFile({ root: ROOT, dir: '/proj/docs', name: 'dup.md', ops }).ok, false);
  assert.equal(newFile({ root: ROOT, dir: '/proj/docs', name: '../evil.md', ops }).ok, false);
});

test('newFolder mirrors the same guards', () => {
  const ops = fakeOps();
  assert.equal(newFolder({ root: ROOT, dir: '/proj', name: 'notes', ops }).ok, true);
  assert.deepEqual(ops.calls.mkdirs, ['/proj/notes']);
  assert.equal(newFolder({ root: ROOT, dir: '/outside', name: 'x', ops }).ok, false);
});

test('movePath moves within the root, refusing collisions and escapes', () => {
  const ops = fakeOps(['/proj/a.md', '/proj/docs/a.md']);
  const hit = movePath({ root: ROOT, src: '/proj/a.md', destDir: '/proj/docs', ops });
  assert.equal(hit.ok, false);
  const ok = movePath({ root: ROOT, src: '/proj/a.md', destDir: '/proj/sub', ops });
  assert.deepEqual(ok, { ok: true, path: '/proj/sub/a.md' });
  assert.deepEqual(ops.calls.renames, [['/proj/a.md', '/proj/sub/a.md']]);
  assert.equal(movePath({ root: ROOT, src: '/proj/a.md', destDir: '/tmp', ops }).ok, false);
  assert.equal(movePath({ root: ROOT, src: '/etc/passwd', destDir: '/proj', ops }).ok, false);
});

test('trashPath trashes inside the root only, never the root itself', async () => {
  const trashed = [];
  const ops = fakeOps(['/proj/old.md']);
  const trashFn = (p) => { trashed.push(p); return Promise.resolve(); };
  const ok = await trashPath({ root: ROOT, path: '/proj/old.md', trashFn, ops });
  assert.deepEqual(ok, { ok: true, path: '/proj/old.md' });
  assert.deepEqual(trashed, ['/proj/old.md']);
  assert.equal((await trashPath({ root: ROOT, path: ROOT, trashFn, ops })).ok, false);
  assert.equal((await trashPath({ root: ROOT, path: '/etc/passwd', trashFn, ops })).ok, false);
  assert.equal((await trashPath({ root: ROOT, path: '/proj/gone.md', trashFn, ops })).ok, false);
});
