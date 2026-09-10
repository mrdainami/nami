// Exercise the real Nami renderer and import handler with synthetic source data.
// No installed browser profiles, Keychain secrets or live websites are used.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-import-destination-'));
const source = { browser: 'Chrome', name: 'Work fixture', directory: fixture, cookies: path.join(fixture, 'Cookies'), history: path.join(fixture, 'History'), logins: '' };
const cookies = new DatabaseSync(source.cookies);
cookies.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)');
cookies.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('import.example.test', 'fixture_account', 'synthetic-work', Buffer.alloc(0), '/', 0, 1, 1, 1);
cookies.close();
const history = new DatabaseSync(source.history);
history.exec('CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)');
history.prepare('INSERT INTO urls VALUES (?, ?, ?)').run('https://import.example.test/', 'Synthetic work history', 13400000000000000n);
history.close();
const profileModule = require('../src/main/browser-profiles');
let keychainCalls = 0;
profileModule.detectChromiumProfiles = () => [source];
profileModule.cookieImportStatus = () => ({ available: true, browsers: [{ browser: source.browser, name: source.name, cookies: true, history: true, passwords: false }] });
profileModule.chromeKeychainPassword = () => { keychainCalls++; return null; };
app.getVersion = () => require('../package.json').version;
process.argv.push('--demo', '--scene=browser', '--theme=paper');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
require('../src/main/main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await pause(40); }
  throw new Error('Timed out: ' + label);
}
app.whenReady().then(async () => {
  let win, server;
  try {
    win = await until(() => BrowserWindow.getAllWindows()[0], 'Nami window');
    const run = expression => win.webContents.executeJavaScript(expression).catch(error => { console.error('Failed fixture expression:', expression); throw error; });
    const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const invoke = args => run(`dainami.browserProfiles(${JSON.stringify(args)})`);
    await until(() => run('!!document.querySelector(".browser-address")'), 'browser pane');
    const tabId = await run('document.querySelector(".browser-tile").dataset.id');
    await until(() => run(`dainami.browserStatus().then(r => r.views.some(v => v.id === ${JSON.stringify(tabId)}))`), 'native browser view');
    server = http.createServer((_req, res) => res.end('<title>Import fixture</title><p>Local import destination fixture</p>'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    const navigation = await run(`dainami.browserAction(${JSON.stringify({id:tabId,action:'navigate',url})})`);
    assert.equal(navigation.ok, true, navigation.error);
    const work = (await invoke({ action: 'create', name: 'Work' })).profile;
    const switched = await invoke({ action: 'switch', id: tabId, profileId: work.id });
    assert.equal(switched.ok, true, switched.error);
    await until(() => run(`dainami.browserStatus().then(r => r.views.find(v => v.id === ${JSON.stringify(tabId)})?.profileId === ${JSON.stringify(work.id)})`), 'Work tab');
    const openImport = async () => {
      await click('[data-browser-action="menu"]');
      await run(`Array.from(document.querySelectorAll('.browser-menu button')).find(b => b.textContent === 'Import from Chrome…').click()`);
      await until(() => run('!!document.querySelector("#import-source")'), 'import sheet');
    };
    const choose = async (selector, value) => run(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const shot = async name => {
      if (!process.env.NAMI_REVIEW_DIR) return;
      await run('Promise.all([...document.querySelectorAll(".modal")].flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {})))');
      await pause(150);
      fs.mkdirSync(process.env.NAMI_REVIEW_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    await openImport();
    assert.equal(await run('document.querySelector("#import-destination")?.value'), work.id, 'Import opened from a Work tab must visibly select Work');
    assert.equal(await run('document.querySelector("#import-go").textContent'), 'Import into Work');
    await shot('import-work-paper');
    await choose('#import-destination', 'default');
    assert.equal(await run('document.querySelector("#import-go").textContent'), 'Import into Personal');
    await choose('#import-destination', work.id);
    await run(`document.querySelector('#import-passwords').checked = false`);
    const personalBefore = (await invoke({ action: 'contents', profileId: 'default' })).contents;
    await click('#import-go');
    await until(() => run('!document.querySelector("#import-go").disabled'), 'import completion');
    assert.match(await run('document.querySelector(".browser-profile-result").textContent'), /Work/);
    const workAfter = (await invoke({ action: 'contents', profileId: work.id })).contents;
    assert.equal(workAfter.cookies, 1, 'fixture cookie belongs to Work');
    assert.equal(workAfter.history, 1, 'fixture history belongs to Work');
    assert.deepEqual((await invoke({ action: 'contents', profileId: 'default' })).contents, personalBefore, 'Personal must remain unchanged');
    await shot('import-work-result');
    console.log('PASS: Work-tab import visibly selects Work; changing destination updates the action; real cookie/history writes affect only Work.');

    // A missing/deleted destination must fail before source access or a dialog.
    const callsBefore = keychainCalls;
    for (const action of ['import-browser', 'import-cookies', 'import-passwords']) {
      for (const profileId of [undefined, '', 'removed-profile']) {
        const result = await invoke({ action, profileId, sourceIndex: 0 });
        assert.equal(result.ok, false, action + ' rejects invalid destination');
        assert.match(result.error, /profile|destination/i);
      }
    }
    assert.equal(keychainCalls, callsBefore, 'invalid destination never reaches Keychain');
    console.log('PASS: every import entry rejects a missing/invalid destination before reading the source.');

    // Removing the selected profile while its sheet is open never falls back.
    const temporary = (await invoke({ action: 'create', name: 'Temporary' })).profile;
    await click('#import-cancel');
    await openImport();
    // Refresh the sheet after the newly created profile appeared.
    await choose('#import-destination', temporary.id);
    assert.equal((await invoke({ action: 'remove', profileId: temporary.id, confirmed: true })).ok, true);
    await click('#import-go');
    await until(() => run('!document.querySelector("#import-go").disabled'), 'deleted destination response');
    assert.match(await run('document.querySelector(".browser-profile-result").textContent'), /no longer available/i);
    assert.deepEqual((await invoke({ action: 'contents', profileId: 'default' })).contents, personalBefore);
    console.log('PASS: destination removed while sheet is open produces an inline error and no fallback writes.');
    await click('#import-cancel');
    // Manage profiles carries the explicit selection, even if it differs from the tab.
    await click('[data-browser-action="menu"]');
    await run(`Array.from(document.querySelectorAll('.browser-menu button')).find(b => b.textContent === 'Manage profiles…').click()`);
    await until(() => run('!!document.querySelector("#profile-choice")'), 'profile manager');
    await choose('#profile-choice', 'default');
    await until(() => run('document.querySelector("#profile-choice")?.value === "default" && !!document.querySelector("#profile-import-cookies")'), 'Personal manager selection');
    await click('#profile-import-cookies');
    await until(() => run('!!document.querySelector("#import-destination")'), 'manager import');
    assert.equal(await run('document.querySelector("#import-destination").value'), 'default', 'explicit manager selection takes precedence over Work tab');
    await click('#import-cancel');
    // Global settings has no chosen profile yet: require an explicit destination.
    win.webContents.send('menu:command', 'settings:browser');
    await until(() => run(`(() => { const el=document.querySelector('[data-browser-settings="cookies"]'); if(typeof el?.onclick !== 'function')return false; el.click(); return true; })()`), 'browser settings import action');
    await until(() => run('!!document.querySelector("#import-destination")'), 'global import');
    assert.equal(await run('document.querySelector("#import-destination").value'), '');
    assert.equal(await run('document.querySelector("#import-go").disabled'), true);
    await choose('#import-destination', work.id);
    assert.equal(await run('document.querySelector("#import-go").disabled'), false);
    await run(`document.querySelectorAll('.browser-check input').forEach(el => { el.checked=false; el.dispatchEvent(new Event('change')); })`);
    assert.equal(await run('document.querySelector("#import-go").disabled'), true, 'empty category selection cannot start an import');
    console.log('PASS: Manage profiles keeps its explicit selection; global import requires a destination and at least one category.');
    await click('#import-cancel');
    await openImport();
    for (const [theme, zoom, width, height] of [['paper', 1, 1200, 850], ['operator', 1, 1200, 850], ['paper', 1.75, 1000, 850], ['operator', 1, 700, 650]]) {
      win.setSize(width, height); win.webContents.setZoomFactor(zoom);
      await run(`document.body.dataset.theme = ${JSON.stringify(theme)}; window.dispatchEvent(new Event('resize'))`);
      await pause(120);
      const overflow = await run(`Array.from(document.querySelectorAll('#import-source,#import-destination,#import-go,#import-cancel')).filter(el => { const r=el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1; }).map(el => el.id)`);
      assert.deepEqual(overflow, [], 'import controls fit at ' + theme + '/' + zoom);
      await shot('import-' + theme + '-' + zoom + '-' + width);
    }
    console.log('PASS: import selectors/action fit paper, operator, 1.75 zoom and compact window.');
    await click('#import-cancel');
    const longName='Work' + 'x'.repeat(76);
    assert.equal((await invoke({action:'rename',profileId:work.id,name:longName})).ok,true);
    await openImport();
    const longOverflow=await run(`(() => { const b=document.querySelector('#import-go'), r=b.getBoundingClientRect(), m=document.querySelector('.modal').getBoundingClientRect(); return r.right>m.right || r.left<m.left || b.scrollWidth>b.clientWidth+1; })()`);
    assert.equal(longOverflow,false,'long profile names must not overflow the import action');
    await shot('import-long-profile');
    console.log('PASS: maximum-length profile names remain readable within the import action.');
  } catch (error) {
    console.error(error); process.exitCode = 1;
    if (win && !win.isDestroyed()) console.error(await win.webContents.executeJavaScript('document.querySelector(".modal")?.textContent'));
  } finally {
    server?.close();
    fs.rmSync(fixture, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
  }
});
