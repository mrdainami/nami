import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loginShell, whichCommand, claudeCandidates, windowChrome } = require('../src/main/platform.js');

// The point of this module is that platform is a parameter, so the win32 branch
// can be exercised from a Mac. Every test passes it explicitly; none of them
// depend on where they run.

test('detection runs through a login shell, so PATH from .zshrc counts', () => {
  const sh = loginShell('darwin');
  assert.equal(sh.file, '/bin/zsh');
  assert.deepEqual(sh.args('command -v claude'), ['-lc', 'command -v claude']);
});

test('windows runs powershell without a profile', () => {
  const sh = loginShell('win32');
  assert.equal(sh.file, 'powershell.exe');
  assert.deepEqual(sh.args('echo hi'), ['-NoProfile', '-Command', 'echo hi']);
});

test('linux takes the unix branch rather than falling through to windows', () => {
  assert.equal(loginShell('linux').file, '/bin/zsh');
});

test('"is it installed" asks each platform in its own dialect', () => {
  assert.equal(whichCommand('claude', 'darwin'), 'command -v claude');
  assert.match(whichCommand('claude', 'win32'), /Get-Command claude/);
});

test('the windows probe stays silent when the command is missing', () => {
  // a thrown PowerShell error would surface as a failed detection rather than
  // an honest "not installed", which is the whole bug this avoids
  assert.match(whichCommand('nope', 'win32'), /SilentlyContinue/);
});

test('an explicit CLAUDE_CODE_EXECUTABLE outranks every guess', () => {
  const out = claudeCandidates({ home: '/Users/x', env: { CLAUDE_CODE_EXECUTABLE: '/custom/claude' }, platform: 'darwin' });
  assert.equal(out[0], '/custom/claude');
});

test('mac looks in the installer location before the package managers', () => {
  const out = claudeCandidates({ home: '/Users/x', env: {}, platform: 'darwin' });
  assert.deepEqual(out, [
    '/Users/x/.local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/Users/x/.claude/local/claude',
  ]);
});

test('windows candidates use backslashes and .exe/.cmd', () => {
  const out = claudeCandidates({ home: 'C:\\Users\\x', env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, platform: 'win32' });
  assert.equal(out[0], 'C:\\Users\\x\\.local\\bin\\claude.exe');
  assert.ok(out.some((p) => p.endsWith('claude.cmd')), 'the npm -g install must still be findable');
  assert.ok(out.every((p) => !p.includes('/')), 'no forward slashes should leak into a windows path');
});

test('a missing APPDATA drops that candidate instead of producing a bogus path', () => {
  const out = claudeCandidates({ home: 'C:\\Users\\x', env: {}, platform: 'win32' });
  assert.ok(out.every((p) => p && !p.startsWith('\\')), 'undefined APPDATA must not become a root path');
});

test('claudeCandidates survives being called with nothing', () => {
  assert.doesNotThrow(() => claudeCandidates());
});

test('mac keeps the traffic lights inset over our own header', () => {
  assert.deepEqual(windowChrome('darwin'), { titleBarStyle: 'hiddenInset' });
});

test('windows gets an overlay tinted to the paper header, not a system bar', () => {
  const c = windowChrome('win32');
  assert.equal(c.titleBarStyle, 'hidden');
  assert.equal(c.titleBarOverlay.color, '#fffdf6');   // --paper
  assert.equal(c.titleBarOverlay.symbolColor, '#2f2b26'); // --ink
});
