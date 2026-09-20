// The Windows column of everything that builds a command line. None of this
// needs Windows to run: platform and shell are always parameters, so a Mac can
// check what a PC would be told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loginShell, pathDelimiter, isPowerShell, paneShell, scriptArgs } = require('../src/main/platform.js');
const { mergePath, pathFromOutput } = require('../src/main/user-path.js');
const { shellQuote } = require('../src/main/claude-args.js');
const { doneSuffix, oneShotArgs, feedRunDone } = require('../src/main/run-done.js');
const { rememberBins, forgetBins, resolveRunCommand } = require('../src/main/bin-cache.js');

const PS = 'powershell.exe';

test('PowerShell is recognised under every name it goes by', () => {
  for (const s of ['powershell.exe', 'powershell', 'pwsh', 'pwsh.exe', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:/Windows/System32/WindowsPowerShell/v1.0/PowerShell.EXE']) {
    assert.equal(isPowerShell(s), true, s);
  }
  for (const s of ['/bin/zsh', '/bin/bash', 'cmd.exe', '', null, '/opt/powershell-notes/zsh']) assert.equal(isPowerShell(s), false, String(s));
});

test('a Windows pane runs PowerShell whatever SHELL says', () => {
  assert.equal(paneShell('win32', {}), PS);
  // Git Bash exports this, and it is not a path Windows can spawn.
  assert.equal(paneShell('win32', { SHELL: '/usr/bin/bash' }), PS);
  assert.equal(paneShell('darwin', { SHELL: '/bin/bash' }), '/bin/bash');
  assert.equal(paneShell('darwin', {}), '/bin/zsh');
});

test('a script line is handed to each shell in its own way', () => {
  assert.deepEqual(scriptArgs('/bin/zsh', 'claude'), ['-i', '-c', 'claude']);
  assert.deepEqual(scriptArgs(PS, 'claude'), ['-NoLogo', '-Command', 'claude']);
});

test('the Windows PATH is asked of the registry, where an installer writes it', () => {
  const sh = loginShell('win32', {});
  assert.match(sh.pathCmd, /GetEnvironmentVariable\('Path','Machine'\)/);
  assert.match(sh.pathCmd, /GetEnvironmentVariable\('Path','User'\)/);
  assert.equal(loginShell('darwin', { SHELL: '/bin/zsh' }).pathCmd, 'printf %s "$PATH"');
});

test('a Windows PATH splits on semicolons and folds case', () => {
  assert.equal(pathDelimiter('win32'), ';');
  assert.equal(pathDelimiter('darwin'), ':');
  assert.equal(
    mergePath('C:\\Windows;C:\\Users\\cal\\AppData\\Roaming\\npm', 'c:\\windows\\;D:\\tools', 'win32'),
    'C:\\Windows;C:\\Users\\cal\\AppData\\Roaming\\npm;D:\\tools',
  );
  // a colon inside C:\ must never be read as a separator
  assert.equal(mergePath('C:\\a', 'C:\\b', 'win32'), 'C:\\a;C:\\b');
  // and a Mac stays case-sensitive
  assert.equal(mergePath('/a:/A', '/a', 'darwin'), '/a:/A');
});

test('the PATH line is found under a PowerShell banner', () => {
  assert.equal(pathFromOutput('Loading profile…\r\nC:\\Windows;C:\\x\r\n', 'win32'), 'C:\\Windows;C:\\x');
  assert.equal(pathFromOutput('no path here\r\n', 'win32'), '');
  assert.equal(pathFromOutput('C:\\Windows;C:\\x', 'darwin'), '');
});

test('PowerShell quoting doubles a single quote rather than escaping it', () => {
  assert.equal(shellQuote("Cal's export button", PS), "'Cal''s export button'");
  assert.equal(shellQuote('$env:SECRET `whoami` $(calc)', PS), "'$env:SECRET `whoami` $(calc)'");
  assert.equal(shellQuote('', PS), "''");
  assert.equal(shellQuote('--resume', PS), '--resume');
  // the POSIX answer is unchanged
  assert.equal(shellQuote("Cal's", '/bin/zsh'), "'Cal'\\''s'");
  assert.equal(shellQuote("Cal's"), "'Cal'\\''s'");
});

test('a scanned program with a space in its path is called, not printed', () => {
  forgetBins();
  rememberBins([
    { id: 'codex', found: true, path: 'C:\\Users\\Cal Hia\\AppData\\Roaming\\npm\\codex.cmd' },
    { id: 'kimi', found: true, path: 'C:\\tools\\kimi.exe' },
  ]);
  assert.equal(resolveRunCommand('codex resume abc', PS), "& 'C:\\Users\\Cal Hia\\AppData\\Roaming\\npm\\codex.cmd' resume abc");
  assert.equal(resolveRunCommand('kimi', PS), 'C:\\tools\\kimi.exe');
  assert.equal(resolveRunCommand('unknown --x', PS), 'unknown --x');
  forgetBins();
});

test('a PowerShell one-shot reports its exit code and stays open', () => {
  const args = oneShotArgs(PS, 'npm i -g x');
  assert.deepEqual(args.slice(0, 3), ['-NoLogo', '-NoExit', '-Command']);
  assert.ok(args[3].startsWith('npm i -g x; $namiOk = $?;'), args[3]);
  assert.match(args[3], /\$LASTEXITCODE/);
  assert.match(args[3], /NamiRunDone=/);
  assert.doesNotMatch(args[3], /printf|exec /);
  // and what it writes is what the parser reads
  assert.equal(feedRunDone({ buf: '' }, `done\r\n\x1b]1337;NamiRunDone=3\x07PS C:\\> `), 3);
});

test('the POSIX one-shot is untouched', () => {
  assert.deepEqual(oneShotArgs('/bin/zsh', 'ls'), ['-i', '-c', `${doneSuffix('ls')}; exec /bin/zsh -i`]);
});

test('the Windows caption buttons take the theme and stay readable on it', () => {
  const { windowChrome } = require('../src/main/platform.js');
  const paper = windowChrome('win32', '#cfc3ac').titleBarOverlay;
  const operator = windowChrome('win32', '#121212').titleBarOverlay;
  assert.equal(paper.color, '#cfc3ac');
  assert.equal(paper.symbolColor, '#2f2b26');
  assert.equal(operator.color, '#121212');
  assert.equal(operator.symbolColor, '#f2efe8');
  // nonsense in, the paper default out — never an invalid colour to Electron
  assert.equal(windowChrome('win32', 'red').titleBarOverlay.color, '#fffdf6');
  // and a Mac has no overlay at all
  assert.equal(windowChrome('darwin', '#121212').titleBarOverlay, undefined);
});

test('a tool is looked up by the form of it a stock Windows will run', () => {
  const { whichCommand } = require('../src/main/platform.js');
  const { KNOWN_AGENTS, installCommand } = require('../src/main/agents-detect.js');
  // Measured on a clean Windows 11: `Get-Command npm` answers npm.ps1, which
  // ExecutionPolicy Restricted refuses; -CommandType Application answers npm.cmd.
  const cmd = whichCommand('codex', 'win32');
  assert.match(cmd, /-CommandType Application/);
  assert.match(cmd, /Select-Object -First 1/);   // two dirs on PATH must not come back as two lines
  assert.equal(whichCommand('codex', 'darwin'), 'command -v codex');
  // and nothing Nami types on Windows starts with a bare `npm`, for the same reason
  for (const a of KNOWN_AGENTS) assert.doesNotMatch(installCommand(a, 'win32'), /^npm\s/, a.id);
});
