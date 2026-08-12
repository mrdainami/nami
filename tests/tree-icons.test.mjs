import test from 'node:test';
import assert from 'node:assert/strict';
import { treeBadgeFor, treeIcon, fileBadgeFor, FILE_BADGES } from '../src/renderer/icons.mjs';

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

// ---- file badges -----------------------------------------------------------

test('files get a badge for what they are', () => {
  assert.equal(fileBadgeFor('shot.png'), 'image');
  assert.equal(fileBadgeFor('logo.SVG'), 'image');          // case-blind
  assert.equal(fileBadgeFor('demo.mp4'), 'media');
  assert.equal(fileBadgeFor('theme.mp3'), 'media');
  assert.equal(fileBadgeFor('release.pdf'), 'pdf');
  assert.equal(fileBadgeFor('index.html'), 'web');
  assert.equal(fileBadgeFor('README.md'), 'doc');
  assert.equal(fileBadgeFor('app.js'), 'code');
  assert.equal(fileBadgeFor('main.mjs'), 'code');
  assert.equal(fileBadgeFor('package.json'), 'config');
  assert.equal(fileBadgeFor('config.yml'), 'config');
});

test('lock files read as locks, whichever spelling', () => {
  assert.equal(fileBadgeFor('yarn.lock'), 'lock');
  assert.equal(fileBadgeFor('package-lock.json'), 'lock', 'beats the .json config rule');
  assert.equal(fileBadgeFor('Cargo.lock'), 'lock');
});

test('an unknown or extensionless file stays a plain page, not a gap', () => {
  assert.equal(fileBadgeFor('LICENSE'), null);
  assert.equal(fileBadgeFor('Makefile'), null);
  assert.equal(fileBadgeFor('data.xyzzy'), null);
  assert.equal(fileBadgeFor('.gitignore'), null, 'a leading dot is not an extension');
  const plain = treeIcon('LICENSE', 'file', false);
  assert.match(plain, /M4 7 L9 7/, 'falls back to the two text lines');
});

test('every file badge is drawn, and inks from tokens like the folders do', () => {
  for (const key of Object.keys(FILE_BADGES)) {
    assert.equal(typeof FILE_BADGES[key], 'string', key + ' has no path');
    assert.ok(FILE_BADGES[key].length > 0, key + ' is empty');
    assert.ok(!/#[0-9a-fA-F]{3}/.test(FILE_BADGES[key]), key + ' hard-codes a colour');
  }
  const img = treeIcon('shot.png', 'file', false);
  assert.match(img, /stroke="currentColor"/);
  assert.match(img, /var\(--tree-fill-file\)/);
  assert.match(img, /viewBox="0 0 13 14"/, 'same box as the plain page — no row shifts');
});

test('a badged file does not also draw the plain text lines', () => {
  const code = treeIcon('app.js', 'file', false);
  assert.equal(code.includes('M4 7 L9 7'), false);
});
