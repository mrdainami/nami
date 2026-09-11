import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget } from '../src/renderer/typing-target.mjs';

// The rail's Enter-to-rename and ⌘⌫-to-trash rules ask this before acting.
// The bug it guards against: the Markdown editor is a ProseMirror
// contenteditable, not a textarea, so a tag check alone let Shift+Enter in a
// document start a rename in the sidebar and steal the caret.
test('form fields own the keyboard', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
});

test('a contenteditable owns the keyboard, whatever its tag', () => {
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'P', isContentEditable: true }), true);
});

test('anything else leaves the keyboard to the rail', () => {
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false);
  assert.equal(isTypingTarget({ tagName: 'BODY', isContentEditable: false }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});
