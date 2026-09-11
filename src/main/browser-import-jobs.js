// The main process owns jobs and applies data. Only display-safe snapshots leave it.
const { randomUUID } = require('node:crypto');
const terminal = state => ['complete', 'partial', 'cancelled', 'failed'].includes(state);
const CATEGORIES = ['cookies', 'passwords', 'history'];
function createImportJobs({ resolveSource, resolveProfile, createWorker, applyBatch, onChange = () => {} }) {
  const jobs = new Map(), active = new Map();
  let closing = false;
  const snapshot = j => ({ id:j.id, revision:j.revision, profileId:j.profileId, profileName:j.profileName, sourceId:j.source.id,
    sourceName:j.source.browser + ' · ' + j.source.name, categories:{...j.categories}, state:j.state,
    stage:j.stage, category:j.category, results:structuredClone(j.results), error:j.error || '', startedAt:j.startedAt });
  const emit = j => { j.revision=(j.revision||0)+1; try { onChange(snapshot(j), j.owner); } catch {} };
  const lookup = (owner,id) => { const j=jobs.get(id); if(!j || j.owner!==owner) throw Error('Import job is no longer available.'); return j; };
  function stop(j, error) {
    if(terminal(j.state)) return;
    if(error) j.error=error;
    j.state='cancelling'; j.stage='cancelling';
    Atomics.store(j.cancelFlag,0,1);
    j.worker?.postMessage({type:'cancel'}); emit(j);
  }
  async function finish(j) {
    if(j.finishing) return; j.finishing=true;
    await j.chain;
    for(const r of Object.values(j.results))if(!r.finished && !r.error)r.reasons.push('This category did not finish.');
    const copied=Object.values(j.results).reduce((n,r)=>n+r.copied,0);
    const incomplete=Object.values(j.results).some(r=>r.skipped || r.failed || r.error || r.reasons.length);
    j.state=j.error ? (copied?'partial':'failed') : j.state==='cancelling' ? 'cancelled' : !j.done ? (copied?'partial':'failed') : Object.values(j.results).some(r=>r.error || r.failed) && !copied?'failed':incomplete?'partial':'complete';
    if(!j.done && j.state!=='cancelled' && !j.error) j.error='Import worker stopped before finishing. Try again.';
    j.stage=j.state;
    try { await j.worker?.cleanup?.(); } catch { j.error ||= 'Temporary import files could not be removed.'; if(j.state==='complete')j.state='partial'; }
    active.delete(j.profileId); emit(j); j.resolve(snapshot(j));
  }
  function start(owner,args) {
    if(closing) throw Error('Nami is closing.');
    if(typeof args.profileId!=='string' || !args.profileId) throw Error('Choose a destination Nami profile before importing.');
    const profile=resolveProfile(args.profileId), source=resolveSource(args.sourceId);
    if(active.has(profile.id)) throw Error('An import is already running for this profile. Open its progress or cancel it first.');
    const categories=Object.fromEntries(CATEGORIES.map(k=>[k,args[k]!==false]));
    if(!Object.values(categories).some(Boolean)) throw Error('Choose data to import.');
    // Retain a small review history, never credentials or unbounded job logs.
    for(const [id,j] of jobs) if(jobs.size>=30 && terminal(j.state)) jobs.delete(id);
    if(jobs.size>=40) throw Error('Too many imports are active. Wait for one to finish.');
    const j={id:randomUUID(),owner,profileId:profile.id,profileName:profile.name,source:{...source},categories,
      state:'running',stage:'preparing',startedAt:Date.now(),results:{},chain:Promise.resolve(),cancelFlag:new Int32Array(new SharedArrayBuffer(4))};
    for(const k of CATEGORIES) if(categories[k]) j.results[k]={copied:0,skipped:0,failed:0,reasons:[],error:'',finished:false};
    j.promise=new Promise(resolve=>j.resolve=resolve);
    jobs.set(j.id,j); active.set(j.profileId,j); emit(j);
    try {
      const worker=j.worker=createWorker({source:j.source,categories,cancelBuffer:j.cancelFlag.buffer});
      worker.on('message',message=>{
        if(terminal(j.state)) return;
        if(message.type==='stage' && j.state!=='cancelling') {
          if(['preparing','keychain','reading','copying'].includes(message.stage)) j.stage=message.stage;
          j.category=CATEGORIES.includes(message.category)?message.category:undefined; emit(j);
        } else if(message.type==='result' && j.results[message.category]) {
          const r=j.results[message.category];
          r.skipped+=Math.max(0,Number(message.skipped)||0);
          if(message.reason && !r.reasons.includes(message.reason)) r.reasons.push(String(message.reason).slice(0,250));
          if(message.error) r.error=String(message.error).slice(0,250);
          emit(j);
        } else if(message.type==='category-done' && j.results[message.category]) {
          j.results[message.category].finished=true; emit(j);
        } else if(message.type==='batch') {
          j.chain=j.chain.then(async()=>{
            if(j.state==='cancelling') return;
            const category=message.category, rows=message.rows;
            if(!j.results[category] || !Array.isArray(rows) || rows.length>100 || Buffer.byteLength(JSON.stringify(rows))>512*1024) throw Error('Invalid import batch.');
            resolveProfile(j.profileId); resolveSource(j.source.id);
            j.stage='copying'; j.category=category; emit(j);
            const r=await applyBatch({profileId:j.profileId,sourceId:j.source.id,firstBatch:j.results[category].copied===0,cancelled:()=>Atomics.load(j.cancelFlag,0)!==0},category,rows);
            j.results[category].copied+=r.copied||0; j.results[category].failed+=r.failed||0;
            if(r.failed && !j.results[category].reasons.includes('Some rows were refused by Nami.')) j.results[category].reasons.push('Some rows were refused by Nami.');
            emit(j);
          }).catch(error=>stop(j,error.message)).finally(()=>{if(!j.exited)worker.postMessage({type:'ack'});});
        } else if(message.type==='done') j.done=true;
        else if(message.type==='failure') stop(j,String(message.error||'Could not read browser data.').slice(0,250));
      });
      worker.on('error',()=>{j.error='Import worker stopped unexpectedly. Try again.';});
      worker.on('exit',()=>{j.exited=true; void finish(j);});
    } catch(error) {j.error=error.message; void finish(j);}
    return snapshot(j);
  }
  return {
    start, list:owner=>[...jobs.values()].filter(j=>j.owner===owner).map(snapshot),
    get:(owner,id)=>snapshot(lookup(owner,id)), wait:(owner,id)=>lookup(owner,id).promise,
    active:profileId=>{const j=active.get(profileId);return j?snapshot(j):null;},
    async cancel(owner,id) {const j=lookup(owner,id);stop(j);return j.promise;},
    async cancelProfile(profileId) {const j=active.get(profileId);if(j){stop(j);await j.promise;}},
    async shutdown() {closing=true;for(const j of active.values())stop(j);await Promise.all([...active.values()].map(j=>j.promise));},
  };
}
module.exports={createImportJobs};
