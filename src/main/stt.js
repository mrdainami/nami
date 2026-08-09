// Speech → text, as a registry of interchangeable providers.
//
// The renderer records one clip and hands it over; it never learns which engine
// is active. Everything that varies between engines lives in a provider object:
//
//   { pcm: Float32Array|null, sampleRate, bytes: Uint8Array|null, mime, durationMs }
//
// `pcm` is 16 kHz mono float, decoded in the renderer because only Chromium has
// an Opus decoder. `bytes` is the original webm, kept so cloud providers upload
// ~8 KB/s instead of a fat WAV. A provider declares which one it reads via
// `input`; if it wants a file and there is no `bytes`, we build a WAV from pcm.
//
// fetch and the local engine are injected (`deps`), same as openai-driver's
// fetchImpl, so the whole registry is testable without a network or ONNX.

const DEFAULT_PROVIDER = 'local';

// ---- audio ------------------------------------------------------------------
// 16-bit PCM WAV. Only used when a file-shaped provider has no original clip.
function pcmToWav(pcm, sampleRate = 16000) {
  const n = pcm.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // PCM chunk size
  buf.writeUInt16LE(1, 20);           // format: PCM
  buf.writeUInt16LE(1, 22);           // channels: mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

// What a file-shaped provider uploads: the original recording when we have it,
// otherwise a WAV rebuilt from the decoded samples.
function clipToFile(clip) {
  if (clip.bytes && clip.bytes.length) {
    return { data: Buffer.from(clip.bytes), name: 'audio.webm', type: clip.mime || 'audio/webm' };
  }
  if (clip.pcm && clip.pcm.length) {
    return { data: pcmToWav(clip.pcm, clip.sampleRate || 16000), name: 'audio.wav', type: 'audio/wav' };
  }
  return null;
}

async function postForm({ url, headers, fields, file, fetchImpl }) {
  const form = new FormData();
  form.append('file', new Blob([file.data], { type: file.type }), file.name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const r = await fetchImpl(url, { method: 'POST', headers, body: form });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = new Error(`${r.status}: ${t.slice(0, 140)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// ---- providers --------------------------------------------------------------
// Order is fallback priority: the first ready provider wins when nothing is picked.

const local = {
  id: 'local',
  label: 'On this Mac',
  blurb: 'free, offline, nothing leaves your machine',
  kind: 'local',
  input: 'pcm',
  needsKey: null,
  status(cfg, deps) {
    const engine = deps.engine;
    if (!engine) return { ready: false, reason: 'not installed yet' };
    return engine.status(cfg);
  },
  prepare(cfg, deps) {
    if (!deps.engine) throw new Error('engine unavailable');
    return deps.engine.prepare(cfg, deps.onProgress);
  },
  async transcribe(clip, cfg, deps) {
    if (!clip.pcm || !clip.pcm.length) throw new Error('no audio, the recording could not be decoded');
    return deps.engine.transcribe(clip, cfg);
  },
};

const openai = {
  id: 'openai',
  label: 'OpenAI Whisper',
  blurb: 'cloud, your audio goes to OpenAI',
  kind: 'cloud',
  input: 'file',
  needsKey: 'openaiKey',
  keyEnv: 'OPENAI_API_KEY',
  keyHelpUrl: 'https://platform.openai.com/api-keys',
  keyPlaceholder: 'sk-…',
  status(cfg) {
    return cfg.openaiKey ? { ready: true } : { ready: false, reason: 'no API key' };
  },
  async transcribe(clip, cfg, deps) {
    const file = clipToFile(clip);
    if (!file) throw new Error('no audio');
    const j = await postForm({
      url: 'https://api.openai.com/v1/audio/transcriptions',
      headers: { Authorization: `Bearer ${cfg.openaiKey}` },
      fields: { model: cfg.openaiModel || 'whisper-1' },
      file, fetchImpl: deps.fetchImpl,
    });
    return (j.text || '').trim();
  },
};

const elevenlabs = {
  id: 'elevenlabs',
  label: 'ElevenLabs Scribe',
  blurb: 'cloud, your audio goes to ElevenLabs',
  kind: 'cloud',
  input: 'file',
  needsKey: 'elevenKey',
  keyEnv: 'ELEVENLABS_API_KEY',
  keyHelpUrl: 'https://elevenlabs.io/app/settings/api-keys',
  keyPlaceholder: 'sk_…',
  status(cfg) {
    return cfg.elevenKey ? { ready: true } : { ready: false, reason: 'no API key' };
  },
  async transcribe(clip, cfg, deps) {
    const file = clipToFile(clip);
    if (!file) throw new Error('no audio');
    const j = await postForm({
      url: 'https://api.elevenlabs.io/v1/speech-to-text',
      headers: { 'xi-api-key': cfg.elevenKey },
      fields: { model_id: cfg.elevenModel || 'scribe_v1' },
      file, fetchImpl: deps.fetchImpl,
    });
    return (j.text || '').trim();
  },
};

const PROVIDERS = [local, openai, elevenlabs];
const providerById = (id) => PROVIDERS.find((p) => p.id === id) || null;

// ---- config -----------------------------------------------------------------
// A key saved in the app (the shared Keys store, or the legacy per-provider
// settings field) always beats a stale export in the user's shell profile —
// what you paste into Nami is what gets used.
function sttConfig(settings = {}, env = {}) {
  const shared = (settings.envKeys && typeof settings.envKeys === 'object') ? settings.envKeys : {};
  return {
    openaiKey: shared.OPENAI_API_KEY || settings.openaiKey || env.OPENAI_API_KEY || '',
    elevenKey: shared.ELEVENLABS_API_KEY || settings.elevenKey || env.ELEVENLABS_API_KEY || '',
    openaiModel: settings.openaiModel || '',
    elevenModel: settings.elevenModel || '',
    sttModelId: settings.sttModelId || '',   // which local whisper model
    modelDir: settings.modelDir || '',
  };
}

function withDefaults(deps = {}) {
  return {
    fetchImpl: deps.fetchImpl || ((...a) => fetch(...a)),
    engine: 'engine' in deps ? deps.engine : lazyEngine(),
    onProgress: deps.onProgress || (() => {}),
  };
}

// The local engine drags in ~46 MB of native ONNX, so it is only required the
// first time something actually asks for it. Tests pass `engine` explicitly and
// never touch this path.
let engineCache;
function lazyEngine() {
  if (engineCache !== undefined) return engineCache;
  try { engineCache = require('./stt-local'); } catch (_) { engineCache = null; }
  return engineCache;
}

function safeStatus(p, cfg, deps) {
  try { return p.status(cfg, deps) || { ready: false }; }
  catch (e) { return { ready: false, reason: e.message }; }
}

// Which provider a transcribe call will use. An explicit choice is honoured even
// when it is not ready — the user gets a real error naming what they picked,
// rather than silent, confusing fallback to something else.
function resolveProvider(settings = {}, env = {}, deps) {
  const d = withDefaults(deps);
  const cfg = sttConfig(settings, env);
  const picked = settings.sttProvider ? providerById(settings.sttProvider) : null;
  if (picked) return picked;
  const byDefault = providerById(DEFAULT_PROVIDER);
  if (byDefault && safeStatus(byDefault, cfg, d).ready) return byDefault;
  return PROVIDERS.find((p) => safeStatus(p, cfg, d).ready) || byDefault;
}

// What the UI and the boot payload read. Never throws.
function status({ settings = {}, env = {}, deps } = {}) {
  const d = withDefaults(deps);
  const cfg = sttConfig(settings, env);
  const active = resolveProvider(settings, env, deps);
  const shared = (settings.envKeys && typeof settings.envKeys === 'object') ? settings.envKeys : {};
  const providers = PROVIDERS.map((p) => {
    const s = safeStatus(p, cfg, d);
    return {
      id: p.id, label: p.label, blurb: p.blurb, kind: p.kind,
      needsKey: p.needsKey, keyEnv: p.keyEnv || null, keyHelpUrl: p.keyHelpUrl || null,
      keyPlaceholder: p.keyPlaceholder || null,
      hasKey: p.needsKey ? !!cfg[p.needsKey] : null,
      // true only when the user saved a key in Nami — the UI shows it masked
      keySaved: !!(p.needsKey && (shared[p.keyEnv] || settings[p.needsKey])),
      ready: !!s.ready, reason: s.reason || null,
      downloadBytes: s.downloadBytes || 0, modelId: s.modelId || null,
    };
  });
  const chosen = settings.sttProvider || null;
  return {
    active: active ? active.id : null,
    chosen,
    ready: providers.some((p) => p.id === (active && active.id) && p.ready),
    providers,
  };
}

// Get the active provider's engine ready (download a model, warm a session).
async function prepare({ settings = {}, env = {}, deps } = {}) {
  const d = withDefaults(deps);
  const p = resolveProvider(settings, env, deps);
  if (!p) return { ok: false, error: 'no transcription provider' };
  if (!p.prepare) return { ok: true, provider: p.id };
  try {
    await p.prepare(sttConfig(settings, env), d);
    return { ok: true, provider: p.id };
  } catch (e) { return { ok: false, provider: p.id, error: e.message }; }
}

// Same { ok, text, provider } envelope the old inline handler returned.
async function transcribe({ clip, settings = {}, env = {}, deps } = {}) {
  const d = withDefaults(deps);
  const p = resolveProvider(settings, env, deps);
  if (!p) return { ok: false, error: 'No transcription provider available' };
  const cfg = sttConfig(settings, env);
  const s = safeStatus(p, cfg, d);
  if (!s.ready) return { ok: false, provider: p.id, error: `${p.label} isn't ready: ${s.reason || 'not configured'}` };
  try {
    const text = await p.transcribe(normalizeClip(clip), cfg, d);
    return { ok: true, text: String(text || '').trim(), provider: p.id };
  } catch (e) { return { ok: false, provider: p.id, error: `${p.label}: ${e.message}` }; }
}

// IPC structured-clone hands back plain objects; make the shape predictable
// before any provider sees it.
function normalizeClip(clip) {
  const c = clip || {};
  const pcm = c.pcm ? (c.pcm instanceof Float32Array ? c.pcm : new Float32Array(c.pcm)) : null;
  const bytes = c.bytes ? (c.bytes instanceof Uint8Array ? c.bytes : new Uint8Array(c.bytes)) : null;
  const sampleRate = c.sampleRate || 16000;
  return {
    pcm, bytes, sampleRate,
    mime: c.mime || 'audio/webm',
    durationMs: c.durationMs || (pcm ? Math.round((pcm.length / sampleRate) * 1000) : 0),
  };
}

module.exports = {
  PROVIDERS, DEFAULT_PROVIDER, providerById, resolveProvider,
  sttConfig, status, prepare, transcribe,
  pcmToWav, clipToFile, normalizeClip,
};
