// Gets Whisper weights onto disk in a layout transformers.js can read offline.
//
// Deliberately does NOT use transformers' own FileCache: that streams straight
// into the final path, so quitting mid-download leaves a truncated .onnx that
// every later run treats as a valid cache hit. Here each file lands as .part and
// is renamed only once complete, and the model only counts as usable when a
// .ready marker exists — so a half-finished set is re-fetched, never trusted.
//
// fs and fetch are injectable so the tests run without network or disk.
const fs = require('fs');
const path = require('path');

// Verified empirically against transformers 3.8.1: these are exactly the files
// it opens for an ASR pipeline. Re-check with a remote run if the version moves.
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer_config.json',
  'tokenizer.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

const MODELS = [
  { id: 'tiny.en', repo: 'onnx-community/whisper-tiny.en', label: 'Fast', bytes: 44_000_000, bundled: true },
  { id: 'base.en', repo: 'onnx-community/whisper-base.en', label: 'More accurate', bytes: 81_000_000 },
];
const DEFAULT_MODEL = 'tiny.en';
const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS.find((m) => m.id === DEFAULT_MODEL);

const fsIo = {
  exists: (p) => fs.existsSync(p),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  write: (p, buf) => fs.writeFileSync(p, buf),
  rename: (a, b) => fs.renameSync(a, b),
  remove: (p) => fs.rmSync(p, { recursive: true, force: true }),
};

const repoDir = (dir, repo) => path.join(dir, repo);
const readyMarker = (dir, repo) => path.join(repoDir(dir, repo), '.ready');

// Usable means: the marker is there AND every file it promised still is.
function isReady({ dir, repo, io = fsIo }) {
  if (!dir || !io.exists(readyMarker(dir, repo))) return false;
  return MODEL_FILES.every((f) => io.exists(path.join(repoDir(dir, repo), f)));
}

async function ensureModel({ dir, repo, fetchImpl = fetch, io = fsIo, onProgress = () => {} }) {
  if (isReady({ dir, repo, io })) return { ok: true, cached: true, dir: repoDir(dir, repo) };
  // a marker without its files (or the reverse) means a previous run died partway
  io.remove(readyMarker(dir, repo));

  const missing = MODEL_FILES.filter((f) => !io.exists(path.join(repoDir(dir, repo), f)));
  let done = 0;
  for (const rel of missing) {
    const dest = path.join(repoDir(dir, repo), rel);
    const part = dest + '.part';
    io.mkdir(path.dirname(dest));
    const url = `https://huggingface.co/${repo}/resolve/main/${rel}`;
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`could not fetch ${rel} (${r.status})`);
    io.write(part, Buffer.from(await r.arrayBuffer()));
    io.rename(part, dest);   // only now is the file real
    done += 1;
    onProgress({ phase: 'download', file: rel, done, total: missing.length });
  }
  io.write(readyMarker(dir, repo), Buffer.from(new Date().toISOString()));
  return { ok: true, cached: false, dir: repoDir(dir, repo) };
}

module.exports = { MODEL_FILES, MODELS, DEFAULT_MODEL, modelById, isReady, ensureModel, repoDir, fsIo };
