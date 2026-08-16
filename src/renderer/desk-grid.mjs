// The desk's column arithmetic, kept out of app.js so it can be checked without
// a window.
//
// The desk used to be `repeat(auto-fill, minmax(470px, 1fr))`, which at ordinary
// laptop widths lays two tracks — so a card could be normal or full width and
// nothing in between, and full width is what ⤢ already does. Sizing a card needs
// finer tracks than that.
//
// Halving the track alone is wrong: 235px lands on FIVE columns at 1600px, which
// wastes one per row forever and drops the default card from 623px to 494px, so
// every desk that nobody ever dragged would visibly change. The count has to be
// even, and it has to be twice what auto-fill would have chosen.
//
// Then a card spanning two of the new tracks is arithmetically the card you have
// today. With n = the old count and W the inner width:
//
//     old track   = (W - (n-1)·GAP) / n           =  W/n - GAP + GAP/n
//     new span-2  = 2·(W - (2n-1)·GAP) / 2n + GAP =  W/n - GAP + GAP/n
//
// The same expression — not close, identical, at every width and every n. Rows
// work the same way: ROW·2 + GAP is the 440px a tile is today.

export const COL_MIN = 470;   // the old auto-fill minimum
export const GAP = 20;        // .grid's gap, and .tile's row gap
export const ROW = 210;       // ROW·2 + GAP === 440, the old .tile height
export const MIN_COLS = 2;    // one card's worth, so a very narrow window still works

// What auto-fill would have chosen, given the width inside the padding.
export function autoFillColumns(inner) {
  if (!(inner > 0)) return 1;
  return Math.max(1, Math.floor((inner + GAP) / (COL_MIN + GAP)));
}

// What the desk uses now: twice that, so a default card spans two.
export function deskColumns(inner) {
  return Math.max(MIN_COLS, autoFillColumns(inner) * 2);
}

// Width of one card spanning `span` of `cols` tracks. Used by the tests to prove
// parity, and by nothing at runtime — the browser does this arithmetic itself.
export function spanWidth(inner, cols, span) {
  const track = (inner - (cols - 1) * GAP) / cols;
  return track * span + GAP * (span - 1);
}

// A card asks for a size and keeps asking for it. What it gets is whatever fits
// the window it is in right now — so a 4-wide card on a narrowed window renders
// at 2 and returns to 4 when the window is widened again. Storing the clamped
// value instead is what would make narrowing the window destroy the layout.
export function clampSpan(span, cols) {
  const n = Math.round(Number(span));
  // Anything that is not a real span — missing, zero, negative, not a number —
  // is a desk saved before spans existed, or a corrupt one. Both want the
  // default card, which is what makes restoring an old state.json a no-op.
  if (!Number.isFinite(n) || n < 1) return Math.min(cols, MIN_COLS);
  return Math.min(cols, n);
}

// Rows are not bounded by the window the way columns are — the desk scrolls —
// so the only limit is one that keeps a card from swallowing the whole view by
// accident. Six rows is three cards tall.
export const MAX_ROWS = 6;
export function clampRows(span) {
  const n = Math.round(Number(span));
  if (!Number.isFinite(n) || n < 1) return MIN_COLS;
  return Math.min(MAX_ROWS, n);
}
