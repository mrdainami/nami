// The markdown editor paints its text twice and stacks the two layers: a
// transparent <textarea> holding the caret, over a <pre> painting the colours.
// Every character lines up only while both layers lay out identically, and
// nothing in CSS said so — a single `font-size` on a heading span put the caret
// four characters away from the letter it appeared to sit on. You clicked a
// word you could see and backspace ate a different one.
//
// So the rule is written down here instead of remembered: a declaration that
// changes where a glyph lands must apply to BOTH layers or NEITHER. Colour,
// weight and slant are deliberately allowed — each measured at 0.0px of drift,
// because Courier Prime's four vendored faces share one advance width — and the
// editor would lose its syntax colouring without them.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { highlightMarkdown } from '../src/renderer/md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = ['paper.css', 'theme-glass.css', 'theme-operator.css', 'theme-graphite.css'];

// Anything that changes how wide a glyph is, or where the line box puts it.
// font-weight, font-style, color, background and text-decoration are absent on
// purpose: they paint, they do not move.
const MOVES_GLYPHS = [
  'font', 'font-size', 'font-family', 'font-stretch', 'font-variant',
  'letter-spacing', 'word-spacing', 'line-height', 'white-space', 'tab-size',
  'text-transform', 'text-indent', 'word-break', 'overflow-wrap',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'transform', 'zoom',
];

// Innermost { } pairs only, which is exactly what a rule is — the pattern cannot
// cross a brace, so a rule nested in @media is found and its wrapper ignored.
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

function declares(body) {
  return body.split(';')
    .map((d) => d.split(':')[0].trim().toLowerCase())
    .filter(Boolean);
}

test('nothing moves the glyphs of one editor layer without the other', () => {
  const offenders = [];
  for (const sheet of SHEETS) {
    const css = fs.readFileSync(path.join(ROOT, 'src/renderer', sheet), 'utf8');
    for (const rule of rules(css)) {
      const hitsUnderlay = /\.ed-hl\b/.test(rule.selector);
      const hitsTextarea = /\.ed-area\b/.test(rule.selector);
      if (!hitsUnderlay && !hitsTextarea) continue;
      if (hitsUnderlay && hitsTextarea) continue;       // shared: that is the mechanism
      for (const prop of declares(rule.body).filter((p) => MOVES_GLYPHS.includes(p))) {
        offenders.push(`${sheet}  ${rule.selector}  declares  ${prop}`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.length
    ? `These move one layer's glyphs and not the other's:\n  ${offenders.join('\n  ')}\n\n`
      + 'The caret lives in .ed-area; the letters you see are painted by .ed-hl.\n'
      + 'Anything that changes glyph width or position has to be declared for both\n'
      + '(the `.ed-hl, .ed-area` rule) or for neither. Colour, font-weight and\n'
      + 'font-style are safe and stay allowed.'
    : '');
});

// The other half of the same contract, and the half that was already right: the
// underlay has to reproduce the source character for character, or the layers
// cannot line up no matter what the CSS says. Nothing checked it until now.
test('the highlighter reproduces its input exactly', () => {
  const sample = [
    '# A heading with **bold** in it',
    '',
    'A paragraph with `code`, a [link](https://example.com/a?b=1&c=2),',
    '*emphasis*, ~~struck~~ and a bare https://example.com/x URL.',
    '',
    '> a quote with <tags> & an ampersand and a "quoted" phrase',
    '',
    '- bullet one',
    '2) ordered, closing paren',
    '',
    '---',
    '',
    '```js',
    'const s = "<script>" + a & b;',
    '```',
    '',
    '###### deepest heading',
  ].join('\n');

  const text = highlightMarkdown(sample)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');          // last, or an escaped entity unescapes twice

  // highlightMarkdown appends one newline on purpose, so the layer does not
  // scroll short of the textarea it sits behind
  assert.equal(text, sample + '\n');
});
