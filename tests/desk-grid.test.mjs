import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoFillColumns, deskColumns, spanWidth, clampSpan, clampRows,
  COL_MIN, GAP, ROW, MIN_COLS, MAX_ROWS,
} from '../src/renderer/desk-grid.mjs';

// The inner width of .grid at a few real window sizes: window minus the rail
// minus 26px of padding each side. Approximate as window sizes, exact as the
// numbers the parity check runs on — parity is a property of the arithmetic, so
// it has to hold at any width, not just at these.
const WIDTHS = [900, 1180, 1280, 1388, 1440, 1512, 1600, 1728, 1920, 2240, 2560, 3440];

test('the desk always has an even number of columns', () => {
  for (const w of WIDTHS) {
    assert.equal(deskColumns(w) % 2, 0, `${w}px gave an odd column count`);
  }
});

test('a card spanning two columns is exactly the card we have today', () => {
  for (const w of WIDTHS) {
    const before = spanWidth(w, autoFillColumns(w), 1);   // one auto-fill track
    const after = spanWidth(w, deskColumns(w), 2);        // two of the new ones
    assert.ok(Math.abs(before - after) < 1e-9,
      `at ${w}px: was ${before.toFixed(4)}px, now ${after.toFixed(4)}px`);
  }
});

test('parity is not a coincidence at nice numbers — it holds every pixel', () => {
  for (let w = 480; w <= 3600; w++) {
    const before = spanWidth(w, autoFillColumns(w), 1);
    const after = spanWidth(w, deskColumns(w), 2);
    if (Math.abs(before - after) > 1e-9) {
      assert.fail(`width ${w}px breaks parity: ${before} vs ${after}`);
    }
  }
});

test('halving the track would give odd counts; doubling the count cannot', () => {
  // The obvious way to get finer tracks is to halve the 470px minimum. It does
  // not work: an odd count wastes a column on every row forever, and shrinks the
  // default card. Doubling what auto-fill chose is the version that cannot.
  const naive = (inner) => Math.max(1, Math.floor((inner + GAP) / (235 + GAP)));
  let odd = 0;
  for (let w = 480; w <= 2600; w++) {
    if (naive(w) % 2 === 1) odd++;
    assert.equal(deskColumns(w) % 2, 0, `${w}px gave an odd count`);
  }
  assert.ok(odd > 500, `odd counts under the naive halving are common, not a corner case (${odd})`);

  // A 1600px window with the rail open is about 1298px inside the grid, and it
  // is one of them: five columns, so a row can never be filled evenly.
  assert.equal(naive(1298), 5);
  assert.equal(deskColumns(1298), 4);
});

test('two rows of ROW plus one gap is the height a tile is today', () => {
  assert.equal(ROW * 2 + GAP, 440);
});

test('a very narrow window still lays two columns, so a card can exist', () => {
  assert.equal(deskColumns(100), MIN_COLS);
  assert.equal(deskColumns(0), MIN_COLS);
  assert.equal(deskColumns(-5), MIN_COLS);
});

test('the column count only ever grows with the window', () => {
  let last = 0;
  for (let w = 200; w <= 4000; w += 7) {
    const c = deskColumns(w);
    assert.ok(c >= last, `columns went down from ${last} to ${c} at ${w}px`);
    last = c;
  }
});

test('COL_MIN is the auto-fill minimum the desk used to declare', () => {
  assert.equal(COL_MIN, 470);
  assert.equal(GAP, 20);
});

// ---- spans -------------------------------------------------------------------

test('a span is clamped to what fits, and the ask is not destroyed', () => {
  assert.equal(clampSpan(4, 8), 4);
  assert.equal(clampSpan(4, 2), 2, 'a 4-wide card on a 2-column desk renders at 2');
  assert.equal(clampSpan(4, 4), 4, 'and is itself again as soon as it fits');
});

test('anything that is not a real span reads as the default card', () => {
  // A desk saved before spans existed carries no span at all, and that is the
  // whole of the migration: it comes back as the card it was.
  for (const bad of [undefined, null, '', 'nonsense', 0, -3, NaN]) {
    assert.equal(clampSpan(bad, 8), MIN_COLS, `${String(bad)} should read as the default`);
  }
});

test('a span arriving as a string still works — state.json is JSON', () => {
  assert.equal(clampSpan('4', 8), 4);
});

test('rows are capped so a card cannot swallow the desk by accident', () => {
  assert.equal(clampRows(1), 1);
  assert.equal(clampRows(2), 2);
  assert.equal(clampRows(MAX_ROWS), MAX_ROWS);
  assert.equal(clampRows(MAX_ROWS + 5), MAX_ROWS);
});

test('a broken row count reads as the default too', () => {
  for (const bad of [undefined, null, '', 'x', 0, -2, NaN]) {
    assert.equal(clampRows(bad), MIN_COLS, `${String(bad)} should read as the default`);
  }
});

test('rows do not depend on the window — only columns do', () => {
  // A narrow window clamps a wide card; it must not also flatten a tall one,
  // because the desk scrolls vertically and the height still fits.
  assert.equal(clampSpan(4, 2), 2);
  assert.equal(clampRows(4), 4);
});
