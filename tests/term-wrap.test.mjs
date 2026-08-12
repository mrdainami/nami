import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastCol, continuesLink, leadingIndent, runBounds, MAX_JOINS } from '../src/renderer/term-wrap.mjs';

// The smallest thing that behaves like an xterm buffer line: getCell(x) with
// getChars(), and a width that pads with blanks the way a real row does. Pure
// string work in, pure answer out — the same reason term-links.mjs is testable
// without a terminal.
function line(text, cols = 40) {
  const chars = [...text];
  return {
    getCell: (x) => (x < chars.length ? { getChars: () => chars[x] } : { getChars: () => '' }),
    cols,
  };
}

const COLS = 40;
const full = (s) => s.padEnd(COLS, 'x').slice(0, COLS);

test('lastCol finds the final occupied column, ignoring the blank tail', () => {
  assert.equal(lastCol(line('abc'), COLS), 3);
  assert.equal(lastCol(line(full('a')), COLS), COLS);
  assert.equal(lastCol(line(''), COLS), 0);
  assert.equal(lastCol(line('  '), COLS), 0, 'whitespace is not occupancy');
});

test('leadingIndent counts the blanks a hanging indent puts in front', () => {
  assert.equal(leadingIndent(line('  tail'), COLS), 2);
  assert.equal(leadingIndent(line('tail'), COLS), 0);
  assert.equal(leadingIndent(line(''), COLS), COLS, 'an empty row is all indent');
});

test('a row filled to the edge with an indented link-shaped tail joins', () => {
  const a = line(full('https://claude.ai/code/artifact/84d587ad'), COLS);
  const b = line('  e9553c1', COLS);
  assert.equal(continuesLink(a, b, COLS), true);
});

test('a row with room left does not join — that break was chosen, not forced', () => {
  const a = line('https://claude.ai/x', COLS);
  const b = line('  e9553c1', COLS);
  assert.equal(continuesLink(a, b, COLS), false);
});

test('a continuation at column 0 does not join — that is a soft wrap', () => {
  // isWrapped already carries this case and wrappedRow already stitches it.
  // Joining here too would be a second mechanism for one job.
  const a = line(full('https://claude.ai/code/artifact/84d587ad'), COLS);
  const b = line('e9553c1', COLS);
  assert.equal(continuesLink(a, b, COLS), false);
});

test('a deep indent does not join — that is a new block, not a continuation', () => {
  const a = line(full('https://claude.ai/code/artifact/84d587ad'), COLS);
  const b = line('            e9553c1', COLS);
  assert.equal(continuesLink(a, b, COLS), false);
});

test('an indented sentence does not join — a tail starts with link characters', () => {
  const a = line(full('the watcher declares its whole visible'), COLS);
  const b = line('  "quoted" and then some prose', COLS);
  assert.equal(continuesLink(a, b, COLS), false);
});

test('a blank row does not join', () => {
  const a = line(full('https://claude.ai/code/artifact/84d587ad'), COLS);
  assert.equal(continuesLink(a, line('', COLS), COLS), false);
  assert.equal(continuesLink(a, line('     ', COLS), COLS), false);
});

test('a row ending on punctuation that closes does not join', () => {
  // "…(see below)" filling the row exactly is a finished thought, not a cut.
  const a = line(full('the scanner is pure string work (see it)').slice(0, COLS - 1) + ')', COLS);
  const b = line('  term-links.mjs', COLS);
  assert.equal(continuesLink(a, b, COLS), false);
});

test('a bare word tail still joins — the guard is the row edge, not the shape', () => {
  // src/renderer/very-long-name.mjs broken across rows looks exactly like this.
  const a = line(full('and the scanner lives in src/renderer/'), COLS);
  const b = line('  term-links.mjs', COLS);
  assert.equal(continuesLink(a, b, COLS), true);
});

// ---- the walk ---------------------------------------------------------------
// A stand-in buffer: rows in order, each optionally flagged isWrapped the way
// xterm flags a soft continuation.
function buffer(rows, cols = COLS) {
  const lines = rows.map(([text, wrapped]) => Object.assign(line(text, cols), { isWrapped: !!wrapped }));
  return { getLine: (i) => lines[i], length: lines.length };
}

// The real shape: a URL cut mid-token with a two-space hanging indent.
const SEVERED = [
  ['a line of prose before it', false],
  [full('https://claude.ai/code/artifact/84d587ad'), false],
  ['  e9553c1', false],
  ['a line of prose after it', false],
];

test('hovering the head row reaches down to the tail', () => {
  const { top, bottom, hard } = runBounds(buffer(SEVERED), 2, COLS);
  assert.deepEqual([top, bottom], [1, 2]);
  assert.deepEqual([...hard], [2]);
});

test('hovering the tail row reaches back up to the head', () => {
  // The fragment you can actually see is often the short one. If the walk only
  // went down, clicking the tail would resolve nothing.
  const { top, bottom, hard } = runBounds(buffer(SEVERED), 3, COLS);
  assert.deepEqual([top, bottom], [1, 2]);
  assert.deepEqual([...hard], [2]);
});

test('an ordinary row stays a row of one', () => {
  const { top, bottom, hard } = runBounds(buffer(SEVERED), 1, COLS);
  assert.deepEqual([top, bottom], [0, 0]);
  assert.equal(hard.size, 0);
});

test('a soft-wrapped run still joins, and is not counted as a hard join', () => {
  const soft = buffer([
    [full('https://claude.ai/code/artifact/84d587ad'), false],
    ['e9553c1', true],
  ]);
  const { top, bottom, hard } = runBounds(soft, 2, COLS);
  assert.deepEqual([top, bottom], [0, 1]);
  assert.equal(hard.size, 0, 'a soft wrap must not have its column 0 trimmed');
});

test('soft and hard in one run', () => {
  const mixed = buffer([
    [full('https://claude.ai/code/artifact/84d5'), false],
    [full('87ad-e24e-467a-9689'), true],
    ['  4dc8de9553c1', false],
  ]);
  const { top, bottom, hard } = runBounds(mixed, 1, COLS);
  assert.deepEqual([top, bottom], [0, 2]);
  assert.deepEqual([...hard], [2]);
});

test('the chain is capped — a justified block cannot swallow itself', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push([full('src/renderer/'), false]);
  rows.forEach((r, i) => { if (i) r[0] = '  ' + full('src/renderer/').slice(2); });
  const { top, bottom, hard } = runBounds(buffer(rows), 1, COLS);
  assert.ok(hard.size <= MAX_JOINS, 'joined ' + hard.size + ' rows, cap is ' + MAX_JOINS);
  assert.ok(bottom - top <= MAX_JOINS);
});
