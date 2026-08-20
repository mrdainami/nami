import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'src/renderer/vendor');
fs.mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'scripts/markdown-editor-entry.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome140'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: path.join(outdir, 'markdown-editor.mjs'),
});

const js = fs.readFileSync(path.join(outdir, 'markdown-editor.mjs'));
const css = fs.readFileSync(path.join(outdir, 'markdown-editor.css'));
const summary = {
  js: js.length,
  css: css.length,
  gzip: zlib.gzipSync(Buffer.concat([js, css])).length,
};
console.log(`markdown editor: ${summary.js} B JS + ${summary.css} B CSS; ${summary.gzip} B gzip`);

// A regression guard, not a target. The chosen feature set is far below this;
// crossing it means a new editor subsystem slipped into the bundle unnoticed.
if (summary.gzip > 900_000) throw new Error('markdown editor bundle exceeds the 900 KB gzip ceiling');
