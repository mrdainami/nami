// Real Settings shell and themes, with disposable quota data. Never query a
// provider account or import personal browser data during design verification.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.getVersion = () => require('../package.json').version;
process.argv.push('--demo', '--scene=browser:multi', '--theme=glass');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
require('../src/main/main');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await fn()) return; await pause(50); }
  throw new Error('Settings UI condition timed out.');
}
app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length);
    const win = BrowserWindow.getAllWindows()[0];
    const evaluate = (js) => win.webContents.executeJavaScript(js);
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    let reads = 0;
    ipcMain.removeHandler('usage:read');
    ipcMain.handle('usage:read', () => {
      reads++;
      const now = Date.now();
      return { accounts: [
        ...[['5 hours', 73, 'Shared account allowance'], ['7 days', 52, 'Shared account allowance'], ['5 hours', 100, 'Spark']].map(([windowLabel, remaining, scopeLabel], i) => ({ id: 'codex:' + i, accountId: 'codex:configured', providerName: 'Codex', accountName: 'Configured CLI account', windowLabel, remaining, scopeLabel, source: 'Codex', checkedAt: now, resetsAt: now + 3600000, status: 'reported' })),
        { id: 'claude:stale', accountId: 'claude:status-line', providerName: 'Claude', accountName: 'Status-line account', windowLabel: '5 hours', remaining: null, status: 'stale', detail: 'Use Claude to refresh its status line.' },
        ...['OpenCode', 'Grok', 'Antigravity', 'Hermes'].map((name) => ({ id: name, name, status: 'unavailable', remaining: null, detail: 'No connected quota adapter.' })),
      ], claudeCommand: 'nami-review-fixture', feedDirectory: '/review/usage' };
    });
    await until(() => evaluate('!!document.querySelector(".browser-viewport")'));
    const section = async (name) => {
      win.webContents.send('menu:command', 'settings:' + name);
      await until(() => evaluate(`!!document.querySelector(${JSON.stringify(name === 'browser' ? '.browser-settings #browser-enabled' : '.usage-settings #usage-refresh')})`));
      await pause(220);
    };
    const screenshot = async (name) => {
      if (!process.env.NAMI_REVIEW_DIR) return;
      fs.mkdirSync(process.env.NAMI_REVIEW_DIR, { recursive: true });
      win.webContents.invalidate(); await pause(160);
      fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR, name + '.png'), (await win.webContents.capturePage()).toPNG());
    };
    const checkBounds = async () => {
      const findings = await evaluate(`(() => {
        const pane = document.querySelector('#set-pane'), right = pane.getBoundingClientRect().right;
        const findings = [...pane.querySelectorAll('button,input,.usage-value,.bs-row-label')].filter(el => el.getClientRects().length && el.getBoundingClientRect().right > right + 2).map(el => el.textContent || el.id);
        for (const button of document.querySelectorAll('.set-nav .rail-tab')) {
          const label = button.querySelector('span'), bounds = button.getBoundingClientRect();
          if (label && label.getBoundingClientRect().right > bounds.right - 2) findings.push('Clipped navigation label: ' + label.textContent);
        }
        return findings;
      })()`);
      assert.deepEqual(findings, [], 'Settings controls must fit inside the content pane.');
    };
    await section('browser');
    const initial = await evaluate('document.querySelector("#browser-enabled").checked');
    await click('#browser-enabled');
    await until(() => evaluate(`!document.querySelector('#browser-enabled').disabled && document.querySelector('#browser-enabled').checked === ${!initial}`));
    await click('[data-browser-session]');
    await until(() => evaluate('!!document.querySelector("#browser-access-session")'));
    await section('usage');
    assert.equal(await evaluate('document.querySelectorAll(".usage-group").length'), 2);
    assert.equal(await evaluate('document.querySelectorAll(".usage-bar").length'), 3);
    assert.equal(await evaluate('document.querySelector(".usage-unavailable").open'), false);
    await click('.usage-unavailable summary');
    await click('#usage-open-setup');
    assert.equal(await evaluate('document.querySelector("#usage-setup").open'), true);
    await screenshot('usage-expanded-setup');
    const before = reads; await click('#usage-refresh');
    await until(() => reads > before);
    await until(() => evaluate('document.querySelector("#usage-refresh")?.textContent === "Refresh"'));
    for (const theme of ['paper', 'operator', 'graphite', 'soft', 'glass', 'dusk']) {
      win.webContents.send('menu:command', 'theme:' + theme); await pause(120);
      for (const name of ['browser', 'usage']) { await section(name); await checkBounds(); await screenshot(name + '-' + theme); }
      await click('.ov-x'); await pause(120);
      if (process.env.NAMI_REVIEW_DIR) {
        const bounds = await evaluate(`(() => { const r = document.querySelector('.footer').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.floor(r.width), height: Math.floor(r.height) }; })()`);
        fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR, 'shortcuts-footer-' + theme + '.png'), (await win.webContents.capturePage(bounds)).toPNG());
      }
    }
    for (const zoom of [1.5, 1.75]) {
      win.webContents.setZoomFactor(zoom); win.setSize(1000, 800);
      for (const name of ['browser', 'usage']) {
        await section(name); await checkBounds(); await screenshot(name + '-zoom-' + zoom);
        await evaluate('document.querySelector(".modal-body").scrollTop = document.querySelector(".modal-body").scrollHeight');
        await pause(150); await screenshot(name + '-zoom-' + zoom + '-scrolled');
      }
    }
    win.webContents.setZoomFactor(1); win.setSize(700, 650);
    for (const name of ['browser', 'usage']) { await section(name); await checkBounds(); await screenshot(name + '-compact'); }
    console.log('PASS: Browser access toggle/configure, grouped quota windows/stale/unavailable/setup/refresh, six themes, compact and zoom1.5/1.75 Settings bounds.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
