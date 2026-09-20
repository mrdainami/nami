// The one question the renderer asks before it starts an install. Machine
// access is injected, so the Mac and PC answers are both read from here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installPlan } = require('../src/main/install-plan.js');

const WIN = { platform: 'win32', home: 'C:\\Users\\cal', shell: 'powershell.exe' };
const MAC = { platform: 'darwin', home: '/Users/cal', shell: '/bin/zsh' };
const everything = async (bin) => 'C:\\bin\\' + bin + '.exe';

test('a Mac gets the line it always ran, is never asked about prerequisites, and ~ is expanded to look for the build', async () => {
  const asked = [];
  let looked;
  const out = await installPlan({ ...MAC, connectorId: 'kie', findBin: async (b) => { asked.push(b); return ''; }, exists: (p) => { looked = p; return true; } });
  assert.equal(out.command, 'git clone https://github.com/mrdainami/kie-mcp ~/.nami/connectors/kie-mcp && cd ~/.nami/connectors/kie-mcp && npm install && npm run build');
  assert.equal(out.dir, '~/.nami/connectors/kie-mcp');
  assert.equal(out.built, true);
  assert.equal(looked, '/Users/cal/.nami/connectors/kie-mcp/dist/index.js');
  assert.equal(out.prereq, null);
  assert.deepEqual(asked, []);
});

test('a PC with everything gets a PowerShell line against a real folder', async () => {
  let looked;
  const out = await installPlan({ ...WIN, connectorId: 'kie', findBin: everything, exists: (p) => { looked = p; return false; } });
  assert.equal(out.ok, true);
  assert.equal(out.prereq, null);
  assert.equal(out.dir, 'C:\\Users\\cal\\.nami\\connectors\\kie-mcp');
  assert.equal(looked, 'C:\\Users\\cal\\.nami\\connectors\\kie-mcp\\dist\\index.js');
  assert.equal(out.built, false);
  assert.doesNotMatch(out.command, /&&|~/);
  assert.match(out.command, /^git clone /);
});

test('a clean PC hears what is missing before anything runs', async () => {
  const out = await installPlan({ ...WIN, connectorId: 'kie', findBin: async () => '' });
  assert.deepEqual(out.prereq.missing, ['git', 'node', 'npm']);
  assert.deepEqual(out.prereq.commands, ['winget install --id Git.Git -e', 'winget install --id OpenJS.NodeJS.LTS -e']);
});

test('missing is only said after the PATH has been read again', async () => {
  // the user ran the winget line a moment ago: the remembered PATH is stale
  let fresh = false, refreshed = 0;
  const out = await installPlan({ ...WIN, connectorId: 'kie', refresh: () => { refreshed += 1; fresh = true; }, findBin: async (b) => (fresh ? everything(b) : '') });
  assert.equal(refreshed, 1);
  assert.equal(out.prereq, null);
  // and when nothing was missing the PATH is left alone
  let again = 0;
  await installPlan({ ...WIN, connectorId: 'kie', refresh: () => { again += 1; }, findBin: everything });
  assert.equal(again, 0);
});

test('an npm-installed agent on a PC is guarded the same way; a scripted one needs nothing', async () => {
  const codex = await installPlan({ ...WIN, agentId: 'codex', findBin: async () => '' });
  assert.deepEqual(codex.prereq.missing, ['node', 'npm']);
  assert.equal(codex.command, undefined, 'the agent sheet keeps running the command it shows');
  const opencode = await installPlan({ ...WIN, agentId: 'opencode', findBin: async (b) => (b === 'node' ? 'C:\\n\\node.exe' : '') });
  assert.deepEqual(opencode.prereq.missing, ['npm']);
  const asked = [];
  const claude = await installPlan({ ...WIN, agentId: 'claude', findBin: async (b) => { asked.push(b); return ''; } });
  assert.equal(claude.prereq, null);
  assert.deepEqual(asked, []);
  assert.equal((await installPlan({ ...MAC, agentId: 'codex', findBin: async () => '' })).prereq, null);
});

test('a probe that throws reads as missing, never as a crash', async () => {
  const out = await installPlan({ ...WIN, agentId: 'codex', findBin: async () => { throw new Error('EPERM'); } });
  assert.deepEqual(out.prereq.missing, ['node', 'npm']);
});

test('only a known install is planned', async () => {
  for (const args of [{ connectorId: 'notion' }, { connectorId: 'nope' }, { agentId: 'nope' }, {}]) {
    assert.deepEqual(await installPlan({ ...WIN, ...args }), { ok: false }, JSON.stringify(args));
  }
});
