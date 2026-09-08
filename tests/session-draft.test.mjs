import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionReference, appendDraft, terminalInsertion } from '../src/renderer/session-draft.mjs';

test('source selection has accurate inclusive lines and preserves text', () => {
  const r = selectionReference({ path: 'a.js', source: 'one\ntwo\nthree', start: 4, end: 8 });
  assert.equal(r.text, 'two\n'); assert.equal(r.startLine, 2); assert.equal(r.endLine, 2);
  assert.match(r.reference, /a.js:2/);
});
test('rendered excerpts do not invent source lines', () => {
  const r = selectionReference({ path: 'readme.md', text: 'Rendered heading' });
  assert.equal(r.startLine, undefined); assert.match(r.reference, /excerpt/);
});
test('staging appends to existing draft without losing whitespace', () => {
  assert.equal(appendDraft('unfinished ', 'snippet'), 'unfinished \n\nsnippet');
  assert.equal(appendDraft('', 'snippet'), 'snippet');
});
test('insertion never submits; multiline needs bracketed paste and terminal controls cannot escape it', () => {
  assert.equal(terminalInsertion('one\ntwo', false), null);
  assert.equal(terminalInsertion('one\ntwo', true), '\x1b[200~one\ntwo\x1b[201~');
  assert.equal(terminalInsertion('a\x1b[201~b\x03', false), 'a[201~b');
  assert.equal(terminalInsertion('hello', false), 'hello');
});
