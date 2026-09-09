// A file open on the desk follows the file on disk.
//
// Nami is single-writer: one agent, or one person, changes a file at a time.
// So this is not a sync engine and must not become one. There are four moves
// and they are all here, with no DOM and no Electron underneath them, because
// getting one wrong loses somebody's typing and that is worth being able to
// unit-test.
//
//   1 · watch          — src/main/dir-watch.js, which now names the files
//   2 · drop the echo  — hashText, so our own save does not bounce back
//   3 · merge          — changeRange, so a caret survives an agent's append
//   4 · refuse         — a zero-byte read is a truncation, not a document
//
// The rule that outranks the other three: **a panel holding unsaved edits is
// never silently overwritten.** It gets asked. Everything else merges without
// a word, because a clean buffer has nothing to lose.

// Cheap, non-crypto, and it only has to answer one question: are these the
// bytes we just wrote? FNV-1a with the length pinned on the end — a collision
// would have to match both, and the cost of one is a reload that was already
// going to be a no-op.
export function hashText(s) {
  const t = s == null ? '' : String(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + t.length;
}

// The one region that differs: trim the common prefix, trim the common suffix,
// and what is left in the middle is the edit. An agent's write is almost
// always contiguous — a rewritten paragraph, an appended section — so one
// splice describes it, and describing it is what lets the caret stay put.
//
// Returns offsets into `current`: replace `removed` characters at `start` with
// the `added` characters `disk` has there.
export function changeRange(current, disk) {
  const a = current == null ? '' : String(current);
  const b = disk == null ? '' : String(disk);
  let start = 0;
  const lim = Math.min(a.length, b.length);
  while (start < lim && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA--; endB--; }
  return { start, removed: endA - start, added: endB - start };
}

// Splice the middle back in. With a single writer the result is always `disk`
// byte for byte — which is the point: the merge is honest about being a
// replacement, and the value it adds is the range, not a third document.
export function mergeText(current, disk) {
  const a = current == null ? '' : String(current);
  const b = disk == null ? '' : String(disk);
  const r = changeRange(a, b);
  return a.slice(0, r.start) + b.slice(r.start, r.start + r.added) + a.slice(r.start + r.removed);
}

// Where an offset in the old text ends up in the new one. Before the splice it
// does not move; after it, it shifts by the size difference; inside it there is
// no honest answer, so it clamps to the near edge of what replaced it rather
// than jumping to the end of the document.
export function shiftOffset(offset, range) {
  const off = Math.max(0, Number(offset) || 0);
  const { start, removed, added } = range;
  if (off <= start) return off;
  if (off >= start + removed) return off + added - removed;
  return Math.min(off, start + added);
}

// What an open panel should do about the bytes now on disk.
//
//   drop   — nothing to do: it is our own save coming back, or no change
//   merge  — take it; the panel is clean and has nothing to lose
//   ask    — the panel has unsaved edits; raise the bar, change nothing
//   refuse — zero bytes over a document; a truncated read is not an edit
//
// Order is the argument. The echo guard runs first so a save never raises a
// bar over itself. The truncation guard runs before `dirty`, because an empty
// file is not a choice worth offering. `dirty` runs last and wins over merge.
export function decideReload({ text = '', dirty = false, lastHash = null, diskText = '' } = {}) {
  const cur = text == null ? '' : String(text);
  const next = diskText == null ? '' : String(diskText);
  const done = (action, out) => ({ action, text: out, diskText: next });

  if (lastHash != null && hashText(next) === lastHash) return done('drop', cur);
  if (next === cur) return done('drop', cur);
  if (next.length === 0 && cur.length > 0) return done('refuse', cur);
  if (dirty) return done('ask', cur);
  return { ...done('merge', mergeText(cur, next)), range: changeRange(cur, next) };
}
