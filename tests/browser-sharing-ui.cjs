// Real Electron, native browser and PTYs: exercise the user-facing sharing flow.
const {app,BrowserWindow,webContents}=require('electron');
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
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nami-sharing-ui-'));
  try{
    const win=await until(()=>BrowserWindow.getAllWindows()[0]);
    const run=js=>win.webContents.executeJavaScript(js);
    const click=sel=>run(`document.querySelector(${JSON.stringify(sel)}).click()`);
    win.webContents.on('console-message',e=>{if(e.level==='error')console.error('Renderer:',e.message);});
    await until(()=>run('!!document.querySelector(".browser-viewport")'),'browser mounted');
    const page=await until(()=>webContents.getAllWebContents().find(w=>w.getURL().startsWith('nami-doc:')));
    await until(()=>!page.isLoading());
    const nativeClick=async(wc,sel)=>{const r=JSON.parse(await wc.executeJavaScript(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`));for(const type of ['mouseDown','mouseUp'])wc.sendInputEvent({type,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1});await pause(90);};
    const overlay=async(sel)=>{for(const wc of webContents.getAllWebContents().filter(w=>w.getURL().endsWith('/browser-overlay.html')))if(await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(sel)})`).catch(()=>false))return wc;};
    const shot=async name=>{if(!process.env.NAMI_REVIEW_DIR)return;await pause(450);win.webContents.invalidate();await pause(100);const views=new Map(win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents).map((view,i)=>[i,{window:win,view}]));fs.mkdirSync(process.env.NAMI_REVIEW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR,name+'.png'),await captureWindow(win,views));};
    const status=await run('dainami.browserStatus()');
    const [owner,peer]=status.sessions,tab=status.views[0];
    assert.ok(owner&&peer&&tab);
    for(const [i,s] of status.sessions.entries()){
      const program="import os,sys,tty\ntty.setraw(0)\nsys.stdout.write('\\x1b[?2004h');sys.stdout.flush()\nf=open(sys.argv[1],'ab',buffering=0)\nwhile True:f.write(os.read(0,65536))";
      const r=await run(`dainami.termCreate(${JSON.stringify({id:s.id,kind:'harness',program:'/usr/bin/python3',args:['-c',program,path.join(dir,String(i))],cwd:dir,cols:80,rows:24})})`);assert.equal(r.ok,true);
    }
    await until(()=>run('window.__terms.every(t=>t.modes.bracketedPasteMode)'));
    assert.equal(await run('document.querySelector(".browser-tile .code").textContent.trim()'),'');
    await run('document.querySelector(".companion-tab").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:500,clientY:90}))');
    await until(()=>run('[...document.querySelectorAll(".ctx-item")].some(e=>e.textContent.includes("Share with"))'));
    await run('[...document.querySelectorAll(".ctx-item")].find(e=>e.textContent.includes("Share with")).click()');
    await until(()=>run('!!document.querySelector(".source-chip")'),'shared chip');
    const c1=await run(`dainami.browserConnection({id:${JSON.stringify(owner.id)}})`);
    assert.ok(c1.url);
    const grant=await run(`dainami.browserGrant(${JSON.stringify({id:owner.id,viewIds:[tab.id],peers:[]})})`);
    assert.equal(grant.url,c1.url,'sharing preserves session endpoint');
    await shot('sharing-glass');
    await click('.source-remove');
    await until(()=>run('!document.querySelector(".source-chip")'),'chip removed');
    assert.ok((await run('dainami.browserStatus()')).views.some(v=>v.id===tab.id),'unshare leaves tab open');
    await click('.browser-tile .t-mic');
    await nativeClick(page,'#preview-action');
    const bubble=await until(()=>overlay('#browser-comment'),'native bubble');
    await until(()=>run('!!document.querySelector(".browser-annotation-image img")'),'crop preview');
    await nativeClick(bubble,'#browser-comment');await bubble.insertText('Fix this selected button');
    await until(()=>run('document.querySelector("#browser-comment").value.includes("Fix this")'));
    await shot('annotation-glass');
    for(const theme of ['paper','operator','graphite','soft','glass','dusk']) {
      win.webContents.send('menu:command','theme:'+theme);await until(()=>run(`(document.body.dataset.theme||'paper')===${JSON.stringify(theme)}`));
      await shot('annotation-'+theme);
    }
    for(const zoom of [1.5,1.75]) { win.webContents.setZoomFactor(zoom);await pause(200);await click('[data-pane="files"]');await shot('annotation-zoom-'+zoom); }
    win.webContents.setZoomFactor(1);await pause(150);

    const activeBubble=await until(()=>overlay('#browser-comment'));await nativeClick(activeBubble,'#browser-comment');activeBubble.sendInputEvent({type:'keyDown',keyCode:'Return'});activeBubble.sendInputEvent({type:'keyUp',keyCode:'Return'});
    await until(()=>fs.existsSync(path.join(dir,'0'))&&fs.statSync(path.join(dir,'0')).size>0,'feedback pasted');
    const pasted=fs.readFileSync(path.join(dir,'0'),'utf8');
    assert.ok(pasted.startsWith('\x1b[200~')&&pasted.endsWith('\x1b[201~'),'bracketed paste without Enter');
    assert.match(pasted,/Fix this selected button/);assert.match(pasted,/Screenshot file reference/);
    assert.equal(await page.executeJavaScript('document.documentElement.innerHTML.includes("Fix this selected button")'),false);
    assert.equal(await run('!!document.querySelector("#selection-add")'),false,'no repeated review dialog');
    await click('.browser-tile .t-mic');
    // Ordinary Chromium text highlighting has tracked capture identity too.
    await page.executeJavaScript(`(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('h1'));const s=getSelection();s.removeAllRanges();s.addRange(range)})()`);
    page.sendInputEvent({type:'mouseUp',x:20,y:20,button:'left',clickCount:1});
    await until(()=>run('!document.querySelector(".browser-selection").hidden'),'ordinary highlight action');
    await click('.browser-selection button');
    await until(()=>run('!!document.querySelector(".browser-annotation-image img")'),'ordinary highlight screenshot');
    await shot('annotation-text-highlight');
    const textBubble=await until(()=>overlay('#browser-comment'));
    await nativeClick(textBubble,'#browser-comment');await textBubble.insertText('Clarify this heading');
    textBubble.sendInputEvent({type:'keyDown',keyCode:'Return'});textBubble.sendInputEvent({type:'keyUp',keyCode:'Return'});
    await until(()=>fs.readFileSync(path.join(dir,'0'),'utf8').includes('Clarify this heading'));
    assert.equal(await run('!!document.querySelector("#browser-comment")'),false);
    await click('.browser-tile .t-mic');
    // History inspection is read-only, and inserting again opens a preview.
    const historyBytes=fs.statSync(path.join(dir,'0')).size;
    await click(`[data-id="${owner.id}"] .browser-note-strip button`);
    await until(()=>run('!!document.querySelector("#history-done")'));
    assert.match(await run('document.querySelector(".modal--insertion-history").textContent'),/Clarify this heading/);
    assert.equal(fs.statSync(path.join(dir,'0')).size,historyBytes);
    await click('[data-insert-again]');await until(()=>run('!!document.querySelector("#selection-add")'));
    assert.equal(fs.statSync(path.join(dir,'0')).size,historyBytes);
    await click('#selection-cancel');
    const ownerSel=`[data-id="${owner.id}"]`;
    await click(ownerSel+' .t-expand');
    await until(()=>run('document.querySelector(".paneview").classList.contains("full-agent")'));
    await run(`document.querySelector(${JSON.stringify(ownerSel+' .tile-head')}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
    assert.equal(await run('document.querySelector(".paneview").classList.contains("full-agent")'),true,'same panel focus preserves expansion');
    await click(ownerSel+' .t-expand');
    for(const theme of ['paper','operator','graphite','soft','glass','dusk']){
      win.webContents.send('menu:command','theme:'+theme);await until(()=>run(`(document.body.dataset.theme||'paper')===${JSON.stringify(theme)}`));await pause(160);await shot('tabs-'+theme);
    }
    win.webContents.setZoomFactor(1.5);await pause(200);await click('[data-pane="files"]');await shot('tabs-zoom-150');win.webContents.setZoomFactor(1.75);await pause(200);await click('[data-pane="files"]');await shot('tabs-zoom-175');win.webContents.setZoomFactor(1);
    await click('.companion-close');
    await until(()=>page.isDestroyed(),'tab closed');
    console.log('PASS: actual tab sharing/unsharing, stable connection, native crop+Enter insertion, private comments, no auto-submit, expansion, tab close and six-theme captures.');
    fs.rmSync(dir,{recursive:true,force:true});app.exit(0);
  }catch(e){console.error(e);fs.rmSync(dir,{recursive:true,force:true});app.exit(1);}
});
