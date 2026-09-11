// Exercise real renderer tab controls in disposable apps, with and without an
// agent beside the browser. No real accounts, Chrome data, or agent processes.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const {spawnSync}=require('node:child_process');
  for(const mode of ['desk','agent']){
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nami-tab-close-fixture-'));
    try{
      fs.writeFileSync(path.join(directory,'settings.json'),JSON.stringify({theme:'operator',view:'split'}));
      if(mode==='desk')fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({panelsByFolder:{__no_folder__:[{kind:'browser',url:'about:blank'}]}}));
      const child=spawnSync(require('electron'),[__filename,mode],{env:{...process.env,NAMI_TAB_CLOSE_FIXTURE:directory},stdio:'inherit',timeout:45000});
      assert.equal(child.status,0,mode+': '+(child.error?.message||child.signal||'fixture failed'));
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  }
}else{
  const {app,BrowserWindow,safeStorage}=require('electron');
  const directory=process.env.NAMI_TAB_CLOSE_FIXTURE,mode=process.argv.at(-1);
  if(!directory||!path.basename(directory).startsWith('nami-tab-close-fixture-'))throw Error('Run this fixture through Node.');
  const profiles=require('../src/main/browser-profiles');profiles.detectChromiumProfiles=()=>[];profiles.cookieImportStatus=()=>({available:false,browsers:[]});
  safeStorage.isEncryptionAvailable=()=>{throw Error('This test must not access Keychain');};
  app.getVersion=()=>require('../package.json').version;
  process.argv.push('--review','--user-data',directory);
  if(mode==='agent')process.argv.push('--demo','--scene=browser');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  require('../src/main/main');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(fn,label)=>{const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await pause(50);}throw Error('Timed out: '+label);};
  app.whenReady().then(async()=>{
    try{
      let win;await until(()=>win=BrowserWindow.getAllWindows()[0],'window');
      await until(()=>!win.webContents.isLoadingMainFrame()&&win.webContents.getURL().startsWith('file:'),'app document');
      const run=js=>win.webContents.executeJavaScript(js),click=s=>run(`document.querySelector(${JSON.stringify(s)}).click()`);
      const fileId=()=>run('document.querySelector(".pane-files .tile")?.dataset.id||null');
      const agentId=()=>run('document.querySelector(".pane-agent .tile")?.dataset.id||null');
      const tabs=()=>run('[...document.querySelectorAll(".pane-files .companion-tab")].map(b=>b.dataset.viewId)');
      const close=id=>click('.pane-files [data-close-id="'+id+'"]');
      const focus=id=>click('.pane-files [data-view-id="'+id+'"]');
      await until(()=>fileId(),'initial browser');
      const agent=await agentId();assert.equal(!!agent,mode==='agent');
      for(let count=(await tabs()).length;count<5;count++){
        await click('.pane-files .companion-add');
        await until(async()=>(await tabs()).length===count+1,'added tab');
      }
      const order=await tabs();assert.equal(order.length,5);
      const expectShown=async(id)=>{
        await until(async()=>(await fileId())===id,'replacement tab '+id);
        assert.equal(await agentId(),agent,'other pane unchanged');
        assert.equal(await run('document.querySelector(".pane-files .companion-tab[aria-pressed=true]")?.dataset.viewId||null'),id);
        if(id)assert.equal(await run('document.querySelector(".paneview").classList.contains("full-files")'),true,'expanded pane stays expanded');
      };
      await focus(order[2]);await click('.pane-files .t-expand');
      await close(order[2]);await expectShown(order[3]);
      console.log('PASS '+mode+': closing middle tab shows next neighbor and keeps expanded pane.');
      // This is the app menu command used by Cmd+W, exercising activeId too.
      win.webContents.send('menu:command','close-pane');
      await expectShown(order[4]);assert.deepEqual(await tabs(),[order[0],order[1],order[4]]);
      console.log('PASS '+mode+': the next keyboard close acts on the visible replacement.');
      await click('.pane-files .t-close');await expectShown(order[1]);
      console.log('PASS '+mode+': header close on final-position tab selects its previous neighbor.');
      await close(order[0]);await expectShown(order[1]);assert.deepEqual(await tabs(),[order[1]]);
      console.log('PASS '+mode+': closing a background tab keeps the current page.');
      await close(order[1]);await expectShown(null);
      assert.equal(await run('!!document.querySelector(".pane-files .pane-empty, .lane-empty")'),true);
      assert.equal(await run('!!document.querySelector(".paneview.full-files")'),false);
      await until(async()=>(await run('dainami.browserStatus()')).views.length===0,'closed native browsers disposed');
      console.log('PASS '+mode+': only the last close empties the files pane; the agent stays.');
      app.exit(0);
    }catch(e){console.error(e);app.exit(1);}
  });
}
