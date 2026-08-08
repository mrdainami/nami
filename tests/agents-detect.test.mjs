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
