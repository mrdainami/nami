import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionContextRecorder, terminalSnapshot } from '../src/renderer/session-context.mjs';

test('context records visible user/assistant/tool summaries and excludes hidden events', () => {
  const record = createSessionContextRecorder({ identity: 'conversation-a', now: () => 123 });
  record.user('Please inspect this');
  record.event({ type: 'message', text: 'Visible ' }); record.event({ type: 'message', text: 'answer' });
  record.event({ type: 'thought', text: 'Never share internal thoughts' });
  record.event({ type: 'permission', text: 'Private permission prompt' });
  record.event({ type: 'tool', id: 'call-1', title: 'Read file', status: 'pending', rawInput: 'Excluded argument' });
  record.event({ type: 'tool_update', id: 'call-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Visible tool result' } }] });
  const snapshot = record.snapshot();
  assert.equal(snapshot.identity, 'conversation-a'); assert.equal(snapshot.updatedAt, 123);
  assert.match(snapshot.content, /Assistant:\nVisible answer/); assert.match(snapshot.content, /Read file · completed · Visible tool result/);
  assert.doesNotMatch(snapshot.content, /thoughts|permission|Excluded/); assert.equal(snapshot.incomplete, true);
  record.reset('conversation-b'); assert.equal(record.snapshot().content, ''); assert.equal(record.snapshot().identity, 'conversation-b');
});

test('visible recorder evicts oldest content and marks truncation', () => {
  const record = createSessionContextRecorder({ maxChars: 160, maxEntries: 3 });
  for (let i = 0; i < 8; i++) record.user('message-' + i + 'x'.repeat(60));
  assert.ok(record.snapshot().content.length <= 160); assert.equal(record.snapshot().truncated, true);
  assert.doesNotMatch(record.snapshot().content, /message-0/); assert.match(record.snapshot().content, /message-7/);
  record.event({ type: 'message', text: 'y'.repeat(500) });
  assert.ok(record.snapshot().content.length <= 160);
});

test('terminal context reads bounded available scrollback without claiming complete history', () => {
  const texts = Array.from({ length: 12 }, (_, i) => 'line-' + i + '-'.repeat(20));
  const term = { buffer: { active: { length: texts.length, getLine: i => ({ translateToString: () => texts[i] }) } } };
  const snapshot = terminalSnapshot(term, { maxChars: 100, maxLines: 8, now: () => 456 });
  assert.ok(snapshot.content.length <= 100); assert.equal(snapshot.truncated, true); assert.equal(snapshot.incomplete, true);
  assert.match(snapshot.content, /line-11/); assert.doesNotMatch(snapshot.content, /line-0/); assert.equal(snapshot.updatedAt, 456);
  assert.match(snapshot.label, /available scrollback/);
});
