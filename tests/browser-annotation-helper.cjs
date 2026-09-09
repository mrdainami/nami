// Real Chromium selection interaction, with an isolated disposable profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-annotation-helper-'));
app.setPath('userData', profile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await pause(40); } throw new Error('Annotation condition timed out'); }
app.whenReady().then(async () => {
  const selections = [], layouts = [], captures = [], textSelections = [];
  let win, server;
  try {
    ipcMain.on('browser:selection', (_event, value) => selections.push(value));
    ipcMain.on('browser:text-selection', (_event, value) => textSelections.push(value));
    ipcMain.on('browser:annotation-layout', (_event, value) => layouts.push(value));
    ipcMain.on('browser:annotation-capture-ready', (_event, value) => captures.push(value));
    server = http.createServer((_req, res) => { res.end('<!doctype html><style>body{font:20px sans-serif;padding:30px}button{display:block;margin:30px 0}#text{width:400px}</style><div id="text">Select these words for feedback.</div><button id="button" onclick="this.textContent=\'Clicked\'">Original button</button><div style="height:1500px"></div>'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    win = new BrowserWindow({ width: 700, height: 600, webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, '../src/main/browser-preload.js') } });
    const wc = win.webContents;
    await wc.loadURL('http://127.0.0.1:' + server.address().port); await pause(200);
    const evalPage = (js) => wc.executeJavaScript(js);
    const rect = await evalPage('JSON.stringify(document.querySelector("button").getBoundingClientRect())').then(JSON.parse);
    wc.send('browser:annotate-mode', { active: true }); await pause(50);
    assert.notEqual(await evalPage('getComputedStyle(document.querySelector("button")).cursor'), 'auto');
    for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: Math.round(rect.x + 10), y: Math.round(rect.y + 10), button: 'left', clickCount: 1 });
    await until(() => selections.length === 1);
    assert.equal(selections[0].locator, '#button'); assert.equal(await evalPage('document.querySelector("button").textContent'), 'Original button');
    assert.equal(await evalPage('typeof window.dainami'), 'undefined');
    wc.send('browser:annotate-mode', { active: true }); await pause(50);
    const annotatingCursor = await evalPage('getComputedStyle(document.body).cursor');
    assert.notEqual(annotatingCursor, 'auto');
    const text = await evalPage('JSON.stringify(document.querySelector("#text").getBoundingClientRect())').then(JSON.parse);
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(text.x + 1), y: Math.round(text.y + 10), button: 'left', clickCount: 1 });
    for (let x = text.x + 10; x < text.x + 190; x += 10) wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(text.y + 10), button: 'left' });
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(text.x + 190), y: Math.round(text.y + 10), button: 'left', clickCount: 1 });
    await until(() => selections.length === 2);
    assert.equal(selections[1].kind, 'text'); assert.match(selections[1].text, /Select/); assert.ok(selections[1].rect.width > 0);
    wc.send('browser:annotate-mode', { active: true }); await pause(50);
    wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 200, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseMove', x: 180, y: 260, button: 'left' });
    wc.sendInputEvent({ type: 'mouseUp', x: 180, y: 260, button: 'left', clickCount: 1 });
    await until(() => selections.length === 3);
    assert.equal(selections[2].kind, 'region'); assert.equal(selections[2].rect.width, 140);
    wc.send('browser:annotation-capture', { requestId:'capture-1', documentId:selections[2].documentId, selectionId:selections[2].selectionId });
    await until(() => captures.length === 1);
    assert.equal(captures[0].selection.stale, false, 'helper style changes cannot stale the region');
    assert.equal(captures[0].selection.rect.width, 140);
    assert.equal(await evalPage('getComputedStyle(document.querySelector("#text"),"::selection").backgroundColor'), 'rgba(0, 0, 0, 0)');
    wc.send('browser:annotation-capture-end', { requestId:'capture-1' });
    wc.send('browser:annotate-mode', { active: true }); await pause(50);
    const annotatingCursor = await evalPage('getComputedStyle(document.body).cursor');
    assert.notEqual(annotatingCursor, 'auto');
    wc.sendInputEvent({type:'keyDown',keyCode:'ESCAPE'}); await pause(50);
    assert.notEqual(await evalPage('getComputedStyle(document.body).cursor'), annotatingCursor);
    await evalPage('window.scrollTo(0,50)');
    await until(() => layouts.some((l) => l.selections.some((s) => s.selectionId === selections[0].selectionId && s.rect?.y < rect.y)));
    await evalPage('document.querySelector("button").textContent="Changed externally"');
    await until(() => layouts.some((l) => l.selections.some((s) => s.selectionId === selections[0].selectionId && s.stale)));
    // Ordinary text selection is also a real tracked range, suitable for the
    // bottom selection action and the native context-menu entry point.
    wc.send('browser:annotate-mode', false);
    await evalPage('window.scrollTo(0,0);window.getSelection().removeAllRanges()'); await pause(50);
    const normal = await evalPage('JSON.stringify(document.querySelector("#text").getBoundingClientRect())').then(JSON.parse);
    wc.sendInputEvent({type:'mouseDown',x:Math.round(normal.x+1),y:Math.round(normal.y+10),button:'left',clickCount:1});
    for(let x=normal.x+10;x<normal.x+190;x+=10)wc.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(normal.y+10),button:'left'});
    wc.sendInputEvent({type:'mouseUp',x:Math.round(normal.x+190),y:Math.round(normal.y+10),button:'left',clickCount:1});
    await until(()=>textSelections.length>0);
    const plain=textSelections.at(-1);assert.ok(plain.selectionId);assert.ok(plain.documentId);assert.equal(plain.kind,'text');
    wc.send('browser:annotation-capture',{requestId:'normal-selection',documentId:plain.documentId,selectionId:plain.selectionId});
    await until(()=>captures.some(value=>value.requestId==='normal-selection'));
    const captured=captures.find(value=>value.requestId==='normal-selection');
    assert.equal(captured.selection.stale,false);assert.ok(captured.selection.rect.width>0);
    wc.send('browser:annotation-capture-end',{requestId:'normal-selection'});
    wc.send('browser:selection-request');
    await until(()=>selections.length===4);
    assert.equal(selections.at(-1).kind,'text');assert.ok(selections.at(-1).selectionId);
    assert.equal(await evalPage('document.querySelectorAll(".browser-annotation-bubble,.browser-annotation-pin,textarea").length'), 0);
    console.log('PASS: real Electron component/text/region selection, scroll, stale mutations, no click-through, no private page UI.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); server?.close(); app.quit(); fs.rmSync(profile, { recursive: true, force: true }); }
});
