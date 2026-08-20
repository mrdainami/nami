import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/renderer/paper.css'), 'utf8');

test('plain Markdown cards expose Read, Edit, and Markdown without affecting MDX', () => {
  assert.match(app, /richMarkdownPath\(p\.filePath\)/);
  assert.match(app, /data-m="markdown">Markdown/);
  assert.match(app, /mountMarkdownEditor\(/);
  assert.match(app, /class="ed-rich/);
});

test('media creation is deliberately absent until its interaction is ready', () => {
  assert.doesNotMatch(app, /class="ed-add/);
  assert.doesNotMatch(app, /class="ed-asset-pop/);
  assert.doesNotMatch(app, /api\.chooseFile\(/);
  assert.doesNotMatch(app, /api\.importMarkdownAsset\(/);
});

test('rich and source panes are mutually exclusive and theme-token driven', () => {
  assert.match(css, /editor--rich\[data-mode="edit"\] \.ed-pane/);
  assert.match(css, /editor--rich\[data-mode="markdown"\] \.ed-rich/);
  assert.match(css, /\.ed-rich[^}]*var\(--ink\)/s);
  assert.doesNotMatch(css, /\.ed-rich[^}]*#[0-9a-f]{3,8}/is);
});
