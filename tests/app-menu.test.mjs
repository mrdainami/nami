import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMenuTemplate, menuRoles, menuItems, LINKS, COMMANDS } = require('../src/main/app-menu.js');

const build = (over = {}) => buildMenuTemplate({
  open: () => {},
  send: () => {},
  newWindow: () => {},
  platform: 'darwin',
  ...over,
});

// The whole hazard of this feature. Setting an application menu discards
// Electron's default rather than extending it, so the standard roles have to
// be restated or the shortcuts they carry silently stop working: ⌘C inside a
// terminal, ⌘Q, minimise. Nothing about the app looks broken; the keys just
// stop.
//
// This list is the roles that carry a key, not the container roles. Every menu
// is written out by hand now, so `editMenu` and friends are gone on purpose and
// asserting on them would only prove the template still exists.
test('every role that carries a key survives, at any depth', () => {
  const roles = menuRoles(build());
  for (const role of [
    'undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll',
    'hide', 'quit', 'minimize', 'zoom', 'front', 'togglefullscreen',
    'resetZoom', 'zoomIn', 'zoomOut', 'reload', 'forceReload', 'toggleDevTools',
  ]) {
    assert.ok(roles.includes(role), `lost the ${role} role`);
  }
});

// What the branch is for. Services is a submenu of unrelated system commands,
// Hide Others and Show All are window management for a Mac with twelve apps
// open, and the two Edit submenus are macOS text features offered to an app
// whose text is prompts, code and paths.
test('the Electron leftovers are gone', () => {
  const roles = menuRoles(build());
  for (const role of ['services', 'hideOthers', 'unhide', 'showSubstitutions', 'startSpeaking', 'about']) {
    assert.ok(!roles.includes(role), `${role} is still in the menu`);
  }
});

// The regression this feature nearly shipped, and the reason the test is louder
// than the rest. The conventional Mac File menu holds `role: 'close'`, which
// binds ⌘W, and Nami binds ⌘W to close the active *pane*. A menu accelerator
// outranks a renderer keydown, so the conventional item would silently turn
// "close this tile" into "close the window", taking every other session in it.
// Nothing in the app would look broken; the key would just do the wrong thing.
//
// File does carry ⌘W now, routed to the same renderer handler the keydown ran.
// That is the only item allowed to claim it.
test('the one item that claims ⌘W closes a pane, and nothing uses role close', () => {
  for (const platform of ['darwin', 'win32']) {
    const sent = [];
    const template = build({ platform, send: (c) => sent.push(c) });
    const claims = [];
    for (const item of menuItems(template)) {
      assert.notEqual(item.role, 'close', `${platform}: role:'close' takes ⌘W from close-pane`);
      if (/CommandOrControl\+W$|Cmd\+W$/i.test(item.accelerator || '')) claims.push(item);
    }
    assert.equal(claims.length, 1, `${platform}: ${claims.length} items claim ⌘W`);
    claims[0].click();
    assert.deepEqual(sent, ['close-pane'], `${platform}: ⌘W does not close a pane`);
  }
});

test('six menus on macOS, in the order a Mac user reads them', () => {
  const labels = build().map((m) => m.label);
  assert.deepEqual(labels, ['Nami', 'File', 'Edit', 'View', 'Window', 'Help']);
});

test('off macOS there is no app submenu, so File exists to hold quit', () => {
  const win = build({ platform: 'win32' });
  assert.ok(!win.some((m) => m.label === 'Nami'), 'built a mac app submenu off mac');
  const file = win.find((m) => m.label === 'File');
  assert.ok(menuRoles([file]).includes('quit'), 'nothing would quit the app');
});

// A command is a string that has to match a string in app.js. A typo here is a
// dead menu item that throws nothing, so the set is declared and checked
// against rather than trusted.
test('every command an item sends is one the renderer knows', () => {
  const sent = [];
  const template = build({ send: (c) => sent.push(c) });
  for (const item of menuItems(template)) if (item.click) item.click();
  assert.ok(sent.length >= 18, `only ${sent.length} items send a command`);
  for (const cmd of sent) {
    const base = cmd.split(':')[0];
    assert.ok(COMMANDS.includes(base), `${cmd} is not a known command`);
  }
});

test('About Nami opens Nami’s own pane, not the grey macOS panel', () => {
  const sent = [];
  const nami = build({ send: (c) => sent.push(c) }).find((m) => m.label === 'Nami');
  const about = nami.submenu.find((i) => i.label === 'About Nami');
  assert.equal(about.role, undefined, 'role:about is the stock panel');
  about.click();
  assert.deepEqual(sent, ['about']);
});

test('the theme submenu is four radios with the saved one ticked', () => {
  const theme = build({ theme: 'graphite' }).find((m) => m.label === 'View')
    .submenu.find((i) => i.label === 'Theme').submenu;
  assert.deepEqual(theme.map((i) => i.label), ['Paper', 'Operator', 'Glass', 'Graphite']);
  for (const item of theme) assert.equal(item.type, 'radio');
  assert.deepEqual(theme.filter((i) => i.checked).map((i) => i.label), ['Graphite']);
});

test('Open Recent is the real list, and stays away when there is none', () => {
  const sent = [];
  const recents = [{ path: '/Users/x/nami' }, { path: '/Users/x/vault' }];
  const file = build({ recents, send: (c) => sent.push(c) }).find((m) => m.label === 'File');
  const recent = file.submenu.find((i) => i.label === 'Open Recent');
  assert.deepEqual(recent.submenu.map((i) => i.label), ['nami', 'vault']);
  recent.submenu[1].click();
  assert.deepEqual(sent, ['open-recent:/Users/x/vault']);

  const bare = build({ recents: [] }).find((m) => m.label === 'File');
  const none = bare.submenu.find((i) => i.label === 'Open Recent');
  assert.equal(none.enabled, false, 'an empty Open Recent should be there but dead');
});

test('Help carries the docs first and the ask in the middle', () => {
  const help = build().find((m) => m.role === 'help');
  const labels = help.submenu.filter((i) => i.type !== 'separator').map((i) => i.label);
  assert.deepEqual(labels, [
    'Nami Docs',
    'Keyboard Shortcuts',
    'Nami on GitHub',
    '★ Star Nami',
    'Report an Issue',
    'Release Notes',
    'Nami for Your Team',
    'Made by Cal',
    'Terms',
  ]);
});

// Eight items, seven destinations: the repo is opened by both Nami on GitHub
// and ★ Star Nami, which is deliberate. One is "read the source", the other is
// an ask, and GitHub has no separate page for the second.
test('every url the menu opens is https, and only the repo is opened twice', () => {
  const opened = [];
  const template = build({ open: (u) => opened.push(u) });
  for (const item of menuItems(template)) if (item.click) item.click();
  assert.equal(opened.length, 8, `${opened.length} urls, expected one per link`);
  assert.equal(new Set(opened).size, 7, 'two items open the same url');
  assert.equal(opened.filter((u) => u === LINKS.repo).length, 2);
  for (const url of opened) assert.match(url, /^https:\/\//, `${url} is not https`);
});

// No telemetry anywhere in Nami, so the UTM is the entire measurement story:
// it has to actually be on the links whose traffic we want to tell apart.
// The repo links are deliberately bare — GitHub is not where the analytics is.
test('the site links carry a help-menu utm; the github ones stay clean', () => {
  for (const key of ['teams', 'maker', 'docs', 'terms']) {
    assert.match(LINKS[key], /utm_source=nami-app&utm_medium=help-menu/, `${key} has no utm`);
  }
  assert.match(LINKS.teams, /utm_campaign=teams/);
  for (const key of ['repo', 'issue', 'releases']) {
    assert.ok(!LINKS[key].includes('utm'), `${key} should stay bare`);
  }
});

test('nothing points at a page that does not exist', () => {
  // /teams was the original destination and was never built; every link that
  // pointed at it would have 404'd on click.
  for (const url of Object.values(LINKS)) assert.ok(!url.includes('/teams'), url);
});

// Nami's copy has no em dashes in it. The menu bar is the most-read copy in the
// app, so the rule is enforced rather than remembered.
test('no label in the menu bar contains an em dash', () => {
  for (const item of menuItems(build())) {
    assert.ok(!/[—–]/.test(item.label || ''), `${item.label} has a dash in it`);
  }
  for (const url of Object.values(LINKS)) assert.ok(!/[—–]/.test(url), url);
});
