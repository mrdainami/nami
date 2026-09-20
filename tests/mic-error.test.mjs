import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micErrorText } from '../src/renderer/mic-error.mjs';

const dom = (name, message) => Object.assign(new Error(message), { name });

test('the Mac shows the browser\'s own message, whatever the error', () => {
  for (const e of [dom('NotAllowedError', 'Permission denied'), dom('NotFoundError', 'Requested device not found'), new Error('Stop session dictation before recording a comment.')]) {
    assert.equal(micErrorText(e, 'darwin'), e.message);
  }
});

test('Windows names the privacy setting when the microphone is refused', () => {
  for (const e of [dom('NotAllowedError', 'Permission denied'), dom('NotAllowedError', 'Permission denied by system'), dom('NotReadableError', 'Could not start audio source')]) {
    const text = micErrorText(e, 'win32');
    assert.match(text, /Settings → Privacy & security → Microphone/);
    assert.match(text, /Let desktop apps access your microphone/);
    assert.doesNotMatch(text, /Permission denied|audio source/);
  }
});

test('Windows says so when there is no microphone at all', () => {
  const text = micErrorText(dom('NotFoundError', 'Requested device not found'), 'win32');
  assert.match(text, /No microphone was found/);
  assert.doesNotMatch(text, /Privacy/);
});

test('an error that is not about the device keeps its own words on Windows too', () => {
  assert.equal(micErrorText(new Error('Choose a speech provider in Settings → Voice first.'), 'win32'), 'Choose a speech provider in Settings → Voice first.');
  assert.equal(micErrorText(dom('AbortError', 'Starting audio failed'), 'win32'), 'Starting audio failed');
});

test('nothing on Windows mentions a Mac, and a missing error is survived', () => {
  assert.doesNotMatch(micErrorText(dom('NotAllowedError', 'x'), 'win32'), /Mac|System Settings/);
  assert.equal(micErrorText(null, 'win32'), 'null');
  assert.equal(micErrorText(undefined, 'darwin'), 'undefined');
});
