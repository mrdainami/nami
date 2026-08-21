import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterOf, receiversOf, formatNames, knowsCopy } from '../src/renderer/receivers.mjs';

const NAMES = {
  claude: 'Claude Code',
  grok: 'Grok',
  hermes: 'Hermes',
  antigravity: 'Antigravity',
  codex: 'Codex',
};
const nameOf = (id) => NAMES[id] || id;

test('an agent copy goes to writers, not Hermes', () => {
  assert.equal(adapterOf('agent', 'claude'), 'copy');
  assert.equal(adapterOf('agent', 'grok'), 'copy');
  assert.equal(adapterOf('agent', 'hermes'), 'none');
  assert.deepEqual(
    receiversOf('agent', ['claude', 'grok', 'hermes', 'antigravity']),
    ['claude', 'grok', 'antigravity'],
  );
});

test('a skill is announced to every CLI that reads AGENTS.md, including Hermes', () => {
  assert.equal(adapterOf('skill', 'hermes'), 'announce');
  assert.equal(adapterOf('skill', 'grok'), 'announce');
  assert.deepEqual(
    receiversOf('skill', ['claude', 'hermes', 'grok']),
    ['claude', 'hermes', 'grok'],
  );
});

test('MCP writes skip Hermes (manual) and include Grok', () => {
  assert.equal(adapterOf('mcp', 'grok'), 'write');
  assert.equal(adapterOf('mcp', 'hermes'), 'manual');
  assert.equal(adapterOf('mcp', 'claude'), 'write');
  assert.deepEqual(
    receiversOf('mcp', ['claude', 'grok', 'hermes', 'codex']),
    ['claude', 'grok', 'codex'],
  );
});

test('knowsCopy names the writers and, for MCP, Hermes’s own command', () => {
  const installed = ['claude', 'grok', 'hermes'];
  assert.equal(
    knowsCopy({ kind: 'agent', installed, nameOf }),
    'Claude Code and Grok get a copy',
  );
  assert.equal(
    knowsCopy({ kind: 'mcp', installed, nameOf }),
    'Claude Code and Grok get this connection. Hermes: `hermes mcp`',
  );
  assert.match(
    knowsCopy({ kind: 'skill', installed, nameOf, stubCount: 1 }),
    /Claude Code, Grok and Hermes\. Announced in AGENTS.md \+ 1 stub/,
  );
});

test('a single receiver uses the singular', () => {
  assert.equal(
    knowsCopy({ kind: 'agent', installed: ['claude'], nameOf }),
    'Claude Code gets a copy',
  );
});

test('formatNames uses and, never everywhere', () => {
  assert.equal(formatNames(['Claude Code']), 'Claude Code');
  assert.equal(formatNames(['Claude Code', 'Grok']), 'Claude Code and Grok');
  assert.equal(formatNames(['A', 'B', 'C']), 'A, B and C');
  assert.ok(!formatNames(['Claude Code', 'Grok']).includes('everywhere'));
});
