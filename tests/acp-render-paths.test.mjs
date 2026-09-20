// The chat transcript's path rules, without a DOM: which `code` spans are
// files, what a diff header shows, and where a tool's image lives on disk.
// Resolving against the session folder is resolveFrom's job, tested with the
// rest of paths.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePath, shortPath, imageOpenPath } from '../src/renderer/acp-render.mjs';

const W = 'win32', M = 'darwin';

test('a code span is a file when it says where it starts, or ends in a type we know', () => {
  for (const t of ['/Users/cal/nami/out/shot.png', '/etc/hosts.bak', '~/notes/todo.md', './src/app.js', 'src/renderer/app.js', 'README.md', 'my notes.txt'])
    assert.equal(looksLikePath(t, M), true, t);
  for (const t of ['npm install', 'foo.bar()', 'user.name', '/Users/cal/nami', 'v1.2.3', 'a/b/c'])
    assert.equal(looksLikePath(t, M), false, t);
});

test('off Windows a backslash path is not one, as it never was', () => {
  for (const t of ['C:\\Users\\cal\\shot.png', '.\\src\\app.js', 'src\\app.js', '\\\\nas\\share\\a.png']) {
    assert.equal(looksLikePath(t, M), false, t);
    assert.equal(looksLikePath(t), false, t);
  }
});

test('windows: drive, share, dotted and bare paths are all files', () => {
  for (const t of ['C:\\Users\\cal\\nami\\out\\shot.png', 'C:/Users/cal/shot.png', 'D:\\logs\\run.bak', '\\\\nas\\share\\a.png',
                   '~\\notes\\todo.md', '.\\src\\app.js', '..\\shared\\util.mjs', 'src\\renderer\\app.js', 'src/renderer/app.js',
                   'README.md', 'C:\\Users\\John Smith\\my notes.txt'])
    assert.equal(looksLikePath(t, W), true, t);
});

test('windows: code that merely has a backslash in it is not a file', () => {
  for (const t of ['npm install', 'foo.bar()', 'user.name', 'C:\\Users\\cal\\nami', '\\d+\\.\\w{2}', '\\n', 'a\\b\\c', 'C:', 'HKLM\\Software\\Nami'])
    assert.equal(looksLikePath(t, W), false, t);
});

test('a diff header shows the last three pieces', () => {
  assert.equal(shortPath('/Users/cal/nami/src/renderer/app.js', M), 'src/renderer/app.js');
  assert.equal(shortPath('src/app.js', M), 'src/app.js');
  assert.equal(shortPath('', M), '');
  assert.equal(shortPath('C:\\Users\\cal\\nami\\src\\renderer\\app.js', W), 'src\\renderer\\app.js');
  assert.equal(shortPath('C:/Users/cal/nami/src/renderer/app.js', W), 'src\\renderer\\app.js');
  assert.equal(shortPath('src\\app.js', W), 'src\\app.js');
  assert.equal(shortPath('C:\\Users\\cal\\nami\\src\\renderer\\app.js', M), 'C:\\Users\\cal\\nami\\src\\renderer\\app.js', 'POSIX: one odd file name');
});

test('where a tool image lives on disk', () => {
  assert.equal(imageOpenPath('/tmp/out/shot.png', M), '/tmp/out/shot.png');
  assert.equal(imageOpenPath('file:///tmp/out/shot.png', M), '/tmp/out/shot.png');
  assert.equal(imageOpenPath('file:///tmp/my%20out/shot.png', M), '/tmp/my%20out/shot.png', 'the Mac column is as it always was');
  assert.equal(imageOpenPath('https://example.com/a.png', M), '');
  assert.equal(imageOpenPath('data:image/png;base64,AAAA', M), '');
  assert.equal(imageOpenPath('', M), '');
  assert.equal(imageOpenPath('C:\\Users\\cal\\out\\shot.png', W), 'C:\\Users\\cal\\out\\shot.png');
  assert.equal(imageOpenPath('file:///C:/Users/John%20Smith/out/shot.png', W), 'C:\\Users\\John Smith\\out\\shot.png');
  assert.equal(imageOpenPath('file://nas/share/shot.png', W), '\\\\nas\\share\\shot.png');
  assert.equal(imageOpenPath('https://example.com/a.png', W), '');
  assert.equal(imageOpenPath('C:\\Users\\cal\\out\\shot.png', M), '', 'POSIX: not a path, not a file URL');
});
