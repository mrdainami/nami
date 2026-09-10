import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { splitAfter, focusSplit } from '../src/renderer/desk-view.mjs';
const require = createRequire(import.meta.url);
const { popupDecision } = require('../src/main/browser-profiles.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('a full-screen pane stays full when you click another tab inside it', () => {
  const panels = [
    { id: 's1', kind: 'claude' },
    { id: 'b1', kind: 'browser', companionOf: 's1' },
    { id: 'b2', kind: 'browser', companionOf: 's1' },
  ];
  let state = splitAfter({ panels }, { type: 'select-companion', id: 'b1' });
  // ⤢ on the files pane, then click the second browser tab
  const next = focusSplit(state, 'b2', 'files');
  assert.equal(next.split.fileId, 'b2');
  assert.equal(next.full, 'files', 'the fill belongs to the pane, not the tab');
  // clicking the session, which is the OTHER pane, does let it go
  assert.equal(focusSplit(state, 's1', 'files').full, null);
});

test('a sign-in popup from a click becomes a real popup; everything else a tab', () => {
  assert.deepEqual(popupDecision('https://accounts.google.com/o/oauth2', 'oauth', 'new-window'), { action: 'allow' });
  // no click behind it → a tab, never a window
  assert.deepEqual(popupDecision('https://accounts.google.com/o/oauth2', 'oauth', 'foreground-tab'), { action: 'deny', newTab: 'https://accounts.google.com/o/oauth2' });
  assert.deepEqual(popupDecision('https://accounts.google.com/o/oauth2', 'oauth'), { action: 'deny', newTab: 'https://accounts.google.com/o/oauth2' });
  // the block policy still blocks
  assert.deepEqual(popupDecision('https://x.example/', 'block', 'new-window'), { action: 'deny', newTab: 'https://x.example/' });
  assert.deepEqual(popupDecision('javascript:alert(1)', 'oauth', 'new-window'), { action: 'deny' });
});

test('an allowed popup is painted, shares the profile, and cannot spawn or wander', () => {
  const views = read('src/main/browser-views.js');
  assert.match(views, /overrideBrowserWindowOptions: \{[^}]*backgroundColor/s, 'no more black window');
  assert.match(views, /session: record\.session, sandbox: true, contextIsolation: true, nodeIntegration: false/);
  assert.match(views, /did-create-window[\s\S]*?setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(views, /did-create-window[\s\S]*?will-navigate/);
});

test('light and dark follow Nami, not the Mac, and websites are told', () => {
  const views = read('src/main/browser-views.js');
  const fn = views.slice(views.indexOf('function blankIsDark'), views.indexOf('\n}', views.indexOf('function blankIsDark')));
  assert.doesNotMatch(fn, /shouldUseDarkColors/, 'the Mac has no vote');
  assert.match(views, /nativeTheme\.themeSource = /);
  assert.match(views, /ipcMain\.on\('theme:applied'[\s\S]*?syncNativeTheme/);
});
