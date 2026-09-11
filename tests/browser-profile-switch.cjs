// Run: npx electron tests/browser-profile-switch.cjs
// Real Electron views, synthetic website sessions and disposable storage only.
const { app, BrowserWindow, protocol } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-profile-switch-'));
app.setPath('userData', root);
protocol.registerSchemesAsPrivileged([{ scheme:'nami-doc', privileges:{standard:true,secure:true,supportFetchAPI:true} }]);
app.whenReady().then(async () => {
  let browser, win, server, failures = 0, rejectSettings = false;
  try {
    const handlers = new Map(), events = [];
    browser = require('../src/main/browser-views').wireBrowserViews({handle:(name,fn)=>handlers.set(name,fn),on:()=>{}}, {
      readSettings:()=>{if(rejectSettings){rejectSettings=false;throw Error('Synthetic view preparation failed');}return {browserEnabled:false};}, writeSettings:()=>({ok:true}),
    });
    win = new BrowserWindow({show:false}); await win.loadURL('data:text/html,<title>Profile switch fixture</title>');
    const originalSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel,event)=>{if(channel==='browser:event')events.push(event);return originalSend(channel,event);};
    const raw = (name,args={})=>handlers.get(name)({sender:win.webContents,senderFrame:win.webContents.mainFrame},args);
    const call = async (name,args)=>{const r=await raw(name,args);assert.equal(r.ok,true,r.error);return r;};
    const test = async (name,fn)=>{try{await fn();console.log('PASS:',name);}catch(e){failures++;console.error('FAIL:',name,e.message);}};
    server = http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Profile account</title><p>'+((req.headers.cookie||'').includes('fixture_account=work')?'WORK_SIGNED_IN':'SIGNED_OUT')+'</p>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+server.address().port;
    const work=(await call('browser:profiles',{action:'create',name:'Work'})).profile;
    const create = async (id,args={})=>{await call('browser:create',{id,url,...args});return browser.views.get(id);};
    const peer=await create('work-peer',{profileId:work.id});
    await peer.view.webContents.session.cookies.set({url,name:'fixture_account',value:'work',httpOnly:true,expirationDate:Date.now()/1000+3600});
    await test('welcome tab switches to Work and uses its real website session',async()=>{
      const old=await create('welcome',{url:'about:blank'});await call('browser:profiles',{action:'switch',id:old.id,profileId:work.id});
      const next=browser.views.get(old.id);assert.equal(next.profileId,work.id);assert.equal(old.view.webContents.isDestroyed(),true);
      assert.ok(events.some(e=>e.id===old.id&&e.type==='state'&&e.profileId===work.id&&e.profileName==='Work'&&e.url==='about:blank'));
      await call('browser:action',{id:old.id,action:'navigate',url});
      assert.match(await next.view.webContents.executeJavaScript('document.body.innerText'),/WORK_SIGNED_IN/);
    });
    await test('HTTP page switches profiles; another Work tab shares auth; Personal stays signed out',async()=>{
      const old=await create('http');assert.match(await old.view.webContents.executeJavaScript('document.body.innerText'),/SIGNED_OUT/);
      await call('browser:profiles',{action:'switch',id:old.id,profileId:work.id});
      assert.match(await browser.views.get(old.id).view.webContents.executeJavaScript('document.body.innerText'),/WORK_SIGNED_IN/);
      const second=await create('work-second',{profileId:work.id}), personal=await create('personal-peer');
      assert.match(await second.view.webContents.executeJavaScript('document.body.innerText'),/WORK_SIGNED_IN/);
      assert.match(await personal.view.webContents.executeJavaScript('document.body.innerText'),/SIGNED_OUT/);
    });
    await test('failed replacement preparation preserves the original native view and supports retry',async()=>{
      const old=await create('failure');rejectSettings=true;
      const failed=await raw('browser:profiles',{action:'switch',id:old.id,profileId:work.id});
      assert.equal(failed.ok,false);assert.match(failed.error,/preparation failed/);
      assert.equal(browser.views.get(old.id),old);assert.equal(old.view.webContents.isDestroyed(),false);assert.equal(old.profileId,'default');
      await call('browser:action',{id:old.id,action:'navigate',url});
      await call('browser:profiles',{action:'switch',id:old.id,profileId:work.id});
      assert.match(await browser.views.get(old.id).view.webContents.executeJavaScript('document.body.innerText'),/WORK_SIGNED_IN/);
    });
    await test('deleted target is rejected without losing the original tab',async()=>{
      const old=await create('deleted');const r=await raw('browser:profiles',{action:'switch',id:old.id,profileId:'deleted-profile'});
      assert.equal(r.ok,false);assert.equal(browser.views.get(old.id),old);assert.equal(old.view.webContents.isDestroyed(),false);
    });
    await test('missing local source preserves the current document; retry stays isolated from Work cookies',async()=>{
      const file=path.join(root,'local.html');fs.writeFileSync(file,'<title>Local switch</title><p>LOCAL_DOCUMENT</p>');
      const old=await create('local',{filePath:file});fs.renameSync(file,file+'.saved');
      const failed=await raw('browser:profiles',{action:'switch',id:old.id,profileId:work.id});
      assert.equal(failed.ok,false);assert.equal(browser.views.get(old.id),old);assert.equal(old.view.webContents.isDestroyed(),false);
      fs.renameSync(file+'.saved',file);await call('browser:profiles',{action:'switch',id:old.id,profileId:work.id});
      const next=browser.views.get(old.id);assert.equal(next.record.local,true);assert.equal(next.profileId,work.id);
      assert.equal(next.view.webContents.session.storagePath,null);assert.deepEqual(await next.view.webContents.session.cookies.get({url}),[]);
      assert.match(await next.view.webContents.executeJavaScript('document.body.innerText'),/LOCAL_DOCUMENT/);
    });
    await test('profile name comes from backend status and updates existing tab state after rename',async()=>{
      await call('browser:profiles',{action:'rename',profileId:work.id,name:'Renamed Work'});
      const view=(await call('browser:status')).views.find(v=>v.id==='work-peer');assert.equal(view.profileName,'Renamed Work');
      assert.ok(events.some(e=>e.id==='work-peer'&&e.type==='state'&&e.profileName==='Renamed Work'));
    });
  } catch(e){failures++;console.error(e);}
  finally{await browser?.close();win?.destroy();server?.close();fs.rmSync(root,{recursive:true,force:true});app.exit(failures?1:0);}
});
