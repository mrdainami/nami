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
  await tick(); w.emit('message',{type:'done'}); w.emit('exit',0);
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
