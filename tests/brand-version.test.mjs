// The version caption under the wordmark. It is decoration with a fact in it,
// and both halves of that are load-bearing.
//
// The fact: it must keep following whatever shipped. `boot()` already carries
// app.getVersion() into the renderer as S.version, so the label is correct for
// free — but only while it is fed from there. A literal version string in the
// markup would look identical on the day it was written and be a lie by the
// next release, so this file refuses one.
//
// The decoration: it must stay quiet, and it must not disturb the lockup it
// hangs off. `.brand` is 26px and the mascot and wordmark share a centre line
// inside it; a caption that takes part in that flow pushes the wordmark up.
// Absolute positioning is what keeps it out of the flow, so that is asserted
// rather than assumed. Geometry beyond that — the 2.5-3.3px gap under the ink,
// the sub-pixel left alignment — was measured in a real engine at build time
// and cannot be re-measured from static text; what is checked here is the
// structure those measurements depend on.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SHEETS = ['paper.css', 'theme-glass.css', 'theme-operator.css', 'theme-graphite.css'];

// Innermost { } pairs only — the pattern cannot cross a brace, so a rule nested
// in @media is found and its wrapper ignored. (Same reader as editor-underlay.)
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}
const decl = (body, prop) => {
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(body);
  return m ? m[1].trim() : null;
};

test('the caption is fed by the running version, never a literal', () => {
  const app = read('src/renderer/app.js');

  // the slot exists in the shell, and it ships empty
  assert.match(app, /<span class="brand-ver" id="brand-ver"><\/span>/,
    'the .brand-ver span should be rendered empty by buildShell and filled at boot');

  // and it is filled from S.version, which boot() takes from app.getVersion()
  const fill = /brand-ver'\);[\s\S]{0,120}?textContent\s*=\s*([^;]+);/.exec(app);
  assert.ok(fill, 'boot() should set #brand-ver textContent');
  assert.match(fill[1], /S\.version/,
    `#brand-ver is filled from \`${fill && fill[1].trim()}\` — it has to come from S.version, `
    + 'which boot() carries from app.getVersion(). Anything else stops following releases.');

  // no hardcoded dotted version anywhere near the brand markup
  const brand = app.slice(app.indexOf('class="brand-stack"'), app.indexOf('class="brand-sub"'));
  assert.doesNotMatch(brand, /\d+\.\d+\.\d+/,
    'a literal version in the brand markup is a lie as of the next release');
});

test('the caption hangs off the lockup instead of standing in it', () => {
  const paper = read('src/renderer/paper.css');
  const ver = rules(paper).find((r) => r.selector === '.brand-ver');
  const stack = rules(paper).find((r) => r.selector === '.brand-stack');

  assert.ok(ver && stack, 'paper.css should define .brand-stack and .brand-ver');
  assert.equal(decl(ver.body, 'position'), 'absolute',
    'A .brand-ver in normal flow makes the lockup two lines tall. `.brand` is 26px, '
    + 'so the wordmark rises to make room and loses the centre line it shares with '
    + 'the mascot. It has to be out of flow.');
  assert.equal(decl(stack.body, 'position'), 'relative',
    '.brand-stack is what the absolute caption is positioned against');

  // it must not swallow clicks in the topbar's drag region
  assert.equal(decl(ver.body, 'pointer-events'), 'none',
    'the caption sits over the topbar drag region; it must not catch the pointer');
});

test('the caption stays quieter and smaller than the tagline it ranks with', () => {
  const paper = read('src/renderer/paper.css');
  const all = rules(paper);
  const size = (sel) => parseFloat(decl(all.find((r) => r.selector === sel).body, 'font-size'));

  assert.ok(size('.brand-ver') < size('.brand-sub'),
    `the version (${size('.brand-ver')}px) must stay smaller than the tagline (${size('.brand-sub')}px) — `
    + 'it is the least important thing in the topbar');

  const color = decl(all.find((r) => r.selector === '.brand-ver').body, 'color');
  assert.match(color, /var\(--(faint|muted-3)\)/,
    `the caption is ${color}; it should use the muted end of the ink scale, never --ink`);
});

test('the caption never outlives the tagline when the window narrows', () => {
  const paper = read('src/renderer/paper.css');
  // the @media block that hides .brand-sub must hide .brand-ver too
  const blocks = [...paper.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[0]);
  const hidesSub = blocks.find((b) => /\.brand-sub\s*\{\s*display:\s*none/.test(b));
  assert.ok(hidesSub, 'paper.css should still hide .brand-sub at a breakpoint');
  assert.match(hidesSub, /\.brand-ver\s*\{\s*display:\s*none/,
    'The topbar sheds things in priority order as it narrows, and the version is the '
    + 'least essential of them. It has to go with the tagline — leaving it behind means '
    + 'the last thing standing in a cramped topbar is a version number.');
});

test('every theme that restyles the wordmark also places the caption', () => {
  // A theme that changes .brand-name's font without saying anything about
  // .brand-ver leaves the caption in the previous theme's face, and the 2px
  // paper uses for Caveat's side bearing misaligns it under a mono or dot N.
  const missing = [];
  for (const sheet of SHEETS) {
    const css = read(path.join('src/renderer', sheet));
    if (sheet === 'paper.css') continue;                       // paper is the base
    const restyles = rules(css).some((r) => /\.brand-name\b/.test(r.selector)
      && (decl(r.body, 'font-family') || decl(r.body, 'font-size')));
    if (!restyles) continue;
    if (!/\.brand-ver\b/.test(css)) missing.push(sheet);
  }
  assert.deepEqual(missing, [], missing.length
    ? `${missing.join(', ')} restyle(s) .brand-name but never places .brand-ver.\n`
      + 'graphite is exempt only because it inherits the glass rules via body[data-glass].'
    : '');
});
