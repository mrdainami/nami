import { test } from 'node:test';
import assert from 'node:assert/strict';
import store from '../src/main/stt-model.js';

const { MODEL_FILES, MODELS, modelById, isReady, ensureModel } = store;
const REPO = 'onnx-community/whisper-tiny.en';

// An in-memory disk that records renames, so we can prove nothing is published
// under its final name until it is complete.
function memIo() {
  const files = new Set();
  const log = [];
  return {
    files, log,
    exists: (p) => files.has(p),
    mkdir: () => {},
    write: (p) => { files.add(p); log.push(['write', p]); },
    rename: (a, b) => { files.delete(a); files.add(b); log.push(['rename', a, b]); },
    remove: (p) => { for (const f of [...files]) if (f === p || f.startsWith(p + '/')) files.delete(f); },
  };
}
function okFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  impl.calls = calls;
  return impl;
}

test('a fresh folder downloads every file the pipeline will open', async () => {
  const io = memIo(), f = okFetch();
  const res = await ensureModel({ dir: '/m', repo: REPO, fetchImpl: f, io });
  assert.equal(res.ok, true);
  assert.equal(res.cached, false);
  assert.equal(f.calls.length, MODEL_FILES.length);
  assert.equal(isReady({ dir: '/m', repo: REPO, io }), true);
  // and it asked huggingface for exactly the files we listed
  assert.deepEqual(
    f.calls.map((u) => u.replace(`https://huggingface.co/${REPO}/resolve/main/`, '')).sort(),
    [...MODEL_FILES].sort());
});

test('every file is written as .part and renamed — never published half-written', async () => {
  const io = memIo(), f = okFetch();
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: f, io });
  const writes = io.log.filter(([op]) => op === 'write').map(([, p]) => p);
  const onnx = writes.filter((p) => p.endsWith('.onnx') || p.endsWith('.json'));
  assert.equal(onnx.length, 0, 'no final path may be written to directly');
  assert.equal(writes.filter((p) => p.endsWith('.part')).length, MODEL_FILES.length);
});

test('a fetch that fails mid-set leaves no usable model and no final file', async () => {
  const io = memIo();
  let n = 0;
  const f = async (url) => {
    n += 1;
    if (n === 3) return { ok: false, status: 503 };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  await assert.rejects(() => ensureModel({ dir: '/m', repo: REPO, fetchImpl: f, io }), /could not fetch/);
  assert.equal(isReady({ dir: '/m', repo: REPO, io }), false);
  assert.equal([...io.files].some((p) => p.endsWith('.ready')), false, 'no marker on a failed run');
  assert.equal([...io.files].some((p) => p.endsWith('.part')), false, 'no stray .part left behind');
  // the file that failed must not exist at its final path
  const failed = `/m/${REPO}/${MODEL_FILES[2]}`;
  assert.equal(io.files.has(failed), false);
});

test('a second call on a complete folder makes zero requests', async () => {
  const io = memIo();
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: okFetch(), io });
  const f2 = okFetch();
  const res = await ensureModel({ dir: '/m', repo: REPO, fetchImpl: f2, io });
  assert.equal(res.cached, true);
  assert.equal(f2.calls.length, 0);
});

test('a resumed download only fetches what is still missing', async () => {
  const io = memIo();
  // pretend an earlier run got the small files down but died before the weights
  for (const f of MODEL_FILES.slice(0, 4)) io.files.add(`/m/${REPO}/${f}`);
  const f = okFetch();
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: f, io });
  assert.equal(f.calls.length, MODEL_FILES.length - 4);
  assert.equal(isReady({ dir: '/m', repo: REPO, io }), true);
});

test('files without the marker are not trusted — the set is completed first', async () => {
  const io = memIo();
  for (const f of MODEL_FILES) io.files.add(`/m/${REPO}/${f}`);
  assert.equal(isReady({ dir: '/m', repo: REPO, io }), false, 'no marker means not ready');
  const f = okFetch();
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: f, io });
  assert.equal(f.calls.length, 0, 'present files are kept');
  assert.equal(isReady({ dir: '/m', repo: REPO, io }), true, 'and the marker is written');
});

test('a marker whose files went missing does not count as ready', async () => {
  const io = memIo();
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: okFetch(), io });
  io.files.delete(`/m/${REPO}/onnx/encoder_model_quantized.onnx`);
  assert.equal(isReady({ dir: '/m', repo: REPO, io }), false);
});

test('progress is reported once per downloaded file and reaches the total', async () => {
  const io = memIo(), seen = [];
  await ensureModel({ dir: '/m', repo: REPO, fetchImpl: okFetch(), io, onProgress: (p) => seen.push(p) });
  assert.equal(seen.length, MODEL_FILES.length);
  assert.equal(seen[seen.length - 1].done, MODEL_FILES.length);
  assert.equal(seen[seen.length - 1].total, MODEL_FILES.length);
});

test('modelById falls back to the bundled default for junk input', () => {
  assert.equal(modelById('base.en').id, 'base.en');
  assert.equal(modelById('nope').id, 'tiny.en');
  assert.equal(modelById(undefined).id, 'tiny.en');
  // the default must be the one we ship, or first run needs a network after all
  assert.equal(MODELS.find((m) => m.bundled).id, 'tiny.en');
});

test('isReady is false rather than throwing when no folder is configured', () => {
  assert.equal(isReady({ dir: null, repo: REPO, io: memIo() }), false);
});
