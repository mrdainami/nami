// A file open on the desk follows the file on disk. Four moves, and this file
// is the contract for all four — the module under test is pure on purpose, so
// the rules can be argued with here rather than through a running app.
//
//   · our own write is dropped        — without it every save bounces back
//   · a clean panel merges            — there is nothing to lose
//   · a dirty panel asks              — and is never overwritten in silence
//   · zero bytes is refused           — a truncated read is not a document
//   · an append leaves the head alone — which is what keeps the caret still
//
// Nami is single-writer. This is not a sync engine and must never grow into
// one: the whole point is that a wrong answer here loses somebody's typing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { hashText, changeRange, mergeText, shiftOffset, decideReload } from '../src/renderer/file-sync.mjs';

// ---- the echo guard ---------------------------------------------------------

test('hashText tells two different documents apart', () => {
  assert.notEqual(hashText('hello'), hashText('hellp'));
  assert.notEqual(hashText('a\nb'), hashText('a\nb\n'));
  assert.notEqual(hashText(''), hashText(' '));
});

test('hashText is stable — the same bytes hash the same every time', () => {
  const s = '# Notes\n\nsomething long enough to matter\n';
  assert.equal(hashText(s), hashText(s));
  assert.equal(typeof hashText(s), 'string');
});

test('hashText treats null and undefined as the empty document', () => {
  assert.equal(hashText(null), hashText(''));
  assert.equal(hashText(undefined), hashText(''));
});

// ---- the splice -------------------------------------------------------------

test('changeRange finds the one region that differs', () => {
  const r = changeRange('the quick brown fox', 'the quick red fox');
  assert.equal('the quick brown fox'.slice(0, r.start), 'the quick ');
  assert.equal('the quick brown fox'.substr(r.start, r.removed), 'brown');
  assert.equal('the quick red fox'.substr(r.start, r.added), 'red');
});

test('changeRange on identical text is an empty splice', () => {
  const r = changeRange('same', 'same');
  assert.deepEqual({ removed: r.removed, added: r.added }, { removed: 0, added: 0 });
});

test('mergeText reproduces the file on disk', () => {
  // Single-writer: the merged result is the disk, always. The prefix/suffix
  // trim exists for the offsets, not to invent a third document.
  for (const [a, b] of [
    ['one\ntwo\n', 'one\ntwo\nthree\n'],
    ['one\ntwo\nthree\n', 'one\nthree\n'],
    ['', 'fresh\n'],
    ['abc', 'xyz'],
  ]) assert.equal(mergeText(a, b), b);
});

test('a merge that only appends leaves the head of the buffer identical', () => {
  // The cursor-survival property. An agent appending to a log must not move a
  // caret sitting on line 2, so the splice has to start at the end.
  const before = '# Log\n\n- first\n';
  const after = '# Log\n\n- first\n- second\n';
  const r = changeRange(before, after);
  assert.equal(r.start, before.length, 'the change begins where the old text ended');
  assert.equal(r.removed, 0, 'nothing was taken away');
  assert.equal(mergeText(before, after).slice(0, before.length), before,
    'every byte the user might be looking at is where it was');
  // A caret anywhere in the old text does not move.
  for (const off of [0, 3, 9, before.length]) assert.equal(shiftOffset(off, r), off);
});

test('a merge that only prepends pushes the caret down by what arrived', () => {
  const before = 'body\n';
  const after = '---\ntitle: x\n---\nbody\n';
  const r = changeRange(before, after);
  assert.equal(r.start, 0);
  assert.equal(r.removed, 0);
  assert.equal(shiftOffset(0, r), 0, 'an offset at the very start stays at the start');
  assert.equal(shiftOffset(before.length, r), after.length);
});

test('an offset inside the replaced region lands on its near edge, never past the end', () => {
  const before = 'aaa BBBB ccc';
  const after = 'aaa C ccc';
  const r = changeRange(before, after);
  const off = shiftOffset(6, r);            // mid-way through BBBB
  assert.ok(off >= r.start && off <= r.start + r.added, 'clamped into the new region');
  assert.ok(off <= after.length, 'and never off the end of the document');
});

// ---- the decision -----------------------------------------------------------

const disk = (diskText, over = {}) => decideReload({ text: '', dirty: false, lastHash: null, diskText, ...over });

test('our own write is dropped', () => {
  const text = '# Notes\n\nwritten by us\n';
  // saveEditor stored the hash main.js returned; the watcher now hands the
  // same bytes straight back. Acting on them would re-enter the editor for
  // nothing, and on a dirty buffer would raise a bar over our own save.
  const res = disk(text, { text, lastHash: hashText(text) });
  assert.equal(res.action, 'drop');
});

test('our own write is dropped even while the panel is dirty again', () => {
  // Saved, then kept typing. The watcher event is still ours.
  const saved = 'line one\n';
  const res = disk(saved, { text: saved + 'still typing', dirty: true, lastHash: hashText(saved) });
  assert.equal(res.action, 'drop');
  assert.equal(res.text, saved + 'still typing', 'the buffer is handed back untouched');
});

test('a file that has not actually changed is dropped even with no hash on file', () => {
  const text = 'unchanged\n';
  assert.equal(disk(text, { text }).action, 'drop');
});

test('a clean panel merges', () => {
  const res = disk('# Notes\n\nrewritten by the agent\n', { text: '# Notes\n' });
  assert.equal(res.action, 'merge');
  assert.equal(res.text, '# Notes\n\nrewritten by the agent\n');
});

test('a dirty panel asks, and the buffer it is holding is not replaced', () => {
  const mine = '# Notes\n\nmy unsaved paragraph\n';
  const res = disk('# Notes\n\nthe agent wrote this\n', { text: mine, dirty: true });
  assert.equal(res.action, 'ask');
  assert.equal(res.text, mine, 'ask hands back what the user has, never the disk');
  assert.equal(res.diskText, '# Notes\n\nthe agent wrote this\n',
    'and carries the disk alongside, so Reload has something to reload');
});

test('a stale hash does not excuse overwriting unsaved work', () => {
  // The hash is from two saves ago; the file has moved on since. Still asks.
  const res = disk('agent text\n', { text: 'my text\n', dirty: true, lastHash: hashText('older\n') });
  assert.equal(res.action, 'ask');
});

test('zero bytes against a non-empty buffer is refused', () => {
  // A half-written file, an editor that truncates before it writes, a copy
  // caught mid-flight. Emptying the tile is never the right answer.
  assert.equal(disk('', { text: '# Notes\n' }).action, 'refuse');
  assert.equal(disk('', { text: '# Notes\n', dirty: true }).action, 'refuse',
    'refused before it is even offered as a choice');
});

test('a genuinely empty file that was already empty is simply dropped', () => {
  assert.equal(disk('', { text: '' }).action, 'drop');
});

test('whitespace is not zero bytes — an emptied-out file still merges', () => {
  const res = disk('\n', { text: '# Notes\n' });
  assert.equal(res.action, 'merge', 'the guard is against a truncated read, not a short document');
});

test('decideReload never invents text it was not given', () => {
  for (const res of [
    disk('b\n', { text: 'a\n' }),
    disk('b\n', { text: 'a\n', dirty: true }),
    disk('', { text: 'a\n' }),
    disk('a\n', { text: 'a\n' }),
  ]) assert.equal(typeof res.text, 'string');
});
