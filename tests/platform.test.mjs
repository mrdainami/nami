import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loginShell, whichCommand, claudeCandidates, windowChrome, binSearchDirs } = require('../src/main/platform.js');

// The point of this module is that platform is a parameter, so the win32 branch
// can be exercised from a Mac. Every test passes it explicitly; none of them
// depend on where they run.

// zsh reads .zshrc only for *interactive* shells. `-lc` is login but not
// interactive, so every PATH line in .zshrc — which is where installers write,
// opencode and bun included — was invisible. It only ever worked when the app
// was started from a terminal and inherited that PATH; launched from the Dock
// there is nothing to inherit and the agent reads as "not installed".
test('detection runs an interactive login shell, so PATH from .zshrc counts', () => {
  const sh = loginShell('darwin', {});
  assert.equal(sh.file, '/bin/zsh');
  // separate flags, not a combined -lic: zsh and bash accept the bundle but
  // fish parses each flag on its own, and a fish user is a real user
  assert.deepEqual(sh.args('command -v claude'), ['-l', '-i', '-c', 'command -v claude']);
});

test('a bash or fish user is asked in their own shell, not zsh', () => {
  assert.equal(loginShell('darwin', { SHELL: '/bin/bash' }).file, '/bin/bash');
  assert.equal(loginShell('darwin', { SHELL: '/opt/homebrew/bin/fish' }).file, '/opt/homebrew/bin/fish');
});

test('an unusable $SHELL falls back to zsh rather than failing every probe', () => {
  // launchd does not always set SHELL for a GUI app, and /usr/bin/false is a
  // real login shell for locked accounts — neither may take the app down
  assert.equal(loginShell('darwin', {}).file, '/bin/zsh');
  assert.equal(loginShell('darwin', { SHELL: '/usr/bin/false' }).file, '/bin/zsh');
  assert.equal(loginShell('darwin', { SHELL: 'relative/zsh' }).file, '/bin/zsh');
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

// The shell probe is the primary answer, but a .zshrc that prints a banner,
// errors without a tty, or is simply absent must not turn into "no agents
// installed". These are the places the six CLIs actually put themselves.
test('the fallback knows where each installer drops its binary', () => {
  const dirs = binSearchDirs({ home: '/Users/x', env: {}, platform: 'darwin' });
  for (const d of ['/Users/x/.local/bin', '/opt/homebrew/bin', '/usr/local/bin',
                   '/Users/x/.opencode/bin', '/Users/x/.bun/bin']) {
    assert.ok(dirs.includes(d), `${d} must be searched`);
  }
});

test('the fallback searches the running PATH first, then the known locations', () => {
  const dirs = binSearchDirs({ home: '/Users/x', env: { PATH: '/first:/second' }, platform: 'darwin' });
  assert.equal(dirs[0], '/first');
  assert.equal(dirs[1], '/second');
  assert.ok(dirs.includes('/opt/homebrew/bin'));
});

test('the fallback never returns the same directory twice', () => {
  const dirs = binSearchDirs({ home: '/Users/x', env: { PATH: '/opt/homebrew/bin' }, platform: 'darwin' });
  assert.equal(dirs.filter((d) => d === '/opt/homebrew/bin').length, 1);
});

test('windows splits PATH on semicolons, not colons', () => {
  const dirs = binSearchDirs({ home: 'C:\\Users\\x', env: { PATH: 'C:\\a;C:\\b' }, platform: 'win32' });
  assert.ok(dirs.includes('C:\\a') && dirs.includes('C:\\b'),
    'a colon split would turn C:\\a into "C" and "\\a"');
});

test('binSearchDirs survives being called with nothing', () => {
  assert.doesNotThrow(() => binSearchDirs());
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
