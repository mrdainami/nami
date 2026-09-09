// Real Electron split layout and PTY; provider launch is replaced before use.
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {captureWindow}=require('../src/main/window-capture');
app.getVersion=()=>require('../package.json').version;
process.argv.push('--demo','--scene=browser:multi','--theme=glass');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
require('../src/main/main');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label='state'){const end=Date.now()+20000;while(Date.now()<end){const v=await fn();if(v)return v;await pause(80);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nami-companion-ui-'));
  try{
    const originalCreate=ipcMain._invokeHandlers.get('term:create');
    const launched=[];
    ipcMain.removeHandler('agents:detect');
    ipcMain.handle('agents:detect',()=>[{id:'codex',name:'Fixture Codex',bin:'codex',kind:'run',found:true,sub:'Deterministic local fixture'}]);
    ipcMain.removeHandler('agents:status');ipcMain.handle('agents:status',()=>({signedIn:true,label:'Local fixture'}));
    ipcMain.removeHandler('term:create');
    ipcMain.handle('term:create',async(event,args)=>{
      launched.push(args);
      const program="import os,sys,tty\ntty.setraw(0)\nsys.stdout.write('\\x1b[?2004h');sys.stdout.flush()\nf=open(sys.argv[1],'ab',buffering=0)\nwhile True:f.write(os.read(0,65536))";
      return originalCreate(event,{...args,kind:'harness',program:'/usr/bin/python3',args:['-c',program,path.join(dir,args.id)],cwd:dir});
    });
    const win=await until(()=>BrowserWindow.getAllWindows()[0]);
    const run=js=>win.webContents.executeJavaScript(js);
    const click=sel=>run(`document.querySelector(${JSON.stringify(sel)}).click()`);
    const shot=async name=>{if(!process.env.NAMI_REVIEW_DIR)return;await pause(400);win.webContents.invalidate();await pause(100);const views=new Map(win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents).map((view,i)=>[i,{window:win,view}]));fs.mkdirSync(process.env.NAMI_REVIEW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR,name+'.png'),await captureWindow(win,views));};
    await until(()=>run('!!document.querySelector(".browser-viewport")'),'browser mounted');
    const initial=await run('dainami.browserStatus()');
    const owner=initial.sessions[0];assert.ok(owner);
    win.webContents.send('term:data',{id:owner.id,data:'\r\nCOMPANION_SOURCE_FIRST\r\n'});
    await pause(600);
    await click('.browser-tile .companion-add');
    await until(()=>run('[...document.querySelectorAll(".browser-menu button")].some(b=>b.textContent.includes("Agent"))'),'plus menu');
    await run('[...document.querySelectorAll(".browser-menu button")].find(b=>b.textContent.includes("Agent")).click()');
    await until(()=>run('[...document.querySelectorAll(".picker-row")].some(b=>b.querySelector(".name")?.textContent==="Fixture Codex")'),'agent picker');
    await run('[...document.querySelectorAll(".picker-row")].find(b=>b.querySelector(".name")?.textContent==="Fixture Codex").click()');
    const companion=await until(()=>launched.find(p=>p.command==='codex'),'fixture terminal created');
    const target=`[data-id="${companion.id}"]`;
    await until(()=>run(`!!document.querySelector(${JSON.stringify(target+' .source-inspect[data-source-type="session"]')})`),'context chip');
    assert.equal(await run(`document.querySelector('.pane-agent [data-id]')?.dataset.id`),owner.id);
    assert.equal(await run(`document.querySelector('.pane-files [data-id]')?.dataset.id`),companion.id);
    assert.ok(await run(`!!document.querySelector(${JSON.stringify(target+' .companion-add')})`),'companion keeps tab controls');
    await until(()=>fs.existsSync(path.join(dir,companion.id)),'PTY ready');
    await pause(700);
    assert.equal(fs.statSync(path.join(dir,companion.id)).size,0,'companion startup must not paste context or submit input');
    await shot('companion-created');
    const refresh=async()=>{
      await click(target+' .source-inspect[data-source-type="session"]');
      await until(()=>run('[...document.querySelectorAll(".ctx-item")].some(b=>b.textContent.includes("Refresh into input"))'));
      await run('[...document.querySelectorAll(".ctx-item")].find(b=>b.textContent.includes("Refresh into input")).click()');
    };
    await refresh();
    const capture=()=>fs.readFileSync(path.join(dir,companion.id),'utf8');
    await until(()=>capture().includes('COMPANION_SOURCE_FIRST'),'explicit refresh pasted snapshot');
    const first=capture();assert.ok(first.startsWith('\x1b[200~')&&first.endsWith('\x1b[201~'),'bracketed paste without Enter');
    assert.match(first,/terminal snapshot/);assert.match(first,/incomplete history/);
    win.webContents.send('term:data',{id:owner.id,data:'\r\nCOMPANION_SOURCE_SECOND\r\n'});
    await pause(900);assert.equal(capture(),first,'new source output must not automatically paste');
    await refresh();await until(()=>capture().includes('COMPANION_SOURCE_SECOND'),'explicit refresh reads latest source');
    assert.equal(capture().split('\x1b[200~').length-1,2,'only the two explicit refreshes insert');
    await shot('companion-refreshed');
    await click(target+' .source-remove[data-source-type="session"]');
    await until(()=>run(`!document.querySelector(${JSON.stringify(target+' .source-inspect[data-source-type="session"]')})`),'source removed');
    const denied=await run(`dainami.browserContext(${JSON.stringify({action:'read',recipientId:companion.id,sourceId:owner.id})})`);
    assert.equal(denied.ok,false,'removing chip immediately revokes reads');
    assert.ok((await run('dainami.browserStatus()')).sessions.some(s=>s.id===owner.id),'removing share keeps original session');
    // The same picker also offers a plain terminal: it must retain placement.
    await click(target+' .companion-add');
    await until(()=>run('[...document.querySelectorAll(".browser-menu button")].some(b=>b.textContent.includes("Agent"))'));
    await run('[...document.querySelectorAll(".browser-menu button")].find(b=>b.textContent.includes("Agent")).click()');
    await until(()=>run('[...document.querySelectorAll(".picker-row")].some(b=>b.querySelector(".name")?.textContent==="Terminal")'));
    await run('[...document.querySelectorAll(".picker-row")].find(b=>b.querySelector(".name")?.textContent==="Terminal").click()');
    const shell=await until(()=>launched.find(p=>p.kind==='shell'),'plain terminal companion');
    await until(()=>run(`document.querySelector('.pane-files [data-id]')?.dataset.id===${JSON.stringify(shell.id)}`),'plain terminal placed right');
    assert.equal(await run(`document.querySelector('.pane-agent [data-id]')?.dataset.id`),owner.id);
    await until(()=>run(`!!document.querySelector(${JSON.stringify(`[data-id="${shell.id}"] .source-inspect`)})`),'plain terminal context chip');
    await until(()=>fs.existsSync(path.join(dir,shell.id)));await pause(500);
    assert.equal(fs.statSync(path.join(dir,shell.id)).size,0,'plain terminal startup has no context paste');
    console.log('PASS: + Agent creates an independent companion in right split, visible source chip, no startup paste, explicit refresh only, latest labelled terminal snapshot, bracketed paste without Enter, immediate revocation. Provider launch intercepted with local PTY.');
    fs.rmSync(dir,{recursive:true,force:true});app.exit(0);
  }catch(error){console.error(error);fs.rmSync(dir,{recursive:true,force:true});app.exit(1);}
});
