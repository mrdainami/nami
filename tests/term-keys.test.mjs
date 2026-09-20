// Ctrl+C in a Windows session: copy or interrupt. Platform is a parameter, so
// the Mac column — nothing, ever — is checked from the same machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { termKeyAction, appChord } from '../src/renderer/term-keys.mjs';
import { APP_CHORDS } from '../src/renderer/platform-words.mjs';

const key = (k, mods = {}) => ({ type: 'keydown', key: k, code: 'Key' + k.toUpperCase(), ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const WIN = { platform: 'win32' };

// The one that must never break: a running program has to be stoppable.
test('Ctrl+C with nothing selected is left to the terminal, so it is ^C', () => {
  assert.equal(termKeyAction(key('c', { ctrlKey: true }), { ...WIN, hasSelection: false }), null);
});

test('Ctrl+C with a selection copies', () => {
  assert.equal(termKeyAction(key('c', { ctrlKey: true }), { ...WIN, hasSelection: true }), 'copy');
});

test('Ctrl+V pastes, selection or not', () => {
  for (const hasSelection of [true, false]) {
    assert.equal(termKeyAction(key('v', { ctrlKey: true }), { ...WIN, hasSelection }), 'paste');
  }
});

test('Ctrl+Shift+C and Ctrl+Shift+V copy and paste, and never reach the program', () => {
  for (const hasSelection of [true, false]) {
    assert.equal(termKeyAction(key('C', { ctrlKey: true, shiftKey: true }), { ...WIN, hasSelection }), 'copy');
    assert.equal(termKeyAction(key('V', { ctrlKey: true, shiftKey: true }), { ...WIN, hasSelection }), 'paste');
  }
});

test('Ctrl+Shift+A selects everything; plain Ctrl+A stays "start of line"', () => {
  assert.equal(termKeyAction(key('A', { ctrlKey: true, shiftKey: true }), WIN), 'select-all');
  assert.equal(termKeyAction(key('a', { ctrlKey: true }), WIN), null);
});

// Readline and PSReadLine own these. Nothing here may take them.
test('the shell keeps its editing keys', () => {
  for (const k of ['w', 'n', 't', 'k', 'l', 'r', 'd', 'z', 'u', 'e', 'x', 'o', 's']) {
    assert.equal(termKeyAction(key(k, { ctrlKey: true }), { ...WIN, hasSelection: true }), null, 'Ctrl+' + k);
  }
  assert.equal(termKeyAction(key('c'), { ...WIN, hasSelection: true }), null, 'a bare c is a letter');
  assert.equal(termKeyAction(key('v'), WIN), null);
});

// AltGr is Ctrl+Alt on Windows, and AltGr+V is a character on some layouts.
test('anything with Alt held is left alone', () => {
  assert.equal(termKeyAction(key('v', { ctrlKey: true, altKey: true }), WIN), null);
  assert.equal(termKeyAction(key('c', { ctrlKey: true, altKey: true }), { ...WIN, hasSelection: true }), null);
});

test('a layout with no Latin letters goes by the physical key', () => {
  const ru = { type: 'keydown', key: 'с', code: 'KeyC', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
  assert.equal(termKeyAction(ru, { ...WIN, hasSelection: true }), 'copy');
  assert.equal(termKeyAction({ ...ru, key: 'м', code: 'KeyV' }, WIN), 'paste');
  // and a layout that moves the letters goes by the letter: Dvorak's C sits on the I key
  assert.equal(termKeyAction({ ...ru, key: 'c', code: 'KeyI' }, { ...WIN, hasSelection: true }), 'copy');
});

test('a Mac is never touched: ⌘C is the menu\'s and Ctrl+C is always ^C', () => {
  for (const platform of ['darwin', 'linux', '', undefined]) {
    for (const hasSelection of [true, false]) {
      for (const e of [key('c', { ctrlKey: true }), key('v', { ctrlKey: true }), key('c', { metaKey: true }), key('v', { metaKey: true }), key('C', { ctrlKey: true, shiftKey: true }), key('A', { ctrlKey: true, shiftKey: true })]) {
        assert.equal(termKeyAction(e, { platform, hasSelection }), null);
      }
    }
  }
});

// Nami's own keys. On a Mac they are ⌘ keys and a terminal never sees them. On
// Windows they would be Ctrl keys, and inside a pane those are the shell's — so
// each has a Ctrl+Shift form, and that form has to get past xterm to the app.
const CS = { ctrlKey: true, shiftKey: true };

test('the Ctrl+Shift app chords are handed to the app, not to the terminal', () => {
  const chords = { T: 'new-session', N: 'new-window', K: 'agents', O: 'open-folder', W: 'close-pane', S: 'save' };
  for (const [k, name] of Object.entries(chords)) {
    assert.equal(appChord(key(k, CS), WIN), name, 'Ctrl+Shift+' + k);
    for (const hasSelection of [true, false]) assert.equal(termKeyAction(key(k, CS), { ...WIN, hasSelection }), 'app', 'Ctrl+Shift+' + k);
  }
});

test('Ctrl+comma is Settings, with or without Shift, whatever the layout calls the key', () => {
  const comma = (mods) => ({ ...key(',', mods), code: 'Comma' });
  assert.equal(appChord(comma({ ctrlKey: true }), WIN), 'settings');
  assert.equal(appChord({ ...comma(CS), key: '<' }, WIN), 'settings');
  assert.equal(termKeyAction(comma({ ctrlKey: true }), WIN), 'app');
  assert.equal(appChord(comma({}), WIN), null, 'a bare comma is a comma');
});

// View → Sessions / Workspace / Library. No shell can be sent Ctrl+1, and
// xterm turns Ctrl+3 into Escape, which would be a surprise.
test('Ctrl+1, 2 and 3 go to the menu, which switches the sidebar', () => {
  for (const d of ['1', '2', '3']) {
    const e = { ...key(d, { ctrlKey: true }), code: 'Digit' + d };
    assert.equal(termKeyAction(e, WIN), 'app', 'Ctrl+' + d);
    assert.equal(appChord(e, WIN), null, 'the menu owns it, not the keydown');
  }
  assert.equal(termKeyAction({ ...key('4', { ctrlKey: true }), code: 'Digit4' }, WIN), null);
  assert.equal(termKeyAction({ ...key('1'), code: 'Digit1' }, WIN), null, 'a bare 1 is a 1');
});

test('the plain Ctrl forms are not app chords: in a pane they are the shell\'s', () => {
  for (const k of ['t', 'n', 'k', 'o', 'w', 's']) assert.equal(appChord(key(k, { ctrlKey: true }), WIN), null, 'Ctrl+' + k);
});

test('Ctrl+Shift+C, V and A stay copy, paste and select-all', () => {
  assert.equal(termKeyAction(key('C', CS), WIN), 'copy');
  assert.equal(termKeyAction(key('V', CS), WIN), 'paste');
  assert.equal(termKeyAction(key('A', CS), WIN), 'select-all');
  for (const k of ['C', 'V', 'A']) assert.equal(appChord(key(k, CS), WIN), null);
});

test('a Ctrl+Shift letter Nami has no use for is left alone', () => {
  for (const k of ['B', 'D', 'E', 'F', 'L', 'P', 'R', 'Z']) {
    assert.equal(appChord(key(k, CS), WIN), null, k);
    assert.equal(termKeyAction(key(k, CS), WIN), null, k);
  }
});

test('AltGr is never an app chord', () => {
  assert.equal(appChord(key('T', { ...CS, altKey: true }), WIN), null);
  assert.equal(termKeyAction(key('T', { ...CS, altKey: true }), WIN), null);
});

test('an app chord goes by the physical key on a layout with no Latin letters', () => {
  assert.equal(appChord({ type: 'keydown', key: 'Е', code: 'KeyT', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }, WIN), 'new-session');
});

test('Dvorak keeps its comma: the physical W key is not W there', () => {
  const dvorakComma = (mods, k) => ({ ...key(k, mods), code: 'KeyW' });
  assert.equal(appChord(dvorakComma({ ctrlKey: true }, ','), WIN), 'settings');
  assert.equal(appChord(dvorakComma(CS, '<'), WIN), null, 'not close-pane');
  assert.equal(termKeyAction(dvorakComma(CS, '<'), WIN), null);
  // and Dvorak's own W, on the physical comma key, is W
  assert.equal(appChord({ ...key('W', CS), code: 'Comma' }, WIN), 'close-pane');
});

test('on a Mac there are no app chords here at all: ⌘ keys never reach a terminal', () => {
  for (const platform of ['darwin', 'linux', '', undefined]) {
    for (const e of [key('T', CS), key('N', CS), key('K', CS), key('N', { metaKey: true }), key('N', { metaKey: true, shiftKey: true }), { ...key(',', { ctrlKey: true }), code: 'Comma' }, { ...key('1', { ctrlKey: true }), code: 'Digit1' }]) {
      assert.equal(appChord(e, { platform }), null);
      assert.equal(termKeyAction(e, { platform }), null);
    }
  }
});

// The sheet prints APP_CHORDS; this file decides what a keypress means. If the
// two disagree, the sheet teaches a key that does nothing.
test('every chord the Windows sheet prints with Ctrl+Shift is one the terminal lets through', () => {
  for (const [name, c] of Object.entries(APP_CHORDS)) {
    if (c.win.length !== 3 || c.win[0] !== 'Ctrl' || c.win[1] !== 'Shift') continue;
    assert.equal(appChord(key(c.win[2], CS), WIN), name);
  }
  assert.deepEqual(APP_CHORDS.settings.win, ['Ctrl', ',']);
});

test('app.js lets an app chord past xterm untouched, and acts on it', () => {
  const app = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  // Not cancelled: a cancelled keydown never reaches onGlobalKey or the menu.
  assert.match(app, /if \(action === 'app'\) return false;\s*\n\s*if \(action !== 'paste'\) e\.preventDefault\(\);/);
  assert.match(app, /const chord = appChord\(e, \{ platform: api\.platform \}\);/);
});

// The handler is only ever attached on Windows, so a Mac terminal keeps xterm's
// own default handler rather than one of ours that happens to agree with it.
test('app.js attaches the handler on Windows only', () => {
  const app = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(api\.platform === 'win32'\) wireWindowsKeys\(/);
  assert.equal((app.match(/attachCustomKeyEventHandler/g) || []).length, 1);
});
