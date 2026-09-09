import test from 'node:test';
import assert from 'node:assert/strict';
import launch from '../src/main/browser-launch.js';
test('browser sharing launch flags stay off', () => {
  assert.deepEqual(launch.browserLaunchArgs('claude', { url: 'http://127.0.0.1:1234/session-token' }), []);
  assert.deepEqual(launch.browserLaunchArgs('codex', { url: 'http://127.0.0.1:1234/session-token' }), []);
  assert.deepEqual(launch.browserLaunchArgs(), []);
});
