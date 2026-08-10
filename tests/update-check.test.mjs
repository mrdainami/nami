import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isNewer, releaseFromApi, checkForUpdate, updateStatus } = require('../src/main/update-check.js');

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
  html_url: 'https://github.com/mrdainami/nami/releases/tag/v0.2.0',
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
  assert.equal(r.url, 'https://github.com/mrdainami/nami/releases/tag/v0.2.0');
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

// --- the manual check, which owes the user a straight answer -----------------
//
// The background poll is built to fail quietly: offline and up-to-date both end
// as "no news", which is right for a check nobody asked for. A button is the
// opposite. Someone pressed it and is waiting, so "I could not reach GitHub"
// must never be dressed up as "you are up to date".

test('a newer release comes back as an update, with somewhere to get it', async () => {
  const st = await updateStatus({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => release(),
  });
  assert.equal(st.state, 'update');
  assert.equal(st.version, '0.2.0');
  assert.equal(st.url, 'https://example.test/arm64.dmg');
});

test('the same version comes back as current', async () => {
  const st = await updateStatus({
    currentVersion: '0.2.0', arch: 'arm64',
    fetchJson: async () => release(),
  });
  assert.deepEqual(st, { state: 'current' });
});

test('being ahead of the release still reads as current', async () => {
  const st = await updateStatus({
    currentVersion: '0.3.0', arch: 'arm64',
    fetchJson: async () => release(),
  });
  assert.deepEqual(st, { state: 'current' });
});

test('a network failure says so instead of claiming we are current', async () => {
  // the whole point of the second entry point
  const st = await updateStatus({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  assert.deepEqual(st, { state: 'offline' });
});

test('a draft-only latest reads as current, not as an error', async () => {
  // GitHub answered, there is simply nothing a user could install
  const st = await updateStatus({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => release({ draft: true }),
  });
  assert.deepEqual(st, { state: 'current' });
});

test('the background poll keeps its old contract exactly', async () => {
  // everything else in the app still calls checkForUpdate and expects null
  const quiet = await checkForUpdate({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => { throw new Error('offline'); },
  });
  assert.equal(quiet, null);
  const found = await checkForUpdate({
    currentVersion: '0.1.0', arch: 'arm64',
    fetchJson: async () => release(),
  });
  assert.deepEqual(found, { version: '0.2.0', url: 'https://example.test/arm64.dmg' });
});
