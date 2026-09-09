// Run with Node: two independent Electron processes share only a disposable
// explicit user-data directory. No personal browser data or live account used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-profile-restart-'));
  try {
    for (const mode of ['write', 'read']) {
      const result = spawnSync(require('electron'), [__filename, mode], {
        env: { ...process.env, NAMI_RESTART_FIXTURE: directory }, encoding: 'utf8', timeout: 30000,
      });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, `Electron ${mode} failed: ${result.signal || result.status}`);
    }
    console.log('PASS: named Nami browser profile and persistent fixture login survive complete Electron exit and a new process.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = require('electron');
  const directory = process.env.NAMI_RESTART_FIXTURE;
  if (!directory || !path.basename(directory).startsWith('nami-profile-restart-')) throw new Error('Use the Node test runner to create the private fixture directory.');
  const mode = process.argv.at(-1);
  app.setPath('userData', directory);
  app.whenReady().then(async () => {
    let win, browser;
    try {
      const handlers = new Map();
      browser = require('../src/main/browser-views').wireBrowserViews({ handle: (name, fn) => handlers.set(name, fn), on: () => {} }, { readSettings: () => ({ browserEnabled: false }), writeSettings: () => ({ ok: true }) });
      win = new BrowserWindow({ show: false });
      await win.loadURL('data:text/html,<title>Profile persistence fixture</title>');
      const invoke = async (name, args = {}) => {
        const result = await handlers.get(name)({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, args);
        if (!result.ok) throw new Error(result.error); return result;
      };
      const fixtureFile = path.join(directory, 'fixture.json');
      let fixture;
      if (mode === 'write') {
        const profile = (await invoke('browser:profiles', { action: 'create', name: 'Fixture Work Profile' })).profile;
        fixture = { profileId: profile.id, writerPid: process.pid };
        fs.writeFileSync(fixtureFile, JSON.stringify(fixture), { mode: 0o600 });
      } else {
        assert.equal(mode, 'read'); fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
        assert.notEqual(process.pid, fixture.writerPid, 'reader must run in a fresh Electron process');
        assert.ok((await invoke('browser:profiles')).profiles.some(profile => profile.id === fixture.profileId && profile.name === 'Fixture Work Profile'));
      }
      await invoke('browser:create', { id: 'fixture-page', profileId: fixture.profileId, url: 'about:blank' });
      const session = browser.views.get('fixture-page').view.webContents.session;
      const url = 'http://127.0.0.1:38999/';
      if (mode === 'write') {
        await session.cookies.set({ url, name: 'nami_fixture_login', value: 'synthetic-signed-in-state', httpOnly: true, expirationDate: Math.floor(Date.now() / 1000) + 3600 });
        await session.cookies.flushStore();
        session.flushStorageData();
        console.log('PASS: first Electron process saved a named profile and an expiring synthetic login cookie.');
      } else {
        const [cookie] = await session.cookies.get({ url, name: 'nami_fixture_login' });
        assert.equal(cookie?.value, 'synthetic-signed-in-state');
        assert.equal(cookie.httpOnly, true); assert.equal(cookie.session, false);
        assert.ok(cookie.expirationDate > Date.now() / 1000);
        await invoke('browser:create', { id: 'personal-page', profileId: 'default', url: 'about:blank' });
        assert.deepEqual(await browser.views.get('personal-page').view.webContents.session.cookies.get({ url, name: 'nami_fixture_login' }), []);
        console.log('PASS: second Electron process recovered the fixture login only in its matching named profile.');
      }
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { await browser?.close(); win?.destroy(); if (process.exitCode) app.exit(process.exitCode); else app.quit(); }
  });
}
