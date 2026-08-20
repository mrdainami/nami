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
