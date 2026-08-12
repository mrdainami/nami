// Following a transcript that is still being written, one bounded read at a
// time. transcript-events.js turns the lines into events; this decides which
// bytes to look at.
//
// Two rules govern the whole file. Never read a transcript whole — they reach
// hundreds of megabytes, and the main process stalls for as long as it takes.
// And never hand on half a record: the CLI flushes mid-line constantly, so a
// read that stops in the middle of one must leave it for next time.
const fs = require('fs');

// Per read. Comfortably more than a turn produces in a tick, small enough that
// a first read of an active session cannot block the main process.
const MAX_BYTES = 1024 * 1024;
// How much history a tile opens with when the transcript is already large.
const START_WINDOW = 96 * 1024;

// Where to begin following a transcript of this size. A small file is read from
// the top so the tile shows the whole conversation; a large one opens on its
// last screenful, and the first line is a fragment (the window lands mid-record)
// which the parser will skip.
function tailStart(size, { window = START_WINDOW } = {}) {
  if (!(size > window)) return { offset: 0, partial: false };
  return { offset: size - window, partial: true };
}

// Read whole lines from `offset` onward.
//   { lines, offset, missing?, reset?, dropped? }
// `offset` is where the next read should start: past the last complete line,
// never into the middle of one.
function readFrom(file, offset, { maxBytes = MAX_BYTES } = {}) {
  let size;
  try { size = fs.statSync(file).size; } catch (_) { return { lines: [], offset, missing: true }; }

  let from = offset;
  let reset = false;
  // Shorter than where we stopped means this is not the same file any more —
  // /clear rewrites it, and a resumed conversation can be replaced wholesale.
  // Reading on from a stale offset would splice two conversations together.
  if (size < from) { from = 0; reset = true; }
  if (size === from) return { lines: [], offset: from, reset };

  const end = Math.min(size, from + maxBytes);
  const buf = Buffer.alloc(end - from);
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, buf.length, from);
  } catch (_) {
    return { lines: [], offset, missing: true };
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (_) {}
  }

  // Byte index, not string index: cutting the buffer at the last newline before
  // decoding is what keeps a multibyte character from being split in half and
  // coming back as replacement glyphs. Claude writes ✳, ⠐ and em dashes on
  // nearly every line.
  const lastNl = buf.lastIndexOf(0x0a);
  if (lastNl < 0) {
    // No line ended inside the window. If there is more file beyond it, this
    // record is longer than one read — a Read of a large file is a single
    // enormous line — so step over the window and resync on the next newline
    // rather than waiting for a line that will never fit.
    if (end < size) return { lines: [], offset: end, reset, dropped: true };
    return { lines: [], offset: from, reset };
  }

  const text = buf.slice(0, lastNl + 1).toString('utf8');
  const lines = text.split('\n');
  lines.pop(); // the empty string after the final newline
  return { lines, offset: from + lastNl + 1, reset };
}

module.exports = { readFrom, tailStart, MAX_BYTES, START_WINDOW };
