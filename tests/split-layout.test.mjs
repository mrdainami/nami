import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { splitLayout } from '../src/renderer/desk-view.mjs';

test('compact split keeps content readable below two useful pane widths', () => {
  assert.equal(splitLayout(659, .46).compact, true);
  assert.equal(splitLayout(660, .46).compact, false);
  assert.equal(splitLayout(0, .46).compact, true);
});
test('compact Session/File still flips data-show when pane ids stay the same', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(root, '../src/renderer/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, '../src/renderer/paper.css'), 'utf8');
  const fn = src.slice(src.indexOf('function focusPanel'), src.indexOf('function closePanel'));
  assert.match(fn, /syncSplitLayout\(pv\)/);
  assert.match(css, /\.pane-switch \{[^}]*border-radius: 2px/);
});
test('split divider clamps both panes without changing the preferred ratio', () => {
  assert.equal(splitLayout(1000, .1).left, 320);
  assert.equal(splitLayout(1000, .9).left, 660);
  assert.equal(splitLayout(660, .9).left, 320);
  assert.equal(splitLayout(1600, .6).left, 948);
  assert.equal(splitLayout(1000, NaN).left, 451);
});
