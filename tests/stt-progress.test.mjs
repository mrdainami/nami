import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import store from '../src/main/stt-model.js';

const { MODEL_FILES, ensureModel } = store;
const REPO = 'onnx-community/whisper-tiny.en';

// The bug this file exists to prevent: the downloader counts FILES and the
// screen printed MEGABYTES. `total: 7` went through `Math.round(7 / 1e6)` and
// the download reported "0 MB of 0 MB" for its whole duration. The two ends of
// one event are tested together here, because either half alone looks correct.

function memIo(present = []) {
  const files = new Set(present);
  return {
    files,
    exists: (p) => files.has(p),
    mkdir: () => {},
    write: (p) => { files.add(p); },
    rename: (a, b) => { files.delete(a); files.add(b); },
    remove: (p) => { for (const f of [...files]) if (f === p || f.startsWith(p + '/')) files.delete(f); },
  };
}
const okFetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

// ---- the sending end --------------------------------------------------------

test('every download event counts files, and counts them up to the total', async () => {
  const io = memIo(), seen = [];
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: okFetch, io, onProgress: (p) => seen.push(p) });

  assert.equal(seen.length, MODEL_FILES.length, 'one event per file fetched');
  for (const ev of seen) {
    assert.equal(ev.phase, 'download');
    assert.equal(ev.total, MODEL_FILES.length, 'total is a file count, not a byte count');
  }
  assert.deepEqual(seen.map((e) => e.done), MODEL_FILES.map((_, i) => i + 1));
  // the number the UI multiplies out must be small enough to be obviously
  // file-shaped: this is what makes the MB reading collapse to zero
  assert.ok(seen[0].total < 100, 'a byte total would be in the millions');
});

test('a half-finished folder counts only what is left to fetch', async () => {
  // two files already landed from an interrupted run
  const done = MODEL_FILES.slice(0, 2).map((f) => `/m/${REPO}/${f}`);
  const io = memIo(done), seen = [];
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: okFetch, io, onProgress: (p) => seen.push(p) });

  const left = MODEL_FILES.length - 2;
  assert.equal(seen.length, left);
  assert.equal(seen.at(-1).done, left);
  assert.equal(seen.at(-1).total, left, 'the total is the work remaining, not the work ever done');
});

// ---- the receiving end ------------------------------------------------------

// app.js touches document on import, so the formatter is lifted out of the
// source and exercised on its own — the same approach star-ask.test.mjs takes.
const src = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const dlProgressText = (() => {
  const m = src.match(/function dlProgressText\(ev\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'dlProgressText must exist in app.js — it is the whole fix');
  return new Function(`return function dlProgressText(ev) {${m[1]}\n}`)();
})();

test('the note says files, in the same units the event arrived in', () => {
  assert.equal(dlProgressText({ phase: 'download', done: 3, total: 7 }), '3 of 7 files…');
  assert.equal(dlProgressText({ phase: 'download', done: 7, total: 7 }), '7 of 7 files…');
  assert.equal(dlProgressText({ phase: 'download', done: 1, total: 2 }), '1 of 2 files…');
});

test('a file count is never printed as megabytes again', () => {
  for (const total of [1, 2, 7, 40]) {
    const out = dlProgressText({ phase: 'download', done: 1, total });
    assert.ok(!/MB/i.test(out), `still talking megabytes: ${out}`);
    assert.ok(!/^0 of 0/.test(out), `collapsed to zero: ${out}`);
  }
});

test('the silent stretch after the last file gets a message of its own', () => {
  // ~44 MB of weights load into an ONNX session here. Nothing is downloading,
  // nothing is printed today, and several seconds of a frozen counter is the
  // moment the download looks hung.
  assert.equal(dlProgressText({ phase: 'load' }), 'Getting the model ready…');
});

test('nothing to say leaves the note alone', () => {
  assert.equal(dlProgressText(null), null);
  assert.equal(dlProgressText(undefined), null);
  assert.equal(dlProgressText({ phase: 'download', done: 0, total: 0 }), null);
});

// ---- the two ends, joined ---------------------------------------------------

test('a real run of events reads as a countdown a person can follow', async () => {
  const io = memIo(), lines = [];
  await ensureModel({
    dir: '/m', repo: REPO, fetchImpl: okFetch, io,
    onProgress: (p) => lines.push(dlProgressText(p)),
  });
  lines.push(dlProgressText({ phase: 'load' }));

  assert.equal(lines[0], `1 of ${MODEL_FILES.length} files…`);
  assert.equal(lines.at(-2), `${MODEL_FILES.length} of ${MODEL_FILES.length} files…`);
  assert.equal(lines.at(-1), 'Getting the model ready…');
  assert.ok(lines.every((l) => l), 'no step of a live download may print nothing');
});

// prepare() cannot be called here without pulling in ONNX and the real weights,
// so the one thing that cannot be proven at the boundary is asserted at the
// source: the load event has to be sent BEFORE the session is awaited, or it
// arrives only once the wait it was meant to explain is already over.
test('stt-local announces the load before it blocks on it', () => {
  const local = readFileSync(new URL('../src/main/stt-local.js', import.meta.url), 'utf8');
  const body = local.match(/async function prepare\([\s\S]*?\n\}/)[0];
  const announce = body.indexOf("phase: 'load'");
  const block = body.indexOf('await session(');
  assert.ok(announce > -1, 'prepare must announce the load phase');
  assert.ok(block > -1, 'prepare must still warm the session');
  assert.ok(announce < block, 'the announcement must come before the wait');
});
