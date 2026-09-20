// The chat transcript's path rules, without a DOM: which `code` spans are
// files, what a diff header shows, and where a tool's image lives on disk.
// Resolving against the session folder is resolveFrom's job, tested with the
// rest of paths.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { looksLikePath, shortPath, imageOpenPath, imageSrcAllowed, thumbSrc, toolImageHtml, touchable } from '../src/renderer/acp-render.mjs';

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

// An agent's reply is text nobody chose, and the transcript draws a thumbnail
// for any image path in it without a click. On Windows `\\\\evil\\share\\a.png`
// in an <img> is a login to that server (src/main/remote-path.js), so such a
// path stays words: no src, no link, no stat.
const LOCAL = { cwd: 'C:\\proj', home: 'C:\\Users\\u' };
const ON_SHARE = { cwd: '\\\\Mac\\Home\\Documents\\nami', home: 'C:\\Users\\u' };
const EVIL_SRC = ['file://evil/share/a.png', 'FILE://evil/share/a.png', 'file:////evil/share/a.png', 'file:///%5C%5Cevil%5Cshare%5Ca.png', 'file:\\\\evil\\share\\a.png',
  '//evil/share/a.png', ' //evil/share/a.png', '\\\\evil\\share\\a.png', '/\\evil/share/a.png', 'file://%3F/C%3A/a.png', 'file://./pipe/x', 'file://evil@SSL@443/dav/a.png', 'file://10.0.0.5/c$/a.png'];

test('windows: an <img> is never pointed at another computer', () => {
  for (const src of EVIL_SRC) {
    assert.equal(imageSrcAllowed(src, [LOCAL.cwd, LOCAL.home], W), false, src);
    assert.equal(imageSrcAllowed(src, [ON_SHARE.cwd, ON_SHARE.home], W), false, src);
  }
  for (const src of ['file:///C:/proj/out/shot.png', 'file:///C:/Users/John%20Smith/a.png', 'data:image/png;base64,AAAA', 'https://example.com/a.png', 'out/shot.png'])
    assert.equal(imageSrcAllowed(src, [LOCAL.cwd, LOCAL.home], W), true, src);
  // a project on a share draws its own pictures, and nobody else's
  for (const src of ['file://Mac/Home/Documents/nami/out/shot.png', 'file://mac/home/elsewhere/a.png', 'file:////Mac/Home/a.png'])
    assert.equal(imageSrcAllowed(src, [ON_SHARE.cwd, ON_SHARE.home], W), true, src);
  assert.equal(imageSrcAllowed('file://Mac/Other/a.png', [ON_SHARE.cwd], W), false);
  // a Mac has no such paths, and nothing there is refused
  for (const src of [...EVIL_SRC, 'file:///Users/cal/a.png']) assert.equal(imageSrcAllowed(src, [], M), true, src);
});

test('a thumbnail is drawn from the session folder, and not at all for a path on someone else\'s server', () => {
  assert.equal(thumbSrc('out\\shot.png', LOCAL, W), 'file:///C:/proj/out/shot.png');
  assert.equal(thumbSrc('~\\my pics\\a.png', LOCAL, W), 'file:///C:/Users/u/my%20pics/a.png');
  assert.equal(thumbSrc('out\\shot.png', ON_SHARE, W), 'file://Mac/Home/Documents/nami/out/shot.png');
  assert.equal(thumbSrc('\\\\MAC\\home\\x.png', ON_SHARE, W), 'file://MAC/home/x.png');
  for (const t of ['\\\\evil\\share\\a.png', '//evil/share/a.png', '\\\\?\\C:\\a.png', '\\\\.\\pipe\\x.png']) {
    assert.equal(thumbSrc(t, LOCAL, W), '', t);
    assert.equal(thumbSrc(t, ON_SHARE, W), '', t);
    assert.equal(touchable(t, LOCAL, W), false, t);
  }
  // a relative path in a session that is itself somewhere it should not be
  assert.equal(thumbSrc('a.png', { cwd: '\\\\evil\\share', home: 'C:\\Users\\u' }, W), 'file://evil/share/a.png', 'the session folder was chosen by a person');
  assert.equal(touchable('src\\a.md', LOCAL, W), true);
  assert.equal(touchable('\\\\Mac\\Home\\notes.md', ON_SHARE, W), true);
  // the Mac column is what it always was
  assert.equal(thumbSrc('out/shot.png', { cwd: '/Users/cal/nami', home: '/Users/cal' }, M), 'file:///Users/cal/nami/out/shot.png');
  assert.equal(thumbSrc('//evil/share/a.png', { cwd: '/x', home: '/Users/cal' }, M), 'file:////evil/share/a.png');
  assert.equal(touchable('//evil/share/a.png', { cwd: '/x', home: '/Users/cal' }, M), true);
});

test('a tool\'s image is drawn as before, and one on someone else\'s server is shown as the words it came in', () => {
  const img = (uri, o, pf) => toolImageHtml({ type: 'image', uri }, o, pf);
  assert.equal(img('/tmp/out/shot.png', { cwd: '/tmp', home: '/Users/cal' }, M), '<img class="cw-imgout" data-open="/tmp/out/shot.png" src="file:///tmp/out/shot.png" alt="">');
  assert.equal(img('file:///tmp/out/shot.png', { cwd: '/tmp' }, M), '<img class="cw-imgout" data-open="/tmp/out/shot.png" src="file:///tmp/out/shot.png" alt="">');
  assert.equal(toolImageHtml({ type: 'image', mimeType: 'image/jpeg', data: 'QUJD' }, {}, M), '<img class="cw-imgout" src="data:image/jpeg;base64,QUJD" alt="">');
  assert.equal(toolImageHtml({ type: 'image', data: 'QUJD' }, LOCAL, W), '<img class="cw-imgout" src="data:image/png;base64,QUJD" alt="">');
  assert.equal(img('C:\\proj\\out\\shot.png', LOCAL, W), '<img class="cw-imgout" data-open="C:\\proj\\out\\shot.png" src="file:///C:/proj/out/shot.png" alt="">');
  assert.equal(img('file://Mac/Home/Documents/nami/a.png', ON_SHARE, W), '<img class="cw-imgout" data-open="\\\\Mac\\Home\\Documents\\nami\\a.png" src="file://Mac/Home/Documents/nami/a.png" alt="">');
  for (const uri of EVIL_SRC) {
    const html = img(uri, LOCAL, W);
    assert.doesNotMatch(html, /<img|src=|data-open|<code|href/i, uri);
    assert.ok(html.startsWith('<div class="cw-tool-text">') && html.includes('evil') === uri.includes('evil'), html);
  }
  assert.equal(img('file://evil/share/<a>.png', LOCAL, W), '<div class="cw-tool-text">file://evil/share/&lt;a&gt;.png</div>');
});

// wire() needs a DOM, which these tests do not have, so its shape is read: the
// only places that may build a file:// address are the two functions above.
test('nothing in the transcript points an <img> at a path without asking first', () => {
  const src = readFileSync(new URL('../src/renderer/acp-render.mjs', import.meta.url), 'utf8');
  const wire = src.slice(src.indexOf('function wire(root)'), src.indexOf('function closeStreams'));
  assert.doesNotMatch(wire, /toFileUrl\(/);
  assert.match(wire, /thumbSrc\(/);
  assert.match(wire, /touchable\(/);
  assert.doesNotMatch(src.slice(src.indexOf('function toolUpdate')), /toFileUrl\(/);
});
