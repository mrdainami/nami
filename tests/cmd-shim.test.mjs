// Free text and a .cmd shim.
//
// npm installs a CLI on Windows as a .cmd file, and a .cmd is run by cmd.exe,
// which reads the whole command line again as a command: `&` starts a second
// one, `%NAME%` is filled in, a `"` flips what is quoted. A pane's arguments do
// not go through spawnPlan's escaping — node-pty quotes only an argument with a
// space in it, and PowerShell quotes nothing properly — so a first message of
// `resize it to 5" wide & echo PWNED` ran echo, and a session named `a&calc`
// would have run calc (measured in the Windows 11 VM).
//
// So where the program is a shim, text somebody else may have written does not
// travel as an argument at all, and the one argument with no other road, the
// session's name, is reduced to characters cmd.exe does nothing with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { reachesCmd, shimSafe, shimSafeArgs } = require('../src/main/cmd-shim.js');
const { initialPromptArgs } = require('../src/main/seed-launch.js');

const W = 'win32', M = 'darwin';

test('only a real .exe or .com on Windows keeps its arguments away from cmd.exe', () => {
  for (const p of ['C:\\Users\\cal\\.local\\bin\\claude.exe', '\\\\corp\\home\\cal\\.local\\bin\\claude.exe', 'C:\\tools\\GROK.EXE', 'C:\\x\\edit.com', 'C:/Users/cal/.local/bin/claude.exe'])
    assert.equal(reachesCmd(p, W), false, p);
  // a shim, a script, a bare name the shell will resolve to who knows what, and
  // nothing at all (the scan has not found it, so the shell will go looking)
  for (const p of ['C:\\Users\\cal\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\npm\\codex.CMD', 'C:\\x\\run.bat', 'C:\\x\\tool.ps1', 'C:\\x\\tool', 'codex', 'claude', 'claude.exe', '.\\claude.exe', '', null, undefined])
    assert.equal(reachesCmd(p, W), true, String(p));
});

test('a Mac has no cmd.exe, whatever the program is called', () => {
  for (const p of ['/opt/homebrew/bin/claude', 'claude', 'C:\\npm\\claude.cmd', '', null]) assert.equal(reachesCmd(p, M), false, String(p));
  assert.equal(reachesCmd('/usr/bin/codex', 'linux'), false);
});

test('a name bound for a shim keeps its words and loses what cmd.exe would act on', () => {
  assert.equal(shimSafe('fix the export button'), 'fix the export button');
  assert.equal(shimSafe("Cal's déjà vu — 日本語 #2"), "Cal's déjà vu — 日本語 #2");
  assert.equal(shimSafe('resize it to 5" wide & echo PWNED'), 'resize it to 5 wide echo PWNED');
  assert.equal(shimSafe('a&calc'), 'acalc');
  assert.equal(shimSafe('use %USERNAME% and !cd! here'), 'use USERNAME and cd here');
  assert.equal(shimSafe('a|b<c>d^e(f)g'), 'abcdefg');
  assert.equal(shimSafe('line1\r\ncalc\tx\x00y\x1b[0m\x7f'), 'line1 calc xy[0m');
  assert.equal(shimSafe('  &&  '), '');
  assert.equal(shimSafe(null), '');
  for (const evil of ['a" & calc & "', '%COMSPEC%', '^& calc', '(calc)', 'x > C:\\out.txt', 'a\nb', '!x!'])
    assert.doesNotMatch(shimSafe(evil), /["%&|<>^!()\x00-\x1f\x7f]/, evil);
});

test('arguments are reduced only when they are on their way to a shim', () => {
  const args = ['--session-id', '00000000-0000-4000-8000-000000000001', '--name', 'a&calc "x"', '--agent', 'rev%iewer'];
  assert.deepEqual(shimSafeArgs(args, 'C:\\npm\\claude.cmd', W), ['--session-id', '00000000-0000-4000-8000-000000000001', '--name', 'acalc x', '--agent', 'reviewer']);
  // an argument reduced to nothing takes its flag's place rather than leave it
  // to swallow the next one
  assert.deepEqual(shimSafeArgs(['--name', '&&', '--agent', 'x'], 'C:\\npm\\claude.cmd', W), ['--name', '_', '--agent', 'x']);
  // a real claude.exe, and a Mac, get every character as they always have
  assert.equal(shimSafeArgs(args, 'C:\\Users\\cal\\.local\\bin\\claude.exe', W), args);
  assert.equal(shimSafeArgs(args, '/opt/homebrew/bin/claude', M), args);
});

const SEED = 'resize it to 5" wide & echo PWNED\nuse %USERNAME% here';
test('a first message never rides to a shim as an argument', () => {
  for (const id of ['claude', 'codex', 'grok', 'opencode', 'antigravity']) {
    assert.deepEqual(initialPromptArgs(id, SEED, { program: 'C:\\npm\\' + id + '.cmd', platform: W }), [], id);
    assert.deepEqual(initialPromptArgs(id, SEED, { program: '', platform: W }), [], id + ', not found by the scan');
    assert.deepEqual(initialPromptArgs(id, SEED, { program: id, platform: W }), [], id + ', bare name');
  }
});

test('a real .exe on Windows, and everything on a Mac, is handed the message exactly as before', () => {
  assert.deepEqual(initialPromptArgs('claude', SEED, { program: 'C:\\Users\\cal\\.local\\bin\\claude.exe', platform: W }), ['--', SEED]);
  assert.deepEqual(initialPromptArgs('grok', SEED, { program: 'C:\\Users\\cal\\.grok\\bin\\grok.exe', platform: W }), ['--', SEED]);
  assert.deepEqual(initialPromptArgs('opencode', SEED, { program: 'C:\\x\\opencode.exe', platform: W }), ['--prompt=' + SEED]);
  assert.deepEqual(initialPromptArgs('antigravity', SEED, { program: 'C:\\x\\agy.exe', platform: W }), ['--prompt-interactive=' + SEED]);
  for (const program of ['/opt/homebrew/bin/codex', 'codex', '', undefined])
    assert.deepEqual(initialPromptArgs('codex', SEED, { program, platform: M }), ['--', SEED]);
  assert.deepEqual(initialPromptArgs('claude', SEED, { platform: M }), ['--', SEED]);
});

// Typing a message in needs the look of the agent's empty input box, and only
// Kimi's and Hermes's are known. A message that was held back and has no other
// road is reported, so the renderer can put it on the clipboard.
test('a held message is owned up to, and only a held one', () => {
  const { seedHeld } = require('../src/main/seed-launch.js');
  for (const id of ['claude', 'codex', 'grok', 'opencode', 'antigravity']) {
    assert.equal(seedHeld(id, SEED, { program: 'C:\\npm\\' + id + '.cmd', platform: W }), true, id);
    assert.equal(seedHeld(id, SEED, { program: 'C:\\x\\' + id + '.exe', platform: W }), false, id);
    assert.equal(seedHeld(id, SEED, { program: '', platform: M }), false, id);
    assert.equal(seedHeld(id, '', { program: 'C:\\npm\\x.cmd', platform: W }), false, id);
  }
  // these two are typed in either way, shim or not
  for (const id of ['kimi', 'hermes', null]) assert.equal(seedHeld(id, SEED, { program: 'C:\\npm\\x.cmd', platform: W }), false, String(id));
});
