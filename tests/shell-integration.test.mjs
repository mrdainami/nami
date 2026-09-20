// A Windows pane telling Nami where it is. Platform and shell are parameters,
// so a Mac checks what a PC would be started with; what real PowerShell does
// with it was measured in the VM through node-pty and is pinned here as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CWD_HOOK, reportingArgs, feedCwd, cleanCwd } = require('../src/main/shell-integration.js');
const { oneShotArgs, doneSuffix, feedRunDone } = require('../src/main/run-done.js');
const { scriptArgs } = require('../src/main/platform.js');

const PS = 'powershell.exe';
const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const SEQ = (p) => `\x1b]9;9;${p}\x1b\\`;

test('a plain Windows pane is started with the hook, and stays open after it', () => {
  for (const shell of [PS, PWSH]) {
    assert.deepEqual(reportingArgs(shell, [], 'win32'), ['-NoExit', '-Command', CWD_HOOK], shell);
  }
});

// A pane is the user's own shell. Their prompt, aliases and PATH additions live
// in the profile, and the hook has to run after it to find their prompt at all.
test('the profile is still read', () => {
  for (const args of [reportingArgs(PS, [], 'win32'), reportingArgs(PS, oneShotArgs(PS, 'npm i -g x'), 'win32')]) {
    assert.equal(args.some((a) => /^-NoProfile$/i.test(a)), false);
  }
});

test('a one-shot carries the hook in front of its command, so $? still belongs to the command', () => {
  const args = reportingArgs(PS, oneShotArgs(PS, 'npm i -g x'), 'win32');
  assert.deepEqual(args.slice(0, 3), ['-NoLogo', '-NoExit', '-Command']);
  assert.equal(args.length, 4);
  assert.equal(args[3], `${CWD_HOOK}; ${doneSuffix('npm i -g x', PS)}`);
  assert.ok(args[3].indexOf('npm i -g x; $namiOk = $?') > args[3].indexOf(CWD_HOOK));
});

// No prompt is ever shown, so there is nothing to hook and nowhere to move to:
// the folder the tile started in is the answer for its whole life.
test('an agent tile is left exactly as it was', () => {
  const args = scriptArgs(PS, 'codex');
  assert.equal(reportingArgs(PS, args, 'win32'), args);
  assert.deepEqual(args, ['-NoLogo', '-Command', 'codex']);
});

test('the Mac is never touched, even when its shell is PowerShell', () => {
  for (const shell of ['/bin/zsh', '/usr/local/bin/pwsh']) {
    for (const args of [[], ['-i', '-c', 'codex'], ['-NoLogo', '-NoExit', '-Command', 'x']]) {
      assert.equal(reportingArgs(shell, args, 'darwin'), args);
    }
  }
  const args = [];
  assert.equal(reportingArgs('cmd.exe', args, 'win32'), args);
});

// It is one command-line argument, passed through node-pty's quoting and then
// PowerShell's. A double quote or a newline is one more thing for both to get
// right; there are none.
test('the hook is one line with no double quotes', () => {
  assert.equal(/["\r\n]/.test(CWD_HOOK), false);
});

test('the hook wraps the prompt that was there rather than replacing it', () => {
  assert.match(CWD_HOOK, /^\$global:__namiPrompt = \$function:prompt; function global:prompt \{/);
  assert.match(CWD_HOOK, /\$namiOut = & \$global:__namiPrompt/);
  // $? is read first and put back before the inner prompt runs: oh-my-posh and
  // starship colour themselves by it.
  assert.ok(CWD_HOOK.indexOf('$namiOk = $global:?') < CWD_HOOK.indexOf('[Console]::Write'));
  assert.ok(CWD_HOOK.indexOf("Write-Error 'nami' -ErrorAction Ignore") < CWD_HOOK.indexOf('& $global:__namiPrompt'));
  // Only a real folder is reported. HKLM:\ and Env:\ are places too.
  assert.match(CWD_HOOK, /Provider\.Name -eq 'FileSystem'/);
  assert.match(CWD_HOOK, /\]9;9;' \+ \$namiLoc\.ProviderPath/);
});

test('a reported folder is read out of the stream', () => {
  assert.equal(feedCwd({}, 'PS C:\\> cd work\r\n' + SEQ('C:\\work') + 'PS C:\\work> '), 'C:\\work');
  assert.equal(feedCwd({}, SEQ('C:\\Users\\Cal Hia\\My Work')), 'C:\\Users\\Cal Hia\\My Work');
  assert.equal(feedCwd({}, SEQ('\\\\Mac\\Home\\Documents')), '\\\\Mac\\Home\\Documents');
  assert.equal(feedCwd({}, SEQ('/Users/cal/work')), '/Users/cal/work');
});

test('BEL ends it as well as ST, and the quoted form is accepted', () => {
  assert.equal(feedCwd({}, '\x1b]9;9;C:\\work\x07'), 'C:\\work');
  assert.equal(feedCwd({}, '\x1b]9;9;"C:\\my work"\x1b\\'), 'C:\\my work');
});

test('the last report in a chunk wins', () => {
  assert.equal(feedCwd({}, SEQ('C:\\a') + 'PS C:\\a> cd ..\\b\r\n' + SEQ('C:\\b')), 'C:\\b');
});

test('ordinary output says nothing', () => {
  const st = {};
  assert.equal(feedCwd(st, 'downloading  ████  100%\r\n'), null);
  assert.equal(feedCwd(st, '\x1b]0;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\x07'), null);
  assert.equal(feedCwd(st, '\x1b]1337;NamiRunDone=0\x07'), null);
  assert.equal(feedCwd(st, '\x1b]9;4;1;50\x07'), null); // OSC 9;4 is a progress bar
  assert.equal(feedCwd(st, ''), null);
  assert.equal(st.buf, '');
});

// The base a relative token is resolved against. A relative one would quietly
// mean "relative to wherever Nami itself was started".
test('only an absolute folder is believed', () => {
  assert.equal(cleanCwd('work\\src'), null);
  assert.equal(cleanCwd('C:work'), null);
  assert.equal(cleanCwd(''), null);
  assert.equal(cleanCwd('C:\\a\nb'), null);
  assert.equal(cleanCwd('D:/work'), 'D:/work');
  assert.equal(feedCwd({}, SEQ('work')), null);
});

// pty chunks are whatever was ready, and a path is long enough that the
// sequence straddles two reads far more often than run-done's short one.
test('the sequence is still found when it straddles two chunks', () => {
  const seq = SEQ('C:\\Users\\cal\\work\\atlas');
  for (let cut = 1; cut < seq.length; cut++) {
    const st = {};
    assert.equal(feedCwd(st, 'PS> cd atlas\r\n' + seq.slice(0, cut)), null, `cut at ${cut}`);
    assert.equal(feedCwd(st, seq.slice(cut) + 'PS C:\\> '), 'C:\\Users\\cal\\work\\atlas', `cut at ${cut}`);
    assert.equal(st.buf, '', `cut at ${cut}`);
  }
});

test('it survives being split three ways', () => {
  const seq = SEQ('C:\\work');
  const st = {};
  assert.equal(feedCwd(st, seq.slice(0, 3)), null);
  assert.equal(feedCwd(st, seq.slice(3, 9)), null);
  assert.equal(feedCwd(st, seq.slice(9)), 'C:\\work');
});

test('a complete report is not lost to a half-arrived one behind it', () => {
  const st = {};
  assert.equal(feedCwd(st, SEQ('C:\\a') + SEQ('C:\\b').slice(0, 8)), 'C:\\a');
  assert.equal(feedCwd(st, SEQ('C:\\b').slice(8)), 'C:\\b');
});

// A tile can stream megabytes. The carry holds one unfinished sequence or
// nothing, and gives up on a sequence that never ends.
test('the carry buffer does not grow with the output', () => {
  const st = {};
  for (let i = 0; i < 200; i++) feedCwd(st, 'x'.repeat(4096));
  assert.equal(st.buf, '');
  feedCwd(st, '\x1b]9;9;C:\\never-closed');
  for (let i = 0; i < 200; i++) feedCwd(st, 'y'.repeat(4096));
  assert.equal(st.buf, '');
  assert.equal(feedCwd(st, SEQ('C:\\after')), 'C:\\after');
});

test('it reads the same stream run-done reads without either disturbing the other', () => {
  const stream = `${SEQ('C:\\nami')}added 1 package\r\n\x1b]1337;NamiRunDone=3\x07${SEQ('C:\\nami')}PS C:\\nami> `;
  assert.equal(feedRunDone({}, stream), 3);
  assert.equal(feedCwd({}, stream), 'C:\\nami');
});
