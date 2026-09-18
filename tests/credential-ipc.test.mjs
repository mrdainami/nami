// Exercise actual main-process handlers against a real store without Electron/Keychain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as settingsStore from '../src/main/settings.js';
import { stripInheritedClaude } from '../src/main/session-env.js';
import { agentStatus as probeAgentStatus } from '../src/main/agents-detect.js';
import { sttConfig } from '../src/main/stt.js';
import { createCredentialStore, preferences, LEGACY, ERROR, SETTINGS_ERROR, CLEANUP_ERROR } from '../src/main/credential-store.js';
const envOnly='environment-only-dummy';
// Mirrors stt.js closely enough for main.js: a keyed provider is ready only when
// sttConfig finds a key in saved settings or the environment.
const keyed=settings=>settings.sttProvider==='openai';
const speech=async({settings,env})=>keyed(settings)&&!sttConfig(settings,env).openaiKey?{ok:false,error:'no API key'}:{ok:true};
const speechStub={sttConfig,resolveProvider:settings=>keyed(settings)?{needsKey:'openaiKey'}:{},transcribe:speech,prepare:speech,
  status:({settings,env})=>({ready:!keyed(settings)||!!sttConfig(settings,env).openaiKey,providers:[{needsKey:'openaiKey',ready:!!sttConfig(settings,env).openaiKey}]})};
const source=fs.readFileSync(new URL('../src/main/main.js',import.meta.url),'utf8');
function harness(t, available) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nami-ipc-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const secret=['dummy','ipc','value','123456789'].join('-');
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({envKeys:{OPENAI_API_KEY:secret},openaiKey:secret,theme:'paper'}));
  const key=crypto.randomBytes(32);
  const safeStorage={isEncryptionAvailable:()=>available,encryptString:s=>{const c=crypto.createCipheriv('aes-256-cbc',key,Buffer.alloc(16));return Buffer.concat([c.update(s),c.final()]);},decryptString:b=>{const d=crypto.createDecipheriv('aes-256-cbc',key,Buffer.alloc(16));return Buffer.concat([d.update(b),d.final()]).toString();}};
  const handlers=new Map(), probes=[], reads=[], savedMaps=[];
  const agentStatus = (id, {envKeys}) => {
    savedMaps.push(envKeys);
    return probeAgentStatus(id, {envKeys, home:path.join(dir,'fixture-home'), env:{},
      exec:async cmd=>{probes.push(cmd); return JSON.stringify({loggedIn:true,email:'fixture@example.invalid',subscriptionType:'max',authMethod:'claude.ai'});},
      readFile:async file=>{reads.push(file); return null;}});
  };
  const ctx=vm.createContext({ fs,path,stripInheritedClaude,app:{getPath:()=>dir},settingsStore,createCredentialStore,preferences,LEGACY,safeStorage,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},REVIEW:false,CREDENTIAL_ERROR:ERROR,process:{env:{PATH:'/usr/bin',OPENAI_API_KEY:envOnly}},SETTINGS_ERROR,stt:speechStub,sendWc(){},agentStatus,shell:{showItemInFolder(){}},refreshAppMenu(){} });
  vm.runInContext(source.slice(source.indexOf('function settingsFile()'),source.indexOf('function sendWc(')),ctx);
  vm.runInContext('credentialStore().initialize()',ctx);
  vm.runInContext(source.slice(source.indexOf('function sessionEnv('),source.indexOf('// ---- IPC: terminal / harness')),ctx);
  vm.runInContext(source.slice(source.indexOf('function sttEnv()'),source.indexOf('// Whisper weights live')),ctx);
  vm.runInContext(source.slice(source.indexOf('async function runSpeech('),source.indexOf('// Every session inherits')),ctx);
  vm.runInContext(source.slice(source.indexOf("ipcMain.handle('agents:status'"),source.indexOf("ipcMain.handle('agents:status'")+source.slice(source.indexOf("ipcMain.handle('agents:status'")).indexOf('\n});')+4),ctx);
  vm.runInContext(source.slice(source.indexOf("ipcMain.handle('theme:set'"),source.indexOf("ipcMain.handle('folder:pick'")),ctx);
  return {secret,dir,ctx,handlers,probes,reads,savedMaps};
}
for(const available of [true,false]) test(`IPC responses contain no secrets with storage ${available?'available':'blocked'}`, t=>{
  const h=harness(t,available);
  for(const [channel,arg] of [['settings:get'],['keys:get'],['theme:set','glass'],['view:set','split'],['settings:set',{openaiModel:'whisper-1'}]]) {
    const result=h.handlers.get(channel)({},arg);
    assert.ok(!JSON.stringify(result).includes(h.secret),channel);
  }
  const revealed=h.handlers.get('keys:reveal')({},{name:'OPENAI_API_KEY'});
  assert.equal(revealed.ok,available);
  if(available) assert.equal(revealed.value,h.secret);
  else assert.equal(JSON.parse(fs.readFileSync(path.join(h.dir,'settings.json'),'utf8')).openaiKey,h.secret);
});
test('legacy settings writes go to encrypted storage; a completed profile self-heals bad preferences',t=>{
  const h=harness(t,true), handler=h.handlers.get('settings:set');
  assert.equal(handler({},{elevenKey:h.secret}).ok,true);
  assert.ok(!fs.readFileSync(path.join(h.dir,'settings.json'),'utf8').includes(h.secret));
  assert.equal(h.handlers.get('keys:reveal')({},{name:'legacy:elevenKey'}).value,h.secret);
  // Migration is complete, so a damaged preferences file is simply replaced.
  fs.writeFileSync(path.join(h.dir,'settings.json'),'invalid original');
  assert.equal(handler({},{theme:'paper'}).ok,true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.dir,'settings.json'),'utf8')),{theme:'paper'});
});
test('malformed key IPC payloads return validation errors without disabling storage', t => {
  const h = harness(t, true);
  for (const args of [undefined, null, {}, [], 12, 'wrong']) {
    for (const channel of ['keys:set', 'keys:delete', 'keys:reveal']) assert.equal(h.handlers.get(channel)({}, args).ok, false);
  }
  assert.equal(h.handlers.get('keys:get')({}).ok, true);
});
test('unavailable storage disables only saved keys: sessions, agent status, shell keys and preferences still work', async t => {
  const h = harness(t, false), settingsFile = path.join(h.dir, 'settings.json');
  const source = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  fs.writeFileSync(settingsFile, JSON.stringify({ ...source, sttProvider: 'openai' }));
  // A session still gets its environment, minus the saved keys.
  const env = vm.runInContext('sessionEnv("/fixture/bin")', h.ctx);
  assert.equal(env.PATH, '/fixture/bin');
  assert.equal(env.OPENAI_API_KEY, envOnly);
  assert.ok(!JSON.stringify(env).includes(h.secret));
  // Agent status keeps the shape the launcher renders.
  const agent = await h.handlers.get('agents:status')({}, { id: 'claude' });
  assert.equal(agent.id, 'claude');
  assert.equal(agent.signedIn, true);
  assert.equal(agent.label, 'fixture@example.invalid · Max');
  assert.equal(agent.source, 'claude auth status');
  assert.deepEqual(agent.rows, [
    {k:'Account',v:'fixture@example.invalid'},
    {k:'Plan',v:'Max'},
    {k:'Signed in',v:'through claude.ai'},
  ]);
  assert.deepEqual(h.probes, ['claude auth status --json']);
  assert.equal(Object.keys(h.savedMaps[0]).length, 0);
  await h.handlers.get('agents:status')({}, {id:'grok'});
  assert.ok(h.reads.length > 0);
  assert.ok(h.reads.every(file=>file.startsWith(path.join(h.dir,'fixture-home')+path.sep)));
  // A key exported in the shell still drives a keyed speech provider.
  let status = h.handlers.get('stt:status')({});
  assert.equal(status.providers[0].ready, true);
  assert.equal(status.credentialStorage.ok, false);
  assert.equal((await h.handlers.get('stt:transcribe')({}, {})).ok, true);
  // With no key anywhere, the error names secure storage rather than "no API key".
  vm.runInContext('delete process.env.OPENAI_API_KEY', h.ctx);
  status = h.handlers.get('stt:status')({});
  assert.equal(status.providers[0].ready, false);
  for (const channel of ['stt:transcribe', 'stt:prepare']) {
    const failed = await h.handlers.get(channel)({}, {});
    assert.equal(failed.ok, false); assert.equal(failed.error, ERROR); // vm realm: compare fields
  }
  // Preferences are unaffected, and the unmigrated plaintext source is kept.
  assert.equal(h.handlers.get('theme:set')({}, 'dusk').ok, true);
  const kept = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(kept.theme, 'dusk');
  assert.equal(kept.openaiKey, h.secret);
  fs.writeFileSync(settingsFile, JSON.stringify({ ...kept, sttProvider: 'local' }));
  assert.equal((await h.handlers.get('stt:transcribe')({}, {})).ok, true);
});
test('an unreadable settings.json is replaced by a preference write once migration is complete', t => {
  const h = harness(t, true), settingsFile = path.join(h.dir, 'settings.json');
  for (const broken of ['invalid original', '', '[]']) {
    fs.writeFileSync(settingsFile, broken);
    const saved = h.handlers.get('theme:set')({}, 'dusk');
    assert.equal(saved.ok, true, JSON.stringify(broken));
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { theme: 'dusk' });
  }
  // The migrated vault does not depend on it either way.
  fs.writeFileSync(settingsFile, 'invalid again');
  assert.equal(h.handlers.get('keys:reveal')({}, { name: 'OPENAI_API_KEY' }).value, h.secret);
  assert.equal(h.handlers.get('keys:set')({}, { name: 'NEW_KEY', value: h.secret }).ok, true);
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), 'invalid again');
  assert.equal(h.handlers.get('view:set')({}, 'split').ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { view: 'split' });
});
test('an unreadable settings.json is never overwritten while it is still a migration source', t => {
  const h = harness(t, false), settingsFile = path.join(h.dir, 'settings.json');
  fs.writeFileSync(settingsFile, 'invalid original');
  for (const [channel, arg] of [['theme:set', 'dusk'], ['view:set', 'split'], ['settings:set', { openaiModel: 'whisper-1' }]]) {
    const refused = h.handlers.get(channel)({}, arg);
    assert.equal(refused.ok, false, channel); assert.equal(refused.error, SETTINGS_ERROR, channel);
  }
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), 'invalid original');
});
test('production speech and agent lookup preserve precedence without persisting environment keys', t => {
  const h = harness(t, true);
  let env = vm.runInContext('sessionEnv("/fixture/bin")', h.ctx);
  assert.equal(env.OPENAI_API_KEY, h.secret);
  assert.equal(env.PATH, '/fixture/bin');
  let speech = vm.runInContext('sttEnv()', h.ctx);
  assert.equal(sttConfig(speech.settings, speech.env).openaiKey, h.secret);
  h.handlers.get('keys:delete')({}, { name: 'OPENAI_API_KEY' });
  h.handlers.get('settings:set')({}, { openaiKey: 'legacy-dummy' });
  speech = vm.runInContext('sttEnv()', h.ctx);
  assert.equal(sttConfig(speech.settings, speech.env).openaiKey, 'legacy-dummy');
  h.handlers.get('keys:delete')({}, { name: 'legacy:openaiKey' });
  speech = vm.runInContext('sttEnv()', h.ctx);
  assert.equal(sttConfig(speech.settings, speech.env).openaiKey, 'environment-only-dummy');
  env = vm.runInContext('sessionEnv("/fixture/bin")', h.ctx);
  assert.equal(env.OPENAI_API_KEY, 'environment-only-dummy');
  assert.equal(h.handlers.get('keys:reveal')({}, { name: 'OPENAI_API_KEY' }).value, '');
  for (const file of ['settings.json', 'credentials.json']) {
    assert.ok(!fs.readFileSync(path.join(h.dir, file), 'utf8').includes('environment-only-dummy'));
  }
});

test('cleanup status reaches key IPC without leaking source or disabling committed mutations',t=>{
  const h=harness(t,true), file=path.join(h.dir,'settings.json');
  fs.writeFileSync(file,'invalid fixture');
  for(const [channel,arg] of [['keys:set',{name:'NEW_KEY',value:h.secret}],['keys:delete',{name:'OPENAI_API_KEY'}],['keys:retry'],['keys:get']]) {
    const result=h.handlers.get(channel)({},arg);
    assert.equal(result.ok,true,channel);
    assert.equal(result.cleanupPending,true,channel);
    assert.ok(result.cleanupWarning.includes('Plaintext cleanup is incomplete'));
    assert.ok(!JSON.stringify(result).includes(h.secret));
  }
  assert.equal(h.handlers.get('keys:reveal')({},{name:'NEW_KEY'}).value,h.secret);
  assert.equal(h.handlers.get('keys:reveal')({},{name:'OPENAI_API_KEY'}).value,'');
  fs.writeFileSync(file,JSON.stringify({theme:'dusk',envKeys:{OPENAI_API_KEY:h.secret}}));
  assert.equal(h.handlers.get('keys:retry')({}).cleanupPending,false);
  assert.equal(h.handlers.get('keys:get')({}).cleanupWarning,null);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{theme:'dusk'});
  const legacy=h.handlers.get('settings:set')({},{elevenKey:h.secret});
  assert.equal(legacy.cleanupPending,false); assert.equal(legacy.cleanupWarning,null);
});

test('a migration blocked by settings.json tells the Keys pane and dictation about settings.json', async t => {
  const h = harness(t, true), settingsFile = path.join(h.dir, 'settings.json');
  // Fresh profile whose settings.json cannot be rewritten: the source lives in a
  // read-only folder behind a symlink, which the private writer follows.
  fs.rmSync(path.join(h.dir, 'credentials.json'));
  const ro = path.join(h.dir, 'ro'); fs.mkdirSync(ro);
  fs.writeFileSync(path.join(ro, 'settings.json'), JSON.stringify({ sttProvider: 'openai', envKeys: { OPENAI_API_KEY: h.secret } }));
  fs.chmodSync(ro, 0o500); t.after(() => { try { fs.chmodSync(ro, 0o700); } catch (_) {} });
  fs.rmSync(settingsFile); fs.symlinkSync(path.join(ro, 'settings.json'), settingsFile);
  vm.runInContext('credentials = undefined; delete process.env.OPENAI_API_KEY', h.ctx);
  const init = vm.runInContext('credentialStore().initialize()', h.ctx);
  assert.equal(init.ok, false); assert.equal(init.error, CLEANUP_ERROR);
  assert.equal(h.handlers.get('keys:get')({}).kind, 'settings');
  assert.equal(h.handlers.get('keys:retry')({}).error, CLEANUP_ERROR);
  for (const channel of ['stt:transcribe', 'stt:prepare']) {
    const failed = await h.handlers.get(channel)({}, {});
    assert.equal(failed.ok, false); assert.equal(failed.error, CLEANUP_ERROR, channel);
  }
  assert.equal(h.handlers.get('stt:status')({}).credentialStorage.kind, 'settings');
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).envKeys.OPENAI_API_KEY, h.secret);
  // Fixing the folder and retrying finishes the migration.
  fs.chmodSync(ro, 0o700);
  assert.equal(h.handlers.get('keys:retry')({}).ok, true);
  assert.equal(h.handlers.get('keys:reveal')({}, { name: 'OPENAI_API_KEY' }).value, h.secret);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { sttProvider: 'openai' });
  assert.equal((await h.handlers.get('stt:transcribe')({}, {})).ok, true);
});
test('keys:retry on a usable store retries cleanup without the key store and reports skipped entries', t => {
  const h = harness(t, true), settingsFile = path.join(h.dir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dusk', envKeys: { OPENAI_API_KEY: h.secret, 'bad-name': 'skipped-dummy' } }));
  vm.runInContext('safeStorage.isEncryptionAvailable = () => false', h.ctx);
  const retried = h.handlers.get('keys:retry')({});
  assert.equal(retried.ok, true); assert.equal(retried.cleanupPending, false);
  assert.deepEqual(retried.skippedKeys, ['bad-name']);
  assert.ok(retried.skippedWarning.includes('bad-name'));
  assert.ok(!JSON.stringify(retried).includes('skipped-dummy') && !JSON.stringify(retried).includes(h.secret));
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { theme: 'dusk', envKeys: { 'bad-name': 'skipped-dummy' } });
  assert.equal(h.handlers.get('keys:reveal')({}, { name: 'OPENAI_API_KEY' }).value, h.secret);
  assert.ok(!JSON.stringify(h.handlers.get('settings:get')({})).includes('skipped-dummy'));
});

test('corrected source recovery and damaged-vault cleanup refusal reach IPC safely', t => {
  const h=harness(t,true), settings=path.join(h.dir,'settings.json'), vault=path.join(h.dir,'credentials.json');
  fs.writeFileSync(settings,JSON.stringify({envKeys:{'BAD-NAME':h.secret}}));
  assert.deepEqual(h.handlers.get('keys:retry')({}).skippedKeys,['BAD-NAME']);
  fs.writeFileSync(settings,JSON.stringify({envKeys:{FIXED_NAME:h.secret},theme:'dusk'}));
  const imported=h.handlers.get('keys:retry')({});
  assert.equal(imported.cleanupPending,false);
  assert.equal(h.handlers.get('keys:reveal')({},{name:'FIXED_NAME'}).value,h.secret);
  const good=fs.readFileSync(vault), source=JSON.stringify({envKeys:{FIXED_NAME:h.secret},theme:'paper'});
  fs.writeFileSync(settings,source);fs.writeFileSync(vault,'damaged fixture');
  const blocked=h.handlers.get('keys:retry')({});
  assert.equal(blocked.cleanupPending,true);assert.ok(blocked.cleanupWarning.includes('credentials.json'));
  assert.equal(h.handlers.get('keys:set')({},{name:'OTHER',value:h.secret}).ok,false);
  assert.equal(h.handlers.get('keys:reveal')({},{name:'FIXED_NAME'}).value,h.secret);
  assert.equal(fs.readFileSync(settings,'utf8'),source);
  for(const response of [imported,blocked,h.handlers.get('keys:get')({}),h.handlers.get('settings:get')({})]) assert.ok(!JSON.stringify(response).includes(h.secret));
  fs.writeFileSync(vault,good);
  assert.equal(h.handlers.get('keys:retry')({}).cleanupPending,false);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings,'utf8')),{theme:'paper'});
});
