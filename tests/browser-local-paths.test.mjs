import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveBrowserInput } = require('../src/main/browser-file');
const { browserUrl } = require('../src/main/browser-policy');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nami-local-paths-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'My café #1 100%.HTML');
  fs.writeFileSync(file, '<title>Local</title>');
  return { root, file };
}

test('human local path input opens the same real HTML file in its supported forms', t => {
  const { root, file } = fixture(t);
  for (const input of [file, '  ' + file + '  ', '"' + file + '"', "'" + file + "'", pathToFileURL(file).href, '~/' + path.basename(file)]) {
    const result = resolveBrowserInput(input, { homePath: root });
    assert.equal(result.filePath, file, input);
    assert.equal(result.url, pathToFileURL(file).href);
  }
});

test('file links are canonicalized and escaped without granting arbitrary browser URL schemes', t => {
  const { root, file } = fixture(t), link = path.join(root, 'linked.html');
  try {
    fs.symlinkSync(file, link, 'file');
    assert.equal(resolveBrowserInput(link).filePath, file);
  } catch (err) {
    if (err.code !== 'EPERM') throw err;
  }
  assert.throws(() => browserUrl(pathToFileURL(file).href));
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'nami-doc://doc/x/y', 'file://remote-host/share/index.html', 'https://user:pass@example.com']) assert.throws(() => resolveBrowserInput(value), value);
});

test('missing files, directories and non-HTML files produce useful errors', t => {
  const { root } = fixture(t);
  const missing = path.join(root, 'missing.html');
  assert.throws(() => resolveBrowserInput(missing), /not found/i);
  fs.mkdirSync(path.join(root, 'folder.html'));
  assert.throws(() => resolveBrowserInput(path.join(root, 'folder.html')), /HTML file/i);
  fs.writeFileSync(path.join(root, 'notes.txt'), 'notes');
  assert.throws(() => resolveBrowserInput(path.join(root, 'notes.txt')), /HTML file/i);
  assert.throws(() => resolveBrowserInput(path.join(root, 'bad\0.html')), /invalid/i);
  assert.throws(() => resolveBrowserInput('"' + missing), /quote/i);
});

test('web addresses, searches and blank input keep their existing behavior', () => {
  assert.deepEqual(resolveBrowserInput('example.com'), { url: 'https://example.com/' });
  assert.deepEqual(resolveBrowserInput('localhost:3000'), { url: 'http://localhost:3000/' });
  assert.deepEqual(resolveBrowserInput('local HTML tutorial'), { url: 'https://www.google.com/search?q=local%20HTML%20tutorial' });
  assert.deepEqual(resolveBrowserInput(''), { url: null });
});
