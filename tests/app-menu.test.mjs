import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMenuTemplate, menuRoles, LINKS } = require('../src/main/app-menu.js');

const build = (platform = 'darwin') => buildMenuTemplate({ open: () => {}, platform });

// The whole hazard of this feature. Setting an application menu discards
// Electron's default rather than extending it, so the standard roles have to
// be restated or the shortcuts they carry silently stop working — ⌘C inside a
// terminal, ⌘Q, minimise. Nothing about the app looks broken; the keys just
// stop.
test('the standard roles survive — losing these loses ⌘C and ⌘Q', () => {
  const roles = menuRoles(build('darwin'));
  for (const role of ['appMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help']) {
    assert.ok(roles.includes(role), `lost the ${role} role`);
  }
});

test('off macOS there is no app submenu, so File exists to hold quit', () => {
  const win = build('win32');
  assert.ok(!menuRoles(win).includes('appMenu'));
  const file = win.find((m) => m.label === 'File');
  assert.ok(file.submenu.some((i) => i.role === 'quit'), 'nothing would quit the app');
});

// The regression this feature nearly shipped. The conventional Mac File menu
// holds `role: 'close'`, which binds ⌘W — and Nami already binds ⌘W to close
// the active *pane*. A menu accelerator outranks a renderer keydown, so the
// conventional item would have silently turned "close this tile" into "close
// the window", taking every other session in it. Nothing in the app would look
// broken; the key would just do the wrong thing.
test('no menu item claims ⌘W — the app needs it for close pane', () => {
  for (const platform of ['darwin', 'win32']) {
    for (const top of build(platform)) {
      for (const item of top.submenu || []) {
        assert.notEqual(item.role, 'close', `${platform}: role:'close' takes ⌘W from close-pane`);
        assert.ok(!/CommandOrControl\+W|Cmd\+W/i.test(item.accelerator || ''), `${platform}: ${item.label} binds ⌘W`);
      }
    }
  }
  // and on macOS that means no File menu at all — appMenu already has ⌘Q
  assert.equal(build('darwin').find((m) => m.label === 'File'), undefined);
});

test('Help carries the four ways out, in order', () => {
  const help = build().find((m) => m.role === 'help');
  const labels = help.submenu.filter((i) => i.type !== 'separator').map((i) => i.label);
  assert.deepEqual(labels, [
    'Nami on GitHub',
    '★ Star Nami',
    'Report an issue',
    'Nami for your team…',
    'Made by Cal',
  ]);
});

test('every Help item opens exactly one url, and every url is https', () => {
  const opened = [];
  const help = buildMenuTemplate({ open: (u) => opened.push(u), platform: 'darwin' })
    .find((m) => m.role === 'help');
  for (const item of help.submenu) if (item.click) item.click();
  assert.equal(opened.length, 5);
  for (const url of opened) assert.match(url, /^https:\/\//, `${url} is not https`);
});

// No telemetry anywhere in Nami, so the UTM is the entire measurement story:
// it has to actually be on the links whose traffic we want to tell apart.
// The repo links are deliberately bare — GitHub is not where the analytics is.
test('the dainami links carry a help-menu utm; the github ones stay clean', () => {
  assert.match(LINKS.teams, /utm_source=nami-app&utm_medium=help-menu/);
  assert.match(LINKS.maker, /utm_source=nami-app&utm_medium=help-menu/);
  assert.match(LINKS.teams, /utm_campaign=teams/);
  assert.ok(!LINKS.repo.includes('utm'));
  assert.ok(!LINKS.issue.includes('utm'));
});

test('nothing points at a page that does not exist', () => {
  // /teams was the original destination and was never built; every link that
  // pointed at it would have 404'd on click.
  for (const url of Object.values(LINKS)) assert.ok(!url.includes('/teams'), url);
});
