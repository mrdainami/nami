// An agent tile on Windows starts its program itself instead of asking
// PowerShell to. Every route through PowerShell 5.1 to a native program has to
// guess how that program will unquote its command line, and the guess that
// suits node ("" for a quote) splits an argument in two for a Bun-built one —
// which is what opencode.exe and claude.exe are. node-pty writes the command
// line the one way both families agree on, so the program is handed to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { directLaunch } = createRequire(import.meta.url)('../src/main/cmd-shim.js');

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const CODEX_JS = 'C:\\Users\\ana\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
const found = { codex: 'C:\\Users\\ana\\AppData\\Roaming\\npm\\codex.cmd', grok: 'C:\\Users\\ana\\.grok\\bin\\grok.exe', pnpmtool: 'C:\\pnpm\\tool.cmd' };
const knownBin = (name) => found[name] || '';
// what real-program.js answers: a shim it can see through becomes node + script, anything else is handed back
const real = (p) => (p === found.codex ? { file: NODE, args: [CODEX_JS] } : { file: p, args: [] });
const ask = (line, platform = 'win32') => directLaunch(line, { real, knownBin, platform });

test('a known agent is started as its real program with its own arguments', () => {
  assert.deepEqual(ask('codex'), { file: NODE, args: [CODEX_JS] });
  assert.deepEqual(ask('codex resume 0198-abcd --full-auto'), { file: NODE, args: [CODEX_JS, 'resume', '0198-abcd', '--full-auto'] });
  assert.deepEqual(ask('grok --minimal'), { file: found.grok, args: ['--minimal'] });
});

test('anything that needs a shell to mean what it says stays with the shell', () => {
  for (const line of ['npm run dev && echo done', 'codex "two words"', "codex --agent 'my agent'", 'codex | more', 'codex > out.txt', 'codex $env:X', 'codex; calc', '.\\codex', 'C:\\tools\\codex.exe', '']) {
    assert.equal(ask(line), null, line);
  }
});

test('a program that would still pass through cmd.exe is not started this way', () => {
  assert.equal(ask('pnpmtool --go'), null);      // a shim nobody could see through
  assert.equal(ask('unknown --go'), null);       // the scan never found it: a bare name is whatever the shell finds first
});

test('a Mac never takes this road', () => {
  assert.equal(ask('codex', 'darwin'), null);
  assert.equal(ask('codex', 'linux'), null);
});
