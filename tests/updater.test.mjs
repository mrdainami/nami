import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { nextState, percentOf, downloadUpdate, updaterState } = require('../src/main/updater.js');

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
