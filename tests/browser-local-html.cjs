// Run with Node. Two normal Nami processes use a disposable profile and local
// fixture pages to verify real address-bar navigation and restart restoration.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

if (!process.versions.electron) {
  (async () => {
    const { spawn } = require('node:child_process'), http = require('node:http');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nami-local-html-')));
    const userData = path.join(root, 'profile');
    fs.mkdirSync(userData);
    fs.mkdirSync(path.join(root, 'Page A'));
    fs.mkdirSync(path.join(root, 'Page B'));
    const a = path.join(root, 'Page A', 'café #1.html'), b = path.join(root, 'Page B', 'second.htm');
    fs.writeFileSync(a, '<title>Local HTML A</title><h1>Local HTML A</h1><img src="image.svg"><a id="anchor">Anchor</a>');
    fs.writeFileSync(path.join(root, 'Page A', 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="coral"/></svg>');
    fs.writeFileSync(b, '<title>Local HTML B</title><h1>Local HTML B</h1>');
    const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Local web fixture</title><h1>Local web fixture</h1>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const web = 'http://127.0.0.1:' + server.address().port + '/';
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'operator', view: 'split' }));
    fs.writeFileSync(path.join(userData, 'state.json'), JSON.stringify({ panelsByFolder: { __no_folder__: [{ kind: 'browser', url: 'about:blank' }] } }));
    fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ a, b, web }));
    try {
      for (const phase of ['write', 'read']) await new Promise((resolve, reject) => {
        const env = { ...process.env, NAMI_LOCAL_HTML_FIXTURE: root };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename, phase], { env, stdio: 'inherit' });
        const timer = setTimeout(() => { child.kill(); reject(Error('Local HTML fixture timed out: ' + phase)); }, 60000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Local HTML phase failed: ' + phase)); });
      });
    } finally { server.close(); fs.rmSync(root, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, webContents, safeStorage } = require('electron');
  const root = process.env.NAMI_LOCAL_HTML_FIXTURE, phase = process.argv.at(-1);
  if (!root || !path.basename(root).startsWith('nami-local-html-')) throw Error('Run this fixture with Node.');
  const userData = path.join(root, 'profile'), fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json')));
  const profiles = require('../src/main/browser-profiles');
  profiles.detectChromiumProfiles = () => [];
  profiles.cookieImportStatus = () => ({ available: false, browsers: [] });
  safeStorage.isEncryptionAvailable = () => { throw Error('No Keychain access belongs in this fixture.'); };
  app.getVersion = () => require('../package.json').version;
  process.argv.push('--review', '--user-data', userData);
  require('../src/main/main');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(fn, label) { const end = Date.now() + 15000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(40); } throw Error('Timed out: ' + label); }
  app.whenReady().then(async () => {
    try {
      const win = await until(() => BrowserWindow.getAllWindows()[0], 'window');
      await until(() => !win.webContents.isLoadingMainFrame(), 'renderer');
      const run = source => win.webContents.executeJavaScript(source);
      await until(() => run('!!document.querySelector(".browser-address") && !!window.dainami'), 'address bar');
      const status = () => run('dainami.browserStatus()');
      const invoke = args => run(`dainami.browserProfiles(${JSON.stringify(args)})`);
      const page = title => until(() => webContents.getAllWebContents().find(w => w.getTitle() === title && !w.isLoading()), title);
      const input = async value => {
        await run(`(()=>{const field=document.querySelector('.browser-address input');field.value=${JSON.stringify(value)};field.closest('form').requestSubmit();})()`);
      };
      await until(async () => (await status()).views.length === 1, 'restored tab');
      const id = (await status()).views[0].id;
      assert.equal(await run('dainami.boot().then(b=>b.demo)'), false);
      if (phase === 'write') {
        const work = (await invoke({ action: 'create', name: 'Work' })).profile;
        assert.equal((await invoke({ action: 'switch', id, profileId: work.id })).ok, true);
        await input(fixture.web);
        const webPage = await page('Local web fixture'), webSession = webPage.session;
        await webSession.cookies.set({ url: fixture.web, name: 'retained_fixture', value: 'work', expirationDate: Date.now() / 1000 + 3600 });
        // Page-controlled navigation cannot acquire local file access.
        await webPage.executeJavaScript(`location.href=${JSON.stringify(pathToFileURL(fixture.a).href)}`);
        await pause(100);
        assert.equal(webPage.getURL(), fixture.web);
        await input(fixture.a);
        const a = await page('Local HTML A'), aSession = a.session;
        assert.equal((await status()).views[0].id, id);
        assert.equal((await status()).views[0].profileId, work.id);
        assert.equal((await status()).views[0].profileLocal, true);
        assert.equal(a.session.storagePath, null);
        assert.notEqual(a.session, webSession);
        assert.equal((await a.session.cookies.get({ url: fixture.web })).length, 0);
        await until(() => a.executeJavaScript('document.querySelector("img").naturalWidth===32'), 'relative image');
        console.log('PASS: pasted HTML path opens in the current tab, loads relative assets and keeps Work website identity isolated.');
        const identity = (await status()).views[0].identity;
        await input(path.join(root, 'missing.html'));
        await until(() => run('/HTML file not found/.test(document.body.innerText)'), 'missing-file error');
        assert.equal((await status()).views[0].identity, identity);
        assert.equal(a.isDestroyed(), false);
        await input('"' + fixture.b + '"');
        const b = await page('Local HTML B');
        assert.equal(a.isDestroyed(), true);
        assert.notEqual(b.session, aSession);
        const previousRoot = require('../src/main/doc-protocol').buildDocUrl(path.dirname(fixture.a), fixture.a);
        assert.equal((await b.session.fetch(previousRoot)).status, 404);
        await input(pathToFileURL(fixture.a).href + '?view=local#anchor');
        const reopened = await page('Local HTML A');
        assert.deepEqual(await reopened.executeJavaScript('[location.search,location.hash]'), ['?view=local', '#anchor']);
        await input(fixture.web);
        const returned = await page('Local web fixture');
        assert.equal(returned.session, webSession);
        assert.equal((await webSession.cookies.get({ url: fixture.web, name: 'retained_fixture' }))[0].value, 'work');
        assert.equal((await status()).views[0].profileLocal, false);
        await input('~/' + path.relative(os.homedir(), fixture.a));
        await page('Local HTML A');
        await until(() => run(`dainami.loadPanels(null).then(rows=>rows.some(p=>p.kind==='browser'&&p.filePath===${JSON.stringify(fixture.a)}&&p.profileId===${JSON.stringify(work.id)}))`), 'persisted local file');
        fs.writeFileSync(path.join(root, 'work-id.txt'), work.id);
        console.log('PASS: invalid paths preserve the page; quoted/file/home paths work; local roots are replaced; returning to a web page preserves the profile cookie.');
      } else {
        const restored = await page('Local HTML A');
        assert.equal((await status()).views[0].profileId, fs.readFileSync(path.join(root, 'work-id.txt'), 'utf8'));
        assert.equal(restored.session.storagePath, null);
        assert.equal((await status()).views[0].url, fixture.a);
        await run('document.querySelector("[data-browser-action=reload]").click()');
        await page('Local HTML A');
        await run('document.querySelector(".companion-add").click()');
        await until(async () => (await status()).views.length === 2, 'second tab');
        assert.ok((await status()).views.every(v => v.profileId === fs.readFileSync(path.join(root, 'work-id.txt'), 'utf8')));
        console.log('PASS: normal Nami restart restores the local HTML tab and selected profile; reload and a new tab work.');
      }
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
}
