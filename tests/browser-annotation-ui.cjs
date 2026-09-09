// Trusted renderer annotation behavior, independent of provider/network accounts.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-annotation-ui-'));
app.setPath('userData', path.join(dir, 'profile'));
app.whenReady().then(async () => {
  let win;
  try {
    const renderer = path.join(__dirname, '../src/renderer');
    fs.writeFileSync(path.join(dir, 'test.html'), '<!doctype html><body data-theme="paper"><div id="host" style="position:relative;width:480px;height:400px"></div>');
    win = new BrowserWindow({ width: 700, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(path.join(dir, 'test.html'));
    const run = (script) => win.webContents.executeJavaScript(script);
    await run(`(async()=>{
      for (const name of ['paper.css','browser-annotations.css']) { const link=document.createElement('link');link.rel='stylesheet';link.href=${JSON.stringify(pathToFileURL(renderer + '/').href)}+name;document.head.append(link); }
      const {createBrowserAnnotations}=await import(${JSON.stringify(pathToFileURL(path.join(renderer, 'browser-annotations.mjs')).href)});
      window.calls=[];window.cancelled=0;window.payload=null;window.p={id:'tab',owner:'session',url:'https://example.test',title:'Example'};
      window.a=createBrowserAnnotations({api:{browserAction:async(value)=>{calls.push(value);return {ok:true}}},esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icon:()=>'',selection:(_p,n)=>payload=n,toast:t=>calls.push(t),confirmDiscard:async()=>true,dictation:{start:(callbacks)=>{window.dictationCallbacks=callbacks;callbacks.onState('recording');return {stop(){callbacks.onState('transcribing')},cancel(){cancelled++}}}}});
      a.mount(p,document.querySelector('#host'));
      window.value={selectionId:'d:1',documentId:'d',kind:'component',text:'Button',locator:'#button',rect:{x:30,y:130,width:100,height:30},viewport:{width:480,height:400}};
      a.edit(p,value);
    })()`);
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await click('[data-comment="mic"]');
    assert.match(await run('document.querySelector(".browser-annotation-status").textContent'), /Listening/);
    await click('[data-comment="cancel"]');
    assert.equal(await run('cancelled'), 1);
    await run('dictationCallbacks.onText("Late cancelled text");a.edit(p,{...value,selectionId:"d:2"})');
    assert.equal(await run('document.querySelector("textarea").value'), '');
    await run('document.querySelector("textarea").value="Specific feedback"');
    await click('[data-comment="save"]');
    assert.equal(await run('a.store.list(p).length'), 1);
    assert.equal(await run('document.querySelectorAll(".browser-annotation-pin").length'), 1);
    await click('.browser-annotation-pin');
    assert.equal(await run('document.querySelector("textarea").value'), 'Specific feedback');
    await run('document.querySelector("textarea").value="Revised feedback"');
    await click('[data-comment="save"]');
    await run('a.handleEvent({id:"tab",type:"annotation-layout",layout:{documentId:"other",selections:[]}})');
    assert.equal(await run('document.querySelectorAll(".browser-annotation-pin").length'), 0);
    assert.match(await run('document.querySelector(".browser-annotation-note-list").textContent'), /Snapshot/);
    await click('[data-note="review"]');
    assert.match(await run('payload.text'), /Revised feedback/); assert.match(await run('payload.text'), /Snapshot/);
    assert.equal(await run('a.store.list(p).length'), 1, 'review alone must not consume notes');
    await run('payload.onInserted()'); assert.equal(await run('a.store.list(p).length'), 0);
    assert.equal(await run('calls.some(c=>c.action==="submit")'), false);
    await run(`a.dispose();window.deliveries=[];window.failSecond=true;window.failCapture=false;`);
    await run(`(async()=>{
      const {createBrowserAnnotations}=await import(${JSON.stringify(pathToFileURL(path.join(renderer, 'browser-annotations.mjs')).href)});
      window.a=createBrowserAnnotations({api:{browserAction:async(value)=>{calls.push(value);if(value.action==='capture-annotation')return failCapture ? {ok:false,error:'Page changed; select again.'} : {ok:true,image:{id:'image-1',path:'/private/fixture.png',thumbnail:'data:image/png;base64,iVBORw0KGgo=',mimeType:'image/png'}};return {ok:true}},browserAnnotationImage:async(value)=>calls.push(value)},esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),icon:()=>'',sessions:()=>[{id:'session',title:'Adjacent Claude'},{id:'second',title:'Second Codex'}],insertAnnotation:async(payload,ids)=>{deliveries.push({payload,ids});return failSecond ? {inserted:ids.filter(id=>id!=='second'),failed:[{id:'second',error:'Second session unavailable'}]} : {inserted:ids}},toast:t=>calls.push(t),confirmDiscard:async()=>true});
      a.mount(p,document.querySelector('#host'));a.toggle(p);a.edit(p,value);
    })()`);
    assert.equal(await run('a.isActive("tab")'), true);
    assert.match(await run('document.querySelector("summary").textContent'), /Adjacent Claude/);
    assert.equal(await run('document.querySelector(".browser-annotation-image img").alt'), 'Selected browser area');
    assert.equal(await run('document.querySelector("[data-note=review]")'), null, 'direct path has no mandatory batch review');
    await run(`document.querySelector('input[value="second"]').click();document.querySelector('textarea').value='Keep this exact feedback';document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}));document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));`);
    assert.equal(await run('deliveries.length'), 0, 'newline and IME Enter must never insert');
    await run(`document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
    assert.equal(await run('deliveries.length'), 1);
    assert.deepEqual(await run('deliveries[0].ids'), ['session','second']);
    assert.match(await run('document.querySelector("[role=status]").textContent'), /Second session unavailable/);
    assert.equal(await run('a.pendingCount("tab")'), 1);
    await run('failSecond=false;document.querySelector("[data-comment=save]").click()');
    assert.deepEqual(await run('deliveries[1].ids'), ['second'], 'retry must not duplicate successful insertion');
    assert.equal(await run('a.pendingCount("tab")'), 0);
    assert.equal(await run('document.querySelectorAll(".browser-annotation-pin").length'), 1, 'inserted annotation remains inspectable');
    assert.equal(await run('document.querySelector("textarea")'), null);
    await run('a.toggle(p)');
    assert.equal(await run('a.isActive("tab")'), false);
    assert.equal(await run('document.querySelectorAll(".browser-annotation-pin").length'), 0);
    await run('a.toggle(p);failCapture=true;a.edit(p,{...value,selectionId:"d:bad"})');
    assert.match(await run('document.querySelector(".browser-annotation-image").textContent'), /Page changed/);
    assert.equal(await run('document.querySelector("[data-comment=save]").disabled'), true);
    await run('failCapture=false;document.querySelector("[data-comment=retry-capture]").click()');
    assert.equal(await run('document.querySelector("[data-comment=save]").disabled'), false);
    await run(`document.querySelector('textarea').value='Preserved on Escape';document.querySelector('textarea').dispatchEvent(new Event('input'));document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    assert.equal(await run('a.isActive("tab")'), false);
    assert.equal(await run('a.pendingCount("tab")'), 1);
    assert.match(await run('a.store.list(p).at(-1).note'), /Preserved on Escape/);
    await run('a.dispose()');
    console.log('PASS: trusted annotation lifecycle, direct Enter/IME insertion, screenshot preview/retry, recipient partial failure without duplication, toggle/Escape, microphone cancellation.');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { win?.destroy(); app.quit(); fs.rmSync(dir, { recursive: true, force: true }); }
});
