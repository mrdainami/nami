import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { handles, chooseTarget, chooseFolderTarget, OPEN_EXT } = require('../src/main/open-with.js');

test('handles the declared extensions, case-insensitively', () => {
  for (const e of OPEN_EXT) assert.equal(handles('/a/b/note.' + e), true, e);
  assert.equal(handles('/a/b/NOTE.MD'), true);
  assert.equal(handles('/a/b/read.markdown'), true);
});

test('does not handle anything else', () => {
  for (const p of ['/a/b/shot.png', '/a/b/app.js', '/a/b/data.json', '/a/b/paper.pdf', '/a/b/README', '/a/b/.md'])
    assert.equal(handles(p), false, p);
  assert.equal(handles(''), false);
  assert.equal(handles(null), false);
});

const pick = (over = {}) => chooseTarget({
  filePath: '/proj/docs/note.md',
  windows: [],
  focusedId: null,
  ...over,
});

test('a window holding the folder takes the file where it is', () => {
  const r = pick({ windows: [{ id: 1, folder: '/proj' }], focusedId: 1 });
  assert.deepEqual(r, { action: 'here', id: 1, folder: '/proj' });
});

test('the file lands in the same folder it already sits in', () => {
  const r = pick({ windows: [{ id: 7, folder: '/proj/docs' }], focusedId: 7 });
  assert.deepEqual(r, { action: 'here', id: 7, folder: '/proj/docs' });
});

test('the deepest folder wins over a shallower one', () => {
  const r = pick({ windows: [{ id: 1, folder: '/proj' }, { id: 2, folder: '/proj/docs' }], focusedId: 1 });
  assert.equal(r.action, 'here');
  assert.equal(r.id, 2);
});

test('among equally deep folders the focused window wins', () => {
  const r = pick({ windows: [{ id: 1, folder: '/proj' }, { id: 2, folder: '/proj' }], focusedId: 2 });
  assert.equal(r.id, 2);
});

test('a sibling that only shares a name prefix is not a match', () => {
  const r = pick({ windows: [{ id: 1, folder: '/proj-evil' }], focusedId: 1 });
  assert.deepEqual(r, { action: 'adopt', id: 1, folder: '/proj/docs' });
});

test('no window holds the folder, so the focused one adopts it', () => {
  const r = pick({ windows: [{ id: 4, folder: '/other' }, { id: 5, folder: '/elsewhere' }], focusedId: 5 });
  assert.deepEqual(r, { action: 'adopt', id: 5, folder: '/proj/docs' });
});

test('a window with no folder open still adopts rather than spawning', () => {
  const r = pick({ windows: [{ id: 3, folder: null }], focusedId: 3 });
  assert.deepEqual(r, { action: 'adopt', id: 3, folder: '/proj/docs' });
});

test('a stale focusedId falls back to the last window rather than spawning', () => {
  const r = pick({ windows: [{ id: 8, folder: '/other' }], focusedId: 99 });
  assert.deepEqual(r, { action: 'adopt', id: 8, folder: '/proj/docs' });
});

test('with no windows at all, one is made for the parent folder', () => {
  const r = pick({ windows: [], focusedId: null });
  assert.deepEqual(r, { action: 'new-window', id: null, folder: '/proj/docs' });
});

// ---- Windows ---------------------------------------------------------------
// The same four cases, reached from a command line instead of from Finder. The
// one thing that differs is how names compare: `C:\Work` and `c:\work` are one
// folder, and a path typed into a terminal arrives in whatever case it was typed.
const winPick = (over = {}) => chooseTarget({
  filePath: 'C:\\proj\\docs\\note.md', windows: [], focusedId: null, platform: 'win32', ...over,
});

test('windows: a window holding the folder takes the file, whatever case either was written in', () => {
  assert.deepEqual(winPick({ windows: [{ id: 1, folder: 'C:\\proj' }], focusedId: 1 }), { action: 'here', id: 1, folder: 'C:\\proj' });
  assert.deepEqual(winPick({ windows: [{ id: 1, folder: 'c:\\PROJ\\' }], focusedId: 1 }), { action: 'here', id: 1, folder: 'c:\\PROJ\\' });
  assert.equal(winPick({ windows: [{ id: 1, folder: 'C:\\proj' }, { id: 2, folder: 'C:\\Proj\\Docs' }], focusedId: 1 }).id, 2);
});

test('windows: a sibling that only shares a name prefix is still not a match', () => {
  assert.deepEqual(winPick({ windows: [{ id: 1, folder: 'C:\\proj-evil' }], focusedId: 1 }), { action: 'adopt', id: 1, folder: 'C:\\proj\\docs' });
});

test('windows: with no windows at all, one is made for the parent folder', () => {
  assert.deepEqual(winPick(), { action: 'new-window', id: null, folder: 'C:\\proj\\docs' });
  assert.deepEqual(winPick({ filePath: 'C:\\note.md' }), { action: 'new-window', id: null, folder: 'C:\\' });
});

test('on a Mac names still differ by case, as they always have here', () => {
  const r = pick({ windows: [{ id: 1, folder: '/PROJ' }], focusedId: 1, platform: 'darwin' });
  assert.deepEqual(r, { action: 'adopt', id: 1, folder: '/proj/docs' });
});

// `Nami.exe C:\work` — a folder has no parent to fall back on and nothing to
// adopt: it is either a desk that is already open, or a new one.
test('a folder that a window already has open goes to that window', () => {
  const windows = [{ id: 1, folder: 'C:\\other' }, { id: 2, folder: 'C:\\work' }];
  assert.deepEqual(chooseFolderTarget({ folder: 'C:\\work', windows, platform: 'win32' }), { action: 'here', id: 2, folder: 'C:\\work' });
  assert.deepEqual(chooseFolderTarget({ folder: 'c:\\WORK\\', windows, platform: 'win32' }), { action: 'here', id: 2, folder: 'C:\\work' });
  assert.deepEqual(chooseFolderTarget({ folder: '/work/', windows: [{ id: 5, folder: '/work' }], platform: 'darwin' }), { action: 'here', id: 5, folder: '/work' });
});

test('a folder nobody has open gets a window of its own, never somebody else\'s desk', () => {
  const windows = [{ id: 1, folder: 'C:\\work\\docs' }, { id: 2, folder: 'C:\\' }, { id: 3, folder: null }];
  assert.deepEqual(chooseFolderTarget({ folder: 'C:\\work', windows, platform: 'win32' }), { action: 'new-window', id: null, folder: 'C:\\work' });
  assert.deepEqual(chooseFolderTarget({ folder: 'C:\\work', windows: [], platform: 'win32' }), { action: 'new-window', id: null, folder: 'C:\\work' });
  assert.deepEqual(chooseFolderTarget({ folder: '/Work', windows: [{ id: 1, folder: '/work' }], platform: 'darwin' }), { action: 'new-window', id: null, folder: '/Work' });
});

test('among windows on the same folder the focused one is chosen', () => {
  const windows = [{ id: 1, folder: 'C:\\work' }, { id: 2, folder: 'C:\\work' }];
  assert.equal(chooseFolderTarget({ folder: 'C:\\work', windows, focusedId: 2, platform: 'win32' }).id, 2);
  assert.equal(chooseFolderTarget({ folder: 'C:\\work', windows, focusedId: 9, platform: 'win32' }).id, 1);
});

// The two lists have to agree or the app advertises a type it then refuses to
// route: Finder offers Nami for the file, macOS launches it, and open-with.js
// drops the path on the floor because the extension is not in OPEN_EXT.
test('electron-builder declares exactly the extensions open-with routes', () => {
  const yml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  const block = yml.split(/^\s*fileAssociations:\s*$/m)[1];
  assert.ok(block, 'no fileAssociations block in electron-builder.yml');
  // Stop at the next key at the same indent — the block is a list under `mac:`.
  const body = block.split(/\n(?=  \w)/)[0];
  const declared = [...body.matchAll(/ext:\s*\[([^\]]+)\]/g)]
    .flatMap((m) => m[1].split(',').map((e) => e.trim()));
  assert.deepEqual([...declared].sort(), [...OPEN_EXT].sort());
});
