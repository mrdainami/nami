// Run with Electron. All sources and destinations are synthetic and disposable.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {DatabaseSync}=require('node:sqlite');
const {fixtureWorker}=require('./browser-import-fixture.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nami-import-jobs-ui-'));
const source={id:'source',browser:'Chrome',name:'Work fixture',directory:root,cookies:path.join(root,'Cookies'),history:path.join(root,'History')};
const db=new DatabaseSync(source.cookies);
db.exec('CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER)');
const insert=db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)');
for(let i=0;i<500;i++)insert.run('import.example.test','fixture_'+i,'synthetic-'+i,Buffer.alloc(0),'/',0,1,1,1);db.close();
const hd=new DatabaseSync(source.history);hd.exec('CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)');
for(let i=0;i<1000;i++)hd.prepare('INSERT INTO urls VALUES(?,?,?)').run('https://example.test/'+i,'History '+i,13400000000000000n+BigInt(i));hd.close();
let mode={},workers=[],keychain=0;
const profileModule=require('../src/main/browser-profiles');
profileModule.detectChromiumProfiles=()=>[source];
profileModule.cookieImportStatus=()=>({available:true,browsers:[{id:source.id,browser:source.browser,name:source.name,cookies:true,history:true,passwords:false}]});
require('../src/main/browser-import-worker').createImportWorker=data=>{const w=fixtureWorker(data,mode,()=>keychain++);workers.push(w);return w;};
app.getVersion=()=>require('../package.json').version;
process.argv.push('--demo','--scene=browser','--theme=paper','--user-data',path.join(root,'Nami'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
require('../src/main/main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+25000;while(Date.now()<end){const v=await fn();if(v)return v;await pause(25);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{
 let win,server,timer;
 try {
  win=await until(()=>BrowserWindow.getAllWindows()[0],'window');
  const run=code=>win.webContents.executeJavaScript(code);
  const invoke=args=>run(`dainami.browserProfiles(${JSON.stringify(args)})`);
  const job=args=>run(`dainami.browserImport(${JSON.stringify(args)})`);
  const click=sel=>run(`document.querySelector(${JSON.stringify(sel)}).click()`);
  await until(()=>run('!!document.querySelector(".browser-address")'),'browser pane');
  const id=await run('document.querySelector(".browser-tile").dataset.id');
  await until(()=>run(`dainami.browserStatus().then(r=>r.views.some(v=>v.id===${JSON.stringify(id)}))`),'native view');
  server=http.createServer((_req,res)=>res.end('<title>Local import check</title><p>Responsive browsing</p>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+server.address().port;
  const action=args=>run(`dainami.browserAction(${JSON.stringify(args)})`);
  assert.equal((await action({id,action:'navigate',url})).ok,true);
  const work=(await invoke({action:'create',name:'Work'})).profile;
  assert.equal((await invoke({action:'switch',profileId:work.id,id})).ok,true);
  const args={profileId:work.id,sourceId:source.id,cookies:true,passwords:false,history:true};
  const start=async(extra={})=>{const r=await job({action:'start',...args,...extra});assert.equal(r.ok,true,r.error);return r.job;};
  const done=async j=>until(async()=>{const r=(await job({action:'get',jobId:j.id})).job;return ['complete','partial','failed','cancelled'].includes(r.state)?r:false;},'job finishes');
  const open=async()=>{await click('[data-browser-action="menu"]');await run(`Array.from(document.querySelectorAll('.browser-menu button')).find(b=>b.textContent==='Import from Chrome…').click()`);};
  const shot=async name=>{if(!process.env.NAMI_REVIEW_DIR)return;await pause(150);fs.mkdirSync(process.env.NAMI_REVIEW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const fits=async()=>assert.deepEqual(await run(`Array.from(document.querySelectorAll('#import-cancel,#import-stop,#import-go')).filter(el=>!el.hidden).filter(el=>{const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1}).map(el=>el.id)`),[]);

  mode={delay:10000};await open();await until(()=>run('!!document.querySelector("#import-source")'),'import form');
  await run(`document.querySelector('#import-passwords').checked=false`);
  let maxGap=0,last=performance.now();timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
  const started=performance.now();await click('#import-go');
  await until(()=>run('!!document.querySelector("#import-stop")'),'progress panel');
  const j=(await job({action:'list'})).jobs.at(-1);
  assert.equal(j.profileId,work.id);
  assert.equal((await job({action:'start',...args})).ok,false,'duplicate destination import rejected');
  await fits();await shot('progress-paper');
  win.focus();win.webContents.focus();await pause(150);
  await run(`document.querySelector('#import-cancel').focus()`);
  assert.equal(await run('document.activeElement.id'),'import-cancel');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await until(()=>run('!document.querySelector(".modal")'),'keyboard closes panel');
  assert.equal(await run('document.querySelector(".browser-import-status").hidden'),false);
  const navigationStart=performance.now();
  assert.equal((await run(`dainami.browserCreate(${JSON.stringify({id:'other-profile',url,profileId:'default'})})`)).ok,true);
  assert.equal((await action({id:'other-profile',action:'navigate',url:url+'/?next=1'})).ok,true);
  const navigationMs=performance.now()-navigationStart;
  assert.ok(navigationMs<500,'another profile navigates while import is delayed: '+navigationMs);
  win.webContents.send('menu:command','settings:browser');
  // Settings now remembers the selected profile. Choose Personal explicitly
  // to open a fresh import form; Work correctly reopens its running job.
  await until(()=>run(`(() => {const el=document.querySelector('#browser-settings-profile');if(!el||el.disabled)return false;el.value='default';el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`),'select Personal settings');
  await until(()=>run(`document.querySelector('#browser-settings-profile')?.value==='default' && !document.querySelector('#browser-settings-profile').disabled`),'Personal settings saved');
  await until(()=>run(`(() => {const el=document.querySelector('[data-browser-settings="cookies"]');if(typeof el?.onclick!=='function')return false;el.click();return true;})()`),'global import entry');
  await until(()=>run('!!document.querySelector("#import-destination")'),'global destination');
  await run(`(() => {const el=document.querySelector('#import-destination');el.value=${JSON.stringify(work.id)};el.dispatchEvent(new Event('change'));})()`);
  assert.equal(await run('document.querySelector("#import-go").disabled'),true,'active destination disables duplicate start in the form');
  await click('.browser-import-running button');await until(()=>run('!!document.querySelector("#import-stop")'),'reopened job');
  assert.equal((await job({action:'list'})).jobs.length,1,'reopening never restarts import');
  win.setSize(1100,800);await run(`document.body.dataset.theme='operator'`);await fits();await shot('progress-operator');
  const completed=await done(j);clearInterval(timer);timer=null;
  assert.equal(completed.state,'complete',JSON.stringify(completed));assert.equal(completed.results.cookies.copied,500);assert.equal(completed.results.history.copied,1000);
  assert.ok(performance.now()-started>=10000,'real ten-second source delay exercised');
  assert.ok(maxGap<250,'main-thread heartbeat gap during import: '+maxGap);
  console.log('PASS: ten-second worker delay; another profile navigated in '+navigationMs.toFixed(1)+'ms; maximum main-thread heartbeat gap '+maxGap.toFixed(1)+'ms.');
  assert.equal((await invoke({action:'contents',profileId:'default'})).contents.cookies,0);
  await shot('complete-operator');await click('#import-cancel');

  mode={batchDelay:300};const partialCancel=await start({history:false});
  await until(async()=>((await job({action:'get',jobId:partialCancel.id})).job.results.cookies.copied>=100),'first cookie batch');
  await open();await until(()=>run('!!document.querySelector("#import-stop")'),'cancel view');
  await click('#import-stop');const cancelled=await done(partialCancel);
  assert.equal(cancelled.state,'cancelled');assert.ok(cancelled.results.cookies.copied>=100 && cancelled.results.cookies.copied<500);
  await shot('cancelled-operator');await click('#import-cancel');
  assert.ok(workers.every(w=>!fs.existsSync(w.fixtureDirectory)),'cancelled/completed snapshots removed');
  console.log('PASS: cancellation settles outstanding writes, reports '+cancelled.results.cookies.copied+' copied cookies, and removes temporary snapshots.');

  mode={delay:10000};const clearing=await start();const clearAt=performance.now();
  const cleared=await invoke({action:'clear',profileId:work.id,siteData:true,credentials:true,confirmed:true});
  assert.equal(cleared.ok,true,cleared.error);assert.ok(performance.now()-clearAt<1500);
  assert.equal((await done(clearing)).state,'cancelled');
  await pause(200);assert.equal((await session.fromPartition('persist:nami-browser-'+work.id).cookies.get({})).length,0);
  assert.equal((await action({id:'other-profile',action:'navigate',url})).ok,true);
  console.log('PASS: clear cancels the active import before deleting Work data; Personal remains usable and no later cookie writes appear.');

  mode={crash:true};const crashed=await start();assert.equal((await done(crashed)).state,'failed');
  assert.ok(workers.every(w=>!fs.existsSync(w.fixtureDirectory)));
  mode={};const beforeKeychain=keychain,retry=await start({cookies:false});
  assert.equal((await done(retry)).state,'complete');assert.equal(keychain,beforeKeychain,'history-only never accesses Keychain');
  console.log('PASS: worker crash releases locks and snapshots; retry succeeds; history-only import never requests Keychain.');

  // A mixed valid/unsupported cookie source must give an honest partial result.
  const mix=new DatabaseSync(source.cookies);mix.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)').run('import.example.test','unsupported','',Buffer.from('v20synthetic'),'/',0,1,1,1);mix.close();
  const partial=await start({history:false});const result=await done(partial);
  assert.equal(result.state,'partial');assert.equal(result.results.cookies.skipped,1);assert.equal(result.results.cookies.copied,500);
  // Open its result through the remaining profile manager, after clear closed Work's tab.
  win.webContents.send('menu:command','settings:browser');
  await until(()=>run(`(() => {const el=document.querySelector('[data-browser-settings="profiles"]');if(typeof el?.onclick!=='function')return false;el.click();return true;})()`),'global profile manager');
  await until(()=>run('!!document.querySelector("#profile-choice")'),'profile choice');
  await run(`(() => {const el=document.querySelector('#profile-choice');el.value=${JSON.stringify(work.id)};el.dispatchEvent(new Event('change'));})()`);
  await until(()=>run(`Array.from(document.querySelectorAll('.browser-profile-actions button')).some(b=>b.textContent==='View import result')`),'result link in profile manager');
  await run(`Array.from(document.querySelectorAll('.browser-profile-actions button')).find(b=>b.textContent==='View import result').click()`);
  await until(()=>run('!!document.querySelector("#import-stop")'),'partial results');
  for(const [theme,zoom,width,height] of [['paper',1,1100,800],['operator',1,700,650],['paper',1.75,1000,850]]) {
    win.setSize(width,height);win.webContents.setZoomFactor(zoom);await run(`document.body.dataset.theme=${JSON.stringify(theme)};window.dispatchEvent(new Event('resize'))`);await pause(150);await fits();await shot('partial-'+theme+'-'+zoom);
  }
  console.log('PASS: partial results separate copied/skipped counts and encryption reasons; actions fit Paper, Operator, compact windows and 1.75 zoom.');
 }catch(error){console.error(error);process.exitCode=1;if(win&&!win.isDestroyed())console.error(await win.webContents.executeJavaScript('document.querySelector(".modal")?.textContent'));}
 finally{if(timer)clearInterval(timer);server?.close();await Promise.all(workers.map(async w=>{try{await w.terminate();await w.cleanup();}catch{}}));fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
