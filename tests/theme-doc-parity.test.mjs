// The document surfaces, asked the same question tests/theme-overlay-parity.test.mjs
// asks the overlays: did every theme that dressed the old surface remember to
// dress the new one beside it?
//
// paper.css is the base. A theme converts it by naming what it restyles, so a
// surface a sheet never names silently keeps paper's clothes — cream fill,
// square corners, a warm brown offset shadow — inside a dark desk. That is
// invisible in review and obvious the moment somebody opens it.
//
// This is a parity check, not a pixel check. It says nothing about WHICH
// border or fill a theme picks, only that it made a choice for both.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// paper.css is deliberately absent: it is the base every sheet below converts.
const THEMES = ['theme-glass.css', 'theme-graphite.css', 'theme-operator.css',
  'theme-soft.css', 'theme-dusk.css'];

// Innermost { } pairs only, which is exactly what a rule is — the pattern
// cannot cross a brace, so a rule nested in @media is found and its wrapper
// ignored. Same parser as tests/theme-overlay-parity.test.mjs.
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

// Two sheets carry the glass family's structure between them — theme-glass.css
// holds every body[data-glass] rule and theme-graphite.css is a pure token
// remap — so a family is asked the question once, as one unit. Dusk reads with
// soft for the same reason.
const FAMILY = { 'theme-graphite.css': 'theme-glass.css', 'theme-dusk.css': 'theme-soft.css' };

function sheetsFor(name) {
  return [name, FAMILY[name]].filter(Boolean)
    .map((f) => fs.readFileSync(path.join(ROOT, 'src/renderer', f), 'utf8'));
}
function covers(sheets, re) {
  return sheets.some((css) => rules(css).some((r) => re.test(r.selector)));
}

test('a theme that restyles the editor foot bar also restyles the changed-on-disk bar', () => {
  const missing = [];
  for (const name of THEMES) {
    const sheets = sheetsFor(name);
    if (!covers(sheets, /\.ed-bar\b/)) continue;      // this theme leaves the editor's strips alone
    if (covers(sheets, /\.disk-bar\b/)) continue;
    missing.push(name);
  }
  assert.deepEqual(missing, [], missing.length
    ? `These themes convert .ed-bar but leave .disk-bar on paper's shell:\n  ${missing.join('\n  ')}\n\n`
      + 'The two are the same kind of thing — a flat strip across the width of a\n'
      + 'file tile. Add .disk-bar to the same rule that gives .ed-bar its border\n'
      + 'and fill, or the bar keeps paper\'s dashed amber line inside your theme.\n' : undefined);
});

test('nothing about the disk bar is written as a literal colour', () => {
  // Every colour in it comes from the amber family, which all six themes define
  // with the right polarity — including operator, where the family is red and
  // that is correct. A hex here would survive the theme switch and read as a
  // patch of somebody else's desk.
  const files = ['paper.css', ...THEMES];
  const bad = [];
  for (const name of files) {
    const css = fs.readFileSync(path.join(ROOT, 'src/renderer', name), 'utf8');
    for (const r of rules(css)) {
      if (!/\.disk-bar\b/.test(r.selector)) continue;
      // rgba() inside a box-shadow is a shadow, not a colour choice, and paper
      // writes every one of those inline; the ban is on naming a hue.
      const decls = r.body.replace(/box-shadow\s*:[^;]*;?/g, '');
      if (/#[0-9a-f]{3,8}\b/i.test(decls) || /\brgba?\(/.test(decls)) bad.push(`${name}: ${r.selector}`);
    }
  }
  assert.deepEqual(bad, [], bad.length
    ? `Literal colours in a .disk-bar rule:\n  ${bad.join('\n  ')}\n\n`
      + 'Use --amber-bg / --amber-line / --amber-ink / --amber-body /\n'
      + '--amber-btn-line. Every theme defines all five.\n' : undefined);
});

test('the disk bar wraps rather than overflowing at split-view width', () => {
  // Split view goes to 320px. A message and two buttons do not share a line
  // there, and a strip that will not wrap pushes its buttons off the tile.
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/paper.css'), 'utf8');
  const bar = rules(css).find((r) => r.selector === '.disk-bar');
  assert.ok(bar, '.disk-bar has a rule in paper.css');
  assert.match(bar.body, /flex-wrap:\s*wrap/, 'flex-wrap: wrap is not optional here');
});

// `hidden` is the weakest rule in the cascade. The UA stylesheet's
// `[hidden] { display: none }` loses to any author `display:` on the same
// element, so a component authored hidden and styled `display: flex` simply
// never hides. Not a theory: the changed-on-disk bar shipped that way and sat
// on screen for the whole life of a tile, with two buttons that ran and looked
// like they did nothing.
//
// The at-risk set is written down in the markup itself — an element that is
// born `hidden` is one the renderer means to toggle — so it is read from there
// rather than kept as a list somebody has to remember to update.
test('a component authored hidden is given a rule that can hide it', () => {
  const RENDERER = path.join(ROOT, 'src/renderer');
  const born = new Set();
  for (const file of fs.readdirSync(RENDERER).filter((f) => /\.(js|mjs)$/.test(f))) {
    const src = fs.readFileSync(path.join(RENDERER, file), 'utf8');
    for (const m of src.matchAll(/class="([^"]+)"[^<>]*?\shidden[\s>]/g)) {
      for (const name of m[1].split(/\s+/)) if (name) born.add(name);
    }
  }
  assert.ok(born.size, 'no hidden-at-birth components found — has the markup moved?');

  const missing = [];
  for (const file of fs.readdirSync(RENDERER).filter((f) => f.endsWith('.css'))) {
    const parsed = rules(fs.readFileSync(path.join(RENDERER, file), 'utf8'));
    const shown = new Set(), hides = new Set();
    for (const r of parsed) {
      for (const sel of r.selector.split(',')) {
        const one = sel.trim();
        const bare = one.match(/^\.([\w-]+)$/);
        if (bare && /(^|;|\s)display:\s*(flex|grid|block|inline-flex|inline-block)/.test(r.body)) shown.add(bare[1]);
        const off = one.match(/\.([\w-]+)\[hidden\]/);
        if (off) hides.add(off[1]);
      }
    }
    for (const name of shown) if (born.has(name) && !hides.has(name)) missing.push(file + ' \u2192 .' + name);
  }
  assert.deepEqual(missing, [], 'styled with display: but nothing makes hidden win: ' + missing.join(', '));
});
