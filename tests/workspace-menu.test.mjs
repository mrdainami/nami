// Two things a right-click on a workspace row can now do, both built from
// plumbing that already existed: the text a drag types into a session, and
// the window:new channel every window is born through.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathRef } from '../src/renderer/file-kinds.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const menu = app.slice(app.indexOf('function treeMenu('), app.indexOf('\n}', app.indexOf('function treeMenu(')));

test('a workspace row offers Add to session and Open in new window', () => {
  assert.match(menu, /label: 'Add to session'/);
  assert.match(menu, /label: 'Open in new window'/);
});

test('a file goes to the session as the same text a drag would type', () => {
  assert.match(app, /function addPathToSession/);
  assert.match(app, /pathRef\(path, S\.project && S\.project\.path, isDir\)/);
  // the reference itself: mention inside the project, quoted path outside
  assert.equal(pathRef('/w/p/notes.md', '/w/p', false), '@notes.md ');
  assert.equal(pathRef('/w/p/src', '/w/p', true), '@src/ ');
  assert.equal(pathRef('/elsewhere/a b.md', '/w/p', false), "'/elsewhere/a b.md' ");
});

test('a new window opens on the folder, and a file lands on its desk', () => {
  assert.match(menu, /api\.newWindow\(n\.path\)/);
  assert.match(menu, /api\.newWindow\(parentDir \|\| root, n\.path\)/);
});
