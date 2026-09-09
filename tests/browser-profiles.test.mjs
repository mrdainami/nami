import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parsePasswordCsv, createProfileStore, isGoogleHost, filterImportableCookies, detectChromiumProfiles, deriveChromeKey, decryptChromeCookie, readChromeCookieRows, cookieUrl, chromeExpiryUnix, importChromiumCookies, readChromeLogins } = require('../src/main/browser-profiles');
const { userBrowserUrl, browserUrl, cleanSelection, cleanAnnotationLayout } = require('../src/main/browser-policy');
test('human address input resolves domains and searches without relaxing agent navigation', () => {
  assert.equal(userBrowserUrl(' youtube.com '), 'https://youtube.com/');
  assert.equal(userBrowserUrl('example.com:8443/path'), 'https://example.com:8443/path');
  assert.equal(userBrowserUrl('example.com/path?q=a'), 'https://example.com/path?q=a');
  assert.equal(userBrowserUrl('localhost:3000?q=a'), 'http://localhost:3000/?q=a');
  assert.equal(userBrowserUrl('127.0.0.1:5173'), 'http://127.0.0.1:5173/');
  assert.equal(userBrowserUrl('[::1]:5173'), 'http://[::1]:5173/');
  assert.equal(userBrowserUrl('apple laptops'), 'https://www.google.com/search?q=apple%20laptops');
  assert.equal(userBrowserUrl('   '), null);
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'https://user:password@example.com']) assert.throws(() => userBrowserUrl(value));
  assert.throws(() => browserUrl('youtube.com'));
  assert.throws(() => browserUrl('apple laptops'));
});
test('annotation metadata is bounded and private comments cannot enter layout events', () => {
  const rect = { x: 1, y: 2, width: 3, height: 4 };
  assert.deepEqual(cleanSelection({ rect, selectionId: 'note-1', documentId: 'doc', kind: 'region' }, 'https://example.com').rect, rect);
  assert.deepEqual(cleanAnnotationLayout({ selections: [null, false] }).selections, []);
  const layout = cleanAnnotationLayout({ documentId: 'd', note: 'private', selections: [{ selectionId: 'one', rect, note: 'private' }] });
  assert.equal(JSON.stringify(layout).includes('private'), false);
  assert.equal(cleanSelection({ rect: { ...rect, width: Infinity } }, '').rect, null);
});
test('Chrome CSV parser preserves commas, escaped quotes and multiline passwords and reports unsupported rows', () => {
  const result = parsePasswordCsv('name,url,username,password,note\r\nExample,https://example.com/login,"a,b","pa""ss\nword",x\r\nBad,android://app,u,p,x\r\n');
  assert.deepEqual(result.entries, [{ origin: 'https://example.com', username: 'a,b', password: 'pa"ss\nword' }]);
  assert.equal(result.skipped, 1);
  assert.throws(() => parsePasswordCsv('name,url\nx,https://example.com'));
  assert.throws(() => parsePasswordCsv('url,username,password\nhttps://example.com,u,"bad'));
});
test('profile vault persists encrypted data, exposes only metadata, exact-matches origins and deletes credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-profile-test-'));
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decryptString(value) { const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString(); },
  };
  try {
    const store = createProfileStore({ directory, safeStorage });
    const work = store.create('Work');
    const result = store.importPasswords(work.id, 'url,username,password\nhttps://example.com/login,calvin,private-test-secret\n');
    assert.deepEqual(result, { imported: 1, skipped: 0 });
    const list = store.credentials(work.id);
    assert.equal(JSON.stringify(list).includes('private-test-secret'), false);
    assert.equal(fs.readFileSync(path.join(directory, work.id + '.vault')).includes('private-test-secret'), false);
    assert.equal(store.credentials('default').length, 0);
    assert.throws(() => store.credential(work.id, list[0].id, 'https://evil.example.com'));
    assert.equal(store.credential(work.id, list[0].id, 'https://example.com').password, 'private-test-secret');
    const restarted = createProfileStore({ directory, safeStorage });
    assert.equal(restarted.credentials(work.id).length, 1);
    restarted.deleteCredential(work.id, list[0].id); assert.equal(restarted.credentials(work.id).length, 0);
    restarted.remove(work.id); assert.equal(restarted.list().length, 1);
    assert.throws(() => restarted.remove('default'));
    assert.throws(() => restarted.get('../../other'));
    const locked = createProfileStore({ directory, safeStorage: { isEncryptionAvailable: () => false } });
    assert.throws(() => locked.importPasswords('default', 'url,username,password\nhttps://example.com,u,p'));
    restarted.configure('default', { downloadMode: 'auto', popupMode: 'oauth', origin: 'https://meet.example', permission: 'media', value: 'allow' });
    assert.equal(restarted.list()[0].downloadMode, 'auto');
    assert.equal(restarted.list()[0].permissions['https://meet.example'].media, 'allow');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cookie import skips Google hosts from fixtures and never logs values', () => {
  const cookies = [
    { host_key: '.google.com', name: 'SID', value: 'must-not-copy' },
    { host_key: 'accounts.google.com', name: 'LSID', value: 'must-not-copy' },
    { host_key: '.youtube.com', name: 'VISITOR_INFO1_LIVE', value: 'must-not-copy' },
    { host_key: '.googleapis.com', name: 'NID', value: 'must-not-copy' },
    { host_key: 'google.co.uk', name: 'SID', value: 'must-not-copy' },
    { host_key: '.example.com', name: 'session', value: 'fixture-keep' },
    { host_key: 'news.example.org', name: 'id', value: 'fixture-keep-2' },
  ];
  assert.equal(isGoogleHost('.google.com'), true);
  assert.equal(isGoogleHost('youtube.com'), true);
  assert.equal(isGoogleHost('meet.google.com'), true);
  assert.equal(isGoogleHost('.example.com'), false);
  const { keep, skippedGoogle } = filterImportableCookies(cookies);
  assert.equal(skippedGoogle, 5);
  assert.deepEqual(keep.map((c) => c.host_key), ['.example.com', 'news.example.org']);
  const dump = JSON.stringify({ keep: keep.map(({ host_key, name }) => ({ host_key, name })), skippedGoogle });
  assert.equal(dump.includes('must-not-copy'), false);
  assert.equal(dump.includes('fixture-keep'), false);
});

test('Chromium profile detection uses an injected home and never the real Chrome user-data dir', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-chrome-home-'));
  try {
    const cookies = path.join(home, 'Library/Application Support/Google/Chrome/Default/Network/Cookies');
    fs.mkdirSync(path.dirname(cookies), { recursive: true });
    fs.writeFileSync(cookies, '');
    fs.writeFileSync(path.join(home, 'Library/Application Support/Google/Chrome/Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }));
    const edge = path.join(home, 'Library/Application Support/Microsoft Edge/Default/Cookies');
    fs.mkdirSync(path.dirname(edge), { recursive: true });
    fs.writeFileSync(edge, '');
    const found = detectChromiumProfiles({ home, platform: 'darwin' });
    assert.equal(found.length, 2);
    assert.equal(found[0].browser, 'Chrome');
    assert.equal(found[0].name, 'Person 1');
    assert.equal(found[1].browser, 'Edge');
    assert.ok(found.every((p) => p.cookies.startsWith(home)));
    assert.equal(found.some((p) => p.cookies.includes(os.homedir()) && !p.cookies.startsWith(home)), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Chrome cookie files at Default/Cookies are found when Network/Cookies is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-chrome-legacy-'));
  try {
    const cookies = path.join(home, 'Library/Application Support/Google/Chrome/Default/Cookies');
    fs.mkdirSync(path.dirname(cookies), { recursive: true });
    fs.writeFileSync(cookies, '');
    fs.writeFileSync(path.join(home, 'Library/Application Support/Google/Chrome/Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Calvin' } } } }));
    const found = detectChromiumProfiles({ home, platform: 'darwin' });
    assert.equal(found.length, 1);
    assert.equal(found[0].cookies, cookies);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('v10 cookie decrypt works on a fixture blob and refuses v20', () => {
  const key = deriveChromeKey('fixture-password');
  const iv = Buffer.alloc(16, ' ');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update('fixture-cookie-value'), cipher.final()]);
  assert.equal(decryptChromeCookie(encrypted, key), 'fixture-cookie-value');
  assert.equal(decryptChromeCookie(Buffer.concat([Buffer.from('v20'), encrypted.subarray(3)]), key), null);
  assert.equal(cookieUrl({ host_key: '.example.com', path: '/', is_secure: 1 }), 'https://example.com/');
  assert.ok(chromeExpiryUnix(13400000000000000) > 1_700_000_000);
});

test('Chrome cookie rows are read from a fixture database, never a live profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-cookie-db-'));
  try {
    const { DatabaseSync } = require('node:sqlite');
    const file = path.join(dir, 'Cookies');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)');
    db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('.example.com', 'session', 'plain-fixture', Buffer.alloc(0), '/', 0, 1, 1, 1);
    db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('.google.com', 'SID', 'google-fixture', Buffer.alloc(0), '/', 0, 1, 1, 1);
    db.close();
    const rows = readChromeCookieRows(file);
    const { keep, skippedGoogle } = filterImportableCookies(rows);
    assert.equal(keep.length, 1);
    assert.equal(keep[0].name, 'session');
    assert.equal(skippedGoogle, 1);
    assert.equal(JSON.stringify(keep.map(({ host_key, name }) => ({ host_key, name }))).includes('google-fixture'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Chrome login rows decrypt with a fixture key and copy into the vault', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-login-db-'));
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-vault-'));
  try {
    const key = deriveChromeKey('fixture-password');
    const iv = Buffer.alloc(16, ' ');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update('secret-pass'), cipher.final()]);
    const { DatabaseSync } = require('node:sqlite');
    const file = path.join(dir, 'Login Data');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB)');
    db.prepare('INSERT INTO logins VALUES (?, ?, ?)').run('https://shop.example/login', 'ada', encrypted);
    db.close();
    const parsed = readChromeLogins(file, key);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].username, 'ada');
    assert.equal(parsed.entries[0].password, 'secret-pass');
    const store = createProfileStore({ directory: vault, safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() } });
    assert.equal(store.importLogins('default', parsed.entries).imported, 1);
    assert.equal(store.credentials('default')[0].username, 'ada');
    assert.equal(store.credential('default', store.credentials('default')[0].id, 'https://shop.example').password, 'secret-pass');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(vault, { recursive: true, force: true }); }
});

test('cookie import can keep Google cookies when asked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-cookie-keep-'));
  try {
    const { DatabaseSync } = require('node:sqlite');
    const file = path.join(dir, 'Cookies');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)');
    db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('.example.com', 'session', 'keep-me', Buffer.alloc(0), '/', 0, 1, 1, 1);
    db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('.google.com', 'SID', 'google-keep', Buffer.alloc(0), '/', 0, 1, 1, 1);
    db.close();
    const kept = [];
    await importChromiumCookies({
      session: { cookies: { set: async (c) => kept.push(c.name + ':' + c.value) } },
      includeGoogle: true,
      sources: [{ cookies: file }],
      passwordFor: () => null,
    });
    assert.ok(kept.includes('session:keep-me'));
    assert.ok(kept.includes('SID:google-keep'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
