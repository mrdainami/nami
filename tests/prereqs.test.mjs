// "Is what this install needs on the machine?" — asked before the command runs,
// so a PC with no Git hears that in plain words rather than watching PowerShell
// fail to recognise a word. Pure: what was found is handed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { needsOf, missingPrereqs } = require('../src/main/prereqs.js');
const { KNOWN_AGENTS, installCommand } = require('../src/main/agents-detect.js');
const { connectorInstall } = require('../src/main/shell-chain.js');

const ALL = { git: 'C:\\Program Files\\Git\\cmd\\git.exe', node: 'C:\\Program Files\\nodejs\\node.exe', npm: 'C:\\Program Files\\nodejs\\npm.cmd' };

test('what a command needs is read off the programs it starts', () => {
  assert.deepEqual(needsOf('npm install -g @openai/codex'), ['node', 'npm']);
  assert.deepEqual(needsOf('npm.cmd install -g opencode-ai'), ['node', 'npm']);
  assert.deepEqual(needsOf('npx -y something'), ['node', 'npm']);
  assert.deepEqual(needsOf('git clone https://github.com/x/y'), ['git']);
  assert.deepEqual(needsOf('irm https://claude.ai/install.ps1 | iex'), []);
  assert.deepEqual(needsOf('curl -fsSL https://claude.ai/install.sh | bash'), []);
  assert.deepEqual(needsOf(''), []);
  assert.deepEqual(needsOf(null), []);
});

test('a connector install needs all three, on either shell', () => {
  for (const [platform, shell, home] of [['darwin', '/bin/zsh', '/Users/cal'], ['win32', 'powershell.exe', 'C:\\Users\\cal']]) {
    const plan = connectorInstall({ repo: 'https://github.com/mrdainami/kie-mcp', home, platform, shell });
    assert.deepEqual(needsOf(plan.steps), ['git', 'node', 'npm'], platform);
  }
});

test('on Windows the npm-installed agents are the ones that need Node', () => {
  const needy = KNOWN_AGENTS.filter((a) => needsOf(installCommand(a, 'win32')).length).map((a) => a.id);
  assert.deepEqual(needy, ['codex', 'opencode']);
});

test('nothing missing, nothing said', () => {
  assert.equal(missingPrereqs({ needs: ['git', 'node', 'npm'], found: ALL, platform: 'win32' }), null);
  assert.equal(missingPrereqs({ needs: [], found: {}, platform: 'win32' }), null);
});

test('a PC with no Git is told so, with the one command that adds it', () => {
  const out = missingPrereqs({ needs: ['git', 'node', 'npm'], found: { ...ALL, git: '' }, platform: 'win32' });
  assert.deepEqual(out.missing, ['git']);
  assert.equal(out.message, 'Git is not on this PC yet, and this install needs it. Run this in a terminal first, then come back:');
  assert.equal(out.short, 'Git is not on this PC yet.');
  assert.deepEqual(out.commands, ['winget install --id Git.Git -e']);
});

test('Node and npm are one thing to install, named once', () => {
  const out = missingPrereqs({ needs: ['node', 'npm'], found: {}, platform: 'win32' });
  assert.deepEqual(out.missing, ['node', 'npm']);
  assert.equal(out.message, 'Node.js is not on this PC yet, and this install needs it. Run this in a terminal first, then come back:');
  assert.deepEqual(out.commands, ['winget install --id OpenJS.NodeJS.LTS -e']);
  // npm alone missing is still a Node install
  assert.deepEqual(missingPrereqs({ needs: ['node', 'npm'], found: { node: ALL.node }, platform: 'win32' }).commands, ['winget install --id OpenJS.NodeJS.LTS -e']);
});

test('a clean PC is told about both, in the order they will be needed', () => {
  const out = missingPrereqs({ needs: ['git', 'node', 'npm'], found: {}, platform: 'win32' });
  assert.equal(out.message, 'Git and Node.js are not on this PC yet, and this install needs them. Run these in a terminal first, then come back:');
  assert.equal(out.short, 'Git and Node.js are not on this PC yet.');
  assert.deepEqual(out.commands, ['winget install --id Git.Git -e', 'winget install --id OpenJS.NodeJS.LTS -e']);
});

test('a Mac says nothing new, whatever is missing', () => {
  assert.equal(missingPrereqs({ needs: ['git', 'node', 'npm'], found: {}, platform: 'darwin' }), null);
  assert.equal(missingPrereqs({ needs: ['git'], found: {}, platform: 'linux' }), null);
});
