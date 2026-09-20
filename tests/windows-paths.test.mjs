// Paths the way Windows writes them, checked from any machine. Each function
// here takes its platform as an argument or treats both separators alike, so
// none of this needs a PC to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chooseTarget } = require('../src/main/open-with.js');
const { resolveBrowserInput } = require('../src/main/browser-file.js');
const { pathFromShellOutput, findOnDisk } = require('../src/main/agents-detect.js');
const { buildMenuTemplate } = require('../src/main/app-menu.js');

test('a file opened from Explorer lands in the window that holds it', () => {
  const windows = [{ id: 1, folder: 'C:\\work' }, { id: 2, folder: 'C:\\work\\site' }, { id: 3, folder: 'C:\\work-old' }];
  assert.deepEqual(chooseTarget({ filePath: 'C:\\work\\site\\notes.md', windows }), { action: 'here', id: 2, folder: 'C:\\work\\site' });
  // C:\work-old is a sibling of C:\work, not a child of it
  assert.deepEqual(chooseTarget({ filePath: 'C:\\work-old\\a.md', windows: [windows[0]] }), { action: 'adopt', id: 1, folder: 'C:\\work-old' });
  assert.deepEqual(chooseTarget({ filePath: 'C:\\notes.md', windows: [] }), { action: 'new-window', id: null, folder: 'C:\\' });
  // and the Mac answers are what they were
  assert.deepEqual(chooseTarget({ filePath: '/proj/a.md', windows: [] }), { action: 'new-window', id: null, folder: '/proj' });
  assert.deepEqual(chooseTarget({ filePath: '/a.md', windows: [] }), { action: 'new-window', id: null, folder: '/' });
});

test('the address bar reads a drive path as a file on Windows only', () => {
  // A file that is not there is the proof it was read as a file at all: a URL
  // would have come back as one instead of throwing.
  assert.throws(() => resolveBrowserInput('C:\\nowhere\\page.html', { platform: 'win32' }), /HTML file not found/);
  assert.throws(() => resolveBrowserInput('"C:\\no where\\page.html"', { platform: 'win32' }), /HTML file not found/);
  assert.throws(() => resolveBrowserInput('"C:\\no where\\page.html', { platform: 'win32' }), /Close the quote/);
  assert.ok(resolveBrowserInput('example.com', { platform: 'win32' }).url.startsWith('https://example.com'));
});

test('a shell answer is recognised with either slash, and as a share', () => {
  assert.equal(pathFromShellOutput('banner\r\nC:\\Users\\cal\\.local\\bin\\claude.exe\r\n', 'win32'), 'C:\\Users\\cal\\.local\\bin\\claude.exe');
  assert.equal(pathFromShellOutput('C:/tools/codex.cmd', 'win32'), 'C:/tools/codex.cmd');
  assert.equal(pathFromShellOutput('\\\\nas\\bin\\kimi.exe', 'win32'), '\\\\nas\\bin\\kimi.exe');
  assert.equal(pathFromShellOutput('not a path', 'win32'), '');
});

test('the disk search joins with backslashes and tries the Windows extensions', async () => {
  const asked = [];
  const found = await findOnDisk('codex', {
    home: 'C:\\Users\\cal', env: { PATH: '', APPDATA: 'C:\\Users\\cal\\AppData\\Roaming' }, platform: 'win32',
    access: async (p) => { asked.push(p); if (!p.endsWith('npm\\codex.cmd')) throw new Error('no'); },
  });
  assert.equal(found, 'C:\\Users\\cal\\AppData\\Roaming\\npm\\codex.cmd');
  assert.ok(asked.every((p) => !p.includes('/')), 'a forward slash crept into a Windows path: ' + asked.find((p) => p.includes('/')));
});

test('the menu says File Explorer where there is no Finder', () => {
  const labels = (platform) => JSON.stringify(buildMenuTemplate({ open() {}, send() {}, newWindow() {}, platform }));
  assert.match(labels('win32'), /Reveal in File Explorer/);
  assert.doesNotMatch(labels('win32'), /Finder/);
  assert.match(labels('darwin'), /Reveal in Finder/);
});
