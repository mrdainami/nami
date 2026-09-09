// Real Nami + live native page + trusted native annotation surfaces.
const { app, BrowserWindow, webContents, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { captureWindow } = require('../src/main/window-capture');
app.getVersion = () => require('../package.json').version;
process.argv.push('--demo', '--scene=browser:multi', '--theme=glass');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
require('../src/main/main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label = 'UI state') { const end = Date.now()+25000; while(Date.now()<end) { const value=await fn();if(value)return value;await pause(60); } throw new Error('Timed out: '+label); }
app.whenReady().then(async()=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-round-two-pty-'));
  try {
    const win = await until(()=>BrowserWindow.getAllWindows()[0]);
    const run = js=>win.webContents.executeJavaScript(js);
    win.webContents.on('console-message', e=>{if(e.level==='error')console.error('Renderer:',e.message)});
    const click = selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(()=>run('!!document.querySelector(".browser-viewport")'));
    const page = await until(()=>webContents.getAllWebContents().find(w=>w!==win.webContents&&w.getURL().startsWith('nami-doc:')));
    await until(()=>!page.isLoading());
    const nativeView=()=>win.contentView.children.find(v=>v.webContents===page);
    const overlay = async(selector)=>{
      for(const wc of webContents.getAllWebContents().filter(w=>w.getURL().endsWith('/browser-overlay.html'))) {
        if(await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`).catch(()=>false))return wc;
      }
    };
    const nativeClick = async(wc,selector)=>{
      const r=await wc.executeJavaScript(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`).then(JSON.parse);
      for(const type of ['mouseDown','mouseUp'])wc.sendInputEvent({type,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1});
      await pause(80);
    };
    const shot=async(name)=>{
      if(!process.env.NAMI_REVIEW_DIR)return;
      await pause(220);win.webContents.invalidate();await pause(100);
      const views=new Map(win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents).map((view,i)=>[i,{window:win,view}]));
      fs.mkdirSync(process.env.NAMI_REVIEW_DIR,{recursive:true});
      fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR,name+'.png'),await captureWindow(win,views));
    };
    await until(()=>nativeView()?.getVisible());
    await click('.browser-tile .t-mic');
    await until(()=>overlay('[data-note="add"]'));
    await nativeClick(page,'#preview-action');
    const bubble = await until(()=>overlay('#browser-comment'),'native comment bubble');
    assert.equal(nativeView().getVisible(),true,'page stays visible beneath comment bubble');
    assert.equal(await page.executeJavaScript('document.querySelector("button").textContent'),'Try this button');
    await nativeClick(bubble,'#browser-comment');
    for(const letter of 'Native overlay feedback') await bubble.insertText(letter);
    await until(()=>run('document.querySelector("#browser-comment").value === "Native overlay feedback"'),'comment input bridged');
    assert.equal(await page.executeJavaScript('document.documentElement.innerHTML.includes("Native overlay feedback")'),false);
    await shot('round-two-inline-glass');
    await nativeClick(bubble,'[data-comment="save"]');
    const pin=await until(()=>overlay('.browser-annotation-pin'),'saved native pin');
    await nativeClick(pin,'.browser-annotation-pin');
    const edited=await until(()=>overlay('#browser-comment'));
    assert.equal(await edited.executeJavaScript('document.querySelector("textarea").value'),'Native overlay feedback');
    await nativeClick(edited,'[data-comment="save"]');
    const toolbar=await until(()=>overlay('[data-note="review"]'));
    await nativeClick(toolbar,'[data-note="review"]');
    await until(()=>run('!!document.querySelector("#selection-add")'));
    assert.match(await run('document.querySelector(".selection-preview").textContent'),/Native overlay feedback/);
    // Actual terminal PTY still receives one paste and no Enter, through new batch review.
    const recipients=await run('[...document.querySelectorAll("[data-selection-session]")].map(b=>b.dataset.selectionSession)');
    for(const [i,id] of recipients.entries()) {
      const program="import os,sys,tty\ntty.setraw(0)\nsys.stdout.write('\\x1b[?2004h');sys.stdout.flush()\nf=open(sys.argv[1],'ab',buffering=0)\nwhile True: f.write(os.read(0,65536))";
      assert.equal((await run(`dainami.termCreate(${JSON.stringify({id,kind:'harness',program:'/usr/bin/python3',args:['-c',program,path.join(dir,String(i))],cwd:dir,cols:80,rows:24})})`)).ok,true);
    }
    await until(()=>run('window.__terms.every(t=>t.modes.bracketedPasteMode)'));
    await run('document.querySelectorAll("[data-selection-session]").forEach(b=>{if(!b.checked)b.click()})');
    await shot('round-two-review-terminal');await click('#selection-add');
    await until(()=>recipients.every((_id,i)=>fs.existsSync(path.join(dir,String(i)))&&fs.statSync(path.join(dir,String(i))).size>0));
    for(const [_id,i] of recipients.map((id,i)=>[id,i])) { const bytes=fs.readFileSync(path.join(dir,String(i)),'utf8');assert.ok(bytes.startsWith('\x1b[200~')&&bytes.endsWith('\x1b[201~'));assert.match(bytes,/Native overlay feedback/); }
    await until(()=>nativeView().getVisible());
    await until(()=>run('document.querySelector("[data-note=review]").textContent.includes("(0)")'));
    const historySizes=recipients.map((_id,i)=>fs.statSync(path.join(dir,String(i))).size);
    await click('[data-id="'+recipients[0]+'"] .browser-note-strip button');
    await until(()=>run('!!document.querySelector("#history-done")'));await shot('round-two-insertion-history');
    assert.match(await run('document.querySelector(".selection-preview").textContent'),/Native overlay feedback/);
    assert.deepEqual(recipients.map((_id,i)=>fs.statSync(path.join(dir,String(i))).size),historySizes,'opening history must never paste');
    await click('[data-insert-again]');await until(()=>run('!!document.querySelector("#selection-add")'));
    assert.deepEqual(recipients.map((_id,i)=>fs.statSync(path.join(dir,String(i))).size),historySizes,'Insert again opens a preview before pasting');
    await click('#selection-cancel');await until(()=>nativeView().getVisible());
    await click('.browser-tile .t-mic');await nativeClick(page,'h1');
    await nativeClick(await until(()=>overlay('#browser-comment')), '[data-comment="save"]');
    await nativeClick(await until(()=>overlay('[data-note="add"]')), '[data-note="add"]');
    await nativeClick(page,'#preview-action');
    await nativeClick(await until(()=>overlay('#browser-comment')), '[data-comment="save"]');
    await until(()=>run('document.querySelectorAll(".browser-annotation-pin").length===2'));
    await shot('round-two-multiple-notes');
    await page.executeJavaScript('document.body.style.minHeight="1400px";window.scrollTo(0,60)');await pause(200);await shot('round-two-scrolled-pins');
    await nativeClick(await until(()=>overlay('.browser-annotation-pin')), '.browser-annotation-pin');
    await until(()=>overlay('#browser-comment'));await shot('round-two-scrolled-edit');
    await nativeClick(await until(()=>overlay('#browser-comment')), '[data-comment="save"]');
    await page.executeJavaScript('window.scrollTo(0,0)');await pause(100);
    await nativeClick(await until(()=>overlay('[data-note="review"]')), '[data-note="review"]');
    await until(()=>run('!!document.querySelector("#selection-add")'));
    await run('document.querySelectorAll("[data-selection-session]").forEach(b=>{if(!b.checked)b.click()})');
    const writeHandler=ipcMain._invokeHandlers.get('term:write');
    ipcMain.removeHandler('term:write');ipcMain.handle('term:write',(event,args)=>args.id===recipients[1]?{ok:false,error:'Transient test write failure'}:writeHandler(event,args));
    await click('#selection-add');
    await until(()=>run('!!document.querySelector("[data-selection-session][disabled]")'),'partial insertion result');
    assert.equal(await run('document.querySelectorAll(".modal--selection").length'),1,'partial retry uses one review sheet');
    const firstAfter=fs.statSync(path.join(dir,'0')).size;
    assert.ok(firstAfter>historySizes[0]);assert.equal(fs.statSync(path.join(dir,'1')).size,historySizes[1]);
    await shot('round-two-partial-insertion');
    ipcMain.removeHandler('term:write');ipcMain.handle('term:write',writeHandler);
    await click('#selection-add');await until(()=>run('!document.querySelector("#selection-add")'));
    await until(()=>fs.statSync(path.join(dir,'1')).size>historySizes[1]);
    assert.equal(fs.statSync(path.join(dir,'0')).size,firstAfter,'retry never duplicates successful recipient');
    await run('document.querySelector(".browser-tile .tile-head").dispatchEvent(new MouseEvent("mousedown",{bubbles:true}))');
    await until(()=>nativeView().getVisible());
    await nativeClick(await until(()=>overlay('[data-note="add"]')), '[data-note="add"]');
    await nativeClick(page,'h1');
    await until(()=>overlay('#browser-comment'));
    for(const theme of ['paper','operator','graphite','soft','glass','dusk']) {
      win.webContents.send('menu:command','theme:'+theme);await pause(200);
      await shot('round-two-annotation-'+theme);
    }
    win.webContents.setZoomFactor(1.5);await pause(200);await shot('round-two-annotation-zoom-150');
    win.webContents.setZoomFactor(1.75);await pause(200);await shot('round-two-annotation-zoom-175');
    win.webContents.setZoomFactor(1);win.setSize(700,700);await pause(200);await shot('round-two-annotation-compact');
    await nativeClick(await until(()=>overlay('#browser-comment')), '[data-comment="cancel"]');
    await click('[data-browser-action="menu"]');const menuView=await until(()=>overlay('.browser-menu'));await shot('round-two-menu-compact');
    menuView.focus();await menuView.executeJavaScript('document.querySelector("[role=menuitem]").focus()');
    menuView.sendInputEvent({type:'keyDown',keyCode:'Down'});menuView.sendInputEvent({type:'keyUp',keyCode:'Down'});
    await until(()=>menuView.executeJavaScript('document.activeElement.textContent==="Zoom in"'),'native menu arrow navigation');
    menuView.sendInputEvent({type:'keyDown',keyCode:'Up'});menuView.sendInputEvent({type:'keyUp',keyCode:'Up'});
    await until(()=>menuView.executeJavaScript('document.activeElement.textContent==="Find in page"'));
    await nativeClick(await until(()=>overlay('.browser-menu')), '.browser-menu button');
    await until(()=>run('!!document.querySelector(".browser-find")'));
    console.log('PASS: native overlay pointer/input/save/pin/edit, live page, private note isolation, batch two-terminal no-submit insertion, read-only history, partial failure/retry, native keyboard menu, six themes/zoom/compact screenshots.');
    fs.rmSync(dir,{recursive:true,force:true});app.exit(0);
  }catch(error){console.error(error);fs.rmSync(dir,{recursive:true,force:true});app.exit(1)}
});
