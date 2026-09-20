// "Do this, then that, but only if this worked" — for both shells, from one
// machine. The shell and the platform are parameters, so a Mac can read the
// exact line a PC would be handed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chainLine, connectorInstall } = require('../src/main/shell-chain.js');

const PS = 'powershell.exe';
const KIE = 'https://github.com/mrdainami/kie-mcp';

test('a POSIX shell chains with &&, as it always has', () => {
  assert.equal(chainLine(['a', 'b', 'c'], '/bin/zsh'), 'a && b && c');
  assert.equal(chainLine(['a'], '/bin/bash'), 'a');
  assert.equal(chainLine(['a', 'b'], ''), 'a && b');
});

test('PowerShell gets no && at all: each step runs inside the success of the one before', () => {
  const line = chainLine(['a', 'b', 'c'], PS);
  assert.equal(line, 'a; if ($?) { b; if ($?) { c } }');
  assert.doesNotMatch(line, /&&/);
  assert.equal(chainLine(['a'], PS), 'a');
  assert.equal(chainLine(['a', 'b'], 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'a; if ($?) { b }');
});

test('empty steps are dropped rather than chained', () => {
  assert.equal(chainLine(['a', '', null, 'b'], '/bin/zsh'), 'a && b');
  assert.equal(chainLine(['a', '', null, 'b'], PS), 'a; if ($?) { b }');
  assert.equal(chainLine([], PS), '');
});

test('on a Mac the connector install is the line it has always been, byte for byte', () => {
  const plan = connectorInstall({ repo: KIE, home: '/Users/cal', platform: 'darwin', shell: '/bin/zsh' });
  assert.equal(plan.dir, '~/.nami/connectors/kie-mcp');
  assert.equal(plan.entry, '~/.nami/connectors/kie-mcp/dist/index.js');
  assert.equal(plan.command,
    'git clone https://github.com/mrdainami/kie-mcp ~/.nami/connectors/kie-mcp && cd ~/.nami/connectors/kie-mcp && npm install && npm run build');
});

test('on a PC the folder is real, quoted for PowerShell, and npm is the .cmd PowerShell is allowed to run', () => {
  const plan = connectorInstall({ repo: KIE, home: 'C:\\Users\\cal', platform: 'win32', shell: PS });
  assert.equal(plan.dir, 'C:\\Users\\cal\\.nami\\connectors\\kie-mcp');
  assert.equal(plan.entry, 'C:\\Users\\cal\\.nami\\connectors\\kie-mcp\\dist\\index.js');
  assert.equal(plan.command,
    "git clone https://github.com/mrdainami/kie-mcp 'C:\\Users\\cal\\.nami\\connectors\\kie-mcp'; "
    + "if ($?) { Set-Location -LiteralPath 'C:\\Users\\cal\\.nami\\connectors\\kie-mcp'; "
    + 'if ($?) { npm.cmd install; if ($?) { npm.cmd run build } } }');
  assert.doesNotMatch(plan.command, /&&|~/);
});

test('a Windows home with a space or an apostrophe stays one argument', () => {
  const plan = connectorInstall({ repo: KIE, home: "C:\\Users\\Cal O'Hia", platform: 'win32', shell: PS });
  assert.ok(plan.command.includes("'C:\\Users\\Cal O''Hia\\.nami\\connectors\\kie-mcp'"));
});

test('the platform decides, not the shape of the home folder', () => {
  // A Mac told about a Windows-looking home still builds the Mac line.
  const plan = connectorInstall({ repo: KIE, home: 'C:\\Users\\cal', platform: 'darwin', shell: '/bin/zsh' });
  assert.equal(plan.dir, '~/.nami/connectors/kie-mcp');
});

test('a repo whose last segment is not a plain name is refused, never quoted into a line', () => {
  for (const repo of ['', null, 'https://github.com/x/', 'https://github.com/x/a b', 'https://github.com/x/$(calc)', 'https://github.com/x/..', "https://github.com/x/a'b"]) {
    assert.equal(connectorInstall({ repo, home: '/Users/cal', platform: 'darwin', shell: '/bin/zsh' }), null, String(repo));
  }
});

test('the renderer no longer chains an install by hand', () => {
  for (const f of ['../src/renderer/mcp-setup.mjs', '../src/renderer/app.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /'git clone '/, f);
    assert.doesNotMatch(src, /&& npm install/, f);
  }
});
