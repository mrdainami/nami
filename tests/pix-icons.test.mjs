import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixIcon, PIX } from '../src/renderer/icons.mjs';

const viewBoxOf = (svg) => (svg.match(/viewBox="([^"]+)"/) || [])[1];

test('every pixel glyph declares the grid it was cut on', () => {
  for (const [name, glyph] of Object.entries(PIX)) {
    assert.ok(Array.isArray(glyph), `${name} should be [path, size]`);
    const [d, size] = glyph;
    assert.equal(typeof d, 'string', `${name} needs a path`);
    assert.ok(Number.isInteger(size) && size > 0, `${name} needs an integer grid size`);
  }
});

test('the emitted viewBox matches the glyph, not a hardcoded 7', () => {
  for (const [name, [, size]] of Object.entries(PIX)) {
    assert.equal(viewBoxOf(pixIcon(name)), `0 0 ${size} ${size}`, `${name} viewBox`);
  }
});

test('settings and help are cut on 16 so they land on whole pixels at 16px', () => {
  // 16 cells in a 16px box is one cell per CSS pixel. Seven is what made the
  // old cog mush: it cannot hold a ring and teeth at the same time.
  assert.equal(PIX.settings[1], 16);
  assert.equal(PIX.help[1], 16);
});

test('the cog has teeth — it is not the old slider glyph', () => {
  const d = PIX.settings[0];
  assert.ok(!d.startsWith('M0 1h7v1H0z'), 'still the three-slider path');
  // a rasterised gear is many short runs, not six long ones
  assert.ok(d.split('M').length > 12, 'too few runs to be a gear');
});

test('a glyph nobody drew returns nothing rather than a broken svg', () => {
  assert.equal(pixIcon('no-such-glyph'), '');
});

test('the glyphs the chrome depends on are all still here', () => {
  for (const name of ['theme', 'settings', 'help', 'plus', 'close', 'expand', 'mic', 'send']) {
    assert.ok(pixIcon(name).includes('<svg'), `${name} missing`);
  }
});
