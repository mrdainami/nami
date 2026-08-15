// The composer's Enter decision, extracted pure so it tests without a DOM.
// The contract: anything on screen that is a choice owns Enter first; then
// plain ⏎ sends and a modified ⏎ (⌥ or ⇧) breaks the line instead — the
// original bug was `if (e.key === 'Enter') submit()` ignoring modifiers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composerKeyAction } from '../src/renderer/cards-dom.mjs';

const k = (key, mods = {}) => ({ key, altKey: false, shiftKey: false, ...mods });

test('plain Enter sends', () => {
  assert.equal(composerKeyAction(k('Enter'), {}), 'send');
});

test('option-Enter and shift-Enter break the line, never send', () => {
  assert.equal(composerKeyAction(k('Enter', { altKey: true }), {}), 'newline');
  assert.equal(composerKeyAction(k('Enter', { shiftKey: true }), {}), 'newline');
  assert.equal(composerKeyAction(k('Enter', { altKey: true, shiftKey: true }), {}), 'newline');
});

test('an open picker owns Enter — modifiers included, a choice is never split', () => {
  assert.equal(composerKeyAction(k('Enter'), { pickerOpen: true }), 'picker');
  assert.equal(composerKeyAction(k('Enter', { altKey: true }), { pickerOpen: true }), 'picker');
});

test('an open slash/@ menu owns Enter next', () => {
  assert.equal(composerKeyAction(k('Enter'), { menuOpen: true }), 'menu');
  assert.equal(composerKeyAction(k('Enter'), { pickerOpen: true, menuOpen: true }), 'picker');
});

test('every other key is not the composer\'s business', () => {
  assert.equal(composerKeyAction(k('a'), {}), null);
  assert.equal(composerKeyAction(k('Escape'), {}), null);
  assert.equal(composerKeyAction(k('Tab', { shiftKey: true }), {}), null);
});
