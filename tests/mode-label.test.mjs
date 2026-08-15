// Mode chips: one label and one stable colour class per mode id, wherever a
// mode appears. The lists come from the adapters now — the label table is
// cosmetic only, so an id it has never seen must fall through as itself,
// never break the chip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modeLabel, modeClass } from '../src/renderer/cards-dom.mjs';

test('every adapter-reported id has a human label', () => {
  // claude — the six SDK modes
  assert.equal(modeLabel('default'), 'ask first');
  assert.equal(modeLabel('acceptEdits'), 'accept edits');
  assert.equal(modeLabel('plan'), 'plan');
  assert.equal(modeLabel('auto'), 'auto');
  assert.equal(modeLabel('dontAsk'), "don't ask");
  assert.equal(modeLabel('bypassPermissions'), 'bypass ⚠');
  // codex — the CLI's presets
  assert.equal(modeLabel('read-only'), 'read-only');
  assert.equal(modeLabel('full-access'), 'full access ⚠');
  // agy + acp agents
  assert.equal(modeLabel('accept-edits'), 'accept edits');
  assert.equal(modeLabel('skip-permissions'), 'skip ⚠');
  assert.equal(modeLabel('build'), 'build');
});

test('an unknown id falls through as itself — a new CLI mode is never blank', () => {
  assert.equal(modeLabel('turbo-yolo'), 'turbo-yolo');
});

test('colour means kind: green pre-approved, blue careful, amber dangerous', () => {
  // the two new claude modes join existing classes, no new hues
  assert.equal(modeClass('auto'), 'm-accept');
  assert.equal(modeClass('dontAsk'), 'm-plan');
  // dangerous stays amber across vocabularies
  assert.equal(modeClass('bypassPermissions'), 'm-bypass');
  assert.equal(modeClass('skip-permissions'), 'm-bypass');
  assert.equal(modeClass('full-access'), 'm-bypass');
  // careful stays blue
  assert.equal(modeClass('plan'), 'm-plan');
  assert.equal(modeClass('read-only'), 'm-plan');
  // pre-approved stays green
  assert.equal(modeClass('acceptEdits'), 'm-accept');
  assert.equal(modeClass('workspace-write'), 'm-accept');
  // neutral asks
  assert.equal(modeClass('default'), 'm-default');
  assert.equal(modeClass('build'), 'm-default');
});
