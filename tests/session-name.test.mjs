import test from 'node:test';
import assert from 'node:assert/strict';
import { isGenericTitle, feedNameDraft, adoptTitle, shouldPushName } from '../src/renderer/session-name.mjs';

test('generic titles are the ones auto-naming may replace', () => {
  assert.equal(isGenericTitle('Session'), true);
  assert.equal(isGenericTitle('Claude session'), true);
  assert.equal(isGenericTitle('design-agent session'), true);
  assert.equal(isGenericTitle('build: dark mode'), false);
  assert.equal(isGenericTitle('fix the login bug'), false);
  assert.equal(isGenericTitle(''), true);
});

test('typing a prompt then Enter commits it as the name', () => {
  let d = '';
  for (const ch of 'fix the login bug') d = feedNameDraft(d, ch).draft;
  const r = feedNameDraft(d, '\r');
  assert.equal(r.name, 'fix the login bug');
  assert.equal(r.draft, '');
});

test('a whole pasted chunk with Enter commits in one feed', () => {
  const r = feedNameDraft('', 'refactor the settings panel\r');
  assert.equal(r.name, 'refactor the settings panel');
});

test('backspace edits the draft', () => {
  let d = feedNameDraft('', 'helllo').draft;
  d = feedNameDraft(d, '\x7f').draft;
  d = feedNameDraft(d, '\x7f').draft;
  d = feedNameDraft(d, 'o').draft;
  assert.equal(feedNameDraft(d, '\r').name, 'hello');
});

test('menu-driving keys never become a name', () => {
  // arrow down + enter on a picker, then "y" + enter on a trust prompt
  assert.equal(feedNameDraft('', '\x1b[B').draft, '');
  assert.equal(feedNameDraft('', '\r').name, null);
  const r1 = feedNameDraft('', 'y\r');
  assert.equal(r1.name, null);
  assert.equal(r1.draft, '', 'a committed-but-too-short draft resets');
});

test('bracketed paste markers and ANSI sequences are stripped', () => {
  const r = feedNameDraft('', '\x1b[200~write the release notes\x1b[201~\r');
  assert.equal(r.name, 'write the release notes');
});

test('ctrl-c abandons the draft', () => {
  let d = feedNameDraft('', 'half a thought').draft;
  d = feedNameDraft(d, '\x03').draft;
  assert.equal(d, '');
});

test('long prompts are trimmed to a label, whitespace collapsed', () => {
  const long = 'please  go through   every file in the renderer and ' + 'x'.repeat(100);
  const r = feedNameDraft('', long + '\r');
  assert.ok(r.name.length <= 60);
  assert.ok(r.name.startsWith('please go through every file'));
});

// ---- precedence: who is allowed to rename a tile ---------------------------

test("claude's name upgrades a name guessed from the first typed line", () => {
  assert.deepEqual(adoptTitle({ title: 'go ahead', source: 'prompt' }, { title: 'Refactor the auth module', source: 'agent' }),
    { title: 'Refactor the auth module', source: 'agent' });
});

test('a name you typed yourself is never overwritten by claude', () => {
  assert.equal(adoptTitle({ title: 'db migration', source: 'user' }, { title: 'Rename database columns', source: 'agent' }), null);
});

test('renaming by hand beats every other source', () => {
  for (const source of ['generic', 'prompt', 'flow', 'agent']) {
    assert.deepEqual(adoptTitle({ title: 'x', source }, { title: 'mine', source: 'user' }), { title: 'mine', source: 'user' });
  }
});

test("a flow's chosen name holds against claude's — it is the same name pushed down", () => {
  assert.equal(adoptTitle({ title: 'build: dark mode', source: 'flow' }, { title: 'Build a dark mode toggle', source: 'agent' }), null);
});

test('a fresh generic tile takes anything', () => {
  assert.deepEqual(adoptTitle({ title: 'Claude session', source: 'generic' }, { title: 'Fix the flicker', source: 'prompt' }),
    { title: 'Fix the flicker', source: 'prompt' });
});

test('no change means no re-render', () => {
  assert.equal(adoptTitle({ title: 'Same name', source: 'agent' }, { title: 'Same name', source: 'agent' }), null);
  assert.equal(adoptTitle({ title: 'x', source: 'prompt' }, { title: '   ', source: 'agent' }), null);
  assert.equal(adoptTitle({ title: 'x', source: 'prompt' }, { title: null, source: 'agent' }), null);
});

test('only deliberate names are pushed down into claude', () => {
  assert.equal(shouldPushName('user'), true);
  assert.equal(shouldPushName('flow'), true);
  assert.equal(shouldPushName('prompt'), false);   // a guess; claude names it better
  assert.equal(shouldPushName('agent'), false);    // it came from claude to begin with
  assert.equal(shouldPushName('generic'), false);
});
