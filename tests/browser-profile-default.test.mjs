import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { browserSettingsContent } from '../src/renderer/browser-settings.mjs';
const { createProfileStore } = createRequire(import.meta.url)('../src/main/browser-profiles');
const safeStorage = { isEncryptionAvailable() { throw Error('Profile preferences must not open Keychain'); } };
function fixture(t, records) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-default-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (records) fs.writeFileSync(path.join(directory, 'profiles.json'), JSON.stringify(records));
  const open = () => createProfileStore({ directory, safeStorage });
  return { directory, open, store: open() };
}
test('legacy profiles retain their IDs and data when a default is first remembered', t => {
  const records = [{ id: 'default', name: 'Personal', history: [{url:'https://personal.test/'}] }, {id:'work', name:'Work', history:[{url:'https://work.test/'}]}];
  const { store, open } = fixture(t, records);
  assert.equal(store.defaultId(), 'default');
  store.setDefault('work');
  assert.equal(open().defaultId(), 'work');
  assert.deepEqual(open().get('default').history, records[0].history);
  assert.deepEqual(open().get('work').history, records[1].history);
  assert.deepEqual(open().list().map(p => p.id), ['default', 'work']);
});
test('profile choices and different settings persist independently without reading passwords', t => {
  const { store, directory, open } = fixture(t);
  const work = store.create('Work');
  const vault = path.join(directory, work.id + '.vault');
  fs.writeFileSync(vault, 'opaque-encrypted-fixture');
  store.configure(work.id, {downloadMode:'auto', popupMode:'oauth', origin:'https://work.test', permission:'notifications', value:'allow'});
  store.configure('default', {downloadMode:'ask', popupMode:'block'});
  store.setDefault(work.id); store.setDefault('default'); store.setDefault(work.id);
  const restored = open();
  assert.equal(restored.defaultId(), work.id);
  assert.equal(restored.list().find(p => p.id === work.id).downloadMode, 'auto');
  assert.equal(restored.list().find(p => p.id === 'default').downloadMode, 'ask');
  assert.equal(restored.get(work.id).permissions['https://work.test'].notifications, 'allow');
  assert.equal(fs.readFileSync(vault, 'utf8'), 'opaque-encrypted-fixture');
});
test('failed preference or settings save does not change the in-memory or persisted value', t => {
  const { store, directory, open } = fixture(t);
  const work = store.create('Work');
  store.configure(work.id, {downloadMode:'ask', origin:'https://work.test', permission:'notifications', value:'deny'});
  const blocked = path.join(directory, 'profiles.json.tmp');
  fs.mkdirSync(blocked);
  assert.throws(() => store.setDefault(work.id));
  assert.equal(store.defaultId(), 'default');
  assert.throws(() => store.configure(work.id, {downloadMode:'auto', origin:'https://work.test', permission:'notifications', value:'allow'}));
  assert.equal(store.get(work.id).downloadMode, 'ask');
  assert.equal(store.get(work.id).permissions['https://work.test'].notifications, 'deny');
  fs.rmdirSync(blocked);
  assert.equal(open().defaultId(), 'default');
  assert.equal(open().get(work.id).downloadMode, 'ask');
  store.setDefault(work.id); assert.equal(open().defaultId(), work.id);
});
test('removing the preferred profile selects an existing fallback and invalid choices never silently select Personal', t => {
  const {store, open} = fixture(t);
  const work = store.create('Work'); store.setDefault(work.id);
  assert.throws(() => store.setDefault('missing'), /no longer available/);
  assert.equal(store.defaultId(), work.id);
  store.remove(work.id);
  assert.equal(store.defaultId(), 'default');
  assert.equal(open().defaultId(), 'default');
});
test('settings displays and edits only the selected profile, with a distinct default choice', () => {
  const status = { defaultProfileId:'work', profiles:[
    {id:'default',name:'Personal',downloadMode:'ask',popupMode:'block',permissions:{'https://personal.test':{notifications:'allow'}}},
    {id:'work',name:'Work',downloadMode:'auto',popupMode:'oauth',permissions:{'https://work.test':{notifications:'allow'}}}
  ]};
  const html = browserSettingsContent(status, {profileId:'work'});
  assert.match(html, /id="browser-settings-profile"/);
  assert.match(html, /value="work" selected/);
  assert.match(html, /id="browser-download-auto"[^>]*checked/);
  assert.match(html, /id="browser-popups-oauth"[^>]*checked/);
  assert.match(html, /https:\/\/work.test/);
  assert.doesNotMatch(html, /https:\/\/personal.test/);
  const personal = browserSettingsContent(status, {profileId:'default'});
  assert.match(personal, /id="browser-download-ask"[^>]*checked/);
  assert.match(personal, /Use Personal for new tabs/);
  const implicit = browserSettingsContent(status);
  assert.match(implicit, /value="work" selected/);
});
