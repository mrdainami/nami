// The renderer's path module, both columns from one machine. Every call names
// the platform it is asking about; the ones that name none are checking the
// default, which under plain node is the POSIX column on any OS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/renderer/paths.mjs';

const W = 'win32', M = 'darwin';

test('with no app around it the module answers as POSIX, on any machine', () => {
  assert.equal(P.currentPlatform(), '');
  assert.equal(P.isWin(), false);
  assert.equal(P.baseName('C:\\proj\\a.js'), 'C:\\proj\\a.js', 'a backslash is a filename character here');
  assert.equal(P.baseName('/proj/a.js'), 'a.js');
});

test('the platform comes from the preload, then from the body attribute', () => {
  const g = globalThis;
  try {
    g.document = { body: { dataset: { platform: 'win32' } } };
    assert.equal(P.currentPlatform(), 'win32');
    assert.equal(P.baseName('C:\\proj\\a.js'), 'a.js');
    g.dainami = { platform: 'darwin' };
    assert.equal(P.currentPlatform(), 'darwin', 'the preload wins: it is there before boot sets the attribute');
  } finally { delete g.document; delete g.dainami; }
});

test('baseName', () => {
  assert.equal(P.baseName('/Users/me/proj/app.js', M), 'app.js');
  assert.equal(P.baseName('app.js', M), 'app.js');
  assert.equal(P.baseName('/proj/we\\ird.txt', M), 'we\\ird.txt', 'POSIX: backslash is part of the name');
  assert.equal(P.baseName('C:\\Users\\me\\proj\\app.js', W), 'app.js');
  assert.equal(P.baseName('C:/Users/me/proj/app.js', W), 'app.js');
  assert.equal(P.baseName('C:\\Users\\me/proj\\app.js', W), 'app.js', 'mixed separators');
  assert.equal(P.baseName('\\\\server\\share\\file.txt', W), 'file.txt');
  assert.equal(P.baseName('app.js', W), 'app.js');
  assert.equal(P.baseName(null, W), '');
});

test('dirName', () => {
  assert.equal(P.dirName('/a/b/c.txt', M), '/a/b');
  assert.equal(P.dirName('/a', M), '/');
  assert.equal(P.dirName('/', M), '/');
  assert.equal(P.dirName('name', M), '');
  assert.equal(P.dirName('a/b', M), 'a');
  assert.equal(P.dirName('/a//b', M), '/a', 'a doubled separator leaves no trailing one');
  assert.equal(P.dirName('C:\\a\\b\\c.txt', W), 'C:\\a\\b');
  assert.equal(P.dirName('C:/a/b/c.txt', W), 'C:/a/b', 'sliced, not rebuilt');
  assert.equal(P.dirName('C:\\a', W), 'C:\\');
  assert.equal(P.dirName('C:\\', W), 'C:\\');
  assert.equal(P.dirName('\\\\server\\share\\x.txt', W), '\\\\server\\share\\');
  assert.equal(P.dirName('\\\\server\\share\\d\\x.txt', W), '\\\\server\\share\\d');
  assert.equal(P.dirName('src\\app.js', W), 'src');
  assert.equal(P.dirName('name', W), '');
});

test('isAbsolute and isHomeRelative', () => {
  assert.equal(P.isAbsolute('/etc/hosts', M), true);
  assert.equal(P.isAbsolute('etc/hosts', M), false);
  assert.equal(P.isAbsolute('C:\\x', M), false, 'POSIX: a drive letter is just a name');
  assert.equal(P.isAbsolute('C:\\x', W), true);
  assert.equal(P.isAbsolute('c:/x', W), true);
  assert.equal(P.isAbsolute('\\\\server\\share\\x', W), true);
  assert.equal(P.isAbsolute('\\x', W), true, 'rooted on the current drive, as node reads it');
  assert.equal(P.isAbsolute('C:x', W), false, 'drive-relative is not absolute');
  assert.equal(P.isAbsolute('src\\x', W), false);
  assert.equal(P.isAbsolute('.\\x', W), false);
  assert.equal(P.isAbsolute('', W), false);
  assert.equal(P.isHomeRelative('~/x', M), true);
  assert.equal(P.isHomeRelative('~', M), true);
  assert.equal(P.isHomeRelative('~\\x', M), false);
  assert.equal(P.isHomeRelative('~\\x', W), true);
  assert.equal(P.isHomeRelative('~/x', W), true);
  assert.equal(P.isHomeRelative('~user/x', W), false);
});

test('rootOf', () => {
  assert.equal(P.rootOf('/a/b', M), '/');
  assert.equal(P.rootOf('a/b', M), '');
  assert.equal(P.rootOf('C:\\a', M), '');
  assert.equal(P.rootOf('C:\\a\\b', W), 'C:\\');
  assert.equal(P.rootOf('C:/a', W), 'C:/');
  assert.equal(P.rootOf('C:a', W), 'C:');
  assert.equal(P.rootOf('\\\\server\\share\\x', W), '\\\\server\\share\\');
  assert.equal(P.rootOf('\\\\server\\share', W), '\\\\server\\share');
  assert.equal(P.rootOf('\\x', W), '\\');
  assert.equal(P.rootOf('src\\x', W), '');
});

test('splitSegments leaves the root out', () => {
  assert.deepEqual(P.splitSegments('/a//b/c.txt', M), ['a', 'b', 'c.txt']);
  assert.deepEqual(P.splitSegments('a\\b/c', M), ['a\\b', 'c']);
  assert.deepEqual(P.splitSegments('C:\\a\\b/c.txt', W), ['a', 'b', 'c.txt']);
  assert.deepEqual(P.splitSegments('\\\\server\\share\\d\\x', W), ['d', 'x']);
  assert.deepEqual(P.splitSegments('C:\\', W), []);
});

test('join, stripDotSlash, climbs', () => {
  assert.equal(P.join('/a/b', 'c/d.png', M), '/a/b/c/d.png');
  assert.equal(P.join('/a/b/', 'c', M), '/a/b/c');
  assert.equal(P.join('/', 'c', M), '/c');
  assert.equal(P.join('', 'c/d', M), 'c/d', 'no base, no change');
  assert.equal(P.join('C:\\a\\b', 'c\\d.png', W), 'C:\\a\\b\\c\\d.png');
  assert.equal(P.join('C:\\a\\b', 'c/d.png', W), 'C:\\a\\b\\c\\d.png', 'what we build is written the way main writes it');
  assert.equal(P.join('C:\\', 'x', W), 'C:\\x');
  assert.equal(P.join('C:\\a\\', 'x', W), 'C:\\a\\x');
  assert.equal(P.join('\\\\server\\share', 'x', W), '\\\\server\\share\\x');
  assert.equal(P.stripDotSlash('./a/b', M), 'a/b');
  assert.equal(P.stripDotSlash('.\\a', M), '.\\a');
  assert.equal(P.stripDotSlash('.\\a\\b', W), 'a\\b');
  assert.equal(P.stripDotSlash('../a', W), '../a');
  assert.equal(P.climbs('a/../b', M), true);
  assert.equal(P.climbs('a\\..\\b', M), false);
  assert.equal(P.climbs('a\\..\\b', W), true);
  assert.equal(P.climbs('..\\b', W), true);
  assert.equal(P.climbs('a..b\\c', W), false);
});

test('normalize', () => {
  assert.equal(P.normalize('/p/docs/../a.md', M), '/p/a.md');
  assert.equal(P.normalize('/../../a', M), '/a', 'an absolute path cannot climb above its root');
  assert.equal(P.normalize('../a/./b', M), '../a/b');
  assert.equal(P.normalize('C:\\p\\docs\\..\\a.md', W), 'C:\\p\\a.md');
  assert.equal(P.normalize('C:/p/docs/../a.md', W), 'C:\\p\\a.md');
  assert.equal(P.normalize('C:\\..\\..\\a', W), 'C:\\a');
  assert.equal(P.normalize('C:\\', W), 'C:\\');
  assert.equal(P.normalize('\\\\server\\share\\d\\..\\x', W), '\\\\server\\share\\x');
  assert.equal(P.normalize('\\\\server\\share\\', W), '\\\\server\\share');
  assert.equal(P.normalize('..\\a\\.\\b', W), '..\\a\\b');
});

test('resolveFrom: home, absolute, or under the session folder', () => {
  assert.equal(P.resolveFrom('~/x.png', '/proj', '/Users/me', M), '/Users/me/x.png');
  assert.equal(P.resolveFrom('/abs/x.png', '/proj', '/Users/me', M), '/abs/x.png');
  assert.equal(P.resolveFrom('./out/x.png', '/proj', '/Users/me', M), '/proj/out/x.png');
  assert.equal(P.resolveFrom('out/x.png', '', '', M), 'out/x.png');
  assert.equal(P.resolveFrom('~\\x.png', 'C:\\proj', 'C:\\Users\\me', W), 'C:\\Users\\me\\x.png');
  assert.equal(P.resolveFrom('C:\\abs\\x.png', 'C:\\proj', 'C:\\Users\\me', W), 'C:\\abs\\x.png');
  assert.equal(P.resolveFrom('.\\out\\x.png', 'C:\\proj', '', W), 'C:\\proj\\out\\x.png');
  assert.equal(P.resolveFrom('out/x.png', 'C:\\proj', '', W), 'C:\\proj\\out\\x.png');
});

test('isInside: the boundary is the separator, and Windows ignores case', () => {
  assert.equal(P.isInside('/proj', '/proj/a/b', M), true);
  assert.equal(P.isInside('/proj', '/proj', M), true);
  assert.equal(P.isInside('/proj/', '/proj/a', M), true);
  assert.equal(P.isInside('/proj', '/proj-evil/x', M), false);
  assert.equal(P.isInside('/proj', '/proj\\evil', M), false, 'POSIX: backslash is not a separator');
  assert.equal(P.isInside('/Proj', '/proj/a', M), false, 'POSIX: case is kept as it always was');
  assert.equal(P.isInside('/', '/etc', M), true);
  assert.equal(P.isInside('', '/etc', M), false);
  assert.equal(P.isInside('C:\\proj', 'C:\\proj\\a\\b', W), true);
  assert.equal(P.isInside('C:\\proj', 'C:\\proj', W), true);
  assert.equal(P.isInside('C:\\proj\\', 'C:\\proj\\a', W), true);
  assert.equal(P.isInside('C:\\proj', 'C:\\proj-evil\\x', W), false);
  assert.equal(P.isInside('C:\\Proj', 'c:\\proj\\A.txt', W), true, 'same folder, different spelling');
  assert.equal(P.isInside('C:/proj', 'C:\\proj\\a', W), true, 'either separator');
  assert.equal(P.isInside('C:\\', 'C:\\x', W), true);
  assert.equal(P.isInside('C:\\', 'D:\\x', W), false);
  assert.equal(P.isInside('\\\\server\\share', '\\\\server\\share\\x', W), true);
  assert.equal(P.isInside('\\\\server\\share', '\\\\server\\share2\\x', W), false);
});

test('relativeTo', () => {
  assert.equal(P.relativeTo('/proj', '/proj/src/a.js', M), 'src/a.js');
  assert.equal(P.relativeTo('/proj/', '/proj/src/a.js', M), 'src/a.js');
  assert.equal(P.relativeTo('/proj', '/proj', M), '');
  assert.equal(P.relativeTo('/proj', '/other/a.js', M), null);
  assert.equal(P.relativeTo('/', '/etc/hosts', M), 'etc/hosts');
  assert.equal(P.relativeTo('C:\\proj', 'C:\\proj\\src\\a.js', W), 'src\\a.js');
  assert.equal(P.relativeTo('c:\\PROJ\\', 'C:\\proj\\src\\a.js', W), 'src\\a.js');
  assert.equal(P.relativeTo('C:\\proj', 'C:\\proj', W), '');
  assert.equal(P.relativeTo('C:\\proj', 'C:\\proj-other\\a.js', W), null);
  assert.equal(P.relativeTo('C:\\', 'C:\\a.js', W), 'a.js');
});

test('toFileUrl', () => {
  assert.equal(P.toFileUrl('/Users/me/My Site/a.png', M), 'file:///Users/me/My%20Site/a.png');
  assert.equal(P.toFileUrl('/p/a#b?.png', M), 'file:///p/a%23b%3F.png');
  assert.equal(P.toFileUrl('C:\\Users\\me\\My Site\\a.png', W), 'file:///C:/Users/me/My%20Site/a.png');
  assert.equal(P.toFileUrl('C:/Users/me/a.png', W), 'file:///C:/Users/me/a.png');
  assert.equal(P.toFileUrl('C:\\p\\a#b.png', W), 'file:///C:/p/a%23b.png');
  assert.equal(P.toFileUrl('C:\\', W), 'file:///C:/');
  assert.equal(P.toFileUrl('\\\\server\\share\\x', W), 'file://server/share/x');
  assert.equal(P.toFileUrl('\\\\server\\share\\my docs\\x.pdf', W), 'file://server/share/my%20docs/x.pdf');
  // what Chromium makes of them is what node makes of them
  assert.equal(new URL(P.toFileUrl('C:\\Users\\me\\My Site\\a.png', W)).pathname, '/C:/Users/me/My%20Site/a.png');
  assert.equal(new URL(P.toFileUrl('\\\\server\\share\\x', W)).host, 'server');
});

test('toDirUrl ends in exactly one slash', () => {
  assert.equal(P.toDirUrl('/a/b', M), 'file:///a/b/');
  assert.equal(P.toDirUrl('/', M), 'file:///');
  assert.equal(P.toDirUrl('C:\\a b', W), 'file:///C:/a%20b/');
  assert.equal(P.toDirUrl('C:\\', W), 'file:///C:/');
});

test('fromFileUrl', () => {
  assert.equal(P.fromFileUrl('file:///Users/me/a.png', M), '/Users/me/a.png');
  assert.equal(P.fromFileUrl('file://localhost/Users/me/a.png', M), '/Users/me/a.png');
  assert.equal(P.fromFileUrl('file:///C:/Users/me/a.png', W), 'C:\\Users\\me\\a.png');
  assert.equal(P.fromFileUrl('file://server/share/x.png', W), '\\\\server\\share\\x.png');
  assert.equal(P.fromFileUrl('/not/a/url', M), '/not/a/url');
});

test('a slash command is one word; a pasted path is not one', () => {
  assert.equal(P.isSlashCommandDraft('/'), true);
  assert.equal(P.isSlashCommandDraft('/mod'), true);
  assert.equal(P.isSlashCommandDraft('/plugin:review-pr'), true);
  assert.equal(P.isSlashCommandDraft('/model opus'), false);
  assert.equal(P.isSlashCommandDraft('/Users/me/a.png'), false);
  assert.equal(P.isSlashCommandDraft('C:\\Users\\me\\a.png'), false);
  assert.equal(P.isSlashCommandDraft('\\\\server\\share\\a.png'), false);
  assert.equal(P.isSlashCommandDraft('/c\\Users'), false);
  assert.equal(P.isSlashCommandDraft('hello'), false);
  assert.equal(P.isSlashCommandDraft(''), false);
});
