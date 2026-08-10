import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpen } from '../src/renderer/peek-core.mjs';

const desk = [
  { id: 'p_1', kind: 'editor', filePath: '/w/notes.md' },
  { id: 'p_2', kind: 'viewer', filePath: '/w/logo.png' },
  { id: 'p_3', kind: 'card', filePath: '/w/.claude/agents/collector.md' },
  { id: 'p_4', kind: 'claude' },
];

test('a file already open as an editor tile is focused, not re-opened', () => {
  assert.deepEqual(resolveOpen(desk, 'file', '/w/notes.md'), { action: 'focus', id: 'p_1' });
});
test('a file already open as a viewer tile is focused too', () => {
  assert.deepEqual(resolveOpen(desk, 'file', '/w/logo.png'), { action: 'focus', id: 'p_2' });
});
test('a card matches only card tiles, and file opens never match cards', () => {
  assert.deepEqual(resolveOpen(desk, 'card', '/w/.claude/agents/collector.md'), { action: 'focus', id: 'p_3' });
  assert.deepEqual(resolveOpen(desk, 'file', '/w/.claude/agents/collector.md'), { action: 'peek' });
});
test('nothing on the desk matches: peek (and empty or missing lists are safe)', () => {
  assert.deepEqual(resolveOpen(desk, 'file', '/w/other.md'), { action: 'peek' });
  assert.deepEqual(resolveOpen([], 'file', '/w/notes.md'), { action: 'peek' });
  assert.deepEqual(resolveOpen(null, 'card', '/w/x.md'), { action: 'peek' });
});
