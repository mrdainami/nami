import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLayout } from '../src/renderer/desk-view.mjs';

test('compact split keeps content readable below two useful pane widths', () => {
  assert.equal(splitLayout(659, .46).compact, true);
  assert.equal(splitLayout(660, .46).compact, false);
  assert.equal(splitLayout(0, .46).compact, true);
});
test('split divider clamps both panes without changing the preferred ratio', () => {
  assert.equal(splitLayout(1000, .1).left, 320);
  assert.equal(splitLayout(1000, .9).left, 660);
  assert.equal(splitLayout(660, .9).left, 320);
  assert.equal(splitLayout(1600, .6).left, 948);
  assert.equal(splitLayout(1000, NaN).left, 451);
});
