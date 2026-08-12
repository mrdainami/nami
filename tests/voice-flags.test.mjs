import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Settings · Voice said "ready" for OpenAI and ElevenLabs on a profile where
// Settings · Keys said "not set" for the same two keys. Both were telling the
// truth about different things: sttConfig falls back to process.env, so a key
// exported in a shell profile makes a provider genuinely usable, while Keys
// only ever shows what Nami itself stores.
//
// The catch is that only a run started FROM a terminal inherits that export.
// user-path.js merges the login shell's PATH into a Dock launch and nothing
// else, so from the Dock those variables are absent and the same provider is
// not ready at all. A flag that says "ready" in one launch and "no API key" in
// the next, with nothing changed, is the confusing part -- so the flag now says
// which of the two it is.

const src = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const voiceFlag = (() => {
  const m = src.match(/function voiceFlag\(p\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'voiceFlag must exist in app.js');
  // it calls mb() for the download size; hand it the real one
  const mbSrc = src.match(/function mb\(bytes\) \{ ([\s\S]*?) \}/)[1];
  const mb = new Function('bytes', mbSrc);
  return new Function('mb', `return function voiceFlag(p) {${m[1]}\n}`)(mb);
})();

const cloud = (over = {}) => ({
  id: 'openai', needsKey: 'openaiKey', keyEnv: 'OPENAI_API_KEY',
  ready: false, keySaved: false, downloadBytes: 0, reason: null, ...over,
});

test('a key you saved in Nami reads as plainly ready', () => {
  assert.equal(voiceFlag(cloud({ ready: true, keySaved: true })), 'ready');
});

test('a key that only exists in this run says where it came from', () => {
  const flag = voiceFlag(cloud({ ready: true, keySaved: false }));
  assert.notEqual(flag, 'ready', 'an inherited key must not read the same as a saved one');
  assert.match(flag, /ready/, 'it is still usable right now, and should say so');
  assert.match(flag, /shell/i, 'and it must say where the key came from');
});

test('no key anywhere still says so', () => {
  assert.equal(voiceFlag(cloud({ ready: false, reason: 'no API key' })), 'no API key');
});

// The on-device engine has no key to inherit, so it must never pick up the new
// wording -- p.needsKey is null for it and that is what keeps the branch off.
test('the on-device engine is never described as borrowing a key', () => {
  const local = { id: 'local', needsKey: null, keySaved: false, downloadBytes: 0, reason: null };
  assert.equal(voiceFlag({ ...local, ready: true }), 'ready');
  assert.equal(voiceFlag({ ...local, ready: false, downloadBytes: 44_000_000 }), '44 MB to download');
  assert.equal(voiceFlag({ ...local, ready: false, reason: 'no model folder' }), 'no model folder');
});

// status() has carried both facts all along; only the flag ignored them.
test('the status payload still reports saved and usable separately', () => {
  const stt = readFileSync(new URL('../src/main/stt.js', import.meta.url), 'utf8');
  assert.match(stt, /hasKey:/, 'whether a key is usable at all');
  assert.match(stt, /keySaved:/, 'whether Nami is the one holding it');
});
