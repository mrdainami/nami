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
  assert.match(app, /if \(p && p\.dirty\)[\s\S]{0,180}await saveEditor\(p\)[\s\S]{0,180}api\.openFileInBrowser/);
  assert.match(app, /Save &amp; open ↗/);
});
