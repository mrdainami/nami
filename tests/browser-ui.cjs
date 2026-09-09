// Actual Nami UI + sandboxed native page. No provider account or network needed.
// Optional NAMI_REVIEW_DIR writes review screenshots outside the repository.
const { app, BrowserWindow, webContents, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { captureWindow } = require('../src/main/window-capture');
app.getVersion = () => require('../package.json').version;
process.argv.push('--demo', '--scene=browser:multi', '--theme=glass');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
require('../src/main/main');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  const end = Date.now() + 35000;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(50); }
  throw new Error('UI condition timed out.');
}
app.whenReady().then(async () => {
  let fixture;
  const terminalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-insertion-'));
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0]);
    win.webContents.on('console-message', (event) => { if (event.level === 'error') console.error('Renderer:', event.message); });
    const evaluate = (js) => win.webContents.executeJavaScript(js);
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await until(async () => evaluate('!!document.querySelector(".browser-viewport")'));
    const page = await until(() => webContents.getAllWebContents().find((wc) => wc !== win.webContents && wc.getURL().startsWith('nami-doc:')));
    await until(async () => !page.isLoading());
    const originalId = await evaluate('document.querySelector(".pane-files .browser-tile").dataset.id');
    const nativeView = () => win.contentView.children.find((v) => v.webContents === page);
    await until(() => nativeView()?.getVisible());
    const shot = async (name) => {
      if (!process.env.NAMI_REVIEW_DIR) return;
      console.log('Capture:', name);
      await pause(250); win.webContents.invalidate(); await pause(150);
      fs.mkdirSync(process.env.NAMI_REVIEW_DIR, { recursive: true });
      const views = new Map(win.contentView.children.filter((v) => v.webContents && v.webContents !== win.webContents).map((view, i) => [i, { window: win, view }]));
      fs.writeFileSync(path.join(process.env.NAMI_REVIEW_DIR, name + '.png'), await captureWindow(win, views));
    };
    assert.equal(await page.executeJavaScript('typeof window.dainami'), 'undefined');
    assert.equal(await page.executeJavaScript('typeof require'), 'undefined');
    await page.executeJavaScript('document.querySelector("button").click()');
    assert.equal(await page.executeJavaScript('document.querySelector("button").textContent'), 'It works');
    await click('.browser-address [data-browser-action="reload"]');
    await until(async () => !page.isLoading() && await page.executeJavaScript('document.querySelector("button")?.textContent === "Try this button"'));
    await shot('build-glass');

    await click('.browser-tile .t-mic');
    await page.executeJavaScript('document.querySelector("button").click()');
    await until(async () => evaluate('!!document.querySelector("#browser-comment")'));
    await until(() => !nativeView().getVisible());
    assert.equal(await page.executeJavaScript('document.querySelector("button").textContent'), 'Try this button', 'Annotate must not click through');
    assert.match(await evaluate('document.querySelector(".selection-sheet").textContent'), /#preview-action/);
    await evaluate('document.querySelector("#browser-comment").value = "Make this button easier to find."');
    await shot('build-annotate');
    await click('#browser-note-insert');
    assert.ok(await evaluate('document.querySelector("[data-selection-session]").checked'));
    const recipients = await evaluate('[...document.querySelectorAll("[data-selection-session]")].map(b => b.dataset.selectionSession)');
    assert.equal(recipients.length, 2);
    // Feed the existing terminal renderer through real PTYs. The small raw
    // reader records received bytes, so we can prove no Enter was submitted.
    for (const [i, id] of recipients.entries()) {
      const capture = path.join(terminalDir, String(i));
      const program = "import os,sys,tty\ntty.setraw(0)\nsys.stdout.write('\\x1b[?2004h');sys.stdout.flush()\nf=open(sys.argv[1],'ab',buffering=0)\nwhile True: f.write(os.read(0,65536))";
      const spawned = await evaluate(`dainami.termCreate(${JSON.stringify({ id, kind: 'harness', program: '/usr/bin/python3', args: ['-c', program, capture], cwd: terminalDir, cols: 80, rows: 24 })})`);
      assert.equal(spawned.ok, true);
    }
    await until(async () => evaluate('window.__terms.every(t => t.modes.bracketedPasteMode)'));
    await evaluate('document.querySelectorAll("[data-selection-session]").forEach(b => { if (!b.checked) b.click(); })');
    await shot('build-context');
    await click('#selection-add');
    await until(async () => evaluate('!document.querySelector("#selection-add")'));
    await until(() => recipients.every((_id, i) => fs.existsSync(path.join(terminalDir, String(i))) && fs.statSync(path.join(terminalDir, String(i))).size > 0));
    for (const [_id, i] of recipients.map((id, i) => [id, i])) {
      const data = fs.readFileSync(path.join(terminalDir, String(i)), 'utf8');
      assert.ok(data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~'));
      assert.match(data, /#preview-action/); assert.match(data, /Make this button easier to find/);
    }
    await until(() => nativeView().getVisible());
    await shot('build-terminal-context');

    // '+' uses the real existing pane's tab row and dialog.
    await click('.browser-tile .companion-add');
    await until(() => !nativeView().getVisible());
    assert.equal(await evaluate('document.querySelector(".modal .title").textContent'), 'New browser');
    await click('#browser-new-cancel');
    fixture = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Component gallery</title><h1>Component gallery</h1><button>Save changes</button>'); });
    await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
    await click('.browser-tile .companion-add');
    await evaluate(`document.querySelector('#browser-new-url').value = ${JSON.stringify('http://127.0.0.1:' + fixture.address().port)}`);
    await click('#browser-new-open');
    await until(async () => evaluate('document.querySelectorAll(".pane-files .companion-tab").length === 2'));
    await click('.pane-files [data-view-id="' + originalId + '"]');
    await shot('build-multiple-views');
    win.webContents.send('menu:command', 'settings:browser');
    await until(async () => evaluate('!!document.querySelector("#browser-enabled")'));
    assert.ok(await evaluate('[...document.querySelectorAll(".set-nav button")].some(b => /Shortcuts/.test(b.textContent))'));
    await click('#browser-enabled');
    await until(async () => evaluate('document.querySelector("#browser-enabled").checked'));
    await shot('build-browser-settings');
    await click('[data-browser-session]');
    await until(async () => evaluate('!!document.querySelector("[data-grant-view]")'));
    await evaluate('document.querySelectorAll("[data-grant-view]").forEach(b => b.click())'); await click('#browser-control');
    await shot('build-access');
    await click('#browser-access-save');
    await until(async () => evaluate('!!document.querySelector("#browser-mcp-url")'));
    assert.match(await evaluate('document.querySelector("#browser-mcp-url").value'), /^http:\/\/127\.0\.0\.1:\d+\/mcp\//);
    await click('#browser-connection-done');
    win.webContents.send('menu:command', 'settings:usage');
    await until(async () => evaluate('!!document.querySelector("#usage-refresh")')).catch(async (error) => { console.log('Usage UI:', await evaluate('document.querySelector("#set-pane")?.textContent')); throw error; });
    await shot('build-usage');
    win.webContents.send('menu:command', 'settings:shortcuts');
    await until(async () => evaluate('!!document.querySelector(".modal--shortcuts")'));
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    await until(() => nativeView().getVisible());
    for (const theme of ['paper', 'operator', 'graphite', 'soft', 'dusk']) {
      win.webContents.send('menu:command', 'theme:' + theme); await pause(180);
      await until(() => nativeView().getVisible());
      assert.equal(await page.executeJavaScript('document.querySelector("h1").textContent'), 'A page besideyour session.');
      await shot('build-' + theme);
    }
    win.webContents.send('menu:command', 'theme:glass');
    win.webContents.setZoomFactor(1.5); await pause(250);
    await shot('build-zoom');
    win.webContents.setZoomFactor(1); win.setSize(700, 700); await pause(250);
    await shot('build-compact');
    await click('[data-id="' + originalId + '"] .t-close');
    await until(() => page.isDestroyed());
    console.log('PASS: local HTML/reload, page isolation, DOM annotation, two real PTY insertions without Enter, multiple tabs, grants, settings, six themes, zoom, compact layout, and native close.');
    fixture.close(); fs.rmSync(terminalDir, { recursive: true, force: true });
    app.exit(0);
  } catch (error) { console.error(error); fixture?.close(); fs.rmSync(terminalDir, { recursive: true, force: true }); app.exit(1); }
});
