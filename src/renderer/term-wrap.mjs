// When two rows are one line, and xterm cannot tell you so.
//
// A soft wrap — xterm running out of columns and folding the line itself —
// sets isWrapped on the continuation, and wrappedRow stitches the run back
// together before anything is scanned. That case is already handled and
// nothing here touches it.
//
// A hard wrap is the other thing. The program measured your width, chose the
// break, and printed its own newline with a hanging indent. Both rows carry
// isWrapped false, nothing joins them, and scanLinks matches the head of a
// severed URL as a complete one — so the click goes somewhere real and wrong,
// and widening the window never heals it because the newline is in the
// scrollback.
//
// The information was destroyed by the emitter, so this is inference, not
// recovery. Two guards keep it narrow. A row with space left in it was not
// cut off — whoever broke there meant to. And a continuation that starts at
// column 0 is a soft wrap, which is someone else's job. What remains is a row
// filled to its last column followed by a short indent and a character a link
// could actually contain.
//
// Pure functions over the smallest slice of a buffer line, so the whole thing
// is testable without a terminal — the same call term-links.mjs makes.

// Characters a URL or a path can contain in its body. Deliberately not the
// full RFC set: a continuation opening with a quote or a bracket is prose.
const LINKISH = /[\w.~:/?#@!$&'*+,;=%-]/;

// The deepest indent still readable as a continuation. Claude Code's hanging
// indent is two; anything past a small tab is a new block, not a tail.
const MAX_INDENT = 8;

// The final occupied column, blanks at the tail ignored. Returns a count, not
// an index: cols means "filled to the edge".
export function lastCol(line, cols) {
  for (let x = cols - 1; x >= 0; x--) {
    const c = line.getCell(x);
    const ch = c && c.getChars();
    if (ch && ch.trim()) return x + 1;
  }
  return 0;
}

// How many blank cells a row opens with. An all-blank row answers cols, which
// no caller will accept as an indent — that is the point.
export function leadingIndent(line, cols) {
  for (let x = 0; x < cols; x++) {
    const c = line.getCell(x);
    const ch = c && c.getChars();
    if (ch && ch.trim()) return x;
  }
  return cols;
}

// The most rows one severed token is allowed to span. A path long enough to
// need a fourth row is rarer than a paragraph that trips all the other guards,
// so the cap is what stops a whole justified block chaining into one string.
export const MAX_JOINS = 3;

function charAt(line, x) {
  const c = line.getCell(x);
  const ch = c && c.getChars();
  return ch || '';
}

// Is `next` the rest of a token that ran off the end of `line`?
export function continuesLink(line, next, cols) {
  if (!line || !next) return false;
  const end = lastCol(line, cols);
  if (end < cols) return false;                        // room left: the break was chosen
  // The character the row ends on has to be one a token could be cut through.
  // A row ending in a closing bracket or a quote finished its thought.
  if (!LINKISH.test(charAt(line, end - 1))) return false;
  const indent = leadingIndent(next, cols);
  if (indent < 1 || indent > MAX_INDENT) return false; // col 0 is a soft wrap; deep is a new block
  return LINKISH.test(charAt(next, indent));
}
