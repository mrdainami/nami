// A path that names another computer, arriving in text nobody chose.
//
// Windows reaches for \\server\share the moment anything stats, reads or draws
// it, and the reaching is the damage: the PC logs in to that server with the
// owner's account, which hands over a hash of their password, and a server
// that does not answer holds the caller for the length of an SMB timeout. An
// agent's reply, a line a program printed and a cwd report are all text nobody
// chose, so none of them may make that happen.
//
// One rule, kept twice — main (remote-path.js) and the renderer (paths.mjs),
// which cannot import it. Both are fed the same table here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as R from '../src/renderer/paths.mjs';

const require = createRequire(import.meta.url);
const M = require('../src/main/remote-path.js');

const W = 'win32', MAC = 'darwin';
const BOTH = [['main', M], ['renderer', R]];

const REMOTE = ['\\\\evil\\share\\a.png', '\\\\evil\\share', '\\\\10.0.0.5\\c$\\a.txt', '//evil/share/a.png', '\\/evil\\share', '/\\evil/share',
  '\\\\?\\C:\\x\\a.md', '\\\\?\\UNC\\evil\\share\\a', '\\\\.\\pipe\\x', '\\\\evil@SSL@443\\dav\\a', '\\\\evil', '\\\\'];
const LOCAL = ['C:\\work\\a.md', 'C:/work/a.md', 'D:\\', 'a.md', '.\\a.md', '..\\a.md', '~\\a.md', '\\work\\a.md', '/work/a.md', '', null, undefined];

test('two leading separators of either kind look remote on Windows, and nothing else does', () => {
  for (const [who, lib] of BOTH) {
    for (const p of REMOTE) assert.equal(lib.looksRemote(p, W), true, `${who} ${p}`);
    for (const p of LOCAL) assert.equal(lib.looksRemote(p, W), false, `${who} ${p}`);
  }
});

test('a Mac has no such paths: // is a folder there, and \\\\ is a file name', () => {
  for (const [who, lib] of BOTH) for (const p of [...REMOTE, ...LOCAL]) {
    assert.equal(lib.looksRemote(p, MAC), false, `${who} ${p}`);
    assert.equal(lib.safeToTouch(p, [], MAC), true, `${who} ${p}`);
  }
});

test('the share is the server and the share name, in one spelling', () => {
  for (const [who, lib] of BOTH) {
    assert.equal(lib.shareOf('\\\\Mac\\Home\\Documents\\x', W), '\\\\mac\\home', who);
    assert.equal(lib.shareOf('//MAC/home/', W), '\\\\mac\\home', who);
    assert.equal(lib.shareOf('\\\\Mac\\Home', W), '\\\\mac\\home', who);
    // no share to name: a device path, a server alone, a local path
    for (const p of ['\\\\?\\C:\\x', '\\\\?\\UNC\\Mac\\Home\\x', '\\\\.\\pipe\\x', '\\\\Mac', '\\\\', 'C:\\x', '', null])
      assert.equal(lib.shareOf(p, W), '', `${who} ${p}`);
    assert.equal(lib.shareOf('\\\\Mac\\Home\\x', MAC), '', who);
  }
});

test('a remote-looking path is left alone unless the open project lives on that very share', () => {
  const project = '\\\\Mac\\Home\\Documents\\nami';
  for (const [who, lib] of BOTH) {
    for (const p of LOCAL) assert.equal(lib.safeToTouch(p, [], W), true, `${who} ${p}`);
    for (const p of REMOTE) {
      assert.equal(lib.safeToTouch(p, [], W), false, `${who} ${p}`);
      assert.equal(lib.safeToTouch(p, ['C:\\work', 'C:\\Users\\cal'], W), false, `${who} ${p}`);
      assert.equal(lib.safeToTouch(p, [project], W), false, `${who} ${p}`);
    }
    // the owner's own case: a project on the Mac's share, in every spelling
    for (const p of ['\\\\Mac\\Home\\Documents\\nami\\src\\a.png', '\\\\mac\\HOME\\elsewhere\\b.md', '//Mac/Home/Documents/nami/a.png', '\\\\Mac\\Home'])
      assert.equal(lib.safeToTouch(p, ['C:\\Users\\cal', project], W), true, `${who} ${p}`);
    // the same server is not the same share, and a longer name is another server
    for (const p of ['\\\\Mac\\Other\\a.png', '\\\\Mac\\Home2\\a.png', '\\\\Mac.evil.example\\Home\\a.png', '\\\\?\\UNC\\Mac\\Home\\a.png'])
      assert.equal(lib.safeToTouch(p, [project], W), false, `${who} ${p}`);
    // roots that are missing or are not strings are nobody's share
    assert.equal(lib.safeToTouch('\\\\evil\\share\\a', [null, undefined, '', 5, '\\\\', '\\\\?\\x'], W), false, who);
    assert.equal(lib.safeToTouch('\\\\evil\\share\\a', undefined, W), false, who);
  }
});
