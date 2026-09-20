// Which PowerShell a Windows pane runs, and where a cmd.exe helper is started.
// Platform, environment and the disk are all parameters, so a Mac checks the
// Windows answers without a PC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { paneShell, loginShell, pwshCandidates, planCwd, spawnPlan, isPowerShell, scriptArgs } = require('../src/main/platform.js');
const { findPwsh } = require('../src/main/pwsh-find.js');
const { oneShotArgs } = require('../src/main/run-done.js');
const { shellQuote } = require('../src/main/claude-args.js');

const MSI = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const WPS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const ENV = { Path: 'C:\\Windows\\system32;C:\\Users\\cal\\AppData\\Local\\Microsoft\\WindowsApps\\;"C:\\tools\\my bin"', ProgramFiles: 'C:\\Program Files', ProgramW6432: 'C:\\Program Files' };

test('PowerShell 7 is the pane shell when it was found, Windows PowerShell when it was not', () => {
  assert.equal(paneShell('win32', {}, MSI), MSI);
  assert.equal(paneShell('win32', {}, ''), WPS);
  assert.equal(paneShell('win32', {}), WPS);
  assert.equal(paneShell('win32', { SHELL: '/usr/bin/bash' }, null), WPS);
});

// Windows looks for a bare `powershell.exe` in Nami's own folder and in the
// current folder before it looks in System32, so a project that ships a file
// of that name would be the pane. The full path leaves nothing to look for.
test('Windows PowerShell is named by its full path under the Windows folder', () => {
  assert.equal(paneShell('win32', { SystemRoot: 'D:\\WinNT' }), 'D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(paneShell('win32', { SYSTEMROOT: 'D:\\WinNT\\' }), 'D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(paneShell('win32', { windir: 'E:\\W' }), 'E:\\W\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  // a Windows folder that is not a full drive path is somebody's idea, not Windows'
  for (const bad of ['', 'Windows', '.\\evil', '..', '\\\\evil\\share', '\\Windows', 'C:', 'C:relative']) {
    assert.equal(paneShell('win32', { SystemRoot: bad }), WPS, bad);
    assert.equal(loginShell('win32', { SystemRoot: bad }).file, WPS, bad);
  }
  assert.equal(loginShell('win32', { SystemRoot: 'D:\\WinNT' }).file, 'D:\\WinNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(isPowerShell(WPS), true);
});

test('a Mac pane is the user\'s own shell whatever was found', () => {
  assert.equal(paneShell('darwin', { SHELL: '/bin/bash' }, MSI), '/bin/bash');
  assert.equal(paneShell('darwin', {}, MSI), '/bin/zsh');
});

// Everything downstream keys off isPowerShell, so a full path with a space in
// it has to be recognised and has to build the same command lines.
test('the found path builds the same command lines as the bare name', () => {
  assert.equal(isPowerShell(MSI), true);
  assert.deepEqual(scriptArgs(MSI, 'codex'), scriptArgs('powershell.exe', 'codex'));
  assert.deepEqual(oneShotArgs(MSI, 'npm i -g x'), oneShotArgs('powershell.exe', 'npm i -g x'));
  assert.equal(shellQuote("Cal's", MSI), "'Cal''s'");
});

test('PATH is searched first, then the installer\'s own folder', () => {
  assert.deepEqual(pwshCandidates({ env: ENV, platform: 'win32' }), [
    'C:\\Windows\\system32\\pwsh.exe',
    'C:\\Users\\cal\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
    'C:\\tools\\my bin\\pwsh.exe',
    MSI,
  ]);
});

test('an explicit PATH wins over the environment\'s, and a folder is only tried once', () => {
  const got = pwshCandidates({ env: ENV, pathValue: 'D:\\ps;d:\\PS\\;C:\\Program Files\\PowerShell\\7', platform: 'win32' });
  assert.deepEqual(got, ['D:\\ps\\pwsh.exe', MSI]);
});

test('nothing is looked for off Windows', () => {
  assert.deepEqual(pwshCandidates({ env: { PATH: '/usr/local/bin' }, platform: 'darwin' }), []);
  assert.equal(findPwsh({ env: { PATH: '/usr/local/bin' }, platform: 'darwin', exists: () => true }), '');
});

test('the first candidate that is really there is the answer', () => {
  const asked = [];
  const exists = (p) => { asked.push(p); return p === MSI; };
  assert.equal(findPwsh({ env: ENV, platform: 'win32', exists }), MSI);
  assert.equal(asked.length, 4);
  assert.equal(findPwsh({ env: ENV, platform: 'win32', exists: () => false }), '');
  assert.equal(findPwsh({ env: {}, platform: 'win32', exists: () => true }), '');
});

// cmd.exe refuses a network folder: it complains on stderr and runs the tool
// from C:\Windows instead. Measured on Windows 11 with \\Mac\Home\Documents.
const UNC = '\\\\Mac\\Home\\Documents\\work';
const viaCmd = spawnPlan('npx', ['-y', 'x'], 'win32', {});
const direct = spawnPlan('C:\\tools\\kimi.exe', ['acp'], 'win32', {});

test('a cmd.exe helper is never started in a network folder', () => {
  assert.equal(planCwd(viaCmd, UNC, { home: 'C:\\Users\\cal', platform: 'win32' }), 'C:\\Users\\cal');
  assert.equal(planCwd(viaCmd, '//Mac/Home/work', { home: 'C:\\Users\\cal', platform: 'win32' }), 'C:\\Users\\cal');
});

test('a redirected home folder on a share is not a safe place either', () => {
  assert.equal(planCwd(viaCmd, UNC, { home: '\\\\corp\\profiles\\cal', env: { SystemRoot: 'C:\\WINDOWS' }, platform: 'win32' }), 'C:\\WINDOWS');
  assert.equal(planCwd(viaCmd, UNC, { home: '', env: {}, platform: 'win32' }), 'C:\\Windows');
});

test('everything else starts where it was asked to', () => {
  assert.equal(planCwd(viaCmd, 'C:\\work', { home: 'C:\\Users\\cal', platform: 'win32' }), 'C:\\work');
  // a real .exe starts in a share without complaint
  assert.equal(planCwd(direct, UNC, { home: 'C:\\Users\\cal', platform: 'win32' }), UNC);
  // and a Mac has no cmd.exe to protect
  const mac = spawnPlan('npx', ['-y', 'x'], 'darwin', {});
  assert.equal(planCwd(mac, '//odd/but/legal', { home: '/Users/cal', platform: 'darwin' }), '//odd/but/legal');
  assert.equal(planCwd(viaCmd, undefined, { home: 'C:\\Users\\cal', platform: 'win32' }), undefined);
});
