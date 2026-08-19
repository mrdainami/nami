import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basesFromText, joinBase } from '../src/renderer/path-bases.mjs';

// The real shape this exists for: the user's codex prompt named the sweep
// root in full, codex then answered with paths relative to it.
const PROMPT = 'List the absolute path of every png file under /private/tmp/claude-501/-Users-cal-Dropbox-OS/f52496cb/scratchpad one per line';

test('an absolute path in prose yields itself and its parent as bases', () => {
  const bases = basesFromText(PROMPT, 6);
  assert.ok(bases.includes('/private/tmp/claude-501/-Users-cal-Dropbox-OS/f52496cb/scratchpad'));
  assert.ok(bases.includes('/private/tmp/claude-501/-Users-cal-Dropbox-OS/f52496cb'));
});

test('order holds and duplicates collapse', () => {
  const bases = basesFromText('/a/b/c then /a/b/c again then /x/y', 6);
  assert.deepEqual(bases, ['/a/b/c', '/a/b', '/x/y', '/x']);
});

test('the cap is a cap', () => {
  const text = '/a/1 /b/2 /c/3 /d/4 /e/5';
  assert.equal(basesFromText(text, 3).length, 3);
});

test('relative paths and URLs contribute no bases', () => {
  assert.deepEqual(basesFromText('see workshop-banner/scene.png and https://claude.ai/code/x', 6), []);
});

test('a root-level file yields no empty parent', () => {
  assert.deepEqual(basesFromText('/etc', 6), ['/etc']);
});

test('joinBase glues a short token under a base', () => {
  assert.equal(joinBase('/a/b', 'c/d.png'), '/a/b/c/d.png');
  assert.equal(joinBase('/a/b', './c/d.png'), '/a/b/c/d.png');
});

test('joinBase refuses what is not a short relative token', () => {
  assert.equal(joinBase('/a/b', '/abs/path.png'), null, 'absolute stays absolute');
  assert.equal(joinBase('/a/b', '~/home.png'), null);
  assert.equal(joinBase('/a/b', '../up.png'), null, 'no climbing out of a base');
  assert.equal(joinBase('/a/b', 'x/../up.png'), null);
});
