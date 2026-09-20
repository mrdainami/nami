// "Import from Chrome" on both platforms, asked from one machine: what main
// says can be copied, what it refuses at the door, what the worker does if it
// is reached anyway, and what the screen draws from the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { importCategories, importNote } from '../src/renderer/browser-import-note.mjs';

const require = createRequire(import.meta.url);
const { importCapability, refusedCategories, importRefusal, importableSources, WINDOWS_REFUSAL } = require('../src/main/browser-import-capability.js');
const { readImportSource } = require('../src/main/browser-import-worker.js');
const { DatabaseSync } = require('node:sqlite');

test('capability: the Mac copies everything it always did', () => {
  assert.deepEqual(importCapability('darwin'), { available: true, reason: '', categories: ['cookies', 'passwords', 'history'] });
  assert.equal(importRefusal({}, 'darwin'), '');
  assert.equal(importRefusal({ cookies: true, passwords: true, history: true }, 'darwin'), '');
  assert.deepEqual(refusedCategories({}, 'darwin'), []);
});

test('capability: Windows says sign-ins are app-bound and keeps history', () => {
  assert.deepEqual(importCapability('win32'), { available: false, reason: 'windows-app-bound', categories: ['history'] });
  const again = importCapability('win32'); again.categories.push('cookies');
  assert.deepEqual(importCapability('win32').categories, ['history'], 'a caller cannot widen the answer for the next one');
});

test('refusal: on Windows a category is wanted unless it was switched off, as the job queue reads it', () => {
  assert.deepEqual(refusedCategories({}, 'win32'), ['cookies', 'passwords']);
  assert.deepEqual(refusedCategories({ cookies: true, passwords: false, history: false }, 'win32'), ['cookies']);
  assert.deepEqual(refusedCategories({ cookies: false, passwords: false, history: true }, 'win32'), []);
  assert.equal(importRefusal({ cookies: false, passwords: false, history: true }, 'win32'), '');
  assert.equal(importRefusal({ cookies: false, passwords: false }, 'win32'), '', 'history left unsaid is history wanted, and history is fine');
  for (const args of [{}, { history: false }, { cookies: true, passwords: false, history: false }, { passwords: true, cookies: false }]) {
    const said = importRefusal(args, 'win32');
    assert.equal(said, WINDOWS_REFUSAL);
    assert.doesNotMatch(said, /Keychain|macOS|Mac\b/);
  }
});

test('sources: only a profile that holds something this platform can copy is offered', () => {
  const status = { available: true, browsers: [
    { id: 'a', browser: 'Edge', name: 'Default', cookies: true, passwords: true, history: true },
    { id: 'b', browser: 'Chrome', name: 'Work', cookies: true, passwords: true, history: false },
  ] };
  assert.deepEqual(importableSources(status, 'darwin'), status);
  assert.deepEqual(importableSources(status, 'win32').browsers.map((s) => s.id), ['a']);
  assert.deepEqual(importableSources({ available: true, browsers: [status.browsers[1]] }, 'win32'), { available: false, browsers: [] });
  assert.deepEqual(importableSources(undefined, 'win32'), { available: false, browsers: [] });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-import-capability-')), directory = path.join(root, 'snapshots');
  fs.mkdirSync(directory);
  const cookies = path.join(root, 'Cookies'), logins = path.join(root, 'Login Data'), history = path.join(root, 'History');
  let db = new DatabaseSync(cookies);
  db.exec('CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER)');
  db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)').run('example.test', 'plain', 'synthetic-secret', Buffer.alloc(0), '/', 0, 1, 1, 1);
  db.close();
  db = new DatabaseSync(logins);
  db.exec('CREATE TABLE logins(origin_url TEXT,username_value TEXT,password_value BLOB)');
  db.prepare('INSERT INTO logins VALUES(?,?,?)').run('https://example.test/login', 'fixture-user', 'synthetic-password');
  db.close();
  db = new DatabaseSync(history);
  db.exec('CREATE TABLE urls (url TEXT,title TEXT,last_visit_time INTEGER)');
  db.prepare('INSERT INTO urls VALUES (?,?,?)').run('https://example.test/', 'Example', 13400000000000000n);
  db.close();
  return { root, directory, source: { id: 'source', browser: 'Edge', name: 'Fixture', cookies, logins, history } };
}

test('worker: reached on Windows anyway, it copies history and refuses sign-ins without asking for a key', async () => {
  const f = fixture(), events = [], rows = [];
  let asked = 0;
  try {
    await readImportSource({ source: f.source, categories: { cookies: true, passwords: true, history: true }, directory: f.directory, platform: 'win32',
      cancelled: () => false, passwordFor: async () => { asked++; return 'fixture-key'; }, send: (e) => events.push(e), batch: async (k, batch) => rows.push([k, ...batch]) });
    assert.equal(asked, 0, 'no key is asked for on a platform that has none to give');
    assert.equal(events.some((e) => e.stage === 'keychain'), false);
    assert.deepEqual(rows.map((r) => r[0]), ['history'], 'even an unencrypted cookie stays where it is');
    for (const category of ['cookies', 'passwords']) {
      assert.equal(events.find((e) => e.type === 'result' && e.category === category)?.error, WINDOWS_REFUSAL);
      assert.ok(events.some((e) => e.type === 'category-done' && e.category === category), category + ' is finished, not left hanging');
    }
    assert.doesNotMatch(JSON.stringify(events), /Keychain|synthetic/);
    assert.deepEqual(fs.readdirSync(f.directory), []);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('worker: on the Mac the same request still asks the Keychain and copies all three', async () => {
  const f = fixture(), events = [], rows = [];
  let asked = 0;
  try {
    await readImportSource({ source: f.source, categories: { cookies: true, passwords: true, history: true }, directory: f.directory, platform: 'darwin',
      cancelled: () => false, passwordFor: async () => { asked++; return null; }, send: (e) => events.push(e), batch: async (k, batch) => rows.push([k, ...batch]) });
    assert.equal(asked, 1);
    assert.equal(events[0].stage, 'keychain');
    assert.deepEqual(rows.map((r) => r[0]), ['cookies', 'passwords', 'history']);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('screen: with no word from main, or a Mac answer, it draws what it always drew', () => {
  for (const capability of [undefined, null, {}, importCapability('darwin')]) {
    assert.deepEqual(importCategories(capability), ['passwords', 'cookies', 'history']);
    assert.equal(importNote(capability), '');
  }
});

test('screen: on Windows the sign-in boxes give way to one plain sentence', () => {
  const capability = importCapability('win32');
  assert.deepEqual(importCategories(capability), ['history']);
  const note = importNote(capability);
  assert.match(note, /^Windows browsers lock their saved sign-ins to the browser itself, so Nami cannot copy them/);
  assert.match(note, /signing in inside this browser tile works and is remembered\.$/);
  assert.equal((note.match(/[.!?](\s|$)/g) || []).length, 1, 'one sentence');
  assert.doesNotMatch(note, /Keychain|macOS|\bMac\b|Finder|⌘/);
  assert.doesNotMatch(importNote({ available: false, reason: 'something-new' }), /Keychain|macOS|\bMac\b|Windows/);
});
