import { test } from 'node:test';
import assert from 'node:assert/strict';
import stt from '../src/main/stt.js';

const { status, transcribe, resolveProvider, pcmToWav, clipToFile, normalizeClip, sttConfig } = stt;

// A local engine that is always ready and always returns the same words, so the
// registry can be exercised without ONNX anywhere in sight.
function fakeEngine(text = 'hello world', ready = true) {
  const seen = [];
  return {
    seen,
    status: () => (ready ? { ready: true, modelId: 'whisper-tiny.en' } : { ready: false, reason: 'model not downloaded', downloadBytes: 45_000_000 }),
    prepare: async () => { seen.push('prepare'); },
    transcribe: async (clip) => { seen.push(clip); return text; },
  };
}

function fakeFetch(json = { text: ' transcribed ' }, ok = true) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: opts.body });
    return { ok, json: async () => json, text: async () => 'boom', status: ok ? 200 : 401 };
  };
  impl.calls = calls;
  return impl;
}

const pcm = () => new Float32Array([0, 0.5, -0.5, 1, -1]);
const clip = (over = {}) => ({ pcm: pcm(), sampleRate: 16000, mime: 'audio/webm', ...over });
const noEngine = { engine: null };

// ---- resolution -------------------------------------------------------------

test('with no keys and a working local engine, the default is local', () => {
  const p = resolveProvider({}, {}, { engine: fakeEngine() });
  assert.equal(p.id, 'local');
});

test('an explicit choice wins even over a ready local engine', () => {
  const p = resolveProvider({ sttProvider: 'openai', openaiKey: 'sk-x' }, {}, { engine: fakeEngine() });
  assert.equal(p.id, 'openai');
});

test('an explicit choice is honoured even when it is not ready, so the error names it', async () => {
  const res = await transcribe({
    clip: clip(), settings: { sttProvider: 'openai' }, env: {},
    deps: { engine: fakeEngine(), fetchImpl: fakeFetch() },
  });
  assert.equal(res.ok, false);
  assert.equal(res.provider, 'openai');
  assert.match(res.error, /OpenAI Whisper isn't ready/);
});

test('with no local engine, it falls back to the first ready cloud provider', () => {
  const p = resolveProvider({}, { ELEVENLABS_API_KEY: 'k' }, noEngine);
  assert.equal(p.id, 'elevenlabs');
});

test('settings key beats an env key for the same provider', () => {
  const cfg = sttConfig({ openaiKey: 'from-settings' }, { OPENAI_API_KEY: 'from-env' });
  assert.equal(cfg.openaiKey, 'from-settings');
});

// ---- status -----------------------------------------------------------------

test('status reports every provider, and only a key saved in Nami counts as saved', () => {
  const s = status({ settings: {}, env: { OPENAI_API_KEY: 'sk-env' }, deps: { engine: fakeEngine() } });
  assert.deepEqual(s.providers.map((p) => p.id), ['local', 'openai', 'elevenlabs']);
  const oa = s.providers.find((p) => p.id === 'openai');
  assert.equal(oa.ready, true);        // a shell export still works…
  assert.equal(oa.keySaved, false);    // …but the UI field stays empty, no shell talk
  assert.equal(oa.keyEnv, 'OPENAI_API_KEY');
  const el = s.providers.find((p) => p.id === 'elevenlabs');
  assert.equal(el.ready, false);
  assert.equal(el.reason, 'no API key');
});

test('a key saved on the Keys page reads as saved and beats the shell export', () => {
  const settings = { envKeys: { OPENAI_API_KEY: 'sk-saved' } };
  assert.equal(sttConfig(settings, { OPENAI_API_KEY: 'sk-shell' }).openaiKey, 'sk-saved');
  const s = status({ settings, env: { OPENAI_API_KEY: 'sk-shell' }, deps: noEngine });
  assert.equal(s.providers.find((p) => p.id === 'openai').keySaved, true);
});

test('status surfaces the local download size when the model is missing', () => {
  const s = status({ settings: {}, env: {}, deps: { engine: fakeEngine('x', false) } });
  const loc = s.providers.find((p) => p.id === 'local');
  assert.equal(loc.ready, false);
  assert.equal(loc.downloadBytes, 45_000_000);
  assert.equal(s.ready, false);
});

test('status never throws when a provider status blows up', () => {
  const angry = { status: () => { throw new Error('kaboom'); }, prepare: async () => {}, transcribe: async () => '' };
  const s = status({ settings: {}, env: {}, deps: { engine: angry } });
  assert.equal(s.providers.find((p) => p.id === 'local').reason, 'kaboom');
});

test('with nothing configured at all, nothing is ready but status still answers', () => {
  const s = status({ settings: {}, env: {}, deps: noEngine });
  assert.equal(s.ready, false);
  assert.equal(s.providers.every((p) => !p.ready), true);
});

// ---- routing ----------------------------------------------------------------

test('local gets the raw pcm, never a WAV', async () => {
  const engine = fakeEngine('spoken words');
  const res = await transcribe({ clip: clip(), settings: {}, env: {}, deps: { engine } });
  assert.equal(res.ok, true);
  assert.equal(res.text, 'spoken words');
  assert.equal(res.provider, 'local');
  assert.equal(engine.seen[0].pcm instanceof Float32Array, true);
});

test('cloud providers upload the original webm when we have it', async () => {
  const f = fakeFetch();
  const res = await transcribe({
    clip: clip({ bytes: new Uint8Array([1, 2, 3]) }),
    settings: { sttProvider: 'openai', openaiKey: 'sk-x' }, env: {},
    deps: { fetchImpl: f, engine: null },
  });
  assert.equal(res.ok, true);
  assert.equal(res.text, 'transcribed');
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer sk-x');
  const sent = f.calls[0].body.get('file');
  assert.equal(sent.type, 'audio/webm');
  assert.equal(f.calls[0].body.get('model'), 'whisper-1');
});

test('a file provider with no original recording gets a real WAV built from pcm', async () => {
  const f = fakeFetch();
  await transcribe({
    clip: clip({ bytes: null }),
    settings: { sttProvider: 'elevenlabs', elevenKey: 'k' }, env: {},
    deps: { fetchImpl: f, engine: null },
  });
  const sent = f.calls[0].body.get('file');
  assert.equal(sent.type, 'audio/wav');
  const buf = Buffer.from(await sent.arrayBuffer());
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
  assert.equal(buf.toString('latin1', 8, 12), 'WAVE');
  assert.equal(buf.readUInt32LE(24), 16000);          // sample rate
  assert.equal(buf.readUInt16LE(22), 1);              // mono
  assert.equal(buf.readUInt16LE(34), 16);             // 16-bit
  assert.equal(buf.length, 44 + 5 * 2);               // header + 5 samples
  assert.equal(f.calls[0].headers['xi-api-key'], 'k');
});

test('a retired provider choice (old custom / clipboard settings) falls back, never crashes', async () => {
  const engine = fakeEngine('still works');
  const res = await transcribe({
    clip: clip(),
    settings: { sttProvider: 'custom' }, env: {},
    deps: { engine },
  });
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'local');
});

// ---- failures ---------------------------------------------------------------

test('an HTTP failure comes back as {ok:false} rather than throwing', async () => {
  const res = await transcribe({
    clip: clip({ bytes: new Uint8Array([1]) }),
    settings: { sttProvider: 'openai', openaiKey: 'bad' }, env: {},
    deps: { fetchImpl: fakeFetch({}, false), engine: null },
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /OpenAI Whisper: 401/);
});

test('an engine that throws is reported, not propagated', async () => {
  const engine = fakeEngine();
  engine.transcribe = async () => { throw new Error('model exploded'); };
  const res = await transcribe({ clip: clip(), settings: {}, env: {}, deps: { engine } });
  assert.equal(res.ok, false);
  assert.match(res.error, /On this Mac: model exploded/);
});

test('a clip that failed to decode gives a human error, not a crash', async () => {
  const res = await transcribe({ clip: { pcm: null, bytes: null }, settings: {}, env: {}, deps: { engine: fakeEngine() } });
  assert.equal(res.ok, false);
  assert.match(res.error, /could not be decoded/);
});

// ---- helpers ----------------------------------------------------------------

test('pcmToWav clamps out-of-range samples instead of wrapping', () => {
  const buf = pcmToWav(new Float32Array([2, -2]), 16000);
  assert.equal(buf.readInt16LE(44), 32767);
  assert.equal(buf.readInt16LE(46), -32768);
});

test('normalizeClip rebuilds typed arrays that structured clone flattened', () => {
  const c = normalizeClip({ pcm: [0, 1], bytes: [1, 2, 3], sampleRate: 16000 });
  assert.equal(c.pcm instanceof Float32Array, true);
  assert.equal(c.bytes instanceof Uint8Array, true);
  assert.equal(c.durationMs, 0);  // 2 samples at 16 kHz rounds to 0 ms
  assert.equal(normalizeClip({ pcm: new Float32Array(16000) }).durationMs, 1000);
});

test('clipToFile prefers the original recording over a rebuilt WAV', () => {
  assert.equal(clipToFile({ bytes: new Uint8Array([1]), pcm: pcm(), mime: 'audio/webm' }).name, 'audio.webm');
  assert.equal(clipToFile({ bytes: null, pcm: pcm() }).name, 'audio.wav');
  assert.equal(clipToFile({ bytes: null, pcm: null }), null);
});
