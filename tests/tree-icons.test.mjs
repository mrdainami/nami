import test from 'node:test';
import assert from 'node:assert/strict';
import { treeBadgeFor, treeIcon } from '../src/renderer/icons.mjs';

test('well-known folder names get their badge', () => {
  assert.equal(treeBadgeFor('src'), 'code');
  assert.equal(treeBadgeFor('lib'), 'code');
  assert.equal(treeBadgeFor('tests'), 'tests');
  assert.equal(treeBadgeFor('__tests__'), 'tests');
  assert.equal(treeBadgeFor('docs'), 'docs');
  assert.equal(treeBadgeFor('assets'), 'assets');
  assert.equal(treeBadgeFor('public'), 'assets');
  assert.equal(treeBadgeFor('scripts'), 'scripts');
  assert.equal(treeBadgeFor('dist'), 'build');
  assert.equal(treeBadgeFor('SRC'), 'code'); // case-blind
});

test('dependency dumps dim, and beat the dot-folder rule', () => {
  assert.equal(treeBadgeFor('node_modules'), 'deps');
  assert.equal(treeBadgeFor('.venv'), 'deps'); // not "config" despite the dot
});

test('dot-folders wear the gear; everything else is a plain folder', () => {
  assert.equal(treeBadgeFor('.claude'), 'config');
  assert.equal(treeBadgeFor('.github'), 'config');
  assert.equal(treeBadgeFor('shots'), null);
  assert.equal(treeBadgeFor('whatever'), null);
});

test('icons ink in currentColor with token fills — themable without redrawing', () => {
  const dir = treeIcon('src', 'dir', false);
  assert.match(dir, /stroke="currentColor"/);
  assert.match(dir, /var\(--tree-fill\)/);
  const file = treeIcon('a.txt', 'file', false);
  assert.match(file, /var\(--tree-fill-file\)/);
  assert.equal(treeIcon('node_modules', 'dir', false).includes('stroke-dasharray'), true);
  // open folders show the tipped flap
  assert.equal(treeIcon('shots', 'dir', true).includes('--tree-fill-open'), true);
  assert.equal(treeIcon('shots', 'dir', false).includes('--tree-fill-open'), false);
});
