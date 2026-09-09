import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { browserUrl, isBlankTab, cleanSelection, Access } = require('../src/main/browser-policy.js');

test('blank tabs are about:blank or the cream welcome file, never other file URLs', () => {
  assert.equal(isBlankTab('about:blank'), true);
  assert.equal(isBlankTab('file:///Users/cal/nami/src/renderer/browser-welcome.html'), true);
  assert.equal(isBlankTab('file:///tmp/browser-welcome.html'), true);
  assert.equal(isBlankTab(''), false);
  assert.equal(isBlankTab('https://example.com'), false);
  assert.equal(isBlankTab('file:///etc/passwd'), false);
  assert.equal(isBlankTab('file:///tmp/notes.html'), false);
});
test('browser URLs accept web pages but never privileged schemes or credentials', () => {
  assert.equal(browserUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(browserUrl('https://example.com/a'), 'https://example.com/a');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'nami-doc://doc/a/b', 'https://u:p@example.com', 'data:text/html,x']) assert.throws(() => browserUrl(url));
});
test('grant replacement revokes old targets and a window cannot take another grant', () => {
  const a = new Access(); a.register('s1', 1); a.register('s2', 2);
  a.grant('s1', 1, ['v1', 'v2']);
  assert.equal(a.allows('s1', 'v1'), true); assert.equal(a.allows('s2', 'v1'), false);
  assert.throws(() => a.grant('s1', 2, ['v3']));
  a.grant('s1', 1, ['v2']); assert.equal(a.allows('s1', 'v1'), false);
  a.removeWindow(1); assert.equal(a.allows('s1', 'v2'), false);
});
test('page supplied selections are bounded and have no terminal control characters', () => {
  const s = cleanSelection({ text: 'hello\x1b[31m', locator: '#button', note: 'x'.repeat(10000) }, 'https://example.com');
  assert.equal(s.url, 'https://example.com'); assert.equal(s.text.includes('\x1b'), false);
  assert.ok(s.note.length <= 4000);
  assert.throws(() => cleanSelection(null, 'https://example.com'));
});
