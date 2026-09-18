import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCredentialStore, preferences, ERROR, SETTINGS_ERROR, CLEANUP_WARNING, CLEANUP_ERROR, SOURCE_CHANGED_ERROR, VAULT_WARNING, RECOVERY_WARNING } from '../src/main/credential-store.js';
import { writeSettings } from '../src/main/settings.js';
import { sttConfig } from '../src/main/stt.js';
const secret = ['dummy','value','987654321'].join('-');
function assertFailure(result, error) {
  assert.equal(result.ok, false);
  assert.equal(result.error, error);
  assert.equal(typeof result.cleanupPending, 'boolean');
  assert.ok(result.cleanupWarning === null || [CLEANUP_WARNING, VAULT_WARNING, RECOVERY_WARNING].includes(result.cleanupWarning));
}
function fixture(source = {}) {
  const files = new Map([['settings', JSON.stringify(source)]]), writes = [];
  const key = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: text => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(text), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); },
    decryptString: data => { const d = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0,12)); d.setAuthTag(data.subarray(12,28)); return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString(); },
  };
  const io = { exists: f => files.has(f), read: f => files.get(f), write: (f,t) => { writes.push([f,t]); files.set(f,t); } };
  const make = (extra = {}) => createCredentialStore({ file: 'vault', settingsFile: 'settings', io, encryption, ...extra });
  return { files, writes, io, encryption, make };
}
test('fresh save, masked listing, explicit reveal, restart and deletion', () => {
  const f = fixture({ theme: 'paper' }), s = f.make();
  assert.equal(s.initialize().ok, true);
  assert.equal(s.set('OPENAI_API_KEY', secret).ok, true);
  assert.equal(s.reveal('OPENAI_API_KEY').value, secret);
  assert.ok(!JSON.stringify(s.list()).includes(secret));
  assert.ok(![...f.files.values()].join('').includes(secret));
  const restart = f.make(); assert.equal(restart.initialize().ok, true);
  assert.equal(restart.context().envKeys.OPENAI_API_KEY, secret);
  assert.equal(restart.remove('OPENAI_API_KEY').ok, true);
  const again = f.make(); again.initialize(); assert.equal(again.reveal('OPENAI_API_KEY').value, '');
});
test('migrates all legacy fields, preserves preferences and precedence without persisting environment', () => {
  const f = fixture({ theme: 'glass', envKeys: { OPENAI_API_KEY: secret }, openaiKey: 'legacy-openai', elevenKey: 'legacy-eleven', sttKey: 'legacy-custom' }), s = f.make();
  assert.equal(s.initialize().ok, true);
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme: 'glass' });
  assert.equal(sttConfig(s.context(), { OPENAI_API_KEY: 'env-only' }).openaiKey, secret);
  assert.equal(sttConfig(s.context(), {}).elevenKey, 'legacy-eleven');
  assert.ok(!f.files.get('vault').includes('env-only'));
  s.remove('OPENAI_API_KEY'); assert.equal(s.context().openaiKey, undefined);
  assert.equal(sttConfig(s.context(), { OPENAI_API_KEY: 'env-only' }).openaiKey, 'env-only');
  assert.equal(s.remove('legacy:sttKey').ok, true); assert.equal(s.context().sttKey, undefined);
});
for (const failAt of [1,2,3]) test(`migration recovers after failure at write ${failAt}`, () => {
  const f = fixture({ envKeys: { TEST_KEY: secret }, theme: 'glass' });
  const original = f.io.write; let count = 0;
  f.io.write = (file,text) => { if (++count === failAt) throw new Error(secret); original(file,text); };
  // Write 2 is the settings.json scrub, which names that file instead of the key store.
  const s = f.make(); assertFailure(s.initialize(), failAt === 2 ? CLEANUP_ERROR : ERROR);
  assert.equal(s.status().kind, failAt === 2 ? 'settings' : 'storage');
  assert.deepEqual(s.context(), { envKeys: {} }); // reads never throw
  f.io.write = original;
  const restarted = f.make(); assert.equal(restarted.initialize().ok, true);
  assert.equal(restarted.reveal('TEST_KEY').value, secret);
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme: 'glass' });
});
test('read-back corruption never removes plaintext and is not overwritten on retry', () => {
  const f = fixture({ openaiKey: secret }), original = f.io.write;
  f.io.write = (file,text) => original(file, file === 'vault' ? '{"version":1,"ciphertext":"YmFk"}' : text);
  const s = f.make(); assert.equal(s.initialize().ok, false);
  assert.equal(JSON.parse(f.files.get('settings')).openaiKey, secret);
  const before = f.files.get('vault'); f.io.write = original;
  assert.equal(s.initialize().ok, false); assert.equal(f.files.get('vault'), before);
});
test('unavailable encryption and insecure Linux backend preserve source and reject saves', () => {
  for (const platform of ['darwin','linux']) {
    const f = fixture({ openaiKey: secret });
    f.encryption.isEncryptionAvailable = () => platform === 'linux';
    f.encryption.getSelectedStorageBackend = () => 'basic_text';
    const s = f.make({ platform }); assert.equal(s.initialize().ok, false);
    assert.equal(s.set('KEY',secret).ok, false); assert.equal(f.writes.length, 0);
    assert.equal(JSON.parse(f.files.get('settings')).openaiKey, secret);
    f.encryption.isEncryptionAvailable = () => true; f.encryption.getSelectedStorageBackend = () => 'gnome_libsecret';
    assert.equal(s.initialize().ok, true);
  }
});
test('mixed state never replaces newer keys or resurrects deletions', () => {
  const f = fixture({ envKeys: { KEY: secret } }), s = f.make(); s.initialize();
  s.set('KEY', 'newer-secret'); s.set('GONE', 'deleted-secret'); s.remove('GONE');
  // Simulate encrypted pending cleanup with newer mutations already durable.
  const envelope = JSON.parse(f.files.get('vault'));
  const doc = JSON.parse(f.encryption.decryptString(Buffer.from(envelope.ciphertext,'base64')));
  doc.migration = 'pending';
  f.files.set('vault', JSON.stringify({ version:1, ciphertext:f.encryption.encryptString(JSON.stringify(doc)).toString('base64') }));
  f.files.set('settings', JSON.stringify({ envKeys: { KEY: secret, GONE: 'stale-secret' }, theme:'dusk' }));
  const next = f.make(); assert.equal(next.initialize().ok,true);
  assert.equal(next.reveal('KEY').value,'newer-secret'); assert.equal(next.reveal('GONE').value,'');
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme:'dusk' });
});
test('cleanup rereads preferences; normal preference writes preserve pending source', () => {
  const f = fixture({ envKeys: { KEY: secret }, theme:'paper' }), original = f.io.write;
  f.io.write = (file,text) => { original(file,text); if (file === 'vault') { const s = JSON.parse(f.files.get('settings')); s.theme='dusk'; f.files.set('settings',JSON.stringify(s)); } };
  assert.equal(f.make().initialize().ok,true); assert.equal(JSON.parse(f.files.get('settings')).theme,'dusk');
  const blocked = fixture({ openaiKey:secret });
  writeSettings({ file:'settings', patch:{ theme:'glass' }, io:blocked.io });
  assert.equal(JSON.parse(blocked.files.get('settings')).openaiKey, secret);
  assert.deepEqual(preferences(JSON.parse(blocked.files.get('settings'))), { theme:'glass' });
});
test('unknown versions, malformed settings and failed updates preserve data and return safe errors', () => {
  const f = fixture(); f.files.set('vault','{"version":99}');
  assert.equal(f.make().initialize().ok,false); assert.equal(f.writes.length,0);
  f.files.delete('vault'); f.files.set('settings','broken'); assert.equal(f.make().initialize().ok,false);
  f.files.set('settings','{}'); const s=f.make(); s.initialize(); s.set('KEY',secret);
  const before=f.files.get('vault'); f.encryption.encryptString=()=>{throw new Error(secret);};
  assertFailure(s.set('KEY','new'), ERROR); assert.equal(f.files.get('vault'),before);
  assert.ok(!JSON.stringify(s.list()).includes(secret));
});
test('real private writer uses owner-only atomic files with encrypted content', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nami-credentials-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const f=fixture(), file=path.join(dir,'credentials.json'), settingsFile=path.join(dir,'settings.json');
  fs.writeFileSync(settingsFile,JSON.stringify({openaiKey:secret}));
  const s=createCredentialStore({file,settingsFile,encryption:f.encryption}); assert.equal(s.initialize().ok,true);
  assert.equal(fs.statSync(file).mode & 0o777,0o600); assert.equal(fs.statSync(settingsFile).mode & 0o777,0o600);
  assert.ok(!fs.readFileSync(file,'utf8').includes(secret)); assert.equal(fs.readdirSync(dir).length,2);
});
test('short secrets stay fully masked and unsafe names are rejected', () => {
  const s=fixture().make(); s.initialize(); s.set('SHORT','abc');
  assert.ok(!JSON.stringify(s.list()).includes('abc'));
  for (const name of ['__proto__','constructor','prototype',undefined,{}]) {
    assert.equal(s.set(name,secret).ok,false); assert.equal(s.reveal(name).ok,false);
  }
});
for (const failAt of [1,2,3]) test(`migration recovers if write ${failAt} commits before interruption`, () => {
  const f=fixture({envKeys:{KEY:secret},elevenKey:secret,view:'split'}), original=f.io.write;
  let count=0; f.io.write=(file,text)=>{original(file,text);if(++count===failAt)throw Error('interrupted');};
  assert.equal(f.make().initialize().ok,false); f.io.write=original;
  const restarted=f.make(); assert.equal(restarted.initialize().ok,true);
  assert.equal(restarted.context().envKeys.KEY,secret); assert.equal(restarted.context().elevenKey,secret);
  assert.deepEqual(JSON.parse(f.files.get('settings')),{view:'split'});
});
test('completed migration rejects stale source resurrection and validates journal structure',()=>{
  const f=fixture({envKeys:{OPENAI_API_KEY:secret},openaiKey:secret}),s=f.make(); s.initialize();s.remove('OPENAI_API_KEY');
  f.files.set('settings',JSON.stringify({envKeys:{OPENAI_API_KEY:secret},openaiKey:secret}));
  const next=f.make();assert.equal(next.initialize().ok,true);assert.equal(next.reveal('OPENAI_API_KEY').value,'');assert.equal(next.context().openaiKey,undefined);
  const envelope=JSON.parse(f.files.get('vault'));
  const doc=JSON.parse(f.encryption.decryptString(Buffer.from(envelope.ciphertext,'base64')));
  doc.tombstones={'named:bad-name':true};
  f.files.set('vault',JSON.stringify({version:1,ciphertext:f.encryption.encryptString(JSON.stringify(doc)).toString('base64')}));
  const before=f.files.get('vault'); assert.equal(f.make().initialize().ok,false);assert.equal(f.files.get('vault'),before);
});
test('mutations do not overwrite a vault damaged after startup; deletion cleans restored plaintext',()=>{
  const f=fixture(),s=f.make();s.initialize();s.set('OPENAI_API_KEY',secret);
  f.files.set('settings',JSON.stringify({envKeys:{OPENAI_API_KEY:secret},openaiKey:secret,theme:'dusk'}));
  assert.equal(s.remove('OPENAI_API_KEY').ok,true);assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'dusk'});
  f.files.set('vault','corrupt-after-startup');
  assert.equal(s.set('KEY','replacement').ok,false);assert.equal(f.files.get('vault'),'corrupt-after-startup');
});
test('key deletion uses only explicit provider aliases, not inherited object properties',()=>{
  const s=fixture().make();s.initialize();
  for(const name of ['toString','valueOf','hasOwnProperty']) {
    assert.equal(s.set(name,secret).ok,true);
    assert.equal(s.remove(name).ok,true);
    assert.equal(s.reveal(name).value,'');
  }
  for(const name of [null,undefined,{},[],{toString:null}]) {
    assert.equal(s.remove(name).ok,false);
  }
  assert.equal(s.status().ok,true);
});
test('completed startup validates without rewriting the vault or settings', () => {
  const f = fixture({ openaiKey: secret }), first = f.make();
  assert.equal(first.initialize().ok, true);
  const before = f.files.get('vault'), writes = f.writes.length;
  assert.equal(f.make().initialize().ok, true);
  assert.equal(f.files.get('vault'), before);
  assert.equal(f.writes.length, writes);
});
test('invalid encryption output cannot overwrite an existing valid vault', () => {
  const f = fixture(), store = f.make(); store.initialize(); store.set('KEY', secret);
  const before = f.files.get('vault');
  f.encryption.encryptString = () => Buffer.from('not decryptable');
  assert.equal(store.set('KEY', 'replacement').ok, false);
  assert.equal(f.files.get('vault'), before);
});
test('invalid legacy input is a validation error without locking a healthy store', () => {
  const store = fixture().make(); store.initialize();
  assert.equal(store.setLegacy({ openaiKey: { secret } }).ok, false);
  assert.equal(store.status().ok, true);
  assert.equal(store.set('KEY', secret).ok, true);
});
test('a key added during migration is retained for retry before plaintext cleanup', () => {
  const f = fixture({ envKeys: { FIRST: secret } }), original = f.io.write;
  let changed = false;
  f.io.write = (file, text) => {
    original(file, text);
    if (file === 'vault' && !changed) {
      changed = true;
      f.files.set('settings', JSON.stringify({ envKeys: { FIRST: secret, LATE: 'late-dummy-key' }, theme: 'dusk' }));
    }
  };
  const store = f.make();
  assert.equal(store.initialize().ok, false);
  assert.equal(JSON.parse(f.files.get('settings')).envKeys.LATE, 'late-dummy-key');
  assert.equal(store.initialize().ok, true);
  assert.equal(store.reveal('LATE').value, 'late-dummy-key');
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme: 'dusk' });
});
test('unknown Linux backends and unsupported platforms cannot create a vault', () => {
  const f = fixture({ openaiKey: secret });
  f.encryption.getSelectedStorageBackend = () => 'unknown';
  for (const platform of ['linux', 'unsupported']) assert.equal(f.make({ platform }).initialize().ok, false);
  assert.equal(f.writes.length, 0);
});
test('an unavailable store yields no saved keys and never throws on reads', () => {
  const f = fixture({ openaiKey: secret });
  f.encryption.isEncryptionAvailable = () => false;
  const store = f.make({ platform: 'darwin' });
  assert.deepEqual(store.context(), { envKeys: {} }); // before initialize
  assert.equal(store.initialize().ok, false);
  assert.deepEqual(store.context(), { envKeys: {} });
  assert.deepEqual(store.status(), { ok: false, error: ERROR, kind: 'storage', migration: 'unknown', cleanupPending: false, cleanupWarning: null, skippedKeys: [], skippedWarning: null });
  assert.equal(store.list().ok, false);
  assert.equal(store.reveal('OPENAI_API_KEY').ok, false);
});
test('a failed save keeps the verified keys readable instead of locking the store', () => {
  const f = fixture(), store = f.make(); store.initialize(); store.set('KEY', secret);
  const before = f.files.get('vault'), write = f.io.write, encrypt = f.encryption.encryptString;
  // Fails before anything is written.
  f.encryption.encryptString = () => { throw new Error('encrypt'); };
  assertFailure(store.set('OTHER', 'other-dummy-value'), ERROR);
  f.encryption.encryptString = encrypt;
  // Fails at the write itself: the atomic rename never happened.
  f.io.write = () => { throw new Error('disk full'); };
  assertFailure(store.remove('KEY'), ERROR);
  f.io.write = write;
  assert.equal(f.files.get('vault'), before);
  assert.equal(store.status().ok, true);
  assert.equal(store.context().envKeys.KEY, secret);
  assert.equal(store.reveal('KEY').value, secret);
  assert.equal(store.set('OTHER', 'other-dummy-value').ok, true);
});
test('a save whose write committed before the error is reported as saved', () => {
  const f = fixture(), store = f.make(); store.initialize();
  const write = f.io.write;
  f.io.write = (file, text) => { write(file, text); throw new Error('interrupted after rename'); };
  assert.equal(store.set('KEY', secret).ok, true);
  f.io.write = write;
  const restarted = f.make(); restarted.initialize();
  assert.equal(restarted.reveal('KEY').value, secret);
});
test('encryption lost mid-run refuses writes but keeps serving keys already in memory', () => {
  const f = fixture(), store = f.make(); store.initialize(); store.set('KEY', secret);
  const before = f.files.get('vault');
  f.encryption.isEncryptionAvailable = () => false;
  assert.equal(store.set('KEY', 'replacement-dummy').ok, false);
  assert.equal(f.files.get('vault'), before);
  assert.equal(store.context().envKeys.KEY, secret);
  assert.equal(store.status().ok, true);
});
test('a vault damaged mid-run blocks writes but retains verified cached keys', () => {
  const f = fixture(), store = f.make(); store.initialize(); store.set('KEY', secret);
  f.files.set('vault', 'damaged');
  assert.equal(store.set('KEY', 'replacement-dummy').ok, false);
  assert.equal(f.files.get('vault'), 'damaged');
  assert.equal(store.context().envKeys.KEY, secret);
  assert.equal(store.status().cleanupWarning, VAULT_WARNING);
  assert.equal(store.status().migration, 'unknown');
});
test('a migrated vault does not depend on settings.json being readable', () => {
  const f = fixture({ envKeys: { KEY: secret }, theme: 'dusk' }); f.make().initialize();
  f.files.set('settings', 'not json');
  const store = f.make();
  assert.equal(store.initialize().ok, true);
  assert.equal(store.context().envKeys.KEY, secret);
  assert.equal(store.set('SECOND', 'second-dummy-value').ok, true);
  assert.equal(store.status().ok, true);
  assert.equal(f.files.get('settings'), 'not json');
});
test('a pending migration with an unreadable or malformed source fails closed and says which file', () => {
  for (const source of ['not json', '[]', '"a string"', '42']) {
    const f = fixture(); f.files.set('settings', source);
    const store = f.make();
    assertFailure(store.initialize(), SETTINGS_ERROR);
    assert.equal(store.status().kind, 'settings');
    assert.equal(store.list().kind, 'settings');
    assert.equal(f.files.get('settings'), source);
    assert.equal(f.files.has('vault'), false);
  }
});
test('settings cleanup failing after a committed save does not fail the save', () => {
  const f = fixture(), store = f.make(); store.initialize();
  f.files.set('settings', JSON.stringify({ envKeys: { STALE: secret }, theme: 'dusk' }));
  const write = f.io.write;
  f.io.write = (file, text) => { if (file === 'settings') throw new Error('read-only'); write(file, text); };
  assert.equal(store.set('KEY', secret).ok, true);
  assert.equal(store.status().ok, true);
  f.io.write = write;
  assert.equal(store.set('KEY2', secret).ok, true); // cleanup is retried
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme: 'dusk' });
});

for (const operation of ['save', 'delete']) test(`${operation} commits despite cleanup failure, warns across restart, and recovers`, () => {
  const f=fixture({envKeys:{OPENAI_API_KEY:secret},openaiKey:secret}), s=f.make();
  s.initialize();
  f.files.set('settings',JSON.stringify({envKeys:{OPENAI_API_KEY:secret},openaiKey:secret,theme:'dusk'}));
  const write=f.io.write;
  f.io.write=(file,text)=>{if(file==='settings') throw Error(secret); write(file,text);};
  const res=operation==='save'?s.set('OTHER',secret):s.remove('OPENAI_API_KEY');
  assert.equal(res.ok,true); assert.equal(res.cleanupPending,true); assert.equal(res.cleanupWarning,CLEANUP_WARNING);
  assert.equal(s.status().ok,true); assert.equal(s.list().cleanupPending,true);
  assert.equal(s.reveal(operation==='save'?'OTHER':'OPENAI_API_KEY').value,operation==='save'?secret:'');
  if(operation==='delete') assert.equal(s.context().openaiKey,undefined);
  const restarted=f.make(), init=restarted.initialize();
  assert.equal(init.ok,true); assert.equal(init.cleanupPending,true);
  assert.equal(restarted.reveal(operation==='save'?'OTHER':'OPENAI_API_KEY').value,operation==='save'?secret:'');
  for(const response of [res,init,s.status(),s.list()]) assert.ok(!JSON.stringify(response).includes(secret));
  f.io.write=write;
  assert.equal(restarted.initialize().cleanupPending,false);
  assert.equal(restarted.status().cleanupWarning,null);
  assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'dusk'});
});
test('cleanup validates its exact snapshot, preserves a newly added key, and imports it on retry',()=>{
  const f=fixture({envKeys:{FIRST:secret},theme:'paper'}), read=f.io.read;
  let reads=0;
  f.io.read=file=>{
    if(file==='settings' && ++reads===2) f.files.set(file,JSON.stringify({envKeys:{FIRST:secret,LATE:'dummy-late'},theme:'dusk'}));
    return read(file);
  };
  const s=f.make(), result=s.initialize();
  assert.equal(result.ok,false); assert.equal(result.error,SOURCE_CHANGED_ERROR);
  assert.equal(JSON.parse(f.files.get('settings')).envKeys.LATE,'dummy-late');
  assert.deepEqual(s.context(),{envKeys:{}});
  assert.equal(s.initialize().ok,true);
  assert.equal(s.reveal('LATE').value,'dummy-late');
  assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'dusk'});
});
test('cleanup writes the validated snapshot without an intervening read and keeps fresh preferences',()=>{
  const f=fixture({envKeys:{FIRST:secret},theme:'paper'}), read=f.io.read, write=f.io.write;
  let reads=0, wrote=false;
  f.io.read=file=>{
    if(file==='settings') {
      ++reads;
      if(reads===2) f.files.set(file,JSON.stringify({envKeys:{FIRST:secret},theme:'dusk',view:'split'}));
      if(reads===3) assert.equal(wrote,true,'third read must only verify after cleanup writes');
    }
    return read(file);
  };
  f.io.write=(file,text)=>{if(file==='settings'){assert.equal(reads,2);wrote=true;}write(file,text);};
  assert.equal(f.make().initialize().ok,true);
  assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'dusk',view:'split'});
});
test('unreadable completed settings warn without disabling keys; retry confirms absence',()=>{
  const f=fixture({envKeys:{KEY:secret}}), s=f.make(); s.initialize();
  f.files.set('settings','unreadable fixture');
  const restarted=f.make();
  assert.equal(restarted.initialize().cleanupPending,true);
  assert.equal(restarted.set('NEW',secret).cleanupPending,true);
  assert.equal(restarted.reveal('KEY').value,secret);
  assert.equal(f.files.get('settings'),'unreadable fixture');
  f.files.set('settings',JSON.stringify({theme:'glass'}));
  assert.equal(restarted.initialize().cleanupPending,false);
});

test('cleanup warning does not clear until read-back confirms plaintext is absent',()=>{
  const f=fixture({envKeys:{KEY:secret}}), s=f.make(); s.initialize();
  f.files.set('settings',JSON.stringify({envKeys:{KEY:secret}}));
  const write=f.io.write;
  f.io.write=(file,text)=>{if(file!=='settings')write(file,text);};
  assert.equal(s.set('OTHER',secret).cleanupPending,true);
  assert.equal(s.status().ok,true);
  f.io.write=write;
  assert.equal(s.set('OTHER',secret).cleanupPending,false);
  assert.equal(f.files.get('settings').includes(secret),false);
});

test('retry while protection is unavailable preserves verified keys and pending cleanup', () => {
  const f = fixture({envKeys:{KEY:secret}}), store = f.make();
  store.initialize();
  f.files.set('settings', 'unreadable fixture');
  assert.equal(store.initialize().cleanupPending, true);
  const before = f.files.get('vault'), writes = f.writes.length;
  f.encryption.isEncryptionAvailable = () => false;
  const retried = store.retry();
  assert.equal(retried.ok, true);
  assert.equal(retried.cleanupPending, true);
  assert.equal(store.status().ok, true);
  assert.equal(store.context().envKeys.KEY, secret);
  assert.equal(store.reveal('KEY').value, secret);
  assert.equal(store.set('OTHER', secret).ok, false);
  assert.equal(f.files.get('vault'), before);
  assert.equal(f.writes.length, writes);
  // No cached state in a fresh process: encrypted keys remain unavailable.
  assert.equal(f.make().initialize().ok, false);
  f.encryption.isEncryptionAvailable = () => true;
  f.files.set('settings', JSON.stringify({envKeys:{KEY:secret},theme:'paper'}));
  assert.equal(store.retry().cleanupPending, false);
  assert.deepEqual(JSON.parse(f.files.get('settings')), {theme:'paper'});
});

test('a locked key store during a save leaves the verified vault usable when nothing reached disk', () => {
  const f = fixture(), store = f.make(); store.initialize(); store.set('KEY', secret);
  const before = f.files.get('vault'), writes = f.writes.length;
  const { encryptString, decryptString } = f.encryption;
  // macOS with the Keychain locked: encryption is "available" but every call throws.
  f.encryption.encryptString = () => { throw new Error('keychain locked'); };
  f.encryption.decryptString = () => { throw new Error('keychain locked'); };
  assertFailure(store.set('OTHER', 'other-dummy-value'), ERROR);
  assert.equal(store.status().ok, true);
  assert.equal(store.list().ok, true);
  assert.equal(store.reveal('KEY').value, secret);
  assert.equal(store.context().envKeys.KEY, secret);
  assert.equal(f.files.get('vault'), before);
  assert.equal(f.writes.length, writes);
  // The in-memory sanity decrypt failing after a good encrypt is the same case.
  f.encryption.encryptString = encryptString;
  assertFailure(store.set('OTHER', 'other-dummy-value'), ERROR);
  assert.equal(store.reveal('KEY').value, secret);
  assert.equal(f.files.get('vault'), before);
  f.encryption.decryptString = decryptString;
  assert.equal(store.set('OTHER', 'other-dummy-value').ok, true);
});

test('status reports the migration state and whether settings.json can be read', () => {
  const f = fixture({ theme: 'paper' }), store = f.make();
  assert.equal(store.status().migration, 'unknown');
  assert.equal(store.settingsReadable(), true);
  store.initialize(); assert.equal(store.status().migration, 'complete');
  assert.equal(f.make().status().migration, 'unknown'); // before initialize
  f.files.set('settings', 'not json'); assert.equal(store.settingsReadable(), false);
  f.files.set('settings', '[]'); assert.equal(store.settingsReadable(), false);
  f.files.set('settings', '   \n'); assert.equal(store.settingsReadable(), true);
  f.files.delete('settings'); assert.equal(store.settingsReadable(), true);
  // Pending: no vault yet and an unreadable source.
  f.files.set('settings', 'not json'); f.files.delete('vault');
  const pending = f.make(); assertFailure(pending.initialize(), SETTINGS_ERROR);
  assert.equal(pending.status().migration, 'pending');
  // Unknown: a vault exists but cannot be read.
  f.files.set('vault', 'damaged');
  const unknown = f.make(); assert.equal(unknown.initialize().ok, false);
  assert.equal(unknown.status().migration, 'unknown');
});
test('an empty settings.json is an empty migration source, not an unreadable one', () => {
  for (const text of ['', ' \n\t']) {
    const f = fixture(); f.files.set('settings', text);
    const store = f.make(); assert.equal(store.initialize().ok, true);
    assert.equal(store.set('KEY', secret).ok, true);
    assert.equal(f.files.get('settings'), text); // nothing to scrub, nothing rewritten
  }
});
test('malformed envKeys entries are skipped, left in place and reported by name only', () => {
  const skippedValue = 'skipped-dummy-value';
  const f = fixture({ theme: 'glass', envKeys: { OPENAI_API_KEY: secret, 'MY-KEY': skippedValue, NUM: 5, EMPTY: '' }, openaiKey: 12, elevenKey: '' });
  const store = f.make(), init = store.initialize();
  assert.equal(init.ok, true); assert.equal(init.cleanupPending, false);
  assert.equal(store.status().migration, 'complete');
  assert.equal(store.reveal('OPENAI_API_KEY').value, secret);
  assert.deepEqual(store.list().legacy, []); // '' is stale, never a phantom row
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme: 'glass', envKeys: { 'MY-KEY': skippedValue, NUM: 5 }, openaiKey: 12 });
  assert.deepEqual(init.skippedKeys, ['MY-KEY', 'NUM', 'openaiKey']);
  assert.ok(init.skippedWarning.includes('MY-KEY') && init.skippedWarning.includes('settings.json'));
  for (const response of [init, store.status(), store.list(), store.set('OTHER', secret)]) {
    assert.deepEqual(response.skippedKeys, ['MY-KEY', 'NUM', 'openaiKey']);
    assert.ok(!JSON.stringify(response).includes(skippedValue) && !JSON.stringify(response).includes(secret));
  }
  // Still reported after a restart, and gone once the user fixes the file.
  const restarted = f.make(); assert.deepEqual(restarted.initialize().skippedKeys, ['MY-KEY', 'NUM', 'openaiKey']);
  f.files.set('settings', JSON.stringify({ theme: 'glass' }));
  assert.deepEqual(restarted.retry().skippedKeys, []); assert.equal(restarted.status().skippedWarning, null);
  // A non-object envKeys field is skipped as a whole.
  const g = fixture({ envKeys: 'not an object', openaiKey: secret }), other = g.make();
  assert.equal(other.initialize().ok, true); assert.deepEqual(other.status().skippedKeys, ['envKeys']);
  assert.equal(other.context().openaiKey, secret);
  assert.deepEqual(JSON.parse(g.files.get('settings')), { envKeys: 'not an object' });
});
test('a cleanup failure during first migration names settings.json, not the key store', () => {
  const f = fixture({ envKeys: { KEY: secret }, theme: 'dusk' }), write = f.io.write;
  f.io.write = (file, text) => { if (file === 'settings') throw new Error('EACCES'); write(file, text); };
  const store = f.make(), init = store.initialize();
  assertFailure(init, CLEANUP_ERROR);
  assert.equal(store.status().kind, 'settings'); assert.equal(store.list().kind, 'settings');
  assert.ok(CLEANUP_ERROR.includes('settings.json'));
  assert.equal(JSON.parse(f.files.get('settings')).envKeys.KEY, secret);
  assert.equal(store.status().migration, 'pending');
  f.io.write = write;
  assert.equal(store.retry().ok, true);
  assert.equal(store.reveal('KEY').value, secret);
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme: 'dusk' });
});
test('retry on an unchanged usable vault cleans known plaintext without the key store', () => {
  const f = fixture({ envKeys: { KEY: secret } }), store = f.make(); store.initialize();
  f.files.set('settings', 'unreadable fixture');
  assert.equal(store.retry().cleanupPending, true);
  let encrypts = 0; const encrypt = f.encryption.encryptString;
  f.encryption.encryptString = text => { encrypts++; return encrypt(text); };
  f.encryption.isEncryptionAvailable = () => false;
  f.files.set('settings', JSON.stringify({ envKeys: { KEY: secret }, theme: 'paper' }));
  const retried = store.retry();
  assert.equal(retried.ok, true); assert.equal(retried.cleanupPending, false);
  assert.equal(encrypts, 0);
  assert.deepEqual(JSON.parse(f.files.get('settings')), { theme: 'paper' });
  assert.equal(store.reveal('KEY').value, secret);
  // An unavailable store retries the whole initialization.
  f.encryption.isEncryptionAvailable = () => true;
  f.files.set('vault', 'damaged');
  assert.equal(store.set('X', secret).ok, false); assert.equal(store.status().ok, true);
  assert.equal(store.retry().cleanupPending, true);
  f.files.set('vault', f.writes.filter(([file]) => file === 'vault').at(-1)[1]);
  assert.equal(store.retry().ok, true); assert.equal(store.reveal('KEY').value, secret);
});

function replaceVault(f, transform) {
  const envelope=JSON.parse(f.files.get('vault'));
  const doc=JSON.parse(f.encryption.decryptString(Buffer.from(envelope.ciphertext,'base64')));
  transform(doc);
  f.files.set('vault',JSON.stringify({version:1,ciphertext:f.encryption.encryptString(JSON.stringify(doc)).toString('base64')}));
}
for (const trigger of ['retry','restart','mutation']) test(`corrected named and legacy source is recovered through ${trigger}`,()=>{
  const f=fixture({envKeys:{'BAD-NAME':secret},openaiKey:12,theme:'paper'}), s=f.make();
  s.initialize();
  f.files.set('settings',JSON.stringify({envKeys:{GOOD_NAME:secret,'STILL-BAD':'dummy-skipped'},openaiKey:secret,theme:'dusk'}));
  const active=trigger==='restart'?f.make():s;
  const response=trigger==='restart'?active.initialize():trigger==='mutation'?active.set('UNRELATED','dummy-other'):active.retry();
  assert.equal(response.ok,true); assert.equal(response.cleanupPending,false);
  assert.equal(active.reveal('GOOD_NAME').value,secret); assert.equal(active.reveal('legacy:openaiKey').value,secret);
  assert.deepEqual(response.skippedKeys,['STILL-BAD']);
  assert.deepEqual(JSON.parse(f.files.get('settings')),{envKeys:{'STILL-BAD':'dummy-skipped'},theme:'dusk'});
  for(const result of [response,active.list(),active.status()]) assert.ok(!JSON.stringify(result).includes(secret));
  const restart=f.make(); restart.initialize(); assert.equal(restart.reveal('GOOD_NAME').value,secret);
});
test('failed encryption after loading a new vault cannot roll back keys or resurrect deletions',()=>{
  const f=fixture({envKeys:{KEY:secret,GONE:secret}}), s=f.make();s.initialize();
  replaceVault(f,doc=>{doc.named.KEY='dummy-new'; delete doc.named.GONE;doc.tombstones['named:GONE']=true;});
  const encrypt=f.encryption.encryptString;
  f.encryption.encryptString=()=>{throw Error(secret);};
  assert.equal(s.set('OTHER','dummy-other').ok,false);
  assert.equal(s.reveal('KEY').value,'dummy-new');assert.equal(s.reveal('GONE').value,'');
  f.encryption.encryptString=encrypt;assert.equal(s.set('OTHER','dummy-other').ok,true);
  const restart=f.make();restart.initialize();assert.equal(restart.reveal('KEY').value,'dummy-new');assert.equal(restart.reveal('GONE').value,'');
});
for(const damage of ['missing','corrupt','unreadable','undecryptable','unsupported']) test(`cleanup refuses ${damage} durable vault and keeps cached keys`,()=>{
  const f=fixture({envKeys:{KEY:secret}}),s=f.make();s.initialize();
  const vault=f.files.get('vault'),read=f.io.read,decrypt=f.encryption.decryptString;
  const source=JSON.stringify({envKeys:{KEY:secret},theme:'paper'});f.files.set('settings',source);
  if(damage==='missing') f.files.delete('vault');
  if(damage==='corrupt') f.files.set('vault','broken');
  if(damage==='unsupported') f.files.set('vault','{"version":99}');
  if(damage==='unreadable') f.io.read=file=>{if(file==='vault')throw Error(secret);return read(file);};
  if(damage==='undecryptable'){f.files.set('vault',vault+' ');f.encryption.decryptString=()=>{throw Error(secret);};}
  const before=f.files.get('vault'),writes=f.writes.length;
  const r=s.retry();assert.equal(r.cleanupPending,true);assert.equal(r.cleanupWarning,VAULT_WARNING);
  assert.equal(s.reveal('KEY').value,secret);assert.equal(s.set('OTHER',secret).ok,false);
  assert.equal(f.files.get('settings'),source);assert.equal(f.files.get('vault'),before);assert.equal(f.writes.length,writes);
  assert.ok(!JSON.stringify(r).includes(secret));
  f.io.read=read;f.encryption.decryptString=decrypt;f.files.set('vault',vault);
  assert.equal(s.retry().cleanupPending,false);assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'paper'});
});
test('unchanged known-source cleanup needs zero crypto calls; unseen sources require encryption',()=>{
  const f=fixture({envKeys:{KEY:secret}}),s=f.make();s.initialize();
  const encrypt=f.encryption.encryptString,decrypt=f.encryption.decryptString;let calls=0;
  f.encryption.encryptString=()=>{calls++;throw Error('locked');};f.encryption.decryptString=()=>{calls++;throw Error('locked');};
  f.files.set('settings',JSON.stringify({envKeys:{KEY:secret}}));
  assert.equal(s.retry().cleanupPending,false);assert.equal(calls,0);
  f.files.set('settings',JSON.stringify({envKeys:{NEW:secret}}));
  assert.equal(s.retry().cleanupWarning,RECOVERY_WARNING);assert.equal(calls,1);
  assert.equal(JSON.parse(f.files.get('settings')).envKeys.NEW,secret);assert.equal(s.reveal('KEY').value,secret);
  f.encryption.encryptString=encrypt;f.encryption.decryptString=decrypt;
  assert.equal(s.retry().cleanupPending,false);assert.equal(s.reveal('NEW').value,secret);
});
for(const phase of ['before-vault','after-vault','cleanup','after-cleanup']) test(`corrected-entry recovery survives ${phase} interruption`,()=>{
  const f=fixture(),s=f.make();s.initialize();
  f.files.set('settings',JSON.stringify({envKeys:{NEW:secret},theme:'dusk'}));
  const write=f.io.write;let failed=false;
  f.io.write=(file,text)=>{
    const hit=!failed && file===(phase.includes('vault')?'vault':'settings');
    if(hit){failed=true;if(phase.startsWith('after'))write(file,text);throw Error(secret);}
    write(file,text);
  };
  s.retry(); assert.equal(s.status().ok,true);
  f.io.write=write;
  const restart=f.make();assert.equal(restart.initialize().ok,true);assert.equal(restart.reveal('NEW').value,secret);
  assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'dusk'});
});
test('a committed mutation stays successful when additional source recovery fails',()=>{
  const f=fixture(),s=f.make();s.initialize();
  f.files.set('settings',JSON.stringify({envKeys:{NEW:secret}}));
  const encrypt=f.encryption.encryptString;let calls=0;
  f.encryption.encryptString=text=>{if(++calls===2)throw Error(secret);return encrypt(text);};
  const res=s.set('SAVED','dummy-saved');assert.equal(res.ok,true);assert.equal(res.cleanupWarning,RECOVERY_WARNING);
  assert.equal(s.reveal('SAVED').value,'dummy-saved');assert.equal(JSON.parse(f.files.get('settings')).envKeys.NEW,secret);
  f.encryption.encryptString=encrypt;s.retry();assert.equal(s.reveal('NEW').value,secret);
});
test('replacement pending vault is recovered before cleanup and retains tombstone precedence',()=>{
  const f=fixture({envKeys:{KEY:secret,GONE:secret}}),s=f.make();s.initialize();s.remove('GONE');
  replaceVault(f,doc=>{doc.migration='pending';doc.named.KEY='dummy-new';});
  f.files.set('settings',JSON.stringify({envKeys:{KEY:secret,GONE:secret,NEW:secret},theme:'dusk'}));
  const res=s.retry();assert.equal(res.ok,true);assert.equal(res.migration,'complete');
  assert.equal(s.reveal('KEY').value,'dummy-new');assert.equal(s.reveal('GONE').value,'');assert.equal(s.reveal('NEW').value,secret);
});
test('completed source recovery preserves a late source key and fresh preferences',()=>{
  const f=fixture(),s=f.make();s.initialize();const write=f.io.write;
  f.files.set('settings',JSON.stringify({envKeys:{FIRST:secret},theme:'paper'}));let once=false;
  f.io.write=(file,text)=>{write(file,text);if(file==='vault'&&!once){once=true;f.files.set('settings',JSON.stringify({envKeys:{FIRST:secret,LATE:secret},theme:'dusk'}));}};
  assert.equal(s.retry().cleanupPending,true);assert.equal(JSON.parse(f.files.get('settings')).envKeys.LATE,secret);
  assert.equal(s.retry().cleanupPending,false);assert.equal(s.reveal('LATE').value,secret);
  assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'dusk'});
});
test('a changed completed vault is adopted before reconciling settings',()=>{
  const f=fixture({envKeys:{KEY:secret}}),s=f.make();s.initialize();
  replaceVault(f,doc=>{doc.named.KEY='dummy-new';});
  f.files.set('settings',JSON.stringify({envKeys:{KEY:secret,NEW:secret},openaiKey:secret,theme:'paper'}));
  assert.equal(s.retry().cleanupPending,false);
  assert.equal(s.reveal('KEY').value,'dummy-new');assert.equal(s.reveal('NEW').value,secret);
  assert.equal(s.reveal('legacy:openaiKey').value,secret);
  assert.deepEqual(JSON.parse(f.files.get('settings')),{theme:'paper'});
});
test('vault changes at the cleanup-read boundary preserve source without trusting the cache',()=>{
  const f=fixture({envKeys:{KEY:secret}}),s=f.make();s.initialize();
  f.files.set('settings',JSON.stringify({envKeys:{KEY:secret}}));
  const read=f.io.read;let count=0;
  f.io.read=file=>{if(file==='settings'&&++count===2)f.files.set('vault','damaged fixture');return read(file);};
  assert.equal(s.retry().cleanupWarning,VAULT_WARNING);
  assert.equal(JSON.parse(f.files.get('settings')).envKeys.KEY,secret);
  assert.equal(s.reveal('KEY').value,secret);
});
test('known app-saved entries and tombstones need no encryption to clean stale sources',()=>{
  const f=fixture(),s=f.make();s.initialize();s.set('KEY',secret);s.set('GONE',secret);s.remove('GONE');
  f.files.set('settings',JSON.stringify({envKeys:{KEY:'dummy-old',GONE:secret}}));
  f.encryption.isEncryptionAvailable=()=>false;
  f.encryption.encryptString=()=>{throw Error('must not encrypt');};f.encryption.decryptString=()=>{throw Error('must not decrypt');};
  assert.equal(s.retry().cleanupPending,false);
  assert.equal(s.reveal('KEY').value,secret);assert.equal(s.reveal('GONE').value,'');
});
test('a replacement pending vault still fails closed when its source cannot be read',()=>{
  const f=fixture({envKeys:{KEY:secret}}),s=f.make();s.initialize();
  replaceVault(f,doc=>{doc.migration='pending';});f.files.set('settings','invalid fixture');
  assert.equal(s.retry().ok,false);assert.deepEqual(s.context(),{envKeys:{}});
  assert.equal(f.files.get('settings'),'invalid fixture');
});
