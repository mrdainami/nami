import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { browserFileUrl } = require('../src/main/browser-file.js');

function fileStat() { return { isFile: () => true }; }

// An absolute path is /tmp/x on a Mac and C:\tmp\x on Windows, and its file url
// carries the drive: file:///C:/tmp/x. The url is still spelled out by hand
// below rather than made with pathToFileURL — that is the call under test.
const path = require('path');
const abs = (p) => path.resolve(p);
const DRIVE = path.parse(abs('/')).root.replace(/[\\/]+$/, '');   // '' or 'C:'
const fileUrl = (rest) => 'file://' + (DRIVE ? '/' + DRIVE : '') + rest;

test('browserFileUrl accepts existing absolute html paths', () => {
  assert.equal(
    browserFileUrl(abs('/Users/cal/My Site/index.html'), { statSync: fileStat }),
    fileUrl('/Users/cal/My%20Site/index.html'),
  );
  assert.equal(
    browserFileUrl(abs('/tmp/report.HTM'), { statSync: fileStat }),
    fileUrl('/tmp/report.HTM'),
  );
});

test('browserFileUrl refuses relative paths and non-html files', () => {
  assert.equal(browserFileUrl('site/index.html', { statSync: fileStat }), null);
  assert.equal(browserFileUrl(abs('/tmp/readme.md'), { statSync: fileStat }), null);
  assert.equal(browserFileUrl(abs('/tmp/page.html.js'), { statSync: fileStat }), null);
});

test('browserFileUrl refuses missing paths and directories', () => {
  assert.equal(browserFileUrl(abs('/tmp/missing.html'), { statSync: () => { throw new Error('missing'); } }), null);
  assert.equal(browserFileUrl(abs('/tmp/folder.html'), { statSync: () => ({ isFile: () => false }) }), null);
});
