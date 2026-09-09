// Chrome writes time as microseconds since 1601, which today is a 17-digit
// integer — larger than Number.MAX_SAFE_INTEGER. node:sqlite refuses to coerce
// an INTEGER that big into a JavaScript number and throws ERR_OUT_OF_RANGE
// before returning a single row, so importing cookies and history failed
// wholesale while passwords (all TEXT and BLOB) came through fine.
//
// The bare `catch` around each read then reported every failure as `locked`,
// and the UI turned that into "Quit Chrome and try again" — advice that could
// never work, because Chrome was never holding anything.
//
// The existing cookie fixture in browser-profiles.test.mjs stores
// `expires_utc = 0`, which is why the suite was green through all of it. Every
// timestamp below is a real value read off a live profile.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readChromeCookieRows, readChromeHistory, readChromeLogins, detectChromiumProfiles, chromeTimeToMs, chromeKeychainPassword, readFailure, decryptChromeCookieValue, decryptChromeCookie, deriveChromeKey, stripCookieDomainHash } = require('../src/main/browser-profiles');

// Real values, copied from a live Chrome profile. Both are > 2^53.
const EXPIRES_UTC = 13433531963056867;
const LAST_VISIT = 13433436295579710;

const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'nami-' + tag + '-'));

function withDb(tag, build, run) {
  const dir = tmpdir(tag);
  try {
    const { DatabaseSync } = require('node:sqlite');
    const file = path.join(dir, tag);
    const db = new DatabaseSync(file);
    build(db);
    db.close();
    return run(file, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a cookie expiry past 2^53 is read, not thrown away', () => {
  withDb('Cookies', (db) => {
    db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)');
    db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('.example.com', 'session', 'plain', Buffer.alloc(0), '/', EXPIRES_UTC, 1, 1, 0);
  }, (file) => {
    const rows = readChromeCookieRows(file);
    assert.equal(rows.length, 1, 'the row must survive the read');
    const row = rows[0];
    // A Number, not a BigInt: every consumer downstream — cookieUrl,
    // chromeExpiryUnix, the samesite lookup — was written against numbers, and
    // converting once here is cheaper than auditing each of them.
    assert.equal(typeof row.expires_utc, 'number');
    assert.ok(Number.isFinite(row.expires_utc));
    assert.equal(typeof row.is_secure, 'number');
    assert.equal(typeof row.samesite, 'number');
    assert.equal(row.host_key, '.example.com');
    assert.equal(row.name, 'session');
  });
});

test('a history visit time past 2^53 is read, not reported as locked', () => {
  withDb('History', (db) => {
    db.exec('CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)');
    db.prepare('INSERT INTO urls VALUES (?, ?, ?)').run('https://example.com/', 'Example', LAST_VISIT);
  }, (file) => {
    const parsed = readChromeHistory(file);
    assert.equal(parsed.locked, false, 'nothing here is locked');
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].title, 'Example');
    // The visit lands in this century rather than at the epoch or in 1601.
    const at = parsed.entries[0].at;
    assert.ok(at > Date.parse('2024-01-01') && at < Date.parse('2100-01-01'), 'visit time out of range: ' + new Date(at).toISOString());
  });
});

test('microsecond timestamps convert to milliseconds from either a number or a bigint', () => {
  const expected = Math.floor(LAST_VISIT / 1000 - 11_644_473_600_000);
  assert.equal(chromeTimeToMs(LAST_VISIT), expected);
  assert.equal(chromeTimeToMs(BigInt(LAST_VISIT)), expected);
});

test('a read that fails reports why, and only a real lock says to quit Chrome', () => {
  const dir = tmpdir('broken');
  try {
    const file = path.join(dir, 'History');
    fs.writeFileSync(file, 'this is not a database');
    const parsed = readChromeHistory(file);
    assert.equal(parsed.entries.length, 0);
    // The whole defect: a bare catch that names one cause names it for every
    // cause. A failure must carry its own reason so the message can be true.
    assert.equal(typeof parsed.error, 'string');
    assert.ok(parsed.error.length > 0);
    assert.equal(parsed.locked, false, 'a corrupt file is not a locked file');

    const logins = readChromeLogins(file, null);
    assert.equal(logins.entries.length, 0);
    assert.equal(typeof logins.error, 'string');
    assert.equal(logins.locked, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every Chromium browser on this platform is offered, each with its own layout', () => {
  const home = tmpdir('chromium-home');
  try {
    // Opera is the one that matters here: its data root IS its profile, with no
    // Default/ under it. A fixture that fabricates Default/ everywhere tests the
    // assumption rather than the disk, and would pass while a real Opera user
    // was told no profile existed.
    const wanted = [
      ['Library/Application Support/Google/Chrome', 'Chrome', 'Default'],
      ['Library/Application Support/Microsoft Edge', 'Edge', 'Default'],
      ['Library/Application Support/Chromium', 'Chromium', 'Default'],
      ['Library/Application Support/BraveSoftware/Brave-Browser', 'Brave', 'Default'],
      ['Library/Application Support/Arc/User Data', 'Arc', 'Default'],
      ['Library/Application Support/Vivaldi', 'Vivaldi', 'Default'],
      ['Library/Application Support/com.operasoftware.Opera', 'Opera', '.'],
    ];
    for (const [rel, , dir] of wanted) {
      const profile = path.join(home, rel, dir);
      fs.mkdirSync(profile, { recursive: true });
      fs.writeFileSync(path.join(profile, 'Cookies'), '');
    }
    const found = detectChromiumProfiles({ home, platform: 'darwin' });
    const names = new Set(found.map((s) => s.browser));
    for (const [, browser] of wanted) {
      assert.ok(names.has(browser), 'no profile found for ' + browser);
    }
    // One row per profile: a root that also holds databases must not be listed
    // twice once its named subfolders have been walked.
    assert.equal(found.length, new Set(found.map((s) => s.directory)).size);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('each browser is asked for its own Keychain key, never Chrome\'s', () => {
  const asked = [];
  const spy = (_cmd, args) => { asked.push(args[args.indexOf('-s') + 1]); return 'key-for-' + args[args.indexOf('-a') + 1]; };
  // Handing Brave's cookies Chrome's key is worse than finding no key at all:
  // the key is truthy, so the "allow Keychain access" hint is suppressed, and
  // every blob then fails its padding check and is silently counted as skipped.
  assert.equal(chromeKeychainPassword('Brave', spy), 'key-for-Brave');
  assert.equal(chromeKeychainPassword('Vivaldi', spy), 'key-for-Vivaldi');
  assert.equal(chromeKeychainPassword('Opera', spy), 'key-for-Opera');
  assert.equal(chromeKeychainPassword('Arc', spy), 'key-for-Arc');
  assert.equal(chromeKeychainPassword('Chromium', spy), 'key-for-Chromium');
  assert.equal(chromeKeychainPassword('Edge', spy), 'key-for-Microsoft Edge');
  assert.deepEqual(asked, ['Brave Safe Storage', 'Vivaldi Safe Storage', 'Opera Safe Storage', 'Arc Safe Storage', 'Chromium Safe Storage', 'Microsoft Edge Safe Storage']);
  // Chrome's own channels share Google Chrome's item, which is the default.
  for (const channel of ['Chrome', 'Chrome Beta', 'Chrome Canary']) {
    assert.equal(chromeKeychainPassword(channel, spy), 'key-for-Chrome');
  }
});

test('a permission denial is not a lock, so it never says to quit the browser', () => {
  // EACCES is a sandbox or TCC denial. Quitting the browser cannot fix one, and
  // saying so is the same wrong advice this change exists to remove.
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const busy = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
  assert.equal(readFailure(denied).locked, false);
  assert.match(readFailure(denied).error, /permission denied/);
  assert.equal(readFailure(busy).locked, true);
  assert.equal(readFailure(new Error('database is locked')).locked, true);
});

test('a cookie carrying Chrome\'s domain hash decrypts to just its value', () => {
  // Chrome 130+ prepends the SHA-256 of the cookie's domain to the plaintext.
  // Left in place it is 32 bytes of binary in front of the value, which
  // Chromium rejects as malformed — an import that reported success and signed
  // you into nothing. Measured on a real profile: 3,866 cookies decrypted,
  // 31 survived the write.
  const key = deriveChromeKey('fixture-password');
  const seal = (plain) => {
    const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
    return Buffer.concat([Buffer.from('v10'), c.update(plain), c.final()]);
  };
  const hash = crypto.createHash('sha256').update('example.com').digest();
  const wrapped = seal(Buffer.concat([hash, Buffer.from('session=abc123')]));
  assert.equal(decryptChromeCookieValue(wrapped, key), 'session=abc123');

  // An older profile has no prefix, and must come through untouched.
  assert.equal(decryptChromeCookieValue(seal(Buffer.from('plain-value')), key), 'plain-value');
  // Nor may a long printable value lose its first 32 characters.
  const long = 'abcdefghijklmnopqrstuvwxyz0123456789-and-more';
  assert.equal(decryptChromeCookieValue(seal(Buffer.from(long)), key), long);

  // Passwords are not wrapped, so their path must not strip anything.
  assert.equal(decryptChromeCookie(seal(Buffer.from('secret-pass')), key), 'secret-pass');
});

test('the domain hash is detected, never assumed', () => {
  assert.equal(stripCookieDomainHash(Buffer.from('short')).toString(), 'short');
  const printable = Buffer.from('x'.repeat(40));
  assert.equal(stripCookieDomainHash(printable).length, 40, 'printable text is a value, not a hash');
  const binary = Buffer.concat([Buffer.alloc(32), Buffer.from('kept')]);
  assert.equal(stripCookieDomainHash(binary).toString(), 'kept');
});
