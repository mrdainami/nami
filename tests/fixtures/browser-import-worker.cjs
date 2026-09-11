// Fixture transport uses the production reader and real SQLite/worker threads.
// It substitutes only Keychain and optional timing/crash behavior.
const { parentPort, workerData }=require('node:worker_threads');
const { readImportSource }=require('../../src/main/browser-import-worker');
const flag=new Int32Array(workerData.cancelBuffer),controller=new AbortController();let ack;
const cancelled=()=>Atomics.load(flag,0)!==0;
parentPort.on('message',m=>{if(m.type==='ack'){ack?.();ack=null;}if(m.type==='cancel'){controller.abort();ack?.();ack=null;}});
const send=m=>parentPort.postMessage(m);
const delay=ms=>new Promise(resolve=>{if(cancelled())return resolve();const timer=setTimeout(resolve,ms);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
(async()=>{
  send({type:'stage',stage:'preparing'});
  if(workerData.delay)await delay(workerData.delay);
  if(workerData.crash)throw Error('Synthetic worker crash');
  let batches=0;
  await readImportSource({...workerData,cancelled,signal:controller.signal,send,
    passwordFor:async()=>{send({type:'fixture-keychain'});return workerData.password||null;},
    batch:async(category,rows)=>{if(cancelled())return;await new Promise(resolve=>{ack=resolve;send({type:'batch',category,rows});});batches++;if(workerData.crashAfterBatch && batches===1)throw Error('Synthetic crash');if(workerData.batchDelay)await delay(workerData.batchDelay);},
  });
  if(!cancelled())send({type:'done'});
})().catch(()=>{throw Error('Synthetic worker failure');}).finally(()=>parentPort.close());
