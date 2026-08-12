import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rememberBins, knownBin, forgetBins } = require('../src/main/bin-cache.js');

// Detection already answers "where does this agent live" properly — it asks the
// user's interactive login shell and walks the documented install folders. The
// bug this module exists to kill is that nothing else could read that answer:
// the SDK adapter re-derived it from a hardcoded list of five paths, and the
// one-shot adapters spawned a bare name against a PATH cached at app start.

test('remembers the path of an agent detection found', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: '/Users/x/.nvm/versions/node/v22.22.0/bin/claude' }]);
  assert.equal(knownBin('claude'), '/Users/x/.nvm/versions/node/v22.22.0/bin/claude');
});

test('an agent that was not found is remembered as nothing', () => {
  forgetBins();
  rememberBins([{ id: 'hermes', found: false, path: '' }]);
  assert.equal(knownBin('hermes'), '');
});

// A scan that no longer finds an agent must clear it. Otherwise uninstalling an
// agent inside Nami leaves a path that spawns ENOENT for the rest of the run —
// worse than the bare name, which would at least fail the same way every time.
test('a later scan that loses an agent clears the old path', () => {
  forgetBins();
  rememberBins([{ id: 'kimi', found: true, path: '/opt/homebrew/bin/kimi' }]);
  rememberBins([{ id: 'kimi', found: false, path: '' }]);
  assert.equal(knownBin('kimi'), '');
});

test('an id nobody has scanned is empty, never undefined', () => {
  forgetBins();
  assert.equal(knownBin('nothing-like-this'), '');
  assert.equal(knownBin(''), '');
  assert.equal(knownBin(undefined), '');
});

// Callers use `knownBin(id) || 'agy'`, so anything falsy has to be the empty
// string and never a path-shaped lie.
test('junk in the scan result never becomes a path', () => {
  forgetBins();
  rememberBins([{ id: 'agy', found: true, path: null }, { id: 'codex', found: true }]);
  assert.equal(knownBin('agy'), '');
  assert.equal(knownBin('codex'), '');
});

test('a scan that is not a list leaves what is already known alone', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: '/usr/local/bin/claude' }]);
  rememberBins(null);
  rememberBins(undefined);
  assert.equal(knownBin('claude'), '/usr/local/bin/claude');
});

// The registry calls Google's agent `antigravity`; its adapter and every tile
// command call it `agy`. Whichever name a caller holds has to work, or the
// lookup misses and falls back to the bare name it was meant to replace.
test('an agent is findable by registry id and by program name', () => {
  forgetBins();
  rememberBins([{ id: 'antigravity', bin: 'agy', found: true, path: '/Users/x/.local/bin/agy' }]);
  assert.equal(knownBin('antigravity'), '/Users/x/.local/bin/agy');
  assert.equal(knownBin('agy'), '/Users/x/.local/bin/agy');
});

test('losing an agent clears both of its names', () => {
  forgetBins();
  rememberBins([{ id: 'antigravity', bin: 'agy', found: true, path: '/Users/x/.local/bin/agy' }]);
  rememberBins([{ id: 'antigravity', bin: 'agy', found: false, path: '' }]);
  assert.equal(knownBin('antigravity'), '');
  assert.equal(knownBin('agy'), '');
});

// A run tile types into the user's interactive shell, whose PATH can miss a
// binary the scan already located (nvm/npm-prefix conflicts drop the
// npm-global dir). The typed command gets the absolute path; anything the
// scan doesn't know passes through untouched.
test('resolveRunCommand swaps a known bare binary for its scanned path', () => {
  const { resolveRunCommand } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'codex', found: true, path: '/Users/x/.nvm/versions/node/v22/bin/codex' }]);
  assert.equal(resolveRunCommand('codex'), '/Users/x/.nvm/versions/node/v22/bin/codex');
  assert.equal(resolveRunCommand('codex resume th_1'), '/Users/x/.nvm/versions/node/v22/bin/codex resume th_1');
  assert.equal(resolveRunCommand('kimi -r s1'), 'kimi -r s1'); // unknown: untouched
  assert.equal(resolveRunCommand('npm test'), 'npm test');
  forgetBins();
});

test('a scanned path with awkward characters is quoted for the shell', () => {
  const { resolveRunCommand } = require('../src/main/bin-cache.js');
  forgetBins();
  rememberBins([{ id: 'codex', found: true, path: '/Users/x/My Tools/codex' }]);
  assert.equal(resolveRunCommand('codex resume t'), "'/Users/x/My Tools/codex' resume t");
  forgetBins();
});
