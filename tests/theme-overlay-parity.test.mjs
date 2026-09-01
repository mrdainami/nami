// The quick start panel (.qs-box) shipped for months looking like cream paper
// inside glass, graphite and operator: square corners, a warm brown offset
// shadow, a Caveat heading and blue ruled lines, on themes that had removed all
// four everywhere else. Nothing was miscoloured — the surface had simply never
// been added to the lists each theme file maintains for its own overlays.
//
// paper.css is the base; a theme converts it by naming the surfaces it restyles.
// Miss one and it silently keeps paper's clothes, which is invisible in review
// and obvious the moment someone opens it. So the rule is written down here
// rather than remembered: a theme that converts the modal must convert the
// quick start panel too, and a theme that converts one overlay heading off
// Caveat must convert the other.
//
// This is a parity check, not a pixel check. It says nothing about WHICH radius
// or face a theme picks — only that it made a choice for both surfaces.

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
// ignored. Same parser as tests/editor-underlay.test.mjs.
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

// A sheet "covers" a selector when any rule in it names that selector. Two
// sheets carry the glass family's structure between them — theme-glass.css
// holds every body[data-glass] rule and theme-graphite.css is a pure token
// remap — so the family is asked the question once, as one unit.
const FAMILY = { 'theme-graphite.css': 'theme-glass.css', 'theme-dusk.css': 'theme-soft.css' };

function covers(sheets, re) {
  return sheets.some((css) => rules(css).some((r) => re.test(r.selector)));
}

function sheetsFor(name) {
  const files = [name, FAMILY[name]].filter(Boolean);
  return files.map((f) => fs.readFileSync(path.join(ROOT, 'src/renderer', f), 'utf8'));
}

test('a theme that restyles the modal also restyles the quick start panel', () => {
  const missing = [];
  for (const name of THEMES) {
    const sheets = sheetsFor(name);
    if (!covers(sheets, /\.modal\b/)) continue;      // this theme leaves overlays alone
    if (covers(sheets, /\.qs-box\b/)) continue;
    missing.push(name);
  }
  assert.deepEqual(missing, [], missing.length
    ? `These themes convert .modal but leave .qs-box on paper's shell:\n  ${missing.join('\n  ')}\n\n`
      + 'The ? panel is an overlay like any other. Add .qs-box to the same rule\n'
      + 'that gives .modal / .picker-box / .setup-box / .peek-box their radius,\n'
      + 'fill and shadow, or the panel keeps paper\'s square corners and its\n'
      + '10px 12px 0 brown offset shadow inside your theme.\n' : undefined);
});

test('a theme that takes one overlay heading off Caveat takes both', () => {
  const missing = [];
  for (const name of THEMES) {
    const sheets = sheetsFor(name);
    if (!covers(sheets, /\.modal-head\s+\.title\b/)) continue;
    if (covers(sheets, /\.qs-head\s+\.title\b/)) continue;
    missing.push(name);
  }
  assert.deepEqual(missing, [], missing.length
    ? `These themes convert .modal-head .title but not .qs-head .title:\n  ${missing.join('\n  ')}\n\n`
      + 'Both are overlay headings set in Caveat by paper.css. A theme that\n'
      + 'moves one to its own face has to move the other, or the ? panel is the\n'
      + 'single cursive heading left in the app.\n' : undefined);
});

test('the ruled-paper texture stays in the paper theme', () => {
  // .qs-body's repeating-linear-gradient draws blue rules for the words to sit
  // on. That is paper's texture; on any other ground it reads as banding. A
  // theme that converts the panel has to switch it off explicitly, because
  // paper.css sets it on .qs-body itself and nothing else will.
  const offenders = [];
  for (const name of THEMES) {
    const sheets = sheetsFor(name);
    if (!covers(sheets, /\.qs-box\b/)) continue;     // panel not converted; the test above says so
    const off = sheets.some((css) => rules(css).some((r) =>
      /\.qs-body\b/.test(r.selector) && /background-image\s*:\s*none/.test(r.body)));
    if (!off) offenders.push(name);
  }
  assert.deepEqual(offenders, [], offenders.length
    ? `These themes convert .qs-box but leave paper's ruled lines drawn:\n  ${offenders.join('\n  ')}\n\n`
      + 'Add `background-image: none` to .qs-body. The 24px baseline stays as\n'
      + 'rhythm; it just stops being painted.\n' : undefined);
});
