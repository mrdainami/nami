import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastCol, continuesLink, leadingIndent } from '../src/renderer/term-wrap.mjs';

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
