const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { deriveChromeKey, decryptChromeCookie, decryptChromeCookieValue, chromeBlobPrefix, cookieOptions, chromeTimeToMs } = require('./browser-profiles');
const { browserUrl } = require('./browser-policy');
const LABELS={Edge:'Microsoft Edge',Brave:'Brave',Vivaldi:'Vivaldi',Opera:'Opera',Arc:'Arc',Chromium:'Chromium'};
function keychainPassword(browser,signal) {
  const label=LABELS[browser]||'Chrome';
  return new Promise(resolve=>execFile('security',['find-generic-password','-w','-s',label+' Safe Storage','-a',label],
    {encoding:'utf8',timeout:25000,signal,maxBuffer:64*1024},(error,out)=>resolve(error?null:String(out).trim()||null)));
}
function createImportWorker(data) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nami-browser-import-'));
  try {
    const worker=new Worker(__filename,{workerData:{...data,directory}});
    worker.cleanup=()=>fs.promises.rm(directory,{recursive:true,force:true});
    return worker;
  } catch(error) {fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
// Dependency injection stays in the backend test harness, never renderer IPC.
async function readImportSource({source,categories,directory,cancelled,signal,send,passwordFor=keychainPassword,batch}) {
  if(cancelled()) return;
  let key=null;
  if((categories.cookies && source.cookies)||(categories.passwords && source.logins)) {
    send({type:'stage',stage:'keychain'});
    const password=await passwordFor(source.browser,signal);
    if(cancelled()) return;
    key=password?deriveChromeKey(password):null;
  }
  const {DatabaseSync}=require('node:sqlite');
  for(const category of ['cookies','passwords','history']) {
    if(!categories[category] || cancelled()) continue;
    const file=source[category==='passwords'?'logins':category];
    if(!file) {send({type:'result',category,reason:'This source has no '+category+' database.'});send({type:'category-done',category});continue;}
    send({type:'stage',stage:'reading',category});
    const target=path.join(directory,category+'.sqlite'); let db;
    try {
      // Never write beside the live browser database. Main owns cleanup even
      // when this worker crashes before its finally block can run.
      fs.copyFileSync(file,target);
      for(const suffix of ['-wal','-shm']) {try{fs.copyFileSync(file+suffix,target+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}}
      db=new DatabaseSync(target);
      const sql=category==='cookies'?'SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies'
        :category==='passwords'?'SELECT origin_url, username_value, password_value FROM logins'
        :'SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC';
      const statement=db.prepare(sql);statement.setReadBigInts(true);
      let rows=[],bytes=0,accepted=0,skipped=0;const reasons=new Set();
      for(const raw of statement.iterate()) {
        if(cancelled()) break;
        const row=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v]));
        let value;
        if(accepted>=5000){skipped++;reasons.add('At most 5,000 rows per category are copied.');continue;}
        try {
          if(category==='cookies') {
            if(chromeBlobPrefix(row.encrypted_value)==='v20')throw Error('Unsupported browser encryption.');
            const decrypted=row.value || (key?decryptChromeCookieValue(row.encrypted_value,key):null);
            if(!decrypted)throw Error(key?'Could not decrypt some cookies.':'Keychain access was unavailable or denied.');
            value=cookieOptions({...row,value:decrypted});
          } else if(category==='passwords') {
            const password=key?decryptChromeCookie(row.password_value,key):(typeof row.password_value==='string'?row.password_value:null);
            if(password && password.length>16000)throw Error('Some rows exceed the supported size.');
            if(!password)throw Error(chromeBlobPrefix(row.password_value)==='v20'?'Unsupported browser encryption.':key?'Could not decrypt some passwords.':'Keychain access was unavailable or denied.');
            value={origin:new URL(browserUrl(row.origin_url)).origin,username:String(row.username_value||'').slice(0,2000),password};
          } else value={url:browserUrl(row.url),title:String(row.title||'').slice(0,200),at:chromeTimeToMs(row.last_visit_time)};
          const size=Buffer.byteLength(JSON.stringify(value));
          if(size>128*1024)throw Error('Some rows exceed the supported size.');
          if(rows.length && (rows.length>=100 || bytes+size>256*1024)){await batch(category,rows);rows=[];bytes=0;if(cancelled())break;}
          rows.push(value);bytes+=size;accepted++;
        } catch(error) {skipped++;reasons.add(/Keychain|encrypt|decrypt|supported size/.test(error.message)?error.message:'Some rows contain unsupported data.');}
      }
      if(rows.length && !cancelled())await batch(category,rows);
      send({type:'result',category,skipped});
      for(const reason of reasons)send({type:'result',category,reason});
    } catch(error) {
      const locked=/SQLITE_BUSY|SQLITE_LOCKED|database is locked|EBUSY/.test(String(error.code)+' '+error.message);
      send({type:'result',category,error:locked?'Source database is locked. Close the source browser and retry.':'Could not read the source '+category+' database. Check file access and retry.'});
    } finally {if(!cancelled())send({type:'category-done',category});db?.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(target+suffix,{force:true});}
  }
}
if(!isMainThread && require.main === module) {
  const flag=new Int32Array(workerData.cancelBuffer),controller=new AbortController();let ack;
  const cancelled=()=>Atomics.load(flag,0)!==0;
  parentPort.on('message',message=>{
    if(message.type==='ack'){ack?.();ack=null;}
    if(message.type==='cancel'){controller.abort();ack?.();ack=null;}
  });
  const send=message=>parentPort.postMessage(message);
  readImportSource({...workerData,cancelled,signal:controller.signal,send,
    batch:async(category,rows)=>{if(cancelled())return;await new Promise(resolve=>{ack=resolve;send({type:'batch',category,rows});});},
  }).then(()=>{if(!cancelled())send({type:'done'});}).catch(()=>send({type:'failure',error:'Import worker could not finish. Try again.'})).finally(()=>parentPort.close());
}
module.exports={createImportWorker,readImportSource};
