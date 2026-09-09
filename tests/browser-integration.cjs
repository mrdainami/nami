// Run with Electron: real page/CDP/MCP smoke test, no provider account needed.
const { app, BrowserWindow, WebContentsView } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBrowserMcp } = require('../src/main/browser-mcp');
const { Access } = require('../src/main/browser-policy');
app.whenReady().then(async () => {
  let win, pageServer, gateway;
  try {
    pageServer = http.createServer((_req, res) => res.end('<!doctype html><title>Browser fixture</title><button onclick="this.textContent=\'Clicked\'">Try me</button>'));
    await new Promise((r) => pageServer.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${pageServer.address().port}`;
    win = new BrowserWindow({ show: false });
    await win.loadURL('data:text/html,<title>Nami private renderer</title><p>PRIVATE APP</p>');
    const page = new WebContentsView({ webPreferences: { sandbox: true, nodeIntegration: false } });
    win.contentView.addChildView(page); page.setBounds({ x: 0, y: 0, width: 800, height: 600 }); await page.webContents.loadURL(url);
    const entry = { id: 'v1', owner: 's1', window: win, view: page }, views = new Map([['v1', entry]]);
    const access = new Access(); access.register('s1', win.webContents.id, 'First'); access.register('s2', win.webContents.id, 'Second');
    access.grant('s1', win.webContents.id, ['v1']); access.get('s1').peers = ['s2'];
    const secretPage = new WebContentsView(); win.contentView.addChildView(secretPage);
    await secretPage.webContents.loadURL('data:text/html,<title>Private tab</title>NOT SHARED');
    views.set('private', { id: 'private', window: win, view: secretPage });
    let delivered;
    gateway = await createBrowserMcp({ access, views, create: async (_win, args) => {
      const view = new WebContentsView(); win.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 800, height: 600 }); await view.webContents.loadURL(args.url);
      const e = { id: args.id, owner: args.owner, window: win, view }; views.set(e.id, e); return e;
    }, remove: async (id) => {
      const e = views.get(id); views.delete(id);
      for (const s of access.sessions.values()) s.views.delete(id);
      win.contentView.removeChildView(e.view); e.view.webContents.close();
    }, send: () => {}, notifyMessage: (_id, message) => delivered = message });
    const connection = await gateway.connection('s1'); let id = 0;
    const callAt = async (endpoint, method, params = {}) => {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
      const m = await r.json(); if (m.error) throw new Error(m.error.message); return m.result;
    };
    const call = (method, params) => callAt(connection.url, method, params);
    assert.equal((await call('initialize')).serverInfo.name, 'nami-browser');
    const tools = await call('tools/list'); assert.ok(tools.tools.some((t) => t.name === 'browser_snapshot'));
    assert.ok(!tools.tools.some((t) => t.name === 'browser_run_code'));
    assert.ok(!tools.tools.find((t) => t.name === 'browser_snapshot').inputSchema.properties.filename);
    await assert.rejects(call('tools/call', { name: 'browser_snapshot', arguments: { filename: '/tmp/not-allowed.md' } }));
    const snap = await call('tools/call', { name: 'browser_snapshot' });
    const text = snap.content.map((c) => c.text || '').join('\n');
    assert.match(text, /Try me/);
    const ref = text.match(/button "Try me" \[ref=(\w+)\]/)?.[1]; assert.ok(ref, text);
    const click = await call('tools/call', { name: 'browser_click', arguments: { target: ref } });
    assert.equal(click.isError, undefined, JSON.stringify(click));
    assert.equal(await page.webContents.executeJavaScript('document.querySelector("button").textContent'), 'Clicked');
    assert.equal(win.webContents.debugger.isAttached(), false);
    assert.equal(secretPage.webContents.debugger.isAttached(), false);
    const tabs = await call('tools/call', { name: 'browser_tabs', arguments: { action: 'list' } });
    assert.doesNotMatch(JSON.stringify(tabs), /Private tab|PRIVATE APP|NOT SHARED/);
    access.grant('s2', win.webContents.id, ['v1']);
    const second = await gateway.connection('s2');
    assert.match(JSON.stringify(await callAt(second.url, 'tools/call', { name: 'browser_snapshot' })), /Clicked/);
    assert.match(JSON.stringify(await call('tools/call', { name: 'browser_snapshot' })), /Clicked/);
    const added = await call('tools/call', { name: 'browser_tabs', arguments: { action: 'new' } });
    assert.equal(added.isError, undefined, JSON.stringify(added));
    assert.equal(access.get('s1').views.size, 2);
    assert.equal(access.get('s2').views.size, 1);
    const closed = await call('tools/call', { name: 'browser_tabs', arguments: { action: 'close', index: 1 } });
    assert.equal(closed.isError, undefined, JSON.stringify(closed));
    assert.equal(access.get('s1').views.size, 1);
    await call('tools/call', { name: 'nami_send_message', arguments: { to: 's2', text: 'Please review.' } });
    assert.equal(access.get('s2').inbox[0].text, 'Please review.');
    assert.equal(delivered.sessionId, 's2');
    await assert.rejects(call('tools/call', { name: 'nami_send_message', arguments: { to: 'unknown', text: 'No' } }));
    assert.equal((await fetch(connection.url, { method: 'POST', headers: { origin: 'https://example.com' } })).status, 403);
    await gateway.revoke('s1'); assert.equal((await fetch(connection.url, { method: 'POST' })).status, 404);
    assert.equal(page.webContents.debugger.isAttached(), false);
    console.log('PASS: real Playwright MCP snapshot/click, session handoff, tab creation/close, target isolation, messages, and revocation.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await gateway?.close(); pageServer?.close(); win?.destroy(); app.exit(process.exitCode || 0); }
});
