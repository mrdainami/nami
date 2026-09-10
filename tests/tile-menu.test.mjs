// One right-click menu for every open tab — desk, split, or the tab strip —
// built from the tile itself. Browser tiles can leave for Chrome and hand
// their address to the session; file tiles hand their path over, open a new
// window, and only an HTML file gets the Chrome line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { tileMenuItems } from '../src/renderer/tile-menu.mjs';

const calls = [];
const ctx = {
  html: (p) => /\.html?$/i.test(p.filePath || ''),
  openOutside: (p) => calls.push(['outside', p.id]),
  copy: (p) => calls.push(['copy', p.id]),
  addToSession: (p) => calls.push(['add', p.id]),
  newWindow: (p) => calls.push(['window', p.id]),
  move: () => [{ label: 'Move to desk', run() {} }],
};
const labels = (items) => items.map((i) => (typeof i === 'string' ? i : i.label));

test('a browser tile: Chrome, copy address, add to session, then the move items', () => {
  const items = tileMenuItems({ id: 'b1', kind: 'browser', url: 'https://www.canva.com/' }, ctx);
  assert.deepEqual(labels(items), ['Open in Chrome ↗', 'Copy address', 'Add to session', '-', 'Move to desk']);
});

test('a markdown tile: add to session, copy path, new window — no Chrome line', () => {
  const items = tileMenuItems({ id: 'f1', kind: 'editor', filePath: '/w/p/notes.md' }, ctx);
  assert.deepEqual(labels(items), ['Add to session', 'Copy path', 'Open in new window', '-', 'Move to desk']);
});

test('an html tile gets the Chrome line too, after the file verbs', () => {
  const items = tileMenuItems({ id: 'f2', kind: 'editor', filePath: '/w/p/page.html' }, ctx);
  assert.deepEqual(labels(items), ['Add to session', 'Copy path', 'Open in new window', 'Open in Chrome ↗', '-', 'Move to desk']);
});

test('a blank browser tab has nowhere to go and nothing to copy', () => {
  const items = tileMenuItems({ id: 'b2', kind: 'browser', url: 'about:blank' }, ctx);
  assert.deepEqual(labels(items), ['Move to desk']);
});

test('every item runs the verb it names, with the tile', () => {
  calls.length = 0;
  const items = tileMenuItems({ id: 'f2', kind: 'editor', filePath: '/w/p/page.html' }, ctx);
  for (const i of items) if (typeof i !== 'string' && i.label !== 'Move to desk') i.run();
  assert.deepEqual(calls, [['add', 'f2'], ['copy', 'f2'], ['window', 'f2'], ['outside', 'f2']]);
});

test('no move items means no dangling divider', () => {
  const items = tileMenuItems({ id: 'f1', kind: 'editor', filePath: '/w/p/notes.md' }, { ...ctx, move: () => [] });
  assert.deepEqual(labels(items), ['Add to session', 'Copy path', 'Open in new window']);
});
