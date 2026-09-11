import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createImportJobs } = require('../src/main/browser-import-jobs');
const tick = () => new Promise(r => setImmediate(r));
class FakeWorker extends EventEmitter {
  postMessage(message) { if (message.type === 'cancel') setImmediate(() => this.emit('exit', 0)); }
}
function fixture(extra = {}) {
  const workers = [], writes = [], changes = [];
  const jobs = createImportJobs({
    resolveSource: id => { assert.equal(id, 'source'); return { id, browser:'Chrome', name:'Work source', directory:'/private/source' }; },
    resolveProfile: id => { if(id !== 'work') throw Error('Missing profile'); return { id, name:'Work' }; },
    createWorker: () => { const w=new FakeWorker(); workers.push(w); return w; },
    applyBatch: async (_job,category,rows) => { writes.push(...rows); return { copied:rows.length, failed:0 }; },
    onChange: j => changes.push(j), ...extra,
  });
  const start = () => jobs.start(11, {profileId:'work',sourceId:'source',cookies:true,passwords:false,history:false});
  return {jobs,workers,writes,changes,start};
}
test('jobs reserve exact destinations, isolate owners, and expose no source paths or rows', async () => {
  const f=fixture(), j=f.start(); await tick();
  assert.throws(f.start,/already/i);
  assert.deepEqual(f.jobs.list(12),[]);
  assert.throws(()=>f.jobs.get(12,j.id),/available/i);
  const w=f.workers[0];
  w.emit('message',{type:'batch',category:'cookies',rows:[{value:'private-cookie'}]});
  await tick(); w.emit('message',{type:'category-done',category:'cookies'}); w.emit('message',{type:'done'}); w.emit('exit',0);
  const result=await f.jobs.wait(11,j.id);
  assert.equal(result.state,'complete'); assert.equal(result.results.cookies.copied,1);
  assert.doesNotMatch(JSON.stringify(f.changes),/private-cookie|private\/source/);
});
test('cancellation waits for the in-flight write and preserves copied counts', async () => {
  let finish;
  const f=fixture({applyBatch:()=>new Promise(r=>finish=r)}), j=f.start(); await tick();
  f.workers[0].emit('message',{type:'batch',category:'cookies',rows:[{}]}); await tick();
  const cancelled=f.jobs.cancel(11,j.id); let settled=false; cancelled.then(()=>settled=true);
  await tick(); assert.equal(settled,false); assert.equal(f.jobs.get(11,j.id).state,'cancelling');
  finish({copied:1,failed:0});
  const result=await cancelled; assert.equal(result.state,'cancelled'); assert.equal(result.results.cookies.copied,1);
  assert.doesNotThrow(f.start); await f.jobs.cancelProfile('work');
});
test('worker crash releases reservations, reports partial writes and permits retry', async () => {
  const f=fixture(), j=f.start(); await tick();
  f.workers[0].emit('message',{type:'batch',category:'cookies',rows:[{}]}); await tick();
  f.workers[0].emit('error',Error('worker stopped')); f.workers[0].emit('exit',1);
  const result=await f.jobs.wait(11,j.id); assert.equal(result.state,'partial'); assert.equal(result.results.cookies.copied,1);
  assert.match(result.error,/stopped/i); assert.doesNotThrow(f.start); await f.jobs.shutdown();
});
test('destination and source disappearance prevent the next batch from being applied', async () => {
  let missing=false;
  const f=fixture({resolveProfile:id=>{if(missing)throw Error('Missing profile');return {id,name:'Work'};}}),j=f.start(); await tick();
  missing=true; f.workers[0].emit('message',{type:'batch',category:'cookies',rows:[{}]});
  const result=await f.jobs.wait(11,j.id); assert.equal(result.state,'failed'); assert.equal(f.writes.length,0);
});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createImportWorker,readImportSource}=require('../src/main/browser-import-worker');
const {fixtureWorker}=require('./browser-import-fixture.cjs');
function historyFixture(count=260) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nami-job-test-')),history=path.join(directory,'History');
  const db=new DatabaseSync(history);db.exec('CREATE TABLE urls (url TEXT,title TEXT,last_visit_time INTEGER)');
  const insert=db.prepare('INSERT INTO urls VALUES (?,?,?)');
  for(let i=0;i<count;i++)insert.run('https://example.test/'+i,'History '+i,13400000000000000n+BigInt(i));
  db.close();return {directory,source:{id:'source',browser:'Chrome',name:'Fixture',history}};
}
test('real production worker imports history in bounded batches without requesting Keychain',async()=>{
  const h=historyFixture(), batches=[], workers=[], stages=[];
  const jobs=createImportJobs({resolveSource:()=>h.source,resolveProfile:id=>({id,name:'Work'}),
    createWorker:data=>{const w=createImportWorker(data);workers.push(w);return w;},
    applyBatch:async(_job,category,rows)=>{assert.equal(category,'history');assert.ok(rows.length<=100);batches.push(rows);return {copied:rows.length};},
    onChange:job=>stages.push(job.stage),
  });
  try {const j=jobs.start(1,{profileId:'work',sourceId:'source',cookies:false,passwords:false,history:true});
    const result=await jobs.wait(1,j.id);assert.equal(result.state,'complete');assert.equal(result.results.history.copied,260);assert.equal(batches.length,3);assert.equal(stages.includes('keychain'),false);
    assert.equal(fs.readdirSync(h.directory).length,1,'source directory unchanged');
  }finally{await jobs.shutdown();fs.rmSync(h.directory,{recursive:true,force:true});}
});
test('reader reports unsupported encryption and denied Keychain separately, with secrets confined to batches',async()=>{
  const h=historyFixture(1),file=path.join(h.directory,'Cookies');
  const db=new DatabaseSync(file);db.exec('CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER)');
  const insert=db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run('example.test','one','synthetic-secret',Buffer.alloc(0),'/',0,1,1,1);
  insert.run('example.test','two','',Buffer.from('v20xxxxxxxx'),'/',0,1,1,1);
  insert.run('example.test','three','',Buffer.from('v10xxxxxxxx'),'/',0,1,1,1);db.close();
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nami-reader-')),events=[],batches=[];
  try{await readImportSource({source:{...h.source,cookies:file},categories:{cookies:true},directory:temp,cancelled:()=>false,passwordFor:async()=>null,send:e=>events.push(e),batch:async(_k,rows)=>batches.push(...rows)});
    assert.equal(batches.length,1);assert.equal(batches[0].value,'synthetic-secret');
    assert.equal(events.find(e=>e.skipped)?.skipped,2);assert.match(JSON.stringify(events),/Unsupported browser encryption/);assert.match(JSON.stringify(events),/Keychain access/);assert.doesNotMatch(JSON.stringify(events),/synthetic-secret/);
    assert.deepEqual(fs.readdirSync(temp),[]);
  }finally{fs.rmSync(h.directory,{recursive:true,force:true});fs.rmSync(temp,{recursive:true,force:true});}
});
test('real delayed worker cancels promptly, removes snapshots and releases its destination',async()=>{
  const h=historyFixture(),workers=[];
  const jobs=createImportJobs({resolveSource:()=>h.source,resolveProfile:id=>({id,name:'Work'}),createWorker:data=>{const w=fixtureWorker(data,{delay:10000});workers.push(w);return w;},applyBatch:async()=>{throw Error('Cancelled import must not write');}});
  try{const j=jobs.start(1,{profileId:'work',sourceId:'source',history:true,cookies:false,passwords:false});await new Promise(r=>setTimeout(r,100));
    const start=Date.now(),result=await jobs.cancel(1,j.id);assert.equal(result.state,'cancelled');assert.ok(Date.now()-start<1000);assert.equal(fs.existsSync(workers[0].fixtureDirectory),false);assert.equal(jobs.active('work'),null);
  }finally{await jobs.shutdown();fs.rmSync(h.directory,{recursive:true,force:true});}
});

test('source removal during a job stops writes and does not select another source',async()=>{
  let missing=false;
  const f=fixture({resolveSource:id=>{if(missing)throw Error('Source profile is no longer available.');return {id,browser:'Chrome',name:'Work'};}}),j=f.start();await tick();
  missing=true;f.workers[0].emit('message',{type:'batch',category:'cookies',rows:[{}]});
  const result=await f.jobs.wait(11,j.id);assert.equal(result.state,'failed');assert.equal(f.writes.length,0);assert.match(result.error,/Source profile/);
});
test('cancelled reader never requests Keychain, and unreadable categories cannot report success',async()=>{
  let calls=0;const events=[];
  await readImportSource({source:{cookies:'/missing'},categories:{cookies:true},cancelled:()=>true,passwordFor:async()=>calls++,send:e=>events.push(e)});
  assert.equal(calls,0);assert.deepEqual(events,[]);
  const f=fixture(),j=f.start();await tick();
  f.workers[0].emit('message',{type:'result',category:'cookies',error:'Source database is locked.'});
  f.workers[0].emit('message',{type:'category-done',category:'cookies'});f.workers[0].emit('message',{type:'done'});f.workers[0].emit('exit',0);
  const result=await f.jobs.wait(11,j.id);assert.equal(result.state,'failed');assert.equal(result.results.cookies.copied,0);
});
test('encrypted password reader decrypts only supported rows and never includes credentials in progress',async()=>{
  const crypto=require('node:crypto'),{deriveChromeKey}=require('../src/main/browser-profiles');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nami-password-reader-')),directory=path.join(root,'snapshots');fs.mkdirSync(directory);
  const file=path.join(root,'Login Data'),db=new DatabaseSync(file);db.exec('CREATE TABLE logins(origin_url TEXT,username_value TEXT,password_value BLOB)');
  const key=deriveChromeKey('fixture-key'),cipher=crypto.createCipheriv('aes-128-cbc',key,Buffer.alloc(16,' '));
  const blob=Buffer.concat([Buffer.from('v10'),cipher.update('synthetic-password'),cipher.final()]);
  db.prepare('INSERT INTO logins VALUES(?,?,?)').run('https://example.test/login','fixture-user',blob);
  db.prepare('INSERT INTO logins VALUES(?,?,?)').run('https://example.test/login','unsupported',Buffer.from('v20xxxx'));db.close();
  const events=[],rows=[];
  try{await readImportSource({source:{logins:file,browser:'Chrome'},categories:{passwords:true},directory,cancelled:()=>false,passwordFor:async()=>'fixture-key',send:e=>events.push(e),batch:async(_k,batch)=>rows.push(...batch)});
    assert.deepEqual(rows,[{origin:'https://example.test',username:'fixture-user',password:['synthetic','password'].join('-')}]);
    assert.equal(events.find(e=>e.skipped)?.skipped,1);assert.doesNotMatch(JSON.stringify(events),/synthetic-password|fixture-user/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
