import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isNewer, releaseFromApi, checkForUpdate } = require('../src/main/update-check.js');

// --- is there actually a newer version? --------------------------------------

test('a higher patch is newer', () => {
  assert.equal(isNewer('0.1.1', '0.1.0'), true);
});

test('the same version is not newer', () => {
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
});

test('an older version is not newer', () => {
  assert.equal(isNewer('0.1.0', '0.2.0'), false);
});

test('a v prefix on the tag is tolerated', () => {
  assert.equal(isNewer('v0.2.0', '0.1.0'), true);
});

test('versions compare by number, not by text', () => {
  // '0.10.0' < '0.9.0' as strings — the bug this test exists to catch, and the
  // one that would silently stop offering updates the day the minor hits 10.
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
});

test('a missing segment counts as zero', () => {
  assert.equal(isNewer('0.2', '0.1.9'), true);
});

test('a prerelease is older than the release it leads to', () => {
  assert.equal(isNewer('0.2.0-beta.1', '0.2.0'), false);
});

test('a release is newer than its own prerelease', () => {
  assert.equal(isNewer('0.2.0', '0.2.0-beta.1'), true);
});

test('rubbish is never newer', () => {
  assert.equal(isNewer('', '0.1.0'), false);
  assert.equal(isNewer(null, '0.1.0'), false);
  assert.equal(isNewer('banana', '0.1.0'), false);
});

// --- reading GitHub's answer --------------------------------------------------

const release = (over = {}) => ({
  tag_name: 'v0.2.0',
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/mrdainami/nami-releases/releases/tag/v0.2.0',
  assets: [
    { name: 'Nami-0.2.0-arm64.dmg', browser_download_url: 'https://example.test/arm64.dmg' },
    { name: 'Nami-0.2.0.dmg', browser_download_url: 'https://example.test/x64.dmg' },
  ],
  ...over,
});

test('reads the version off the tag', () => {
  assert.equal(releaseFromApi(release()).version, '0.2.0');
});

test('offers the dmg built for this machine', () => {
  assert.equal(releaseFromApi(release(), 'arm64').url, 'https://example.test/arm64.dmg');
  assert.equal(releaseFromApi(release(), 'x64').url, 'https://example.test/x64.dmg');
});

test('falls back to the release page when no dmg matches', () => {
  const r = releaseFromApi(release({ assets: [] }), 'arm64');
  assert.equal(r.url, 'https://github.com/mrdainami/nami-releases/releases/tag/v0.2.0');
});

test('a draft is not a release', () => {
  assert.equal(releaseFromApi(release({ draft: true })), null);
});

test('a prerelease is not offered', () => {
  assert.equal(releaseFromApi(release({ prerelease: true })), null);
});

test('a malformed answer yields nothing rather than throwing', () => {
  assert.equal(releaseFromApi(null), null);
  assert.equal(releaseFromApi({}), null);
  assert.equal(releaseFromApi({ tag_name: '' }), null);
  assert.equal(releaseFromApi('not json at all'), null);
});

// --- the whole check ----------------------------------------------------------

test('reports an update when the published release is newer', async () => {
  const found = await checkForUpdate({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => release(),
  });
  assert.deepEqual(found, { version: '0.2.0', url: 'https://example.test/arm64.dmg' });
});

test('says nothing when we are already current', async () => {
  const found = await checkForUpdate({
    currentVersion: '0.2.0', arch: 'arm64',
    fetchJson: async () => release(),
  });
  assert.equal(found, null);
});

test('says nothing when we are ahead of the release', async () => {
  const found = await checkForUpdate({
    currentVersion: '0.3.0', arch: 'arm64',
    fetchJson: async () => release(),
  });
  assert.equal(found, null);
});

test('a network failure is silent', async () => {
  // Offline, rate-limited or behind a captive portal must never reach the user:
  // an update check is the app's business, not something it can nag about.
  const found = await checkForUpdate({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  assert.equal(found, null);
});

test('a rate-limit body is silent', async () => {
  const found = await checkForUpdate({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => ({ message: 'API rate limit exceeded' }),
  });
  assert.equal(found, null);
});
