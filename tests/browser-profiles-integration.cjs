// Electron integration uses disposable Nami profiles and fake credentials only.
const { app, BrowserWindow, safeStorage, protocol } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-profile-electron-'));
app.setPath('userData', root);
protocol.registerSchemesAsPrivileged([{ scheme: 'nami-doc', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.whenReady().then(async () => {
  let browser, win, server;
  try {
    const handlers = new Map();
    const ipc = { handle: (name, handler) => handlers.set(name, handler), on: () => {} };
    let settings = { browserEnabled: true };
    browser = require('../src/main/browser-views').wireBrowserViews(ipc, { readSettings: () => settings, writeSettings: (next) => { settings = { ...settings, ...next }; return { ok: true }; } });
    win = new BrowserWindow({ show: false });
    await win.loadURL('data:text/html,<p>Trusted Nami test window</p>');
    const invoke = async (name, args = {}) => {
      const value = await handlers.get(name)({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, args);
      if (!value.ok) throw new Error(value.error); return value;
    };
    let delayResponse = false;
    server = http.createServer((_req, res) => { const respond = () => res.end('<!doctype html><title>Profile fixture</title><form><input name="username"><input type="password"><button>Submit</button></form>'); if (delayResponse) setTimeout(respond, 250); else respond(); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    await invoke('browser:create', { id: 'personal', owner: 's1', url });
    const personal = browser.views.get('personal').view.webContents;
    assert.ok(personal.session.storagePath.includes('nami-browser-default'));
    await personal.session.cookies.set({ url, name: 'account', value: 'personal-fake', httpOnly: true });
    const work = (await invoke('browser:profiles', { action: 'create', name: 'Work' })).profile;
    await invoke('browser:create', { id: 'work', owner: 's1', profileId: work.id, url });
    const workWc = browser.views.get('work').view.webContents;
    assert.equal((await workWc.session.cookies.get({ url })).length, 0);
    await invoke('browser:sync', { sessions: [{ id: 's1', title: 'Fixture agent' }] });
    const grant = await invoke('browser:grant', { id: 's1', viewIds: ['personal'] });
    const oldIdentity = (await invoke('browser:status')).views.find(v => v.id === 'personal').identity;
    let requestId = 0;
    const rpc = async (url, method, params) => (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) })).json();
    await rpc(grant.url, 'initialize', {});
    await rpc(grant.url, 'tools/list', {});
    const pendingTool = rpc(grant.url, 'tools/call', { name: 'browser_evaluate', arguments: { function: 'async () => { globalThis.namiPendingTool = true; await new Promise(resolve => setTimeout(resolve, 350)); return "done"; }' } });
    for (let i = 0; i < 100 && !await personal.executeJavaScript('!!globalThis.namiPendingTool'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await personal.executeJavaScript('!!globalThis.namiPendingTool'), true);
    // A grant waiting for an old tool must finish before the identity change,
    // then be revoked by it. It must never resume against the replacement tab.
    const renewal = invoke('browser:grant', { id: 's1', viewIds: ['personal'] });
    const switching = invoke('browser:profiles', { action: 'switch', id: 'personal', profileId: work.id });
    await assert.rejects(invoke('browser:grant', { id: 's1', viewIds: ['personal'] }), /profiles are being updated/);
    const renewed = await renewal;
    await Promise.all([pendingTool, switching]);
    assert.equal(browser.access.get('s1').views.size, 0);
    assert.match((await rpc(grant.url, 'tools/call', { name: 'browser_snapshot' })).error.message, /No browser tabs/);
    assert.match((await rpc(renewed.url, 'tools/call', { name: 'browser_snapshot' })).error.message, /No browser tabs/);
    assert.equal(renewed.url, grant.url, 'permission edits preserve the endpoint while revoking old identity');
    assert.equal(browser.views.get('personal').profileId, work.id);
    await assert.rejects(invoke('browser:grant', { id: 's1', viewIds: ['personal'], expectedIdentities: { personal: oldIdentity } }), /profile changed/);
    assert.equal((await browser.views.get('personal').view.webContents.session.cookies.get({ url })).length, 0);
    // The destination cannot be removed mid-switch while loadURL is awaiting
    // network IO; its removal runs after the switch and closes the new view.
    const temporary = (await invoke('browser:profiles', { action: 'create', name: 'Temporary' })).profile;
    delayResponse = true;
    const switchTemporary = invoke('browser:profiles', { action: 'switch', id: 'personal', profileId: temporary.id });
    const removeTemporary = invoke('browser:profiles', { action: 'remove', profileId: temporary.id, confirmed: true });
    await Promise.all([switchTemporary, removeTemporary]);
    delayResponse = false;
    assert.equal(browser.views.has('personal'), false);
    assert.equal((await invoke('browser:profiles')).profiles.some(p => p.id === temporary.id), false);
    // Pending-note counts are supplied only by the trusted owning renderer.
    await invoke('browser:layout', { pending: [{ id: 'work', count: 2 }] });
    await assert.rejects(invoke('browser:close', { id: 'work' }), /pending annotations/);
    const pendingGrant = await invoke('browser:grant', { id: 's1', viewIds: ['work'] });
    await rpc(pendingGrant.url, 'tools/list', {});
    await rpc(pendingGrant.url, 'tools/call', { name: 'browser_tabs', arguments: { action: 'list' } });
    const deniedClose = await rpc(pendingGrant.url, 'tools/call', { name: 'browser_tabs', arguments: { action: 'close', index: 0 } });
    assert.match(JSON.stringify(deniedClose), /pending annotations/);
    assert.equal(browser.views.has('work'), true);
    await invoke('browser:layout', { pending: [] });
    console.log('PASS: in-flight grant/profile-switch ordering, stale grant rejection, destination removal serialization and pending annotation close protection.');
    await workWc.session.cookies.set({ url, name: 'account', value: 'work-fake' });
    if (safeStorage.isEncryptionAvailable()) {
      const store = require('../src/main/browser-profiles').createProfileStore({ directory: path.join(root, 'browser-profiles'), safeStorage });
      store.importPasswords(work.id, `url,username,password\n${url},fake-user,fake-integration-secret`);
      const credentials = (await invoke('browser:profiles', { action: 'credentials', profileId: work.id, id: 'work' })).credentials;
      assert.equal(JSON.stringify(credentials).includes('fake-integration-secret'), false);
      const response = await invoke('browser:profiles', { action: 'autofill', id: 'work', credentialId: credentials[0].id });
      assert.equal(response.filled, true);
      assert.deepEqual(await workWc.executeJavaScript('[document.querySelector("input[name=username]").value, document.querySelector("input[type=password]").value]'), ['fake-user', 'fake-integration-secret']);
      assert.equal(fs.readFileSync(path.join(root, 'browser-profiles', work.id + '.vault')).includes('fake-integration-secret'), false);
      await invoke('browser:profiles', { action: 'delete-credential', profileId: work.id, credentialId: credentials[0].id });
      assert.equal((await invoke('browser:profiles', { action: 'credentials', profileId: work.id })).credentials.length, 0);
      console.log('PASS: real Electron safeStorage password protection, exact-origin autofill without submit, metadata-only IPC and deletion.');
    } else throw new Error('safeStorage not available: OS-protected credential milestone not proven.');
    const shared = await invoke('browser:grant', { id: 's1', viewIds: ['work'] });
    await invoke('browser:profiles', { action: 'clear', profileId: work.id, siteData: true, credentials: true, confirmed: true });
    assert.equal(browser.views.size, 0);
    assert.equal(browser.access.get('s1').views.size, 0);
    assert.match((await rpc(shared.url, 'tools/call', { name: 'browser_snapshot' })).error.message, /No browser tabs/);
    await invoke('browser:create', { id: 'cleared', profileId: work.id, url });
    assert.equal((await browser.views.get('cleared').view.webContents.session.cookies.get({ url })).length, 0);
    await invoke('browser:profiles', { action: 'remove', profileId: work.id, confirmed: true });
    assert.equal(browser.views.size, 0);
    assert.equal((await invoke('browser:profiles')).profiles.length, 1);
    console.log('PASS: Electron persistent isolated profiles, profile-switch/clear/remove grant revocation, signed-in page closure, data clearing.');
    const localA = path.join(root, 'a'), localB = path.join(root, 'b'); fs.mkdirSync(localA); fs.mkdirSync(localB);
    fs.writeFileSync(path.join(localA, 'index.html'), '<title>Local A</title><p>A</p>');
    fs.writeFileSync(path.join(localB, 'index.html'), '<title>Local B</title><p>PRIVATE LOCAL B</p>');
    await invoke('browser:create', { id: 'local-a', filePath: path.join(localA, 'index.html') });
    await invoke('browser:create', { id: 'local-b', filePath: path.join(localB, 'index.html') });
    const a = browser.views.get('local-a').view.webContents, b = browser.views.get('local-b').view.webContents;
    assert.notEqual(a.session, b.session);
    assert.equal(a.session.storagePath, null);
    const leaked = await a.executeJavaScript(`fetch(${JSON.stringify(b.getURL())}).then(r => r.text()).catch(() => 'blocked')`);
    assert.doesNotMatch(leaked, /PRIVATE LOCAL B/);
    console.log('PASS: Local HTML partitions cannot read another view’s approved file root.');
    const events = [];
    const originalSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = (channel, event) => { if (channel === 'browser:event') events.push(event); return originalSend(channel, event); };
    await invoke('browser:create', { id: 'web-peer', url });
    const peer = browser.views.get('web-peer').view.webContents;
    await peer.session.cookies.set({ url, name: 'shared-profile', value: 'fake-signed-in' });
    // A local document's external link opens a web tab and preserves the local
    // document partition rather than navigating that partition to a website.
    await a.executeJavaScript(`location.href = ${JSON.stringify(url)}`);
    for (let i = 0; i < 50 && !events.some(e => e.id === 'local-a' && e.type === 'new-tab'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(events.some(e => e.id === 'local-a' && e.type === 'new-tab' && e.profileId === 'default'));
    assert.match(a.getURL(), /^nami-doc:/);
    assert.equal(a.session.storagePath, null);
    const localGrant = await invoke('browser:grant', { id: 's1', viewIds: ['local-a'] });
    const beforeLocalCreate=browser.views.size;
    for(const params of [{name:'browser_tabs',arguments:{action:'new',url}},{name:'browser_navigate',arguments:{url}}]) { const result=await rpc(localGrant.url,'tools/call',params); assert.match(result.error.message,/Local HTML permission/); }
    assert.equal(browser.views.size,beforeLocalCreate,'local-only grant cannot create signed-in web tabs');
    const localIdentity = browser.views.get('local-a').identity;
    await invoke('browser:layout', { pending: [{ id: 'local-a', count: 2 }] });
    await invoke('browser:action', { id: 'local-a', action: 'navigate', url });
    const converted = browser.views.get('local-a');
    assert.equal(a.isDestroyed(), true);
    assert.equal(converted.view.webContents.session, peer.session);
    assert.equal(converted.record.local, false);
    assert.equal(converted.pendingCount, 2);
    assert.notEqual(converted.identity, localIdentity);
    assert.equal(converted.view.webContents.getURL(), url + '/');
    assert.equal((await converted.view.webContents.session.cookies.get({ url, name: 'shared-profile' }))[0].value, 'fake-signed-in');
    assert.equal(browser.access.get('s1').views.size, 0);
    assert.match((await rpc(localGrant.url, 'tools/call', { name: 'browser_snapshot' })).error.message, /No browser tabs/);
    assert.equal(events.some(e => e.id === 'local-a' && e.type === 'closed'), false);
    assert.ok(events.some(e => e.id === 'local-a' && e.type === 'profile-changed'));
    assert.equal(b.session.storagePath, null);
    console.log('PASS: local external links stay isolated; address navigation joins persistent profile, revokes prior identity and preserves pending note panel.');
    // A resume can publish a new context identity while a browser operation is
    // draining. The pending grant must not silently approve the new source.
    await invoke('browser:sync', { sessions: [{ id: 's1' }, { id: 'source' }] });
    const publish = identity => invoke('browser:context', { action: 'update', id: 'source', identity, kind: 'chat', content: 'Context for ' + identity });
    await publish('conversation-A');
    const contextConnection = await invoke('browser:grant', { id: 's1', viewIds: ['web-peer'] });
    await assert.rejects(invoke('browser:grant', { id: 's1', viewIds: ['web-peer'], sourceIds: ['source'] }), /source conversation changed/);
    const running = rpc(contextConnection.url, 'tools/call', { name: 'browser_evaluate', arguments: { function: 'async () => { window.contextDrainStarted = true; await new Promise(resolve => setTimeout(resolve, 350)); return "old result"; }' } });
    for (let n = 0; n < 100 && !await peer.executeJavaScript('!!window.contextDrainStarted'); n++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await peer.executeJavaScript('!!window.contextDrainStarted'), true);
    const sharing = invoke('browser:grant', { id: 's1', viewIds: ['local-a'], sourceIds: ['source'], expectedSourceIdentities: { source: 'conversation-A' } });
    const denied = assert.rejects(sharing, /source conversation changed/);
    await new Promise(resolve => setTimeout(resolve, 20));
    await publish('conversation-B');
    await denied; await running;
    assert.deepEqual([...browser.access.get('s1').views], ['web-peer'], 'failed context approval cannot broaden browser grants');
    assert.deepEqual(browser.contexts.list('s1'), []);
    await invoke('browser:grant', { id: 's1', viewIds: ['web-peer'], sourceIds: ['source'], expectedSourceIdentities: { source: 'conversation-B' } });
    // Existing grants do not require re-approval merely to edit browser tabs.
    await invoke('browser:grant', { id: 's1', viewIds: [], sourceIds: ['source'] });
    assert.equal(browser.contexts.read('s1', 'source').content, 'Context for conversation-B');
    assert.equal((await invoke('browser:connection', { id: 's1' })).url, contextConnection.url);
    console.log('PASS: source identity change during engine drain rejects atomically, new sources require selected identity, existing source grants survive tab edits.');


  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await browser?.close(); win?.destroy(); server?.close(); fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
});
