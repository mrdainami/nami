// Verify the actual selected native page crop and recipient-scoped image tool.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-capture-'));
app.setPath('userData', directory);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  let win, server, browser;
  try {
    const handlers = new Map(), events = [];
    browser = require('../src/main/browser-views').wireBrowserViews({ handle: (name, fn) => handlers.set(name, fn), on: ipcMain.on.bind(ipcMain) }, { readSettings: () => ({ browserEnabled: true }), writeSettings: () => ({ ok: true }) });
    win = new BrowserWindow({ width: 850, height: 680 });
    await win.loadURL('data:text/html,<title>Nami fixture</title>');
    const send = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel, value) => { if (channel === 'browser:event') events.push(value); send(channel, value); };
    const invoke = async (name, args) => { const output = await handlers.get(name)({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, args); if (!output.ok) throw new Error(output.error); return output; };
    server = http.createServer((_req, res) => res.end('<!doctype html><style>html,body{margin:0;background:rgb(255,0,0);height:2000px}</style><title>Red crop fixture</title>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await invoke('browser:create', { id: 'page', url: 'http://127.0.0.1:' + server.address().port });
    await invoke('browser:layout', { items: [{ id: 'page', x: 0, y: 0, width: 800, height: 600 }] });
    const wc = browser.views.get('page').view.webContents;
    await pause(200);
    for (const zoom of [1, 1.5]) {
      await invoke('browser:action', { id: 'page', action: 'zoom', value: zoom });
      await pause(100);
      await invoke('browser:action', { id: 'page', action: 'annotate', value: { active: true, mode: 'region' } });
      await pause(50);
      win.focus(); wc.focus();
      assert.match(await wc.executeJavaScript('getComputedStyle(document.body).cursor'), /\bcrosshair$/, 'native or themed crosshair cursor');
      const previous = events.filter(e => e.type === 'selection').length;
      // The helper has its own real pointer test; dispatch a deterministic
      // region here to isolate crop/IPC transport from desktop mouse focus.
      await wc.executeJavaScript(`window.dispatchEvent(new PointerEvent('pointerdown',{clientX:100,clientY:100})); window.dispatchEvent(new PointerEvent('pointermove',{clientX:300,clientY:200})); window.dispatchEvent(new PointerEvent('pointerup',{clientX:300,clientY:200}));`);
      for (let n = 0; n < 50 && events.filter(e => e.type === 'selection').length === previous; n++) await pause(20);
      assert.ok(events.filter(e => e.type === 'selection').length > previous, JSON.stringify(events));
      const selection = events.filter(e => e.type === 'selection').at(-1).selection;
      const captured = await invoke('browser:action', { id: 'page', action: 'capture-annotation', value: selection });
      const picture = nativeImage.createFromPath(captured.image.path), size = picture.getSize();
      assert.ok(Math.abs(size.width / size.height - 2) < 0.05, JSON.stringify(size));
      const pixels = picture.toBitmap(), center = ((Math.floor(size.height / 2) * size.width) + Math.floor(size.width / 2)) * 4;
      assert.equal(pixels[center + 2], 255, 'red page pixels, not blue annotation overlay');
      assert.equal(pixels[center + 1], 0);
      await invoke('browser:sync', { sessions: [{ id: 'recipient' }, { id: 'other' }] });
      const connection = await invoke('browser:connection', { id: 'recipient' });
      const rpc = async endpoint => (await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nami_read_annotation_image', arguments: { id: captured.image.id } } }) })).json();
      assert.match((await rpc(connection.url)).error.message, /not shared/);
      await invoke('browser:annotation-image', { action: 'grant', id: captured.image.id, recipientIds: ['recipient'] });
      assert.equal((await rpc(connection.url)).result.content[1].type, 'image');
      const other = await invoke('browser:connection', { id: 'other' });
      assert.match((await rpc(other.url)).error.message, /not shared/);
      const bytes = await invoke('browser:annotation-image', { action: 'read', id: captured.image.id });
      assert.equal(bytes.mimeType, 'image/png');
      await wc.loadURL('about:blank');
      await assert.rejects(invoke('browser:action', { id: 'page', action: 'capture-annotation', value: selection }), /no longer/);
      await wc.loadURL('http://127.0.0.1:' + server.address().port); await pause(100);
    }
    console.log('PASS: real native region crops at 100%/150% zoom, no selection adornments, navigation rejection, scoped MCP image delivery and trusted image-byte read.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await browser?.close(); win?.destroy(); server?.close(); app.exit(process.exitCode || 0); }
});
