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
    await run('a.dispose()');
    console.log('PASS: trusted annotation edit/delete lifecycle, owner batch preview, stale-note review, microphone cancellation/late result discard, explicit insert completion.');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { win?.destroy(); app.quit(); fs.rmSync(dir, { recursive: true, force: true }); }
});
