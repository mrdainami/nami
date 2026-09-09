import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionContextRecorder, terminalSnapshot } from '../src/renderer/session-context.mjs';
import { formatBrief, seedCompanion } from '../src/renderer/companion-seed.mjs';

test('formatBrief starts with the helping heading and latest visible work', () => {
  const record = createSessionContextRecorder();
  record.user('Look at src/app.js');
  record.event({ type: 'message', text: 'I will inspect it' });
  record.event({ type: 'thought', text: 'hidden chain of thought' });
  const text = formatBrief(record.brief(), { parentTitle: 'Build dark mode' });
  assert.match(text, /^You are helping the Build dark mode session\. Latest visible work:/);
  assert.match(text, /Look at src\/app\.js/); assert.match(text, /I will inspect it/);
  assert.match(text, /incomplete/i); assert.doesNotMatch(text, /hidden chain|mailbox|nami_send_message|auto-?enter/i);
});

test('empty parent is one watching line with nothing to read yet', () => {
  const text = formatBrief({ content: '', incomplete: true }, { parentTitle: 'Claude session' });
  assert.equal(text, 'You are watching the Claude session. Nothing to read yet.');
  assert.equal(text.includes('\n'), false);
  assert.equal(formatBrief(createSessionContextRecorder().brief(), { parentTitle: 'Research' }),
    'You are watching the Research session. Nothing to read yet.');
});

test('terminal versus chat is only a label in the same brief shape', () => {
  const heading = /^You are helping the A session\. Latest visible work:/;
  const chat = formatBrief({ kind: 'chat', content: 'hello from chat', incomplete: true }, { parentTitle: 'A' });
  const term = formatBrief({ kind: 'terminal', content: 'hello from term', incomplete: true, truncated: true,
    label: 'Terminal snapshot · available scrollback only' }, { parentTitle: 'A' });
  assert.match(chat, heading); assert.match(term, heading);
  assert.match(chat, /Visible chat/i); assert.match(term, /Terminal snapshot · available scrollback only/);
  assert.match(chat, /incomplete/i); assert.match(term, /incomplete/i);
  assert.match(term, /truncated/i);
});

test('seedCompanion returns the brief payload and never submits', () => {
  const calls = [];
  const owner = { title: 'Build dark mode', sessionContext: () => ({ kind: 'chat', content: 'User:\nFix the button', incomplete: true }) };
  const child = {
    insertSessionDraft: payload => calls.push(['draft', payload]),
    enter: () => calls.push(['enter']), submit: () => calls.push(['submit']), send: () => calls.push(['send']),
  };
  const text = seedCompanion(owner, child);
  assert.match(text, /^You are helping the Build dark mode session\. Latest visible work:/);
  assert.match(text, /Fix the button/); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['draft', { text }]);
});

test('seedCompanion of an empty parent is the watching line, still without Enter', () => {
  const child = { insertSessionDraft: payload => child.payload = payload, enter() { child.entered = true; } };
  const text = seedCompanion({ title: 'Claude session', sessionContext: () => ({ content: '' }) }, child);
  assert.equal(text, 'You are watching the Claude session. Nothing to read yet.');
  assert.deepEqual(child.payload, { text }); assert.equal(child.entered, undefined);
});

test('seedCompanion labels a terminal parent snapshot without claiming complete history', () => {
  const texts = ['$ npm test', 'ok'];
  const term = { buffer: { active: { length: texts.length, getLine: i => ({ translateToString: () => texts[i] }) } } };
  const text = seedCompanion({ title: 'Codex', snapshot: () => terminalSnapshot(term) }, {});
  assert.match(text, /^You are helping the Codex session\. Latest visible work:/);
  assert.match(text, /Terminal snapshot · available scrollback only/);
  assert.match(text, /npm test/); assert.match(text, /incomplete/i);
});
