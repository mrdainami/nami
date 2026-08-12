// The event vocabulary every adapter speaks and the renderer draws. Pure —
// these tests are the contract: an adapter that emits something buildRows
// cannot draw is caught here, not in a live tile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  EVENT_KINDS, TOOL_KINDS, toolKindFor, capability, clip, BODY_CAP, safeEvent,
} = require('../src/main/agent-events.js');

test('the vocabulary is closed: every kind an adapter may emit is listed', () => {
  for (const k of ['user', 'assistant', 'thinking', 'tool', 'tool_result', 'turn_end',
    'plan', 'permission', 'permission_resolved', 'note', 'error', 'init', 'status']) {
    assert.ok(EVENT_KINDS.has(k), k + ' missing from EVENT_KINDS');
  }
});

test('tool kinds are the eight the design names, nothing else', () => {
  assert.deepEqual(
    [...TOOL_KINDS].sort(),
    ['checkpoint', 'edit', 'execute', 'fetch', 'other', 'read', 'search', 'think'].sort(),
  );
});

test('claude tool names map onto kinds; the unknown stays other, never hidden', () => {
  assert.equal(toolKindFor('Read'), 'read');
  assert.equal(toolKindFor('NotebookRead'), 'read');
  assert.equal(toolKindFor('Edit'), 'edit');
  assert.equal(toolKindFor('MultiEdit'), 'edit');
  assert.equal(toolKindFor('Write'), 'edit');
  assert.equal(toolKindFor('NotebookEdit'), 'edit');
  assert.equal(toolKindFor('Bash'), 'execute');
  assert.equal(toolKindFor('BashOutput'), 'execute');
  assert.equal(toolKindFor('Grep'), 'search');
  assert.equal(toolKindFor('Glob'), 'search');
  assert.equal(toolKindFor('WebFetch'), 'fetch');
  assert.equal(toolKindFor('WebSearch'), 'fetch');
  assert.equal(toolKindFor('Task'), 'other');
  assert.equal(toolKindFor('mcp__github__create_pr'), 'other');
  assert.equal(toolKindFor(''), 'other');
  assert.equal(toolKindFor(null), 'other');
});

test('an ACP kind passes through as itself', () => {
  // ACP types its calls already — read/edit/execute/search/fetch/think — and
  // those names are this vocabulary, so the adapter hands them straight over.
  for (const k of TOOL_KINDS) assert.equal(toolKindFor(k, { typed: true }), k);
  assert.equal(toolKindFor('switch_mode', { typed: true }), 'other');
});

test('a capability record always answers every question', () => {
  const c = capability({ drive: true, channel: 'agent sdk' });
  assert.equal(c.drive, true);
  assert.equal(c.interrupt, false);
  assert.equal(c.ask, false);
  assert.equal(c.commands, false);
  assert.equal(c.models, false);
  assert.equal(c.channel, 'agent sdk');
  assert.equal(c.note, '');
  // Nothing beyond the vocabulary rides along.
  assert.deepEqual(
    Object.keys(c).sort(),
    ['ask', 'channel', 'commands', 'drive', 'interrupt', 'models', 'note'].sort(),
  );
});

test('clip caps a body at BODY_CAP and says so', () => {
  const small = clip('hello');
  assert.deepEqual(small, { body: 'hello', truncated: false });
  const big = clip('x'.repeat(BODY_CAP + 5));
  assert.equal(big.body.length, BODY_CAP);
  assert.equal(big.truncated, true);
  assert.deepEqual(clip(null), { body: '', truncated: false });
});

test('safeEvent passes a known kind and refuses the rest', () => {
  assert.ok(safeEvent({ kind: 'assistant', text: 'hi' }));
  assert.equal(safeEvent({ kind: 'exploit', text: 'x' }), null);
  assert.equal(safeEvent(null), null);
  assert.equal(safeEvent('assistant'), null);
});
