import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Phase A of the cards removal: the surface is unreachable, the code still
// exists. These read app.js the way ipc-wiring reads main.js — the functions
// are not exported, and a green suite that still paints a Cards button is how
// this would ship broken.

const src = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

test('canShowCards is a hard off — no tile chip, no mount, no enter', () => {
  assert.match(src, /function canShowCards\([^)]*\) \{\s*return false;?\s*\}/);
});

test('the launcher has no Cards / Terminal birth pair and does not remember a surface', () => {
  assert.doesNotMatch(src, /way--cards/);
  assert.doesNotMatch(src, /nami\.surface\./);
});

test('panelSnapshot does not persist view, so no new cards tiles are written', () => {
  const m = src.match(/function panelSnapshot\(\) \{[\s\S]*?\nfunction savePanels\(/);
  assert.ok(m, 'panelSnapshot must exist');
  assert.doesNotMatch(m[0], /view:\s*p\.view/);
});

test('startPanel coerces a persisted cards view to term', () => {
  const m = src.match(/function startPanel\(opts\) \{[\s\S]*?\nconst VIEWER_CODES/);
  assert.ok(m, 'startPanel must exist');
  assert.match(m[0], /view === ['"]cards['"]/);
  assert.match(m[0], /view = ['"]term['"]/);
});
