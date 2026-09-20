// The renderer's idea of home, on both platforms from one machine: the folder a
// chat resolves `~` against, and the `~` a long path is shortened to on a tile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setHome, homeDir, sessionHome, shortHome, folderOfUrl } from '../src/renderer/home-path.mjs';
import { resolveFrom } from '../src/renderer/paths.mjs';

const WIN_HOME = 'C:\\Users\\Cal';

test('sessionHome: the Mac column still reads it off the session folder', () => {
  for (const platform of ['darwin', '']) {
    assert.equal(sessionHome('/Users/cal/proj', '/Users/someone-else', platform), '/Users/cal');
    assert.equal(sessionHome('/home/cal/proj/deep', '', platform), '/home/cal');
    assert.equal(sessionHome('/Volumes/work/proj', '/Users/cal', platform), '');
    assert.equal(sessionHome('', '/Users/cal', platform), '');
  }
});

test('sessionHome: on Windows it is the home main reported, wherever the project lives', () => {
  assert.equal(sessionHome('C:\\Users\\Cal\\proj', WIN_HOME, 'win32'), WIN_HOME);
  assert.equal(sessionHome('D:\\work\\proj', WIN_HOME, 'win32'), WIN_HOME, 'a project on another drive has no home in its path');
  assert.equal(sessionHome('\\\\nas\\share\\proj', WIN_HOME + '\\', 'win32'), WIN_HOME);
  assert.equal(sessionHome('D:\\work', '', 'win32'), '');
  assert.equal(resolveFrom('~\\notes\\a.md', 'D:\\work', sessionHome('D:\\work', WIN_HOME, 'win32'), 'win32'), 'C:\\Users\\Cal\\notes\\a.md');
  assert.equal(resolveFrom('~/notes/a.md', 'D:\\work', sessionHome('D:\\work', WIN_HOME, 'win32'), 'win32'), 'C:\\Users\\Cal/notes/a.md');
});

test('setHome: what app.js hands over at boot is what the defaults use', () => {
  try {
    setHome(WIN_HOME);
    assert.equal(homeDir(), WIN_HOME);
    assert.equal(sessionHome('D:\\work', undefined, 'win32'), WIN_HOME);
    assert.equal(shortHome('C:\\Users\\Cal\\proj', undefined, 'win32'), '~\\proj');
    setHome(null);
    assert.equal(homeDir(), '');
    assert.equal(shortHome('C:\\Users\\Cal\\proj', undefined, 'win32'), 'C:\\Users\\Cal\\proj');
  } finally { setHome(''); }
});

test('shortHome: the Mac column is what it always was', () => {
  for (const platform of ['darwin', '']) {
    assert.equal(shortHome('/Users/cal/proj/a.md', '/Users/cal', platform), '~/proj/a.md');
    assert.equal(shortHome('/Users/other/x', '/Users/cal', platform), '~/x', 'it has always shortened any /Users/<name>');
    assert.equal(shortHome('/Users/cal', '', platform), '~');
    assert.equal(shortHome('/usr/local/bin', '/Users/cal', platform), '/usr/local/bin');
    assert.equal(shortHome('C:\\Users\\Cal\\x', WIN_HOME, platform), 'C:\\Users\\Cal\\x');
    assert.equal(shortHome(null, '/Users/cal', platform), '');
  }
});

test('shortHome: Windows ends home at either separator, in any case, and nowhere else', () => {
  assert.equal(shortHome('C:\\Users\\Cal\\proj\\a.md', WIN_HOME, 'win32'), '~\\proj\\a.md');
  assert.equal(shortHome('c:\\users\\cal\\proj', WIN_HOME, 'win32'), '~\\proj');
  assert.equal(shortHome('C:/Users/Cal/proj', WIN_HOME, 'win32'), '~/proj', 'what follows the ~ is left as written');
  assert.equal(shortHome(WIN_HOME, WIN_HOME, 'win32'), '~');
  assert.equal(shortHome('C:\\Users\\Cal\\x', WIN_HOME + '\\', 'win32'), '~\\x');
  assert.equal(shortHome('C:\\Users\\Calvin\\x', WIN_HOME, 'win32'), 'C:\\Users\\Calvin\\x', 'a longer name is another home');
  assert.equal(shortHome('D:\\work\\proj', WIN_HOME, 'win32'), 'D:\\work\\proj');
  assert.equal(shortHome('/Users/cal/x', WIN_HOME, 'win32'), '/Users/cal/x', 'no Mac home is guessed at on Windows');
  assert.equal(shortHome('C:\\Users\\Cal\\x', '', 'win32'), 'C:\\Users\\Cal\\x');
  assert.equal(shortHome('', WIN_HOME, 'win32'), '');
});

test('folderOfUrl: the Mac column is what URL.pathname always gave', () => {
  for (const platform of ['darwin', '']) {
    const href = 'file:///Users/cal/Documents/my%20work/';
    assert.equal(folderOfUrl(href, platform), decodeURIComponent(new URL(href).pathname).replace(/\/$/, ''));
    assert.equal(folderOfUrl(href, platform), '/Users/cal/Documents/my work');
    assert.equal(folderOfUrl('file:///', platform), '');
  }
});

test('folderOfUrl: on Windows it is a drive path, not /C:/…', () => {
  assert.equal(folderOfUrl('file:///C:/Users/Cal/my%20work/', 'win32'), 'C:\\Users\\Cal\\my work');
  assert.equal(folderOfUrl('file://nas/share/proj/', 'win32'), '\\\\nas\\share\\proj');
  assert.equal(folderOfUrl(new URL('../../../../', 'file:///C:/a/b/nami/src/renderer/index.html').href, 'win32'), 'C:\\a');
});
