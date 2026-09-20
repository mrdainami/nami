// The menu bar does not show on Windows (no title bar, so no menu, and Alt does
// not bring one back). The keys still work; what is lost is whatever a person
// could only reach by pointing at the menu. This file is the list: every item
// the Windows menu holds, and where a PC user finds it with the mouse instead.
// A menu item added later fails here until someone decides where it lives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMenuTemplate, buildWindowsExtrasTemplate, editContextTemplate, menuItems, LINKS } = require('../src/main/app-menu.js');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/main/preload.js'), 'utf8');

const sent = [], opened = [];
const recents = [{ path: 'C:\\work\\nami' }];
const template = buildMenuTemplate({ send: (c) => sent.push(c), open: (u) => opened.push(u), newWindow: () => sent.push('(new-window)'), platform: 'win32', recents });
// What a leaf does, as one word: the command it sends, the link it opens, or its role.
function verbOf(item) {
  if (item.role) return 'role:' + item.role;
  sent.length = 0; opened.length = 0;
  item.click();
  if (opened.length) return 'link:' + Object.keys(LINKS).find((k) => LINKS[k] === opened[0]);
  return 'send:' + sent[0].split(':')[0] + (/^(settings|rail):/.test(sent[0]) ? ':' + sent[0].split(':')[1] : '');
}
const leaves = menuItems(template).filter((i) => i.type !== 'separator' && !i.submenu);

// Where each one is in the app. The pattern is looked for in app.js, so a route
// that is removed takes its row down with it.
const IN_APP = {
  'send:new-session': /q\('#btn-new'\)\.onclick = \(\) => openLauncher\(\)/,
  'send:(new-window)': /q\('#open-newwin', pop\)\.onclick/,
  'send:open-folder': /q\('#open-other', pop\)\.onclick = \(\) => \{ pop\.remove\(\); openFolderDialog\(\); \}/,
  'send:open-recent': /row\.onclick = async \(\) => \{ pop\.remove\(\); if \(dead\) openFolderDialog\(\); else await openFolder\(path\); \}/,
  'send:new-file': /label: 'New file…', run: \(\) => openFsName\('file'/,
  'send:new-folder': /label: 'New folder…', run: \(\) => openFsName\('folder'/,
  'send:save': /class="btn btn--go ed-save"/,
  'send:reveal': /class="btn ed-finder"/,
  'send:close-pane': /q\('\.t-close', head\)\.onclick/,
  'send:settings:': /q\('#btn-settings'\)\.onclick = \(\) => openSettings\(\)/,
  'send:settings:voice': /\{ id: 'voice',/,
  'send:settings:shortcuts': /q\('#btn-shortcuts'\)\.onclick = \(\) => openSettings\('shortcuts'\)/,
  'send:dictate': /q\('\.t-mic', head\)\.onclick/,
  'send:rail:sessions': /class="rail-tab active" data-tab="sessions"/,
  'send:rail:workspace': /class="rail-tab" data-tab="workspace"/,
  'send:rail:library': /class="rail-tab" data-tab="library"/,
  'send:rail:toggle': /q\('#rail-collapse'\)\.onclick/,
  'send:theme': /q\('#btn-theme'\)\.onclick/,
  'send:agents': /q\('#btn-agents'\)\.onclick = \(\) => openAgentPicker\(\)/,
  'send:about': /\{ id: 'about', name: 'About'/,
  'send:update-check': /<button class="btn" id="ab-act"/,
  'link:docs': /q\('#shortcuts-guide', modal\)\.onclick = \(\) => api\.openUrl\(DOCS\.home\)/,
  'link:repo': /data-url="\$\{REPO_URL\}">Source on GitHub/,
  'link:issue': /data-url="\$\{REPO_URL\}\/issues">Ask on GitHub/,
  'link:releases': /data-url="\$\{esc\(notes\)\}">What's new/,
  'link:teams': /data-url="\$\{teamsUrl\('about'\)\}"/,
  'link:maker': /data-url="\$\{makerUrl\('about'\)\}"/,
};
// Roles the window itself answers: the caption buttons Windows draws on the
// sheet, and quitting when the last window closes.
const BY_WINDOW = { 'role:minimize': /titleBarOverlay/, 'role:quit': /app\.on\('window-all-closed', \(\) => \{ if \(process\.platform !== 'darwin'\) app\.quit\(\); \}\)/ };
// Every field in Nami is plain text, so there is no style for a paste to match.
const SAME_AS = { 'role:pasteAndMatchStyle': 'role:paste' };

const extras = menuItems(buildWindowsExtrasTemplate({ open: (u) => opened.push(u) })).filter((i) => i.type !== 'separator' && !i.submenu);
const extraVerbs = new Set(extras.map(verbOf));
const editable = editContextTemplate({ isEditable: true, editFlags: {} }, 'win32');
const contextVerbs = new Set(editable.filter((i) => i.role).map((i) => 'role:' + i.role));

test('every item in the Windows menu has somewhere to be clicked', () => {
  const homeless = [];
  for (const item of leaves) {
    let verb = verbOf(item);
    if (verb === 'send:settings') verb = 'send:settings:';
    verb = SAME_AS[verb] || verb;
    if (IN_APP[verb]) { assert.match(app, IN_APP[verb], verb + ' is listed as being in the app, and is not'); continue; }
    if (BY_WINDOW[verb]) { assert.match(main, BY_WINDOW[verb], verb); continue; }
    if (extraVerbs.has(verb) || contextVerbs.has(verb)) continue;
    homeless.push((item.label || item.role) + ' → ' + verb);
  }
  assert.deepEqual(homeless, [], 'a menu item with no mouse route on Windows: give it one in the app, or add it to buildWindowsExtrasTemplate');
});

test('the extras are only what has nowhere else to live', () => {
  assert.deepEqual([...extraVerbs], ['role:zoomIn', 'role:zoomOut', 'role:resetZoom', 'role:togglefullscreen', 'link:terms', 'role:reload', 'role:forceReload', 'role:toggleDevTools']);
  for (const verb of extraVerbs) assert.equal(verb in IN_APP, false, verb + ' is in the app already; it does not need to be here too');
  const menuVerbs = new Set(leaves.map(verbOf));
  for (const verb of extraVerbs) assert.ok(menuVerbs.has(verb), verb + ' is not in the menu bar, so the Mac could not reach it either');
  opened.length = 0;
  extras.find((i) => i.label === 'Terms').click();
  assert.deepEqual(opened, [LINKS.terms]);
});

test('the mark opens them on Windows only, through main', () => {
  assert.match(app, /function wireBrandMenu\(\) \{\n {2}if \(api\.platform !== 'win32' \|\| !api\.menuExtras\) return;/);
  assert.match(app, /q\('#btn-settings'\)\.onclick = \(\) => openSettings\(\);\n {2}wireBrandMenu\(\);/);
  assert.match(preload, /menuExtras: \(at\) => ipcRenderer\.invoke\('menu:extras', at\)/);
  assert.match(main, /ipcMain\.handle\('menu:extras'[\s\S]{0,200}process\.platform !== 'win32'/);
});

test('right-click: an editable field on Windows gets the Edit menu, enabled by what the field can do', () => {
  const t = editContextTemplate({ isEditable: true, editFlags: { canPaste: true, canSelectAll: true } }, 'win32');
  assert.deepEqual(t.filter((i) => i.role).map((i) => [i.role, i.enabled]), [
    ['undo', false], ['redo', false], ['cut', false], ['copy', false], ['paste', true], ['delete', false], ['selectAll', true]]);
  assert.deepEqual(editContextTemplate({ isEditable: true }, 'win32').filter((i) => i.role).map((i) => i.enabled), [false, false, false, false, false, false, false]);
});

test('right-click: selected text that cannot be edited can still be copied; nothing selected, no menu', () => {
  assert.deepEqual(editContextTemplate({ isEditable: false, selectionText: 'npm run build' }, 'win32'), [{ role: 'copy' }]);
  assert.equal(editContextTemplate({ isEditable: false, selectionText: '  ' }, 'win32'), null);
  assert.equal(editContextTemplate({ isEditable: false }, 'win32'), null);
  assert.equal(editContextTemplate(null, 'win32'), null);
});

test('right-click: the Mac has a menu bar for this and gets nothing new', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(editContextTemplate({ isEditable: true, editFlags: { canPaste: true } }, platform), null);
    assert.equal(editContextTemplate({ selectionText: 'x' }, platform), null);
  }
  assert.match(main, /w\.webContents\.on\('context-menu', \(_e, params\) => \{\n {4}const template = editContextTemplate\(params\);/);
});
