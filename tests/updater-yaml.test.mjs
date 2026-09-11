import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { parseUpdateInfo, getFileList, resolveFiles } = require('electron-updater/out/providers/Provider');
const source = new URL('https://updates.example.test/latest-mac.yml');
const parse = text => parseUpdateInfo(text, 'latest-mac.yml', source);

test('the installed updater reads both Mac artifacts and their integrity metadata', () => {
  const digest = Buffer.alloc(64, 7).toString('base64');
  const info = parse(`version: 0.5.2\nfiles:\n  - url: Nami-arm64.zip\n    sha512: ${digest}\n    size: 1234\n  - url: Nami-x64.zip\n    sha512: ${digest}\n    size: 5678\npath: Nami-arm64.zip\nsha512: ${digest}\n`);
  assert.equal(info.version, '0.5.2');
  assert.equal(info.sha512, digest);
  assert.deepEqual(getFileList(info).map(f => [f.url, f.size, f.sha512]), [
    ['Nami-arm64.zip', 1234, digest], ['Nami-x64.zip', 5678, digest],
  ]);
  assert.deepEqual(resolveFiles(info, source).map(f => f.url.href), [
    'https://updates.example.test/Nami-arm64.zip', 'https://updates.example.test/Nami-x64.zip',
  ]);
});

test('the installed updater rejects malformed YAML and artifacts without checksums', () => {
  assert.throws(() => parse('files: [unterminated'), { code: 'ERR_UPDATER_INVALID_UPDATE_INFO' });
  assert.throws(() => parse(null), { code: 'ERR_UPDATER_INVALID_UPDATE_INFO' });
  assert.throws(() => resolveFiles(parse('version: 0.5.2\nfiles:\n  - url: Nami-arm64.zip\n'), source), { code: 'ERR_UPDATER_NO_CHECKSUM' });
});

test('the updater rejects repeated empty YAML merges within its work budget', () => {
  // A small fixture reproduces the empty-source budget bypass without burning
  // CPU in the test runner. A timeout contains any future parser regression.
  const child = spawnSync(process.execPath, ['-e', `
    const { parseUpdateInfo } = require('electron-updater/out/providers/Provider');
    const text = 'arr: &arr [' + Array(200).fill('{}').join(',') + ']\\nitems:\\n' + '  - <<: *arr\\n'.repeat(200);
    try { parseUpdateInfo(text, 'fixture.yml', new URL('https://updates.example.test/fixture.yml')); }
    catch (e) { if (e.code === 'ERR_UPDATER_INVALID_UPDATE_INFO' && /maxTotalMergeKeys|abnormal merge sequence size/.test(e.message)) process.exit(0); process.exit(2); }
    process.exit(1);
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
  assert.equal(child.error, undefined, 'bounded parser process must finish');
  assert.equal(child.status, 0, 'excessive empty merges must be rejected by the installed updater');
});
