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

// ---- going round the shim ---------------------------------------------------
// A held message is safe and it is not what a Mac does. npm's shim is a few
// generated lines that find node and run one script, so Nami can start node on
// that script itself: the program is then a real .exe, cmd.exe is never in the
// room, and the message and the name travel whole. The two texts below are the
// files npm 11 wrote in the Windows 11 VM, byte for byte (`type codex.cmd`).
const { shimTarget } = require('../src/main/cmd-shim.js');
const NPM = 'C:\\Users\\cal\\AppData\\Roaming\\npm';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const HEAD = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';
const viaNode = (target, args = '') => HEAD + '\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\n'
  + `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" ${args} "%dp0%\\${target}" %*\r\n`;
const CODEX_JS = 'node_modules\\@openai\\codex\\bin\\codex.js';
const CODEX_CMD = viaNode(CODEX_JS);
const OPENCODE_CMD = HEAD + '"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe"   %*\r\n';
const has = (...paths) => (p) => paths.map((x) => x.toLowerCase()).includes(String(p).toLowerCase());

test('npm\'s shim for a node script is node and that one script', () => {
  const script = NPM + '\\' + CODEX_JS;
  assert.deepEqual(shimTarget(CODEX_CMD, NPM + '\\codex.cmd', { exists: has(script), node: NODE }), { file: NODE, args: [script] });
  // a node.exe beside the shim is the one the shim itself would pick
  assert.deepEqual(shimTarget(CODEX_CMD, NPM + '\\codex.cmd', { exists: has(script, NPM + '\\node.exe'), node: NODE }), { file: NPM + '\\node.exe', args: [script] });
  assert.deepEqual(shimTarget(CODEX_CMD, NPM + '\\codex.cmd', { exists: has(script, NPM + '\\node.exe') }), { file: NPM + '\\node.exe', args: [script] });
  for (const ext of ['cjs', 'mjs', 'JS']) {
    const at = NPM + '\\node_modules\\x\\cli.' + ext;
    assert.deepEqual(shimTarget(viaNode('node_modules\\x\\cli.' + ext), NPM + '\\x.cmd', { exists: has(at), node: NODE }), { file: NODE, args: [at] }, ext);
  }
});

test('npm\'s shim for a package whose bin is a real .exe is that .exe, and node is not needed', () => {
  const exe = NPM + '\\node_modules\\opencode-ai\\bin\\opencode.exe';
  assert.deepEqual(shimTarget(OPENCODE_CMD, NPM + '\\opencode.cmd', { exists: has(exe) }), { file: exe, args: [] });
  assert.equal(shimTarget(OPENCODE_CMD, NPM + '\\opencode.cmd', { exists: has() }), null, 'the .exe is gone');
  // only a program: a bin that is another script is cmd.exe's to run
  for (const target of ['node_modules\\x\\run.cmd', 'node_modules\\x\\run.bat', 'node_modules\\x\\run', 'node_modules\\x\\run.js'])
    assert.equal(shimTarget(HEAD + `"%dp0%\\${target}"   %*\r\n`, NPM + '\\x.cmd', { exists: () => true, node: NODE }), null, target);
});

test('the shapes npm wrote before this one are read too', () => {
  const script = NPM + '\\' + CODEX_JS;
  // npm 6 and earlier, and yarn 1 to this day
  const oldest = `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\${CODEX_JS}" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\${CODEX_JS}" %*\r\n)`;
  // late npm 6: the subroutine at the foot of the file
  const middle = `@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\n"%_prog%"  "%dp0%\\${CODEX_JS}" %*\r\nENDLOCAL\r\nEXIT /b %errorlevel%\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n`;
  for (const text of [oldest, middle, oldest.replace(/\r\n/g, '\n')])
    assert.deepEqual(shimTarget(text, NPM + '\\codex.cmd', { exists: has(script), node: NODE }), { file: NODE, args: [script] });
});

test('anything that is not unmistakably "node, this script, %*" is left to the shim', () => {
  const script = NPM + '\\' + CODEX_JS;
  const opts = { exists: () => true, node: NODE };
  const no = (text, why, shim = NPM + '\\codex.cmd', o = opts) => assert.equal(shimTarget(text, shim, o), null, why);
  assert.ok(shimTarget(CODEX_CMD, NPM + '\\codex.cmd', opts), 'the control: this one is read');
  no(CODEX_CMD, 'the script is not there', undefined, { exists: has(NODE), node: NODE });
  no(viaNode(CODEX_JS, '--no-warnings'), 'a flag for node from the shebang');
  no(viaNode(CODEX_JS).replace('%*', '--yolo %*'), 'a flag for the script');
  no(viaNode(CODEX_JS).replace('%*', '%* & calc'), 'something after the arguments');
  no(CODEX_CMD.replace('CALL :find_dp0\r\n', 'CALL :find_dp0\r\n@SET "NODE_OPTIONS=--require=x"\r\n'), 'a variable set for the program (cmd-shim writes these for `#!/usr/bin/env X=1 node`)');
  no(CODEX_CMD.replace('CALL :find_dp0\r\n', 'CALL :find_dp0\r\ncalc.exe\r\n'), 'a line nobody knows');
  no(CODEX_CMD.replace(/"_prog=node"/, '"_prog=python"'), 'not node');
  no(CODEX_CMD.replace(/SET "_prog=node"\r\n/, ''), '%_prog% set by nobody');
  no(CODEX_CMD.replace('SET dp0=%~dp0\r\n', ''), '%dp0% set by nobody');
  no(viaNode('..\\..\\elsewhere\\x.js'), 'a script outside the shim\'s own folder');
  no(viaNode('node_modules\\..\\..\\x.js'), 'the same, further in');
  no(viaNode('C:\\elsewhere\\x.js'), 'a drive where a folder should be');
  no(viaNode('node_modules\\%X%\\x.js'), 'a variable in the path');
  no(viaNode('node_modules\\x\\cli.py'), 'not a node script');
  no(viaNode('node_modules\\x\\cli'), 'no extension to go by');
  no(viaNode(CODEX_JS) + `"%_prog%"  "%dp0%\\node_modules\\other\\x.js" %*\r\n`, 'two scripts');
  no('', 'an empty file');
  no('@echo off\r\nclaude.exe %*\r\n', 'somebody\'s own wrapper');
  // pnpm sets NODE_PATH before it runs anything: a setting that matters
  no(`@SETLOCAL\r\n@IF NOT DEFINED NODE_PATH (\r\n  @SET "NODE_PATH=C:\\pnpm\\global\\5\\node_modules"\r\n)\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\${CODEX_JS}" %*\r\n) ELSE (\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\${CODEX_JS}" %*\r\n)\r\n`, 'pnpm');
  // the shim has to say where it is, in full, and be a .cmd
  no(CODEX_CMD, 'a bare name', 'codex.cmd');
  no(CODEX_CMD, 'a relative path', '.\\npm\\codex.cmd');
  no(CODEX_CMD, 'not a .cmd', NPM + '\\codex.ps1');
  // node by full path to a real .exe or not at all: a bare `node` is whatever
  // the current folder holds (platform.js, CMD_GUARD)
  for (const node of ['', 'node', 'node.exe', '.\\node.exe', 'C:\\x\\node.cmd', undefined, null])
    no(CODEX_CMD, 'node: ' + node, undefined, { exists: has(script), node });
});
