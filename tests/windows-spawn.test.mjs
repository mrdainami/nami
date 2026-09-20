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

// Every cmd.exe line opens by telling cmd.exe not to look in the current folder
// for a program. The tests below take it off before they look at the rest.
const GUARD = 'set NoDefaultCurrentDirectoryInExePath=1&& ';
const body = (line) => {
  assert.ok(line.startsWith('"' + GUARD) && line.endsWith('"'), line);
  return line.slice(1 + GUARD.length, -1);
};
// What a .cmd shim sees: cmd.exe has taken the carets off, and the shim's %*
// puts the text through cmd.exe a second time with nothing escaping it. There
// only a quoted stretch is safe, so this walks the quotes the way cmd.exe does
// and reports anything it would act on that is sitting outside them.
const looseInShim = (line) => {
  let inQuote = false, loose = '';
  for (const ch of body(line).replace(/\^(.)/g, '$1')) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && /[&|<>()^]/.test(ch)) loose += ch;
  }
  return loose;
};

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
    const bare = body(line).replace(/\^./g, '');
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

// The project folder is the current folder of an agent's helper, and cmd.exe
// looks there before PATH: a repo holding npx.cmd was run in place of npx.
test('cmd.exe is told not to look for the program in the current folder', () => {
  for (const file of ['npx', 'C:\\npm\\codex.cmd']) {
    const line = spawnPlan(file, ['-y', 'x'], 'win32').args[3];
    assert.ok(line.startsWith('"set NoDefaultCurrentDirectoryInExePath=1&& '), line);
  }
  // a real .exe and a Mac never meet cmd.exe, so there is nothing to tell
  assert.deepEqual(spawnPlan('C:\\x\\claude.exe', ['a'], 'win32').args, ['a']);
  assert.deepEqual(spawnPlan('npx', ['a'], 'darwin').args, ['a']);
});

test('cmd.exe itself is started by full path, never by name', () => {
  assert.equal(spawnPlan('npx', [], 'win32', {}).file, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(spawnPlan('npx', [], 'win32', { SystemRoot: 'D:\\WinNT' }).file, 'D:\\WinNT\\System32\\cmd.exe');
  assert.equal(spawnPlan('npx', [], 'win32', { ComSpec: 'D:\\WinNT\\System32\\cmd.exe' }).file, 'D:\\WinNT\\System32\\cmd.exe');
  // a ComSpec or SystemRoot that is not a full drive path is not believed
  for (const bad of ['cmd.exe', '.\\cmd.exe', '\\\\evil\\share\\cmd.exe', 'evil']) {
    assert.equal(spawnPlan('npx', [], 'win32', { ComSpec: bad, SystemRoot: bad }).file, 'C:\\Windows\\System32\\cmd.exe', bad);
  }
});

// `claude mcp add-json <id> <json>` is the live case: the JSON is all quotes,
// and a key or a URL in it can hold an &. Written as \" the quotes paired off
// wrongly inside the shim and `v&echo PWNED` ran echo (measured in the VM).
test('a quote is doubled, so an argument full of quotes stays quoted inside a shim', () => {
  const json = JSON.stringify({ env: { K: 'v&echo PWNED', P: 'C:\\x\\' } });
  const line = spawnPlan('C:\\npm\\claude.cmd', ['mcp', 'add-json', 'svc', json], 'win32').args[3];
  assert.ok(spawnPlan('C:\\npm\\claude.cmd', ['a"b'], 'win32').args[3].endsWith(' ^"a^"^"b^""'), 'no backslash is put in front of a quote');
  assert.ok(line.includes('^"^"env^"^"'), line);
  for (const evil of [json, 'a" & echo PWNED & "', 'x" "y & echo PWNED', 'a\\"b & calc', '"', '""', '& calc', 'a|b', '<c>', '(d)']) {
    assert.equal(looseInShim(spawnPlan('C:\\npm\\x.cmd', [evil], 'win32').args[3]), '', evil);
  }
  // backslashes in front of a quote are still doubled, as the C runtime reads them
  assert.ok(spawnPlan('C:\\npm\\x.cmd', ['a\\"b'], 'win32').args[3].includes('^"a\\\\^"^"b^"'));
  assert.ok(spawnPlan('C:\\npm\\x.cmd', [''], 'win32').args[3].endsWith(' ^"^""'));
});

// cmd.exe stops reading at a newline: the rest of the line was dropped without
// a word, and a first message is often several lines.
test('a line break in an argument becomes a space instead of ending the line', () => {
  for (const [arg, want] of [['line1\necho PWNED', 'line1^ echo^ PWNED'], ['a\r\n\r\nb', 'a^ b'], ['a\rb', 'a^ b']]) {
    const line = spawnPlan('C:\\npm\\x.cmd', [arg], 'win32').args[3];
    assert.doesNotMatch(line, /[\r\n]/);
    assert.ok(line.includes('^"' + want + '^"'), line);
  }
});
