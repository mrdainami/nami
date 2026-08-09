import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KNOWN_AGENTS, detectAgents } = require('../src/main/agents-detect.js');

test('registry carries the curated six with everything the launcher needs', () => {
  const ids = KNOWN_AGENTS.map((a) => a.id);
  for (const id of ['claude', 'codex', 'opencode', 'gemini', 'hermes', 'kimi']) {
    assert.ok(ids.includes(id), `registry missing ${id}`);
  }
  for (const a of KNOWN_AGENTS) {
    for (const k of ['id', 'name', 'bin', 'kind', 'sub', 'install', 'docs']) {
      assert.ok(a[k], `${a.id} missing ${k}`);
    }
    assert.ok(['claude', 'run'].includes(a.kind));
    assert.ok(/^https:\/\//.test(a.docs), `${a.id} docs must be a real https link`);
  }
  assert.equal(KNOWN_AGENTS.find((a) => a.id === 'claude').kind, 'claude');
});

test('detectAgents marks found agents with their path', async () => {
  const fake = async (bin) => {
    if (bin === 'claude') return '/opt/homebrew/bin/claude';
    if (bin === 'opencode') return '/usr/local/bin/opencode';
    throw new Error('not found');
  };
  const out = await detectAgents({ exec: fake });
  assert.equal(out.length, KNOWN_AGENTS.length);
  const claude = out.find((a) => a.id === 'claude');
  assert.equal(claude.found, true);
  assert.equal(claude.path, '/opt/homebrew/bin/claude');
  const codex = out.find((a) => a.id === 'codex');
  assert.equal(codex.found, false);
  assert.equal(codex.path, '');
});

test('detectAgents survives an exec that always throws', async () => {
  const out = await detectAgents({ exec: async () => { throw new Error('boom'); } });
  assert.ok(out.every((a) => a.found === false && a.path === ''));
});

test('detectAgents treats empty output as not found', async () => {
  const out = await detectAgents({ exec: async () => '   \n' });
  assert.ok(out.every((a) => a.found === false));
});

// ---- lifecycle: who is signed in, and what we can do about it --------------

const { agentStatus } = require('../src/main/agents-detect.js');

const HERMES_AUTH = JSON.stringify({
  credential_pool: { anthropic: [{ label: 'claude_code' }], openrouter: [{ label: 'OPENROUTER_API_KEY' }] },
});

test('lifecycle fields only exist for agents verified on a real machine', () => {
  const withLifecycle = KNOWN_AGENTS.filter((a) => a.lifecycle).map((a) => a.id).sort();
  assert.deepEqual(withLifecycle, ['claude', 'codex', 'hermes', 'opencode']);
  const gemini = KNOWN_AGENTS.find((a) => a.id === 'gemini');
  assert.equal(gemini.lifecycle, undefined, 'gemini is unverified and must stay inert');
});

test('every lifecycle that can sign in can also sign out', () => {
  for (const a of KNOWN_AGENTS) {
    const lc = a.lifecycle; if (!lc) continue;
    if (lc.login) assert.ok(lc.logout, `${a.id} can log in but not out`);
    assert.ok(lc.statusCmd || (lc.statusFiles && lc.statusFiles.length), `${a.id} has no way to read status`);
    if (lc.statusFiles) for (const p of lc.statusFiles) assert.ok(p.startsWith('~/'), `${a.id}: ${p} must be ~-relative`);
    if (lc.accountUrl) assert.ok(/^https:\/\//.test(lc.accountUrl), `${a.id} accountUrl must be https`);
  }
});

test('agentStatus runs the status command and parses it', async () => {
  const exec = async (cmd) => {
    assert.equal(cmd, 'claude auth status --json');
    return JSON.stringify({ loggedIn: true, email: 'dev@example.com', subscriptionType: 'max', authMethod: 'claude.ai' });
  };
  const s = await agentStatus('claude', { exec, readFile: async () => null, home: '/h' });
  assert.equal(s.id, 'claude');
  assert.equal(s.signedIn, true);
  assert.equal(s.label, 'dev@example.com · Max');
  assert.equal(s.source, 'claude auth status');
});

test('agentStatus expands ~ and reads files for file-based agents', async () => {
  const seen = [];
  const readFile = async (p) => { seen.push(p); return p.endsWith('auth.json') ? HERMES_AUTH : null; };
  const s = await agentStatus('hermes', { exec: async () => { throw new Error('must not exec'); }, readFile, home: '/h' });
  assert.ok(seen.includes('/h/.hermes/auth.json'), 'did not expand ~');
  assert.equal(s.signedIn, true);
  assert.equal(s.label, '2 sign-ins');
  assert.equal(s.source, 'reads ~/.hermes');
});

test('agentStatus returns unknown when the status command fails', async () => {
  const s = await agentStatus('claude', { exec: async () => { throw new Error('boom'); }, readFile: async () => null, home: '/h' });
  assert.equal(s.signedIn, null);
  assert.deepEqual(s.rows, []);
});

test('agentStatus returns unknown for an agent with no lifecycle', async () => {
  const s = await agentStatus('gemini', { exec: async () => 'x', readFile: async () => 'y', home: '/h' });
  assert.equal(s.signedIn, null);
  assert.equal(s.label, '');
});

test('agentStatus returns unknown for an id that is not in the registry', async () => {
  const s = await agentStatus('nope', { exec: async () => 'x', readFile: async () => null, home: '/h' });
  assert.equal(s.signedIn, null);
});

test('detectAgents expands configPath so the renderer never needs $HOME', async () => {
  const out = await detectAgents({ exec: async () => '/bin/x', home: '/h' });
  assert.equal(out.find((a) => a.id === 'hermes').configFile, '/h/.hermes/config.yaml');
  assert.equal(out.find((a) => a.id === 'gemini').configFile, '', 'no lifecycle, no config file');
});
