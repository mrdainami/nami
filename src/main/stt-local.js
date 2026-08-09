// Whisper, on this machine, in the Electron main process.
//
// Verified on Electron 43 / transformers 3.8.1: `process.release.name` is 'node'
// in main, so transformers picks the onnxruntime-node backend and runs native.
// Do NOT set globalThis[Symbol.for('onnxruntime')] to force it — in 3.8.1 that
// branch assigns the runtime but never fills `supportedDevices`, and every
// pipeline call then dies with `Unsupported device: "cpu"`.
//
// Measured on Apple Silicon, whisper-tiny.en q8: ~0.6 s to load a warm session,
// ~0.5 s to transcribe a 4 s clip. base.en is ~0.7 s for the same clip.
const path = require('path');
const store = require('./stt-model');

let transformers = null;   // the module, imported once
let sessions = new Map();  // modelId -> Promise<pipeline>, kept warm
let modelsDir = null;

// main owns the paths; this module stays free of electron so it can be required
// from a plain node script when debugging.
function configure({ dir }) { modelsDir = dir; }
function dir() { return modelsDir; }

async function loadTransformers() {
  if (transformers) return transformers;
  transformers = await import('@huggingface/transformers');
  const { env } = transformers;
  // read the weights we placed ourselves, and never reach the network at
  // inference time — a missing file must be a loud error, not a silent download
  env.localModelPath = modelsDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  return transformers;
}

function status(cfg = {}) {
  const model = store.modelById(cfg.sttModelId);
  if (!modelsDir) return { ready: false, reason: 'no model folder' };
  const ready = store.isReady({ dir: modelsDir, repo: model.repo });
  return ready
    ? { ready: true, modelId: model.id }
    : { ready: false, reason: 'model not downloaded', downloadBytes: model.bytes, modelId: model.id };
}

async function prepare(cfg = {}, onProgress = () => {}) {
  const model = store.modelById(cfg.sttModelId);
  await store.ensureModel({ dir: modelsDir, repo: model.repo, onProgress });
  await session(model);   // pay the load cost now, not on the first dictation
  return { ok: true, modelId: model.id };
}

function session(model) {
  if (sessions.has(model.id)) return sessions.get(model.id);
  const p = (async () => {
    const { pipeline } = await loadTransformers();
    return pipeline('automatic-speech-recognition', model.repo, { dtype: 'q8' });
  })();
  // a failed load must not poison the cache — the next attempt should retry.
  // It is also the one failure worth shouting about: it usually means the native
  // ONNX binary could not be loaded (asar packing, signing, wrong arch).
  p.catch((e) => {
    sessions.delete(model.id);
    console.error('[stt] could not load', model.repo, '—', (e && e.message) || e);
  });
  sessions.set(model.id, p);
  return p;
}

async function transcribe(clip, cfg = {}) {
  const model = store.modelById(cfg.sttModelId);
  if (!store.isReady({ dir: modelsDir, repo: model.repo })) {
    throw new Error('the on-device model still needs downloading');
  }
  const run = await session(model);
  // Whisper only sees 30 s at a time; longer clips need overlapping windows.
  const long = clip.pcm.length > 30 * (clip.sampleRate || 16000);
  const out = await run(clip.pcm, long ? { chunk_length_s: 30, stride_length_s: 5 } : {});
  // these models are English-only, so no language/task options are passed
  return String((out && out.text) || '').trim();
}

// Warm the session in the background so the first dictation isn't the slow one.
function warm(cfg = {}) {
  try {
    if (!status(cfg).ready) return;
    const t0 = Date.now();
    session(store.modelById(cfg.sttModelId))
      .then(() => console.log('[stt] on-device engine ready in', Date.now() - t0, 'ms'))
      .catch(() => {});   // session() already logged it
  } catch (e) { console.error('[stt] warm failed:', e.message); }
}

module.exports = { configure, dir, status, prepare, transcribe, warm };
