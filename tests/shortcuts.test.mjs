import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutGroups, openOutputCopy, SHORTCUT_GROUPS, OPEN_OUTPUT_COPY } from '../src/renderer/shortcuts.mjs';
import fs from 'node:fs';
import { APP_CHORDS, chordText } from '../src/renderer/platform-words.mjs';

// The sheet exactly as it shipped for the Mac, before it knew there was a
// second platform. Copied, not computed, so a change to the Mac column cannot
// also change what it is compared against.
const MAC_SHEET = [
  {
    icon: 'link', title: 'Links & files',
    rows: [
      ['Open a web link', ['⌘', 'click'], 'In session output · opens your browser'],
      ['Open a file in Nami', ['⌘', 'click'], 'In session output · opens the file here'],
      ['Reveal a file in Finder', ['⌥', '⌘', 'click']],
      ['Reveal a folder in Finder', ['⌘', 'click']],
      ['Open link actions', ['Right-click'], 'Open, copy, or reveal — depending on the link'],
    ],
    note: 'Reading a document? Links in Read mode open with a normal click.',
  },
  {
    icon: 'keyboard', title: 'Everyday shortcuts',
    rows: [
      ['New session', ['⌘', 'N']],
      ['Open the agent picker', ['⌘', 'K']],
      ['Open a folder', ['⌘', 'O']],
      ['New window', ['⇧', '⌘', 'N']],
      ['Open Settings', ['⌘', ',']],
      ['Save the active file', ['⌘', 'S']],
      ['Close the active pane', ['⌘', 'W']],
      ['Dismiss a dialog or leave an expanded pane', ['Esc']],
    ],
  },
  {
    icon: 'desk', title: 'Arrange your desk',
    rows: [
      ['Reorder a pane', ['Drag header']],
      ['Resize a pane', ['Drag handle']],
      ['Reset a pane’s size', ['Double-click handle']],
      ['Rename a session', ['Double-click title']],
    ],
  },
  {
    icon: 'file', title: 'In the workspace',
    rows: [
      ['Rename a selected file or folder', ['Return'], 'When the workspace list has focus'],
      ['Move a selected item to Trash', ['⌘', '⌫'], 'When the workspace list has focus'],
      ['Add selected file content to a session', ['⇧', '⌘', 'Return'], 'From the file’s selection toolbar'],
    ],
  },
];

const rowsOf = (platform) => shortcutGroups(platform).flatMap((g) => g.rows);
const keysFor = (platform, label) => rowsOf(platform).find((r) => r[0] === label)[1];

test('the Mac sheet is the one that shipped', () => {
  assert.deepEqual(shortcutGroups('darwin'), MAC_SHEET);
  assert.equal(openOutputCopy('darwin'), 'Hold Command (⌘) and click a link or file path in a session. Web links open in your browser. Files open here in Nami.');
});

test('what the app imports under plain node is the Mac sheet', () => {
  assert.deepEqual(SHORTCUT_GROUPS, MAC_SHEET);
  assert.equal(OPEN_OUTPUT_COPY, openOutputCopy('darwin'));
});

test('the Windows sheet has the same rows in the same places', () => {
  const mac = shortcutGroups('darwin'), win = shortcutGroups('win32');
  assert.deepEqual(win.map((g) => [g.icon, g.title, g.rows.length]), mac.map((g) => [g.icon, g.title, g.rows.length]));
  // Same sub-lines too: they describe where, not which key.
  assert.deepEqual(win.map((g) => g.rows.map((r) => r[2])), mac.map((g) => g.rows.map((r) => r[2])));
});

test('the Windows sheet shows the chord that works inside a terminal pane', () => {
  assert.deepEqual(keysFor('win32', 'New session'), ['Ctrl', 'Shift', 'T']);
  assert.deepEqual(keysFor('win32', 'Open the agent picker'), ['Ctrl', 'Shift', 'K']);
  assert.deepEqual(keysFor('win32', 'Open a folder'), ['Ctrl', 'Shift', 'O']);
  assert.deepEqual(keysFor('win32', 'New window'), ['Ctrl', 'Shift', 'N']);
  assert.deepEqual(keysFor('win32', 'Close the active pane'), ['Ctrl', 'Shift', 'W']);
  assert.deepEqual(keysFor('win32', 'Open Settings'), ['Ctrl', ',']);
  assert.deepEqual(keysFor('win32', 'Save the active file'), ['Ctrl', 'S']);
});

test('Windows gestures and workspace keys are in Windows words', () => {
  assert.deepEqual(keysFor('win32', 'Open a web link'), ['Ctrl', 'click']);
  assert.deepEqual(keysFor('win32', 'Reveal a file in File Explorer'), ['Ctrl', 'Alt', 'click']);
  assert.deepEqual(keysFor('win32', 'Reveal a folder in File Explorer'), ['Ctrl', 'click']);
  assert.deepEqual(keysFor('win32', 'Rename a selected file or folder'), ['Enter']);
  assert.deepEqual(keysFor('win32', 'Move a selected item to the Recycle Bin'), ['Ctrl', 'Delete']);
  assert.deepEqual(keysFor('win32', 'Add selected file content to a session'), ['Ctrl', 'Shift', 'Enter']);
});

test('only Windows explains why its keys carry a Shift', () => {
  const everyday = (platform) => shortcutGroups(platform).find((g) => g.title === 'Everyday shortcuts');
  assert.equal('note' in everyday('darwin'), false);
  assert.match(everyday('win32').note, /Inside a terminal/);
});

test('"click" stays the last, lower-case entry, because the sheet draws it as "+ click"', () => {
  for (const platform of ['darwin', 'win32']) {
    for (const [label, keys] of rowsOf(platform)) {
      const at = keys.indexOf('click');
      if (at !== -1) assert.equal(at, keys.length - 1, platform + ' · ' + label);
    }
  }
});

// docs/shortcuts.md is written by hand, and a hand-written table is the first
// thing to fall behind. Each of Nami's chords has to sit on one row of it, the
// Mac key and the Windows key side by side.
test('docs/shortcuts.md prints the same chords the app does, for both platforms', () => {
  const doc = fs.readFileSync(new URL('../docs/shortcuts.md', import.meta.url), 'utf8');
  const rows = doc.split('\n').filter((line) => line.startsWith('|')).map((line) => line.split('|').map((cell) => cell.trim()));
  for (const name of Object.keys(APP_CHORDS)) {
    const mac = chordText(name, 'darwin'), win = chordText(name, 'win32');
    assert.ok(rows.some((cells) => cells.includes(mac) && cells.includes(win)), `${name}: no row with both ${mac} and ${win}`);
  }
});
