import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { browserSettingsContent } from '../src/renderer/browser-settings.mjs';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { uniqueDownloadPath, popupDecision, permissionAllowed } = require('../src/main/browser-profiles.js');

const pane = fs.readFileSync(path.join(root, 'src/renderer/browser-pane.mjs'), 'utf8');
const annotations = fs.readFileSync(path.join(root, 'src/renderer/browser-annotations.mjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/main/browser-preload.js'), 'utf8');
const views = fs.readFileSync(path.join(root, 'src/main/browser-views.js'), 'utf8');
const welcome = fs.readFileSync(path.join(root, 'src/renderer/browser-welcome.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/renderer/browser.css'), 'utf8');

test('newBrowser opens about:blank immediately and never summons the New browser overlay', () => {
  const fn = pane.slice(pane.indexOf('function newBrowser'), pane.indexOf('function renderNew'));
  assert.match(fn, /open\(\s*'about:blank'/);
  assert.match(fn, /focusAddress\s*=\s*true/);
  assert.doesNotMatch(fn, /show\(/);
  assert.doesNotMatch(pane, /show\(\s*\{\s*type:\s*'browser-new'/);
  assert.doesNotMatch(pane, /id="browser-new-url"/);
});

test('address row is back, forward, reload, field, Annotate pill and menu, without a header annotate pin', () => {
  assert.match(pane, /button\('back', 'Back', 'back'\)/);
  assert.match(pane, /button\('forward', 'Forward', 'forward'\)/);
  assert.match(pane, /button\('refresh', 'Reload', 'reload'\)/);
  assert.match(pane, /class="browser-annotate"/);
  assert.match(pane, /button\('more', 'Browser menu', 'menu'\)/);
  assert.match(pane, /\.t-mic.*hidden\s*=\s*true/);
  assert.match(css, /\.browser-annotate\.is-on\s*\{[^}]*var\(--green\)/);
  assert.match(css, /\.browser-annotate[^{]*\{[^}]*font-size:\s*11px/);
});

test('annotation overlay has no Component/Text/Region toolbar or mode icons', () => {
  assert.doesNotMatch(annotations, /browser-annotation-toolbar/);
  assert.doesNotMatch(annotations, /<option value="component">/);
  assert.doesNotMatch(annotations, /data-note="add"/);
  assert.match(preload, /caretRangeFromPoint|caretPositionFromPoint/);
  assert.doesNotMatch(preload, /mode === 'component'/);
});

test('quiet new-tab page is blank, not a product tour', () => {
  assert.doesNotMatch(welcome, /A page beside|Try this button|product tour|Open a website/i);
  assert.match(welcome, /<title>New tab<\/title>/i);
  assert.match(welcome, /#fffdf6/);
  assert.match(welcome, /color-scheme:only light/);
  assert.doesNotMatch(welcome, /light-dark/);
  assert.match(views, /browser-welcome\.html/);
  assert.match(views, /loadFile\(WELCOME\)/);
  assert.match(views, /setBackgroundColor\(dark \? '#1f1f1f' : '#fffdf6'\)/);
  assert.match(views, /insertCSS\('html\{color-scheme:only dark\}/);
  assert.match(pane, /p\.url && p\.url !== 'about:blank'/);
});

test('downloads are asked or auto-saved, never cancelled wholesale', () => {
  assert.doesNotMatch(views, /will-download',\s*\(event\)\s*=>\s*event\.preventDefault\(\)/);
  assert.match(views, /setSavePath/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-dl-'));
  try {
    fs.writeFileSync(path.join(dir, 'report.pdf'), 'x');
    assert.equal(uniqueDownloadPath(dir, 'notes.txt'), path.join(dir, 'notes.txt'));
    assert.equal(uniqueDownloadPath(dir, 'report.pdf'), path.join(dir, 'report (1).pdf'));
    assert.equal(uniqueDownloadPath(dir, '../etc/passwd'), path.join(dir, 'passwd'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('http(s) popups stay new tabs; other popups block unless OAuth-style is allowed', () => {
  assert.deepEqual(popupDecision('https://accounts.example.com/oauth', 'block'), { action: 'deny', newTab: 'https://accounts.example.com/oauth' });
  assert.deepEqual(popupDecision('http://localhost:3000/login', 'oauth'), { action: 'deny', newTab: 'http://localhost:3000/login' });
  assert.deepEqual(popupDecision('about:blank', 'block'), { action: 'deny' });
  assert.deepEqual(popupDecision('about:blank', 'oauth'), { action: 'allow' });
  assert.deepEqual(popupDecision('javascript:alert(1)', 'oauth'), { action: 'deny' });
  assert.deepEqual(popupDecision('file:///etc/passwd', 'oauth'), { action: 'deny' });
});

test('permissions default deny and remember per-origin allow', () => {
  assert.equal(permissionAllowed(undefined, 'media'), false);
  assert.equal(permissionAllowed({ media: 'asked' }, 'media'), false);
  assert.equal(permissionAllowed({ media: 'deny' }, 'media'), false);
  assert.equal(permissionAllowed({ media: 'allow' }, 'media'), true);
  assert.equal(permissionAllowed({ media: 'allow' }, 'notifications'), false);
});

test('Settings → Browser is compact controls for download, popups, camera/mic and cookie import', () => {
  const html = browserSettingsContent({
    enabled: true, sessions: [],
    profiles: [{ id: 'default', name: 'Personal', downloadMode: 'ask', popupMode: 'block', permissions: { 'https://meet.example': { media: 'asked' } } }],
    cookieImport: { decrypt: 'unavailable', message: 'Chrome’s cookie encryption could not be copied. Import a password CSV instead.' },
  }, { onProfiles: true, onImport: true, onClear: true, onImportCookies: true });
  assert.match(html, /id="browser-download-ask"/);
  assert.match(html, /id="browser-download-auto"/);
  assert.match(html, /id="browser-popups-block"/);
  assert.match(html, /id="browser-popups-oauth"/);
  assert.match(html, /meet\.example/);
  assert.match(html, /data-browser-settings="cookies"/);
  assert.match(html, /Import from Chrome/);
  assert.doesNotMatch(html, /browser-agent-details|Agent browser access|Enable local browser/);
  assert.doesNotMatch(html, /This imports saved passwords, not Chrome cookies/);
});

test('plus opens a new browser tab and does not offer a companion Agent', () => {
  assert.match(pane, /title="New browser tab"/);
  assert.match(pane, /onclick=\(\)=>newBrowser\(owner\)/);
  assert.doesNotMatch(pane, /'Agent'/);
  assert.doesNotMatch(pane, /addAgent/);
  assert.match(pane, /type:'browser-import'/);
  assert.match(pane, /Import from your browser/);
});
