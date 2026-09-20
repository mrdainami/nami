// Starting a program on Windows without handing its arguments to a shell raw.
//
// npm installs every CLI as a .cmd file, and Node refuses to spawn one unless
// it goes through cmd.exe. `shell: true` does that and quotes nothing, so an
// argument with a space splits in two and one with an & runs a second command.
// spawnPlan goes through cmd.exe too, and escapes every argument on the way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { spawnPlan } = require('../src/main/platform.js');

test('a Mac spawn is handed back untouched', () => {
  assert.deepEqual(spawnPlan('/opt/homebrew/bin/claude', ['mcp', 'list'], 'darwin'), { file: '/opt/homebrew/bin/claude', args: ['mcp', 'list'], options: {} });
});

test('a real .exe needs no shell on Windows either', () => {
  const plan = spawnPlan('C:\\Users\\cal\\.local\\bin\\claude.exe', ['mcp', 'remove', 'x y'], 'win32');
  assert.deepEqual(plan, { file: 'C:\\Users\\cal\\.local\\bin\\claude.exe', args: ['mcp', 'remove', 'x y'], options: {} });
});

test('a .cmd shim goes through cmd.exe with every argument escaped', () => {
  const plan = spawnPlan('C:\\Users\\Cal Hia\\AppData\\Roaming\\npm\\claude.cmd', ['mcp', 'remove', 'my server'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
  assert.equal(plan.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(plan.options.windowsVerbatimArguments, true);
  const line = plan.args[3];
  // the program path survives its space, and the argument stays one argument
  assert.ok(line.includes('C:\\Users\\Cal^ Hia\\AppData\\Roaming\\npm\\claude.cmd'), line);
  assert.ok(line.includes('^"my^ server^"'), line);
});

test('nothing in an argument can start a second command', () => {
  for (const evil of ['x & calc.exe', 'x | more', 'x && del /q *', '%PATH%', 'a"b & calc', '^& calc', 'x > C:\\out.txt', '(calc)', '!cd!']) {
    const line = spawnPlan('C:\\npm\\codex.cmd', [evil], 'win32').args[3];
    // /s makes cmd.exe drop the line's own outer quotes. Of what is left, every
    // character cmd.exe acts on must have a caret in front of it.
    assert.ok(line.startsWith('"') && line.endsWith('"'), line);
    const bare = line.slice(1, -1).replace(/\^./g, '');
    assert.doesNotMatch(bare, /[()%!"<>&|]/, `${evil}  →  ${line}`);
  }
});

test('a bare name is resolved by cmd.exe, which knows about .cmd', () => {
  const plan = spawnPlan('claude', ['--version'], 'win32');
  assert.match(plan.file, /cmd\.exe$/i);
  assert.ok(plan.args[3].includes('claude'), plan.args[3]);
});

test('a trailing backslash does not swallow the closing quote', () => {
  const line = spawnPlan('C:\\npm\\x.cmd', ['C:\\work\\'], 'win32').args[3];
  assert.ok(line.includes('^"C:\\work\\\\^"'), line);
});
