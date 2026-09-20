// Ctrl+C in a Windows session: copy or interrupt. Platform is a parameter, so
// the Mac column — nothing, ever — is checked from the same machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { termKeyAction } from '../src/renderer/term-keys.mjs';

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

// The handler is only ever attached on Windows, so a Mac terminal keeps xterm's
// own default handler rather than one of ours that happens to agree with it.
test('app.js attaches the handler on Windows only', () => {
  const app = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(api\.platform === 'win32'\) wireWindowsKeys\(/);
  assert.equal((app.match(/attachCustomKeyEventHandler/g) || []).length, 1);
});
