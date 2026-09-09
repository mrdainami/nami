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
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readChromeCookieRows, readChromeHistory, readChromeLogins, detectChromiumProfiles, chromeTimeToMs } = require('../src/main/browser-profiles');

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

test('every Chromium browser on this platform is offered, not only Google Chrome', () => {
  const home = tmpdir('chromium-home');
  try {
    const wanted = [
      ['Library/Application Support/Google/Chrome', 'Chrome'],
      ['Library/Application Support/Microsoft Edge', 'Edge'],
      ['Library/Application Support/Chromium', 'Chromium'],
      ['Library/Application Support/BraveSoftware/Brave-Browser', 'Brave'],
      ['Library/Application Support/Arc/User Data', 'Arc'],
      ['Library/Application Support/Vivaldi', 'Vivaldi'],
      ['Library/Application Support/com.operasoftware.Opera', 'Opera'],
    ];
    for (const [rel] of wanted) {
      const profile = path.join(home, rel, 'Default');
      fs.mkdirSync(profile, { recursive: true });
      fs.writeFileSync(path.join(profile, 'Cookies'), '');
    }
    const found = detectChromiumProfiles({ home, platform: 'darwin' });
    const names = new Set(found.map((s) => s.browser));
    for (const [, browser] of wanted) {
      assert.ok(names.has(browser), 'no profile found for ' + browser);
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
