// A path printed in a terminal or a reply, asked about before it is offered as
// a link. The asking is a stat, and on Windows a stat of \\server\share is a
// login to that server — so the answer for such a path is "no" before the disk
// is touched, unless the pane's own folder is on that share. And the stat is
// awaited, never synchronous: a share that does not answer must not be able to
// hold the whole app still while SMB makes up its mind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { statToken } = require('../src/main/path-stat.js');

const file = { isFile: () => true, isDirectory: () => false };
const dir = { isFile: () => false, isDirectory: () => true };
function disk(entries) {
  const asked = [];
  const stat = async (p) => { asked.push(p); if (p in entries) return entries[p]; throw new Error('ENOENT'); };
  return { stat, asked };
}
const WIN = (d, roots = ['C:\\proj']) => ({ platform: 'win32', home: 'C:\\Users\\cal', roots, stat: d.stat });

test('the answer keeps the shape it always had', async () => {
  const d = disk({ '/proj/src/a.md': file, '/proj/src': dir, '/Users/cal/notes.md': file });
  const o = { platform: 'darwin', home: '/Users/cal', stat: d.stat };
  assert.deepEqual(await statToken('src/a.md', '/proj', o), { exists: true, isFile: true, isDir: false, abs: '/proj/src/a.md', relative: true });
  assert.deepEqual(await statToken('/proj/src', '/proj', o), { exists: true, isFile: false, isDir: true, abs: '/proj/src', relative: false });
  assert.deepEqual(await statToken('~/notes.md', '/proj', o), { exists: true, isFile: true, isDir: false, abs: '/Users/cal/notes.md', relative: false });
  assert.deepEqual(await statToken('src/a.md),', '/proj', o), { exists: true, isFile: true, isDir: false, abs: '/proj/src/a.md', relative: true });
  assert.deepEqual(await statToken('nope.md', '/proj', o), { exists: false, relative: true });
  assert.deepEqual(await statToken('/nope.md', '/proj', o), { exists: false, relative: false });
  assert.deepEqual(await statToken('', '/proj', o), { exists: false, relative: false });
  assert.deepEqual(await statToken(null, '/proj', o), { exists: false, relative: false });
});

test('it really is asynchronous, and really reads the disk when left to itself', async () => {
  const pending = statToken(path.basename(import.meta.filename), import.meta.dirname);
  assert.ok(pending instanceof Promise);
  assert.deepEqual(await pending, { exists: true, isFile: true, isDir: false, abs: import.meta.filename, relative: true });
  assert.equal((await statToken('~', os.tmpdir())).abs, os.homedir());
  assert.equal(fs.existsSync(import.meta.filename), true);
});

test('windows: a path on somebody else\'s server is answered without touching the disk', async () => {
  for (const evil of ['\\\\evil\\share\\a.md', '//evil/share/a.md', '\\\\10.0.0.5\\c$\\a.txt', '\\\\?\\C:\\proj\\a.md', '\\\\?\\UNC\\evil\\s\\a', '\\\\.\\pipe\\x']) {
    const d = disk({ [path.win32.resolve(evil)]: file });
    assert.deepEqual(await statToken(evil, 'C:\\proj', WIN(d)), { exists: false, relative: false }, evil);
    assert.deepEqual(d.asked, [], evil);
  }
});

test('windows: a relative token cannot be walked onto a share by the folder it is read against', async () => {
  const d = disk({ '\\\\evil\\share\\a.md': file });
  assert.deepEqual(await statToken('a.md', '\\\\evil\\share', WIN(d)), { exists: false, relative: true });
  assert.deepEqual(d.asked, []);
});

test('windows: a project on a share keeps its links, absolute and relative', async () => {
  const root = '\\\\Mac\\Home\\Documents\\nami';
  const d = disk({ '\\\\Mac\\Home\\Documents\\nami\\src\\a.md': file, '\\\\Mac\\Home\\other\\b.md': file });
  assert.deepEqual(await statToken('src\\a.md', root, WIN(d, [root])), { exists: true, isFile: true, isDir: false, abs: '\\\\Mac\\Home\\Documents\\nami\\src\\a.md', relative: true });
  assert.deepEqual(await statToken('\\\\mac\\home\\other\\b.md', root, WIN(d, [root])), { exists: false, relative: false }, 'the pretend disk is case-exact; the point is that it was asked');
  assert.deepEqual(d.asked, ['\\\\Mac\\Home\\Documents\\nami\\src\\a.md', '\\\\mac\\home\\other\\b.md']);
  // and another server is still another server
  assert.deepEqual(await statToken('\\\\evil\\share\\a.md', root, WIN(d, [root])), { exists: false, relative: false });
  assert.equal(d.asked.length, 2);
});

test('windows: ordinary drive paths are asked about as before', async () => {
  const d = disk({ 'C:\\proj\\src\\a.md': file, 'C:\\Users\\cal\\notes.md': file });
  assert.deepEqual(await statToken('src/a.md', 'C:\\proj', WIN(d)), { exists: true, isFile: true, isDir: false, abs: 'C:\\proj\\src\\a.md', relative: true });
  assert.deepEqual(await statToken('~\\notes.md', 'C:\\proj', WIN(d)), { exists: true, isFile: true, isDir: false, abs: 'C:\\Users\\cal\\notes.md', relative: false });
});
