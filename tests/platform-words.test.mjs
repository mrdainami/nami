import { test } from 'node:test';
import assert from 'node:assert/strict';
import { words, keys, kb, clickWith, chord, chordText, APP_CHORDS } from '../src/renderer/platform-words.mjs';

const MAC = 'darwin', WIN = 'win32';

test('a Mac keeps every word it has always printed', () => {
  const w = words(MAC);
  assert.equal(w.finder, 'Finder');
  assert.equal(w.finderShort, 'Finder');
  assert.equal(w.reveal, 'Reveal in Finder');
  assert.equal(w.thisMac, 'this Mac');
  assert.equal(w.yourMac, 'your Mac');
  assert.equal(w.theMac, 'the Mac');
  assert.equal(w.os, 'Mac');
  assert.equal(w.dock, 'Dock');
  assert.equal(w.trash, 'Trash');
  assert.equal(w.keychain, 'Keychain');
  assert.equal(w.menuBar, 'menu bar');
  assert.equal(w.holdToOpen, 'Hold Command (⌘) and click a link or file path in a session. Web links open in your browser. Files open here in Nami.');
  assert.equal(w.keyLegend, '⌘ Command · ⌥ Option · ⇧ Shift');
  assert.equal(w.noAgentYet, 'No agent is installed yet. Press ⌘N to add one first.');
  assert.equal(w.shortcutsLabel, '⌘ Shortcuts & gestures');
});

test('Windows gets the words Windows uses', () => {
  const w = words(WIN);
  assert.equal(w.finder, 'File Explorer');
  assert.equal(w.finderShort, 'Explorer');
  assert.equal(w.reveal, 'Reveal in File Explorer');
  assert.equal(w.thisMac, 'this PC');
  assert.equal(w.yourMac, 'your PC');
  assert.equal(w.theMac, 'the PC');
  assert.equal(w.os, 'Windows');
  assert.equal(w.dock, 'taskbar');
  assert.equal(w.trash, 'the Recycle Bin');
  assert.equal(w.menuBar, 'menu');
  assert.match(w.holdToOpen, /^Hold Ctrl and click a link or file path in a session\./);
  assert.equal(w.noAgentYet, 'No agent is installed yet. Press Ctrl+Shift+T to add one first.');
});

test('both columns answer the same questions', () => {
  assert.deepEqual(Object.keys(words(WIN)).sort(), Object.keys(words(MAC)).sort());
  for (const p of [MAC, WIN]) for (const [k, v] of Object.entries(words(p))) assert.ok(typeof v === 'string' && v, p + '.' + k);
});

test('no Mac word is left in the Windows column', () => {
  for (const [k, v] of Object.entries(words(WIN))) assert.doesNotMatch(v, /Mac|Finder|Keychain|Dock|[⌘⌥⇧⌃⌫↵⇥]/, k);
});

test('anything that is not Windows reads the Mac column, the way paths.mjs reads POSIX', () => {
  assert.equal(words(''), words(MAC));
  assert.equal(words('linux'), words(MAC));
  assert.equal(words(), words(MAC), 'plain node has no platform to ask');
});

test('Mac key caps come back exactly as they went in', () => {
  for (const list of [['⌘', 'N'], ['⇧', '⌘', 'N'], ['⌥', '⌘', 'click'], ['⌘', '⌫'], ['⇧', '⌘', 'Return'], ['Esc'], ['Right-click']]) {
    assert.deepEqual(keys(list, MAC), list);
    assert.equal(kb(list, MAC), list.join(''));
  }
  assert.equal(kb(['⌥', '⌘', 'click'], MAC), '⌥⌘click');
  assert.equal(kb(['⇧', '⌘', '↵'], MAC), '⇧⌘↵');
});

test('Windows key caps are words, modifiers first in the order Windows writes them', () => {
  assert.deepEqual(keys(['⌘', 'N'], WIN), ['Ctrl', 'N']);
  assert.deepEqual(keys(['⇧', '⌘', 'N'], WIN), ['Ctrl', 'Shift', 'N']);
  assert.deepEqual(keys(['⌥', '⌘', 'click'], WIN), ['Ctrl', 'Alt', 'click']);
  assert.deepEqual(keys(['⇧', '⌘', 'Return'], WIN), ['Ctrl', 'Shift', 'Enter']);
  assert.deepEqual(keys(['⌘', '⌫'], WIN), ['Ctrl', 'Backspace']);
  assert.deepEqual(keys(['⇧', '⇥'], WIN), ['Shift', 'Tab']);
  assert.deepEqual(keys(['Return'], WIN), ['Enter']);
  assert.deepEqual(keys(['Esc'], WIN), ['Esc']);
  assert.deepEqual(keys(['Drag header'], WIN), ['Drag header']);
  // ⌃ and ⌘ are both Ctrl on a PC keyboard, and one cap is enough.
  assert.deepEqual(keys(['⌃', '⌘', 'C'], WIN), ['Ctrl', 'C']);
});

test('Windows writes a chord with plus signs where the Mac writes glyphs tight', () => {
  assert.equal(kb(['⇧', '⌘', 'N'], WIN), 'Ctrl+Shift+N');
  assert.equal(kb(['⌥', '⌘', 'click'], WIN), 'Ctrl+Alt+click');
  assert.equal(kb(['⌘', 'click'], WIN), 'Ctrl+click');
  assert.equal(kb(['⇧', '⌘', '↵'], WIN), 'Ctrl+Shift+Enter');
  assert.equal(kb(['⇧', '⇥'], WIN), 'Shift+Tab');
});

test('a click hint reads naturally on both', () => {
  assert.equal(clickWith(['⌘'], MAC), '⌘ Click');
  assert.equal(clickWith(['⌥', '⌘'], MAC), '⌥⌘ Click');
  assert.equal(clickWith(['⌘'], WIN), 'Ctrl+Click');
  assert.equal(clickWith(['⌥', '⌘'], WIN), 'Ctrl+Alt+Click');
});

test('the Mac chords are the ones the Mac has always had', () => {
  assert.equal(chordText('new-session', MAC), '⌘N');
  assert.equal(chordText('new-window', MAC), '⇧⌘N');
  assert.equal(chordText('agents', MAC), '⌘K');
  assert.equal(chordText('open-folder', MAC), '⌘O');
  assert.equal(chordText('settings', MAC), '⌘,');
  assert.equal(chordText('save', MAC), '⌘S');
  assert.equal(chordText('close-pane', MAC), '⌘W');
  assert.equal(chordText('trash', MAC), '⌘⌫');
  assert.deepEqual(chord('new-window', MAC), ['⇧', '⌘', 'N']);
});

test('the Windows chords are the forms that work inside a terminal pane too', () => {
  assert.equal(chordText('new-session', WIN), 'Ctrl+Shift+T');
  assert.equal(chordText('new-window', WIN), 'Ctrl+Shift+N');
  assert.equal(chordText('agents', WIN), 'Ctrl+Shift+K');
  assert.equal(chordText('open-folder', WIN), 'Ctrl+Shift+O');
  assert.equal(chordText('close-pane', WIN), 'Ctrl+Shift+W');
  assert.equal(chordText('settings', WIN), 'Ctrl+,');
  assert.equal(chordText('save', WIN), 'Ctrl+S');
  assert.equal(chordText('trash', WIN), 'Ctrl+Delete');
  assert.deepEqual(chord('new-session', WIN), ['Ctrl', 'Shift', 'T']);
});

test('no Windows chord takes a key the terminal already owns', () => {
  // Ctrl+Shift+C / V / A are copy, paste and select-all in a pane (term-keys.mjs).
  for (const [name, c] of Object.entries(APP_CHORDS)) {
    const text = c.win.join('+');
    assert.doesNotMatch(text, /^Ctrl\+Shift\+[CVA]$/, name);
  }
  const seen = new Set();
  for (const [name, c] of Object.entries(APP_CHORDS)) {
    const text = c.win.join('+');
    assert.ok(!seen.has(text), name + ' shares ' + text);
    seen.add(text);
  }
});

test('an unknown chord is a bug, said out loud', () => {
  assert.throws(() => chord('no-such-thing', WIN), /no-such-thing/);
});
