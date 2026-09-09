import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parsePasswordCsv, createProfileStore } = require('../src/main/browser-profiles');
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
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
