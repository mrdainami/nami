import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { nextState, percentOf, downloadUpdate, installNow, hasStagedFile, updaterState } = require('../src/main/updater.js');

// --- the states a download can be in -----------------------------------------
//
// These are the rules that keep a 166 MB download from starting twice, and keep
// a late event from contradicting one that already landed.

test('asking to download from rest starts one', () => {
  assert.equal(nextState('idle', 'download'), 'downloading');
});

test('asking again while downloading changes nothing', () => {
  assert.equal(nextState('downloading', 'download'), 'downloading');
});

test('an update already waiting for a quit cannot be downloaded again', () => {
  // Three windows and a six-hourly poll all reach for this; only the first
  // press should ever have moved anything.
  assert.equal(nextState('ready', 'download'), 'ready');
});

test('a failure can be retried', () => {
  assert.equal(nextState('failed', 'download'), 'downloading');
});

test('a stray progress event after a failure cannot resurrect the download', () => {
  assert.equal(nextState('failed', 'progress'), 'failed');
});

test('nothing moves a staged update off ready', () => {
  for (const ev of ['progress', 'error', 'ready', 'download']) {
    assert.equal(nextState('ready', ev), 'ready', `${ev} moved it`);
  }
});

test('an unknown event leaves the state alone', () => {
  assert.equal(nextState('downloading', 'sneeze'), 'downloading');
});

// --- what the bar is told ----------------------------------------------------

test('a percentage is rounded to something a bar can draw', () => {
  assert.equal(percentOf({ percent: 58.31946 }), 58);
});

test('nonsense reads as no progress rather than as NaN', () => {
  // This one reaches the DOM. "NaN%" in the corner of the app is the failure
  // being guarded against, not a hypothetical.
  assert.equal(percentOf({}), 0);
  assert.equal(percentOf(null), 0);
  assert.equal(percentOf({ percent: 'most of it' }), 0);
});

test('a percentage past the end is clamped', () => {
  assert.equal(percentOf({ percent: 128 }), 100);
  assert.equal(percentOf({ percent: -4 }), 0);
});

// --- the guard that matters --------------------------------------------------

test('a development build refuses to download anything', async () => {
  // The one place this file writes to disk is inside a packaged app. Running
  // from source it must do nothing at all — no request, no event, no swap.
  const seen = [];
  const res = await downloadUpdate({ isPackaged: false, emit: (ch) => seen.push(ch) });
  assert.deepEqual(seen, []);
  assert.equal(res.state, 'idle');
});

test('the state is reportable before anything has happened', () => {
  assert.deepEqual(updaterState(), { state: 'idle', version: null });
});

test('a development build refuses to install anything', async () => {
  const seen = [];
  const res = await installNow({ isPackaged: false, emit: (ch) => seen.push(ch) });
  assert.deepEqual(seen, []);
  assert.equal(res.state, 'idle');
});

// --- the update left behind by an earlier run --------------------------------
//
// This is the case that failed on a real machine: a download finished, the
// install was cancelled, and every later launch was blind to the 166 MB sitting
// in the cache. Nothing installed it and nothing mentioned it.

const stubFs = (files) => ({
  readFileSync: (p) => {
    if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return files[p];
  },
  existsSync: (p) => p in files,
});

test('a complete staged download is found', () => {
  const io = stubFs({
    '/c/pending/update-info.json': '{"fileName":"Nami-arm64.zip","sha512":"x"}',
    '/c/pending/Nami-arm64.zip': 'bytes',
  });
  assert.equal(hasStagedFile('/c', io), true);
});

test('info without the file it names is not a staged download', () => {
  // electron-updater empties this directory on some failures, and a note
  // pointing at a file that is gone must not read as "ready to install".
  const io = stubFs({ '/c/pending/update-info.json': '{"fileName":"Nami-arm64.zip"}' });
  assert.equal(hasStagedFile('/c', io), false);
});

test('an empty cache is not a staged download', () => {
  assert.equal(hasStagedFile('/c', stubFs({})), false);
});

test('unreadable json is not a staged download', () => {
  const io = stubFs({ '/c/pending/update-info.json': 'not json{' });
  assert.equal(hasStagedFile('/c', io), false);
});

test('info with no file name is not a staged download', () => {
  const io = stubFs({ '/c/pending/update-info.json': '{"sha512":"x"}' });
  assert.equal(hasStagedFile('/c', io), false);
});
