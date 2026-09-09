// Real native chrome/menu/profile interactions on a disposable Nami desk.
const { app, BrowserWindow, webContents, dialog } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { captureWindow } = require('../src/main/window-capture');
app.getVersion = () => require('../package.json').version;
process.argv.push('--demo','--scene=browser:multi','--theme=glass');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
require('../src/main/main');
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function until(fn) { for(let i=0;i<300;i++){const v=await fn();if(v)return v;await pause(50);}throw new Error('Condition timed out'); }
app.whenReady().then(async()=>{
 let server, win;
 try {
  server=http.createServer((_req,res)=>res.end('<!doctype html><title>Local search fixture</title><h1>Find this needle</h1><input><button onclick="this.textContent=\'Clicked\'">Click me</button><script>window.ticks=0;setInterval(()=>ticks++,20)</script>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  win=await until(()=>BrowserWindow.getAllWindows()[0]);const run=s=>win.webContents.executeJavaScript(s).catch(e=>{console.error('Failed expression:',s);throw e;});
  await until(()=>run('!!document.querySelector(".browser-address")'));
  const id=await run('document.querySelector(".browser-tile").dataset.id');
  assert.equal((await run(`dainami.browserResolve('apple laptops')`)).url,'https://www.google.com/search?q=apple%20laptops');
  assert.equal((await run(`dainami.browserResolve('youtube.com')`)).url,'https://youtube.com/');
  assert.equal((await run(`dainami.browserResolve('javascript:alert(1)')`)).ok,false);
  await run(`document.querySelector('.browser-address input').value=${JSON.stringify(url.replace('http://',''))};document.querySelector('.browser-address').requestSubmit()`);
  const page=await until(()=>webContents.getAllWebContents().find(w=>w.getURL().startsWith(url)));
  await until(()=>!page.isLoading());
  await until(()=>win.contentView.children.some(v=>v.webContents===page&&v.getVisible()));
  await until(async()=>typeof await page.executeJavaScript('window.ticks')==='number');
  const click=s=>run(`document.querySelector(${JSON.stringify(s)}).click()`);
  const native=async(selector)=>until(async()=>{for(const w of webContents.getAllWebContents().filter(w=>w.getURL().endsWith('browser-overlay.html'))){try{if(await w.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`))return w;}catch{}}});
  async function pointer(w,selector){const r=await w.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mouseDown','mouseUp'])w.sendInputEvent({type,x:Math.round(r.x*w.getZoomFactor()),y:Math.round(r.y*w.getZoomFactor()),button:'left',clickCount:1});await pause(100);}
  const shot=async name=>{if(!process.env.NAMI_REVIEW_DIR)return;await run('Promise.all([...document.querySelectorAll(".modal")].flatMap(m=>m.getAnimations()).map(a=>a.finished.catch(()=>{})))');await pause(300);const views=new Map(win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents).map((view,i)=>[i,{window:win,view}]));fs.mkdirSync(process.env.NAMI_REVIEW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR,name+'.png'),await captureWindow(win,views));};
  await click('[data-browser-action="menu"]');const menu=await native('.browser-menu');
  const before=await page.executeJavaScript('ticks');await until(async()=>await page.executeJavaScript('ticks')>before);assert.ok(win.contentView.children.some(v=>v.webContents===page&&v.getVisible()),'page stays visible under menu');
  await shot('browser-menu-glass');await pointer(menu,'.browser-menu button');
  await until(()=>run('!!document.querySelector(".browser-find")'));
  // Cmd+L works while guest owns focus.
  page.focus();page.sendInputEvent({type:'keyDown',keyCode:'l',modifiers:['meta']});page.sendInputEvent({type:'keyUp',keyCode:'l',modifiers:['meta']});
  await until(()=>run('document.activeElement===document.querySelector(".browser-address input")'));
  await click('.browser-find [type="button"]');
  await click('[data-browser-action="menu"]');await run(`document.querySelectorAll('.browser-menu button')[7].click()`);
  await until(()=>run('!!document.querySelector("#profile-new")'));
  await click('#profile-new');await run(`document.querySelector('#profile-name').value='Work';document.querySelector('#profile-name-save').click()`);
  await until(()=>run('document.querySelector("#profile-choice")?.textContent.includes("Work")'));
  const profiles=await run(`dainami.browserProfiles({action:'list'})`),work=profiles.profiles.find(p=>p.name==='Work');
  await run(`document.querySelector('#profile-choice').value=${JSON.stringify(work.id)};document.querySelector('#profile-choice').dispatchEvent(new Event('change'))`);
  await until(()=>run(`document.querySelector('#profile-choice')?.value===${JSON.stringify(work.id)}&&!!document.querySelector('#profile-switch')`));
  await shot('browser-profiles-glass');await click('#profile-switch');await click('.browser-profile-confirm .btn--go');
  await until(()=>run(`dainami.browserStatus().then(r=>r.views.find(v=>v.id===${JSON.stringify(id)})?.profileId===${JSON.stringify(work.id)})`));
  await until(()=>run('!document.querySelector("#profiles-done")'));
  await click('[data-browser-action="menu"]');await run(`document.querySelectorAll('.browser-menu button')[6].click()`);await until(()=>run('!!document.querySelector("#profile-import")'));
  assert.match(await run('document.querySelector(".browser-profile-body").textContent'),/Direct Chrome cookie import is unavailable/);await shot('browser-import-glass');await click('#profiles-done');
  await click('[data-browser-action="menu"]');await run(`document.querySelectorAll('.browser-menu button')[8].click()`);await until(()=>run('!!document.querySelector("#profile-clear")'));
  await shot('browser-clear-data');await click('#clear-signins');await click('#profile-clear');await shot('browser-clear-confirm');await click('#profiles-done');
  await click('[data-browser-action="menu"]');await run(`document.querySelectorAll('.browser-menu button')[5].click()`);await until(()=>run('!!document.querySelector("#browser-control")'));await shot('browser-access');await click('#browser-access-cancel');
  // Error notification remains above native page instead of disappearing behind it.
  await run(`document.querySelector('.browser-address input').value='javascript:alert(1)';document.querySelector('.browser-address').requestSubmit()`);
  await native('.toast');await until(()=>run('document.querySelector(".toast")?.hasAttribute("data-native-mirrored")'));await pause(250);await shot('browser-error-toast');
  // Same menu/theme geometry at small windows and zoom.
  for(const [theme,zoom]of [['paper',1],['operator',1],['graphite',1],['soft',1],['dusk',1],['glass',1.5],['dusk',1.75]]){
   win.webContents.setZoomFactor(zoom);await run(`document.body.dataset.theme=${JSON.stringify(theme)};document.body.toggleAttribute('data-glass',${['glass','graphite'].includes(theme)});document.body.toggleAttribute('data-soft',${['soft','dusk'].includes(theme)});window.dispatchEvent(new Event('resize'))`);await pause(150);await click('[data-browser-action="menu"]');await native('.browser-menu');
   assert.ok(await run(`(()=>{const r=document.querySelector('.browser-menu').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`));await shot('browser-menu-'+theme+'-'+zoom);await run(`document.querySelector('.browser-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  }
  for(const [theme,zoom]of [['paper',1],['operator',1],['graphite',1],['soft',1],['glass',1],['dusk',1],['glass',1.5],['dusk',1.75]]){
   win.webContents.setZoomFactor(zoom);await run(`document.body.dataset.theme=${JSON.stringify(theme)};document.body.toggleAttribute('data-glass',${['glass','graphite'].includes(theme)});document.body.toggleAttribute('data-soft',${['soft','dusk'].includes(theme)});window.dispatchEvent(new Event('resize'))`);await pause(100);
   await click('[data-browser-action="menu"]');await run(`document.querySelectorAll('.browser-menu button')[7].click()`);await until(()=>run('!!document.querySelector("#profile-new")'));await shot('browser-profiles-'+theme+'-'+zoom);await click('#profiles-done');
   await click('[data-browser-action="menu"]');await run(`document.querySelectorAll('.browser-menu button')[5].click()`);await until(()=>run('!!document.querySelector("#browser-control")'));await shot('browser-access-'+theme+'-'+zoom);await click('#browser-access-cancel');
  }
  console.log('PASS: human URL/search/blocked scheme, native live menu pointer, Cmd+L, profile create/switch, import limitation, visible error toast, menu themes/zoom bounds.');
 }catch(error){console.error(error);if(win&&!win.isDestroyed())console.error(await win.webContents.executeJavaScript('document.querySelector(".modal")?.textContent'));process.exitCode=1;}
 finally{server?.close();app.exit(process.exitCode||0);}
});
