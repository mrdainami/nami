import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planRemoval, isSafeRemovePath, removeAgent } = require('../src/main/agent-remove.js');

// These are questions about a Mac, and say so: run on a PC they must still be
// answered the Mac way. The Windows column has its own tests further down.
const HOME = '/Users/dev';
const MAC = 'darwin';

test('a CLI with its own uninstaller gets used instead of deleting files', () => {
  const p = planRemoval({ id: 'hermes', binPath: '/Users/dev/.local/bin/hermes', home: HOME, platform: MAC });
  assert.equal(p.mode, 'uninstall');
  assert.equal(p.command, 'hermes uninstall');
});

test('without an uninstaller, the program and the auth file go', () => {
  const p = planRemoval({ id: 'opencode', binPath: '/Users/dev/.opencode/bin/opencode', home: HOME, platform: MAC });
  assert.equal(p.mode, 'delete');
  assert.deepEqual(p.paths, ['/Users/dev/.opencode/bin/opencode', '/Users/dev/.local/share/opencode/auth.json']);
});

test("claude removes the program only — ~/.claude is the user's own work", () => {
  const p = planRemoval({ id: 'claude', binPath: '/Users/dev/.local/bin/claude', home: HOME, platform: MAC });
  assert.equal(p.mode, 'delete');
  assert.deepEqual(p.paths, ['/Users/dev/.local/bin/claude']);
  assert.ok(p.describe.some((d) => /settings|skills|history/i.test(d)), 'must say what survives');
});

test('an agent with no lifecycle cannot be removed', () => {
  assert.equal(planRemoval({ id: 'gemini', binPath: '/usr/local/bin/gemini', home: HOME, platform: MAC }).mode, 'none');
});

test('an agent that was never detected cannot be removed', () => {
  assert.equal(planRemoval({ id: 'opencode', binPath: '', home: HOME, platform: MAC }).mode, 'none');
});

test('paths outside home are refused', () => {
  assert.equal(isSafeRemovePath('/usr/local/bin/opencode', HOME, MAC), false);
  assert.equal(isSafeRemovePath('/etc/passwd', HOME, MAC), false);
  assert.equal(isSafeRemovePath('relative/path', HOME, MAC), false);
});

test('home itself and traversal are refused', () => {
  assert.equal(isSafeRemovePath(HOME, HOME, MAC), false);
  assert.equal(isSafeRemovePath(HOME + '/', HOME, MAC), false);
  assert.equal(isSafeRemovePath(HOME + '/../root/x', HOME, MAC), false);
  assert.equal(isSafeRemovePath('/Users/develop/x', HOME, MAC), false, 'prefix match must not pass');
});

test('a normal path under home is allowed', () => {
  assert.equal(isSafeRemovePath(HOME + '/.local/bin/opencode', HOME, MAC), true);
});

test('a system-installed CLI is refused rather than deleted', () => {
  const p = planRemoval({ id: 'opencode', binPath: '/usr/local/bin/opencode', home: HOME, platform: MAC });
  assert.equal(p.mode, 'none');
  assert.match(p.reason, /outside your home folder/i);
});

test('removeAgent deletes exactly the planned paths', async () => {
  const gone = [];
  const out = await removeAgent({ id: 'claude', binPath: HOME + '/.local/bin/claude', home: HOME, platform: MAC, rm: async (p) => { gone.push(p); } });
  assert.equal(out.ok, true);
  assert.deepEqual(gone, [HOME + '/.local/bin/claude']);
  assert.deepEqual(out.removed, [HOME + '/.local/bin/claude']);
});

test('removeAgent refuses an uninstall-mode agent — that runs in a tile', async () => {
  const out = await removeAgent({ id: 'hermes', binPath: HOME + '/.local/bin/hermes', home: HOME, platform: MAC, rm: async () => { throw new Error('must not delete'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /uninstall/i);
});

test('removeAgent reports a delete that failed instead of claiming success', async () => {
  const out = await removeAgent({ id: 'claude', binPath: HOME + '/.local/bin/claude', home: HOME, platform: MAC, rm: async () => { throw new Error('EACCES'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /EACCES/);
  assert.deepEqual(out.removed, []);
});

// ---- Windows ---------------------------------------------------------------
// Where each vendor's Windows installer really puts its program, read from the
// installers themselves. All of them are inside the profile, which is what lets
// the home-folder rule stay exactly as strict as it is on a Mac.
const WIN = 'win32';
const WHOME = 'C:\\Users\\dev';
const WENV = { USERPROFILE: WHOME, APPDATA: WHOME + '\\AppData\\Roaming', LOCALAPPDATA: WHOME + '\\AppData\\Local' };
const wplan = (id, binPath, over = {}) => planRemoval({ id, binPath, home: WHOME, platform: WIN, env: WENV, ...over });

test('windows: each installer\'s own location is a place a program can be removed from', () => {
  const at = {
    claude: WHOME + '\\.local\\bin\\claude.exe',                 // claude.ai/install.ps1
    grok: WHOME + '\\.grok\\bin\\grok.exe',                      // x.ai/cli/install.ps1
    antigravity: WHOME + '\\AppData\\Local\\agy\\bin\\agy.exe',  // antigravity.google/cli/install.ps1
    kimi: WHOME + '\\.kimi-code\\bin\\kimi.exe',                 // code.kimi.com/kimi-code/install.ps1
  };
  for (const [id, binPath] of Object.entries(at)) {
    const p = wplan(id, binPath);
    assert.equal(p.mode, 'delete', `${id}: ${p.reason || ''}`);
    assert.deepEqual(p.paths, [binPath], id);
  }
  // Older and hand-made installs: the other folders the scan looks in.
  for (const binPath of [WHOME + '\\AppData\\Local\\Antigravity\\agy.exe', WHOME + '\\AppData\\Local\\Programs\\agy\\agy.exe']) {
    assert.deepEqual(wplan('antigravity', binPath).paths, [binPath]);
  }
});

test('windows: hermes is still removed by its own uninstaller, wherever it lives', () => {
  const p = wplan('hermes', WHOME + '\\AppData\\Local\\hermes\\bin\\hermes.exe');
  assert.equal(p.mode, 'uninstall');
  assert.equal(p.command, 'hermes uninstall');
});

// npm writes three files for every command it installs — one each for sh, cmd
// and PowerShell. The scan finds one of them. Deleting only that one leaves the
// other two on PATH, so the agent is still "installed" the next time anyone looks.
test('windows: an npm install goes as the three shims npm wrote, whichever one was found', () => {
  const npm = WHOME + '\\AppData\\Roaming\\npm\\';
  const trio = [npm + 'codex', npm + 'codex.cmd', npm + 'codex.ps1'];
  for (const found of ['codex.cmd', 'codex.ps1', 'codex', 'CODEX.CMD']) {
    const p = wplan('codex', npm + found);
    assert.equal(p.mode, 'delete');
    assert.deepEqual(p.paths.map((x) => x.toLowerCase()), trio.map((x) => x.toLowerCase()), found);
  }
  assert.deepEqual(wplan('opencode', npm + 'opencode.cmd').paths, [
    npm + 'opencode', npm + 'opencode.cmd', npm + 'opencode.ps1',
    WHOME + '\\.local\\share\\opencode\\auth.json',
  ]);
});

test('windows: a .cmd that is not in npm\'s folder is one file, not three', () => {
  const binPath = WHOME + '\\tools\\codex.cmd';
  assert.deepEqual(wplan('codex', binPath).paths, [binPath]);
  // %APPDATA% unset: npm's folder is still found at its usual place.
  const p = wplan('codex', WHOME + '\\AppData\\Roaming\\npm\\codex.cmd', { env: {} });
  assert.equal(p.paths.length, 3);
});

test('windows: the confirm sheet names every file, shortened with ~ the Windows way', () => {
  const p = wplan('claude', 'c:\\users\\DEV\\.local\\bin\\claude.exe');
  assert.deepEqual(p.describe.slice(0, 1), ['~\\.local\\bin\\claude.exe']);
  assert.ok(p.describe.some((d) => d.includes('~\\.claude.json')), p.describe.join(' | '));
  assert.ok(!p.describe.some((d) => d.includes('~/')), 'a POSIX path on a Windows sheet');
});

test('windows: forward slashes from a scan are tidied before anything is compared or shown', () => {
  assert.deepEqual(wplan('grok', 'C:/Users/dev/.grok/bin/grok.exe').paths, [WHOME + '\\.grok\\bin\\grok.exe']);
});

test('windows: outside the profile is refused — Program Files, another drive, another user', () => {
  for (const binPath of ['C:\\Program Files\\nodejs\\codex.cmd', 'D:\\tools\\codex.exe', 'C:\\Users\\devon\\.local\\bin\\codex.exe', '\\\\server\\share\\codex.exe']) {
    const p = wplan('codex', binPath);
    assert.equal(p.mode, 'none', binPath);
    assert.match(p.reason, /outside your home folder/i);
  }
});

test('windows: the home-folder rule is as strict as on a Mac, and blind to case', () => {
  const safe = (p) => isSafeRemovePath(p, WHOME, WIN);
  assert.equal(safe(WHOME + '\\.local\\bin\\claude.exe'), true);
  assert.equal(safe('c:\\USERS\\Dev\\.local\\bin\\claude.exe'), true, 'Windows names do not differ by case');
  assert.equal(safe('C:/Users/dev/.grok/bin/grok.exe'), true);
  assert.equal(safe(WHOME), false);
  assert.equal(safe(WHOME + '\\'), false);
  assert.equal(safe('c:\\users\\DEV'), false, 'home itself, in another case');
  assert.equal(safe(WHOME + '\\..\\Public\\x.exe'), false);
  assert.equal(safe(WHOME + '\\.local\\..\\..\\..\\Windows\\System32\\x.exe'), false);
  assert.equal(safe('C:\\Users\\develop\\x.exe'), false, 'prefix match must not pass');
  assert.equal(safe('D:\\Users\\dev\\x.exe'), false, 'same path, another drive');
  assert.equal(safe('C:Users\\dev\\x.exe'), false, 'drive-relative is not absolute');
  assert.equal(safe('.local\\bin\\claude.exe'), false);
  assert.equal(safe('\\Users\\dev\\x.exe'), false, 'no drive, so it is whichever drive happens to be current');
  assert.equal(safe(''), false);
  assert.equal(isSafeRemovePath(WHOME + '\\x.exe', '', WIN), false, 'no home, no deleting');
});

test('windows: removeAgent deletes exactly the planned paths', async () => {
  const gone = [];
  const npm = WHOME + '\\AppData\\Roaming\\npm\\';
  const out = await removeAgent({ id: 'codex', binPath: npm + 'codex.cmd', home: WHOME, platform: WIN, env: WENV, rm: async (p) => { gone.push(p); } });
  assert.equal(out.ok, true);
  assert.deepEqual(gone, [npm + 'codex', npm + 'codex.cmd', npm + 'codex.ps1']);
});

test('no home folder means nothing is safe, on either platform', () => {
  assert.equal(isSafeRemovePath('/Users/dev/x', '', MAC), false);
  assert.equal(isSafeRemovePath('/x', '/', MAC), false, 'a home of / would make the whole disk fair game');
});
