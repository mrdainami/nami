import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampTermFont, nextTermFont, clampDocScale, nextDocScale,
  TERM_FONT_MIN, TERM_FONT_MAX, TERM_FONT_DEFAULT, DOC_STEPS,
} from '../src/renderer/tile-zoom.mjs';

test('a missing panel value uses the old global, not 12 blindly', () => {
  assert.equal(clampTermFont(undefined, 14), 14);
  assert.equal(clampTermFont(null, 14), 14);
  assert.equal(clampDocScale(undefined, 1.3), 1.3);
});

test('a stored panel value wins over the global', () => {
  assert.equal(clampTermFont(16, 12), 16);
  assert.equal(clampDocScale(1.5, 1), 1.5);
});

test('rubbish falls back, then to the factory default', () => {
  assert.equal(clampTermFont('nope', 99), TERM_FONT_DEFAULT);
  assert.equal(clampDocScale(1.11, 9), 1);
});

test('term bump stays on this card\'s size, in 1px steps, clamped', () => {
  assert.equal(nextTermFont(12, +1), 13);
  assert.equal(nextTermFont(12, -1), 11);
  assert.equal(nextTermFont(TERM_FONT_MAX, +1), TERM_FONT_MAX);
  assert.equal(nextTermFont(TERM_FONT_MIN, -1), TERM_FONT_MIN);
});

test('doc bump walks DOC_STEPS and does not skip', () => {
  assert.equal(nextDocScale(1, +1), 1.15);
  assert.equal(nextDocScale(1, -1), 0.85);
  assert.equal(nextDocScale(DOC_STEPS[DOC_STEPS.length - 1], +1), DOC_STEPS[DOC_STEPS.length - 1]);
  assert.equal(nextDocScale(DOC_STEPS[0], -1), DOC_STEPS[0]);
});

test('two panels can sit at different sizes', () => {
  const a = { fontSize: nextTermFont(12, +1) };
  const b = { fontSize: 12 };
  assert.equal(clampTermFont(a.fontSize), 13);
  assert.equal(clampTermFont(b.fontSize), 12);
  const d = { docScale: nextDocScale(1, +2) };
  const e = { docScale: 1 };
  assert.equal(clampDocScale(d.docScale), 1.3);
  assert.equal(clampDocScale(e.docScale), 1);
});
