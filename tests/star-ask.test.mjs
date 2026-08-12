import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// app.js is a browser module that touches document on import, so the rules are
// read out of the source rather than imported — the same approach the other
// renderer tests take. What matters here is that the gate cannot regress into
// asking twice, and that is a property of the code, not of a DOM.
const src = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');

// starAskDue is written pure precisely so it can be lifted out and exercised.
const starAskDue = (() => {
  const body = src.match(/function starAskDue\(\{ asked, launches \}\) \{([\s\S]*?)\n\}/)[1];
  const after = Number(src.match(/const ASK_AFTER_LAUNCHES = (\d+)/)[1]);
  return new Function('ASK_AFTER_LAUNCHES', `return function starAskDue({ asked, launches }) {${body}\n}`)(after);
})();

test('nobody is asked before they have come back', () => {
  for (const launches of [1, 2, 3, 4]) {
    assert.equal(starAskDue({ asked: null, launches }), false, `asked on launch ${launches}`);
  }
  assert.equal(starAskDue({ asked: null, launches: 5 }), true);
  assert.equal(starAskDue({ asked: null, launches: 40 }), true);
});

// The whole promise of this feature. An ask that comes back is a nag, and a nag
// in an app whose pitch is "nothing happens behind your back" costs more than
// the star is worth.
test('once answered, never again — however many launches follow', () => {
  for (const launches of [5, 6, 100]) {
    assert.equal(starAskDue({ asked: '1', launches }), false);
  }
});

test('a missing tally is not a large number', () => {
  // localStorage returns null for a key that was never set; Number(null) is 0,
  // and a NaN or a coerced-true would have asked on first launch.
  assert.equal(starAskDue({ asked: null, launches: null }), false);
  assert.equal(starAskDue({ asked: null, launches: undefined }), false);
  assert.equal(starAskDue({ asked: null, launches: '' }), false);
});

test('the tally stops growing once the ask is due, so it cannot run away', () => {
  assert.match(src, /if \(n <= ASK_AFTER_LAUNCHES\) localStorage\.setItem\(LAUNCH_TALLY/);
});

test('an update always wins the slot — a favour never displaces it', () => {
  const paint = src.match(/function paintStarAsk\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(paint, /if \(!els\.updateRoot \|\| offered \|\| localStorage\.getItem\(STAR_ASKED\)\) return;/);
});

test('dismissing and clicking through are the same answer', () => {
  const close = src.match(/function closeStarAsk\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(close, /localStorage\.setItem\(STAR_ASKED, '1'\)/);
  // the star button must mark it too, or clicking through leaves it due again
  assert.match(src, /q\('#star-go'.*\{ api\.openUrl\(REPO_URL\); closeStarAsk\(\); \}/);
});

test('demo and screenshot runs never count as somebody coming back', () => {
  const arm = src.match(/function armStarAsk\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(arm, /if \(S\.demo\) return;/);
});

// The bar is position:absolute with no max-width, so a long message walks it
// across the desk. The clip is the backstop; the point of this test is that the
// backstop is never actually reached, because a permanently ellipsised message
// looks like a bug rather than like a safety net.
test('the copy fits inside the width that stops it wrapping', () => {
  const msg = src.match(/un-msg un-ask">([^<]+)</)[1];
  const css = readFileSync(new URL('../src/renderer/paper.css', import.meta.url), 'utf8');
  const rule = css.match(/\.update-note \.un-ask \{[^}]*\}/)[0];
  const ch = Number(rule.match(/max-width: (\d+)ch/)[1]);

  assert.match(rule, /white-space: nowrap/);
  assert.match(rule, /text-overflow: ellipsis/);
  assert.ok(msg.length < ch, `copy is ${msg.length} chars but the bar clips at ${ch}ch`);
  // and the backstop still has to be a backstop, not the whole desk
  assert.ok(ch <= 70, `${ch}ch is wide enough to walk the bar across the desk`);
});
