import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { browserFileUrl } = require('../src/main/browser-file.js');

function fileStat() { return { isFile: () => true }; }

test('browserFileUrl accepts existing absolute html paths', () => {
  assert.equal(
    browserFileUrl('/Users/cal/My Site/index.html', { statSync: fileStat }),
    'file:///Users/cal/My%20Site/index.html',
  );
  assert.equal(
    browserFileUrl('/tmp/report.HTM', { statSync: fileStat }),
    'file:///tmp/report.HTM',
  );
});

test('browserFileUrl refuses relative paths and non-html files', () => {
  assert.equal(browserFileUrl('site/index.html', { statSync: fileStat }), null);
  assert.equal(browserFileUrl('/tmp/readme.md', { statSync: fileStat }), null);
  assert.equal(browserFileUrl('/tmp/page.html.js', { statSync: fileStat }), null);
});

test('browserFileUrl refuses missing paths and directories', () => {
  assert.equal(browserFileUrl('/tmp/missing.html', { statSync: () => { throw new Error('missing'); } }), null);
  assert.equal(browserFileUrl('/tmp/folder.html', { statSync: () => ({ isFile: () => false }) }), null);
});
