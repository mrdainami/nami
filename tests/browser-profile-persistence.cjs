// Node runs two normal (non-demo) Nami processes against one disposable profile.
// A local HTTP server verifies cookies, localStorage and IndexedDB; no real accounts.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.versions.electron){
  (async()=>{
    const http=require('node:http'),{spawn}=require('node:child_process');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nami-persistence-fixture-'));
    const server=http.createServer((req,res)=>{
      if(req.url==='/login'){res.writeHead(302,{'Set-Cookie':'fixture_account=work; HttpOnly; SameSite=Lax; Max-Age=3600; Path=/','Location':'/account'});res.end();return;}
      res.setHeader('Content-Type','text/html');
      res.end(`<title>Local profile fixture</title><h1>${(req.headers.cookie||'').includes('fixture_account=work')?'WORK_SIGNED_IN':'SIGNED_OUT'}</h1><a id="login" href="/login">Sign in to local fixture</a><script>
        window.fixtureDB=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('profile-fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        window.fixtureWrite=async()=>{localStorage.setItem('profile-note','work-note');const db=await fixtureDB();await new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put('work-document','document');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();};
        window.fixtureRead=async()=>{const db=await fixtureDB();const value=await new Promise((resolve,reject)=>{const r=db.transaction('data').objectStore('data').get('document');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return {local:localStorage.getItem('profile-note'),document:value||null};};
      </script>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+server.address().port;
    fs.writeFileSync(path.join(directory,'settings.json'),JSON.stringify({theme:'operator',view:'split'}));
    fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({panelsByFolder:{__no_folder__:[{kind:'browser',url:url+'/account',profileId:'default'}]}}));
    try{
      for(const mode of ['write','read'])await new Promise((resolve,reject)=>{
        const child=spawn(require('electron'),[__filename,mode],{env:{...process.env,NAMI_PERSISTENCE_FIXTURE:directory,NAMI_FIXTURE_URL:url},stdio:'inherit'});
        const timer=setTimeout(()=>{child.kill();reject(Error('Normal restart fixture timed out: '+mode));},60000);
        child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(Error(mode+' failed: '+(signal||code)));});
      });
      console.log('PASS: normal Nami restart restores tab profiles, default, profile settings and usable local website data without reimport.');
    }finally{server.close();fs.rmSync(directory,{recursive:true,force:true});}
  })().catch(e=>{console.error(e);process.exitCode=1;});
}else{
  const {app,BrowserWindow,safeStorage}=require('electron');
  const directory=process.env.NAMI_PERSISTENCE_FIXTURE,url=process.env.NAMI_FIXTURE_URL,mode=process.argv.at(-1);
  if(!directory||!path.basename(directory).startsWith('nami-persistence-fixture-'))throw Error('Run this fixture through Node.');
  const profiles=require('../src/main/browser-profiles');profiles.detectChromiumProfiles=()=>[];profiles.cookieImportStatus=()=>({available:false,browsers:[]});
  safeStorage.isEncryptionAvailable=()=>{throw Error('This test must not access Keychain');};
  app.getVersion=()=>require('../package.json').version;
  process.argv.push('--review','--user-data',directory);
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.commandLine.appendSwitch('disable-renderer-backgrounding');
  require('../src/main/main');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(fn,label)=>{const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await pause(40);}throw Error('Timed out: '+label);};
  app.whenReady().then(async()=>{
    try{
      let win;await until(()=>win=BrowserWindow.getAllWindows()[0],'window');
      await until(()=>!win.webContents.isLoadingMainFrame() && win.webContents.getURL().startsWith('file:'),'app document');
      const run=js=>win.webContents.executeJavaScript(js).catch(e=>{throw Error(js+': '+e.message);}),click=s=>run(`document.querySelector(${JSON.stringify(s)}).click()`);
      const invoke=args=>run(`dainami.browserProfiles(${JSON.stringify(args)})`);
      const status=()=>run('dainami.browserStatus()');
      const select=(selector,value)=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await until(async()=>((await status()).views||[]).some(v=>v.url===url+'/account'),'restored native page');
      assert.equal(await run('dainami.boot().then(b=>b.demo)'),false,'test normal startup, never demo seed');
      let account=(await status()).views.find(v=>v.url===url+'/account');
      const web=()=>win.contentView.children.find(v=>v.webContents?.getURL()===url+'/account').webContents;
      const openSettings=async()=>{
        win.webContents.send('menu:command','settings:browser');
        await pause(160);
        await until(()=>run('!!document.querySelector("#browser-settings-profile")'),'profile settings');
      };
      const changed=async()=>{await pause(80);await until(()=>run('!!document.querySelector("#browser-settings-profile") && !document.querySelector("#browser-settings-profile").disabled'),'settings save');};
      const closeSettings=async()=>{await click('.ov-x');await until(()=>run('!document.querySelector("#browser-settings-body")'),'closed settings');};
      if(mode==='write'){
        const work=(await invoke({action:'create',name:'Work'})).profile;
        fs.writeFileSync(path.join(directory,'fixture.json'),JSON.stringify({workId:work.id,pid:process.pid}));
        await invoke({action:'switch',id:account.id,profileId:work.id});
        await until(async()=>(await status()).views.find(v=>v.id===account.id)?.profileId===work.id,'Work switch');
        await web().executeJavaScript('document.querySelector("#login").click()');
        await until(async()=>win.contentView.children.some(v=>v.webContents?.getURL()===url+'/account') && /WORK_SIGNED_IN/.test(await web().executeJavaScript('document.body.innerText')),'local fixture sign in');
        await web().executeJavaScript('fixtureWrite()');
        await openSettings();assert.equal(await run('document.querySelector("#browser-settings-profile").value'),work.id);
        await click('#browser-download-auto');await changed();
        await click('#browser-popups-oauth');await changed();
        assert.equal((await invoke({action:'list'})).profiles.find(p=>p.id===work.id).downloadMode,'auto');
        assert.equal((await invoke({action:'list'})).profiles.find(p=>p.id==='default').downloadMode,'ask');
        const blocked=path.join(directory,'browser-profiles','profiles.json.tmp');fs.mkdirSync(blocked);
        try{await click('#browser-download-ask');await changed();assert.equal(await run('document.querySelector("#browser-download-auto").checked'),true,'failed save restores saved radio');}
        finally{fs.rmdirSync(blocked);}
        await select('#browser-settings-profile','default');await changed();
        win.webContents.send('menu:command','theme:paper');await changed();
        assert.equal(await run('document.querySelector("#browser-settings-profile").value'),'default','settings selection survives modal rerender');
        assert.equal(await run('document.querySelector("#browser-download-ask").checked'),true);
        await click('[data-browser-settings="default"]');await changed();
        assert.equal((await status()).defaultProfileId,'default');
        assert.equal((await status()).views.find(v=>v.id===account.id).profileId,work.id,'changing default does not switch existing tab');
        await select('#browser-settings-profile',work.id);await changed();
        await click('[data-browser-settings="default"]');await changed();
        for(const [action,selector] of [['cookies','#import-destination'],['clear','#profile-choice']]){
          await select('#browser-settings-profile','default');await changed();
          await click('[data-browser-settings="'+action+'"]');
          await until(()=>run(`!!document.querySelector(${JSON.stringify(selector)})`),action+' destination');
          assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).value`),'default',action+' follows selected settings profile, not active Work tab');
          if(action==='clear')assert.equal(await run('!!document.querySelector(".browser-profile-context")'),false,'managing another profile must not switch the active tab');
          await click(action==='clear'?'#profiles-done':'.ov-x');await openSettings();
        }
        await select('#browser-settings-profile',work.id);await changed();
        await until(()=>run('!document.querySelector(".toast")'),'expected failed-save notice clears');
        for(const [theme,zoom,width] of [['paper',1,1200],['operator',1,1200],['paper',1.75,1000],['operator',1.75,1000],['operator',1,700]]){
          win.webContents.send('menu:command','theme:'+theme);win.setSize(width,850);win.webContents.setZoomFactor(zoom);await pause(120);
          const bad=await run(`(()=>{const box=document.querySelector('#set-pane').getBoundingClientRect();return [...document.querySelectorAll('#browser-settings-body select,#browser-settings-body button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>box.right+2||r.left<box.left-2);}).map(e=>e.id||e.textContent);})()`);
          assert.deepEqual(bad,[],theme+'/'+zoom+' settings fit');
          if(process.env.NAMI_REVIEW_DIR){fs.mkdirSync(process.env.NAMI_REVIEW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR,'settings-'+theme+'-'+zoom+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}
        }
        win.webContents.setZoomFactor(1);win.setSize(1200,850);await closeSettings();
        await invoke({action:'switch',id:account.id,profileId:'default'});
        assert.match(await web().executeJavaScript('document.body.innerText'),/SIGNED_OUT/);
        assert.deepEqual(await web().executeJavaScript('fixtureRead()'),{local:null,document:null});
        await invoke({action:'switch',id:account.id,profileId:work.id});
        assert.match(await web().executeJavaScript('document.body.innerText'),/WORK_SIGNED_IN/);
        assert.deepEqual(await web().executeJavaScript('fixtureRead()'),{local:'work-note',document:'work-document'});
        await until(()=>run(`dainami.loadPanels(null).then(rows=>rows.some(p=>p.kind==='browser'&&p.profileId===${JSON.stringify(work.id)}))`),'normal renderer saved Work tab');
        console.log('PASS: normal UI targets selected settings/import/clear profile; failed settings save recovers; Work data survives Personal/Work switches; themes and zoom fit.');
      }else{
        const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json')));assert.notEqual(process.pid,fixture.pid);
        assert.equal(account.profileId,fixture.workId,'restored actual tab belongs to Work');
        assert.equal((await status()).defaultProfileId,fixture.workId);
        assert.match(await web().executeJavaScript('document.body.innerText'),/WORK_SIGNED_IN/);
        assert.deepEqual(await web().executeJavaScript('fixtureRead()'),{local:'work-note',document:'work-document'});
        await openSettings();assert.equal(await run('document.querySelector("#browser-settings-profile").value'),fixture.workId);
        assert.equal(await run('document.querySelector("#browser-download-auto").checked'),true);
        assert.equal(await run('document.querySelector("#browser-popups-oauth").checked'),true);
        await closeSettings();await click('.companion-add');
        await until(async()=>(await status()).views.length===2,'new tab after restart');
        assert.ok((await status()).views.every(v=>v.profileId===fixture.workId));
        console.log('PASS: fresh normal process restores authenticated local page, localStorage, IndexedDB and profile settings; plus opens Work.');
      }
      app.quit();
    }catch(e){console.error(e);app.exit(1);}
  });
}
