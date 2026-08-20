import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsPath = path.join(root, 'src/renderer/vendor/markdown-editor.mjs');
const cssPath = path.join(root, 'src/renderer/vendor/markdown-editor.css');

test('the lazy rich editor assets are committed and stay below their ceiling', () => {
  assert.equal(fs.existsSync(jsPath), true);
  assert.equal(fs.existsSync(cssPath), true);
  const js = fs.readFileSync(jsPath);
  const css = fs.readFileSync(cssPath);
  assert.ok(js.length > 100_000, 'the generated editor bundle looks empty');
  assert.ok(css.length > 5_000, 'the generated editor styles look empty');
  assert.ok(zlib.gzipSync(Buffer.concat([js, css])).length < 900_000, 'the rich editor exceeded its lazy bundle ceiling');
});

test('Read mode does not statically import the rich editor bundle', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  assert.doesNotMatch(app, /^import .*vendor\/markdown-editor/m,
    'the rich bundle must be loaded dynamically only when Edit opens');
});

test('the adapter shares one lazy import and one stylesheet across cards', () => {
  const adapter = fs.readFileSync(path.join(root, 'src/renderer/markdown-rich.mjs'), 'utf8');
  assert.match(adapter, /import\('\.\/vendor\/markdown-editor\.mjs'\)/);
  assert.match(adapter, /markdown-editor\.css/);
  assert.match(adapter, /modulePromise/);
  assert.match(adapter, /stylePromise/);
  assert.match(adapter, /export async function mountMarkdownEditor/);
});

test('the trimmed editor preserves Nami highlight and colour markdown', () => {
  const entry = fs.readFileSync(path.join(root, 'scripts/markdown-editor-entry.mjs'), 'utf8');
  assert.match(entry, /\$markSchema\('namiHighlight'/);
  assert.match(entry, /\$markSchema\('namiColour'/);
  assert.match(entry, /namiHighlight:.*==/s);
  assert.match(entry, /namiColour:.*<span style=/s);
  assert.match(entry, /label: 'Highlight'/);
  assert.match(entry, /label: 'Coral text'/);
});

test('the block menu omits image creation while existing Markdown images still render', () => {
  const entry = fs.readFileSync(path.join(root, 'scripts/markdown-editor-entry.mjs'), 'utf8');
  assert.match(entry, /addFeature\(imageBlock/);
  assert.match(entry, /advancedGroup:\s*\{[^}]*image:\s*null/s);
});
