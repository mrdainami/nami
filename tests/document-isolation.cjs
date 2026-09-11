const { app, BrowserWindow, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nami-document-isolation-')));
const site = path.join(root, 'Allowed folder'), outside = path.join(root, 'Outside folder');
fs.mkdirSync(site); fs.mkdirSync(outside);
const { buildDocUrl } = require('../src/main/doc-protocol');
fs.writeFileSync(path.join(outside, 'private.html'), '<title>Private fixture</title><p id="secret">DISPOSABLE_OUTSIDE_DATA</p>');
fs.writeFileSync(path.join(outside, 'private.js'), 'window.outsideScript=true;');
fs.writeFileSync(path.join(site, 'own.js'), 'window.ownScript=true;');
fs.writeFileSync(path.join(site, 'page.html'), `<title>Document boundary fixture</title><script src="own.js"></script><iframe id="outside" src="${buildDocUrl(outside, path.join(outside, 'private.html'))}"></iframe><script src="${buildDocUrl(outside, path.join(outside, 'private.js'))}"></script>`);
const profiles = require('../src/main/browser-profiles'); profiles.detectChromiumProfiles = () => []; profiles.cookieImportStatus = () => ({ available: false, browsers: [] });
safeStorage.isEncryptionAvailable = () => { throw Error('This fixture must not access Keychain'); };
process.argv.push('--review', '--user-data', path.join(root, 'profile'));
require('../src/main/main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  try {
    let win, frame;
    for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win && !win.webContents.isLoading() && win.webContents.getURL().startsWith('file:')) break; await pause(50); }
    win.webContents.send('open:file', { filePath: path.join(site, 'page.html'), adopt: false });
    for (let i = 0; i < 100; i++) { frame = win.webContents.mainFrame.framesInSubtree.find(f => f.url.endsWith('/page.html')); if (frame && await frame.executeJavaScript('window.ownScript===true')) break; await pause(50); }
    assert.ok(frame); await pause(400);
    assert.equal(await frame.executeJavaScript('window.ownScript'), true, 'own folder scripts still run');
    assert.equal(await frame.executeJavaScript('window.outsideScript===true'), false, 'cannot execute a script from another folder');
    assert.equal(await frame.executeJavaScript(`(()=>{try{return document.querySelector('#outside').contentDocument?.body.innerText.includes('DISPOSABLE_OUTSIDE_DATA')||false;}catch{return false;}})()`), false, 'cannot read another folder by encoding a different root');
    assert.equal(await frame.executeJavaScript(`(()=>{try{return !!parent.dainami;}catch{return false;}})()`), false);
    console.log('PASS: real saved HTML preview runs its own assets and blocks another folder, scripts and app bridge.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const win of BrowserWindow.getAllWindows()) win.destroy(); fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
});
