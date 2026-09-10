import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.resolve(dir, '../src/renderer/app.js'), 'utf8');

test('HTML browser actions exist in the tree, peek head, and pinned editor', () => {
  assert.match(app, /fileKind\(n\.path\) === 'html'[\s\S]{0,180}Open in browser/);
  assert.match(app, /class="btn pk-browser"/);
  assert.match(app, /class="btn ed-browser"/);
});

test('opening a dirty HTML panel saves before invoking the browser channel', () => {
  assert.match(app, /if \(p && p\.dirty\)[\s\S]{0,180}await saveEditor\(p\)[\s\S]{0,180}browsers\.open/);
  assert.match(app, /Save &amp; open in Chrome ↗/);
});

test('the ↗ buttons leave for Chrome; the tree offers both the tile and Chrome', () => {
  assert.match(app, /function bindBrowserButton[\s\S]{0,200}button\.onclick = \(\) => openOutside\(p\)/);
  assert.match(app, /Open in browser'[\s\S]{0,120}Open in Chrome ↗/);
  // a dirty page is saved before Chrome reads the file
  assert.match(app, /async function openOutside[\s\S]{0,200}if \(p\.dirty && !\(await saveEditor\(p\)\)\) return;[\s\S]{0,80}api\.openFileInBrowser/);
});

test('pinning an HTML peek pins the rendered page, not its source', () => {
  const pin = app.slice(app.indexOf('async function pinPeek'), app.indexOf('\n}', app.indexOf('async function pinPeek')));
  assert.match(pin, /fileKind\(p\.filePath\) === 'html'[\s\S]*browsers\.open\('about:blank', p\.filePath, owner\)/);
  assert.match(pin, /pinFilePanel\(p\)/, 'every other file still pins as itself');
});

test('the browser tile menu and the split tab strip carry the tile menu', () => {
  const pane = fs.readFileSync(path.resolve(dir, '../src/renderer/browser-pane.mjs'), 'utf8');
  assert.match(pane, /const actions = \[\s*\['Open in Chrome \\u2197', \(\) => openOutside\(p\)\]/);
  assert.match(pane, /b\.oncontextmenu=[\s\S]{0,160}tileMenu\(x\)/);
  assert.match(app, /if \(isFilePanel\(p\)\) head\.oncontextmenu = [^\n]*tileMenu\(p\)/);
});
