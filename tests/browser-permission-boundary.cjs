// Exercise the handlers actually installed on Electron sessions. Calling their
// captured callbacks verifies routing without touching a real camera/location.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-permission-boundary-'));
app.setPath('userData', root);
app.whenReady().then(async () => {
  let browser, server;
  try {
    server = http.createServer((_req, res) => res.end('<title>Permission fixture</title>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    fs.mkdirSync(path.join(root, 'browser-profiles'));
    fs.writeFileSync(path.join(root, 'browser-profiles/profiles.json'), JSON.stringify([
      { id: 'default', name: 'Personal', permissions: { [origin]: { media: 'allow', geolocation: 'allow' } } },
      { id: 'work', name: 'Work', permissions: { [origin]: { media: 'allow', geolocation: 'block' } } },
    ]));
    const installed = new Map();
    for (const id of ['default', 'work']) {
      const ses = session.fromPartition('persist:nami-browser-' + id), record = {};
      for (const [method, key] of [['setPermissionRequestHandler', 'request'], ['setPermissionCheckHandler', 'check']]) {
        const original = ses[method].bind(ses);
        ses[method] = handler => { record[key] = handler; return original(handler); };
      }
      installed.set(id, record);
    }
    const handlers = new Map();
    browser = require('../src/main/browser-views').wireBrowserViews({ handle: (name, fn) => handlers.set(name, fn), on() {} }, { readSettings: () => ({ browserEnabled: true }), writeSettings: () => ({ ok: true }) });
    const win = new BrowserWindow({ show: false }); await win.loadURL('data:text/html,Fixture');
    const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    for (const id of ['default', 'work']) assert.equal((await handlers.get('browser:create')(event, { id, profileId: id, url: origin })).ok, true);
    const work = browser.views.get('work').view.webContents;
    const request = (wc, permission, details) => { const replies = []; installed.get('work').request(wc, permission, value => replies.push(value), details); assert.equal(replies.length, 1); return replies[0]; };
    assert.equal(request(work, 'media', { requestingUrl: origin + '/page', isMainFrame: true }), true);
    assert.equal(request(work, 'media', { requestingUrl: 'https://child.example.test/frame', isMainFrame: false }), false, 'a child must not borrow the parent site grant');
    assert.equal(request(work, 'media', {}), false, 'missing origin is not a grant');
    assert.equal(request(null, 'media', {}), false);
    const popup = new BrowserWindow({ show: false, webPreferences: { session: work.session } }); await popup.loadURL(origin);
    assert.equal(request(popup.webContents, 'geolocation', { requestingUrl: origin }), false, 'Work popup must not borrow Personal permissions');
    assert.equal(installed.get('work').check(null, 'media', origin), true);
    assert.equal(installed.get('work').check(work, 'media', 'https://child.example.test'), false);
    console.log('PASS: installed Electron handlers use requesting-frame origin, deny missing origins and retain popup profile permissions.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await browser?.close(); for (const win of BrowserWindow.getAllWindows()) win.destroy(); server?.close(); try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } finally { app.exit(process.exitCode || 0); } }
});
