import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termMenuItems } from '../src/renderer/term-menu.mjs';

const labels = (items) => items.filter((i) => i !== '-').map((i) => i.label);
const copyRows = (items) => items.filter((i) => i !== '-' && i.copy != null);

test('a file offers open, reveal and copy', () => {
  const items = termMenuItems({ kind: 'path', text: 'src/app.js', st: { exists: true, isFile: true, abs: '/w/src/app.js' } });
  assert.deepEqual(labels(items), ['Open', 'Reveal in Finder', 'Copy path']);
});

test('a directory does not offer Open — ⌘click reveals it, and so does this', () => {
  const items = termMenuItems({ kind: 'path', text: 'src', st: { exists: true, isDir: true, abs: '/w/src' } });
  assert.deepEqual(labels(items), ['Reveal in Finder', 'Copy path']);
});

test('a url opens in the browser and copies as a link', () => {
  const items = termMenuItems({ kind: 'url', text: 'https://example.com', st: null });
  assert.deepEqual(labels(items), ['Open in browser', 'Copy link']);
});

test('a path whose stat missed keeps Copy and marks Open inert', () => {
  // The whole reason the menu exists. Gated on the stat it would disappear here.
  const items = termMenuItems({ kind: 'path', text: 'src/gone.js', st: null });
  assert.deepEqual(labels(items), ['Open', 'Copy path']);
  const open = items.find((i) => i !== '-' && i.label === 'Open');
  assert.equal(open.off, true);
  assert.equal(open.kb, 'not found');
  assert.equal(copyRows(items).length, 1);
});

test('every shape ends in exactly one copy row, and it is never inert', () => {
  const shapes = [
    { kind: 'path', text: 'a.js', st: { exists: true, isFile: true, abs: '/w/a.js' } },
    { kind: 'path', text: 'a', st: { exists: true, isDir: true, abs: '/w/a' } },
    { kind: 'path', text: 'gone.js', st: null },
    { kind: 'url', text: 'https://example.com', st: null },
  ];
  for (const s of shapes) {
    const items = termMenuItems(s);
    const copies = copyRows(items);
    assert.equal(copies.length, 1, 'one copy row for ' + s.text);
    assert.ok(!copies[0].off, 'copy is never inert for ' + s.text);
    assert.equal(items[items.length - 1], copies[0], 'copy is the last row for ' + s.text);
  }
});

test('copy carries the absolute path when there is one, the raw token when there is not', () => {
  const live = termMenuItems({ kind: 'path', text: '../a.js', st: { exists: true, isFile: true, abs: '/w/a.js' } });
  assert.equal(copyRows(live)[0].copy, '/w/a.js', 'a resolved path copies as the thing it resolved to');
  const dead = termMenuItems({ kind: 'path', text: '../a.js', st: null });
  assert.equal(copyRows(dead)[0].copy, '../a.js', 'an unresolved one copies what was printed');
});

test('a url copies its text, not a normalised target', () => {
  // urlTarget adds https:// for a bare www host when opening. Copy must give
  // back what was on screen, or pasting it somewhere else changes the string.
  const items = termMenuItems({ kind: 'url', text: 'www.example.com', st: null });
  assert.equal(copyRows(items)[0].copy, 'www.example.com');
});

test('there is a separator, and it never leads or trails', () => {
  for (const s of [
    { kind: 'path', text: 'a.js', st: { exists: true, isFile: true, abs: '/w/a.js' } },
    { kind: 'url', text: 'https://example.com', st: null },
    { kind: 'path', text: 'gone.js', st: null },
  ]) {
    const items = termMenuItems(s);
    assert.ok(items.includes('-'), 'has a separator');
    assert.notEqual(items[0], '-');
    assert.notEqual(items[items.length - 1], '-');
  }
});

test('the shortcuts advertised are the ones that exist', () => {
  const file = termMenuItems({ kind: 'path', text: 'a.js', st: { exists: true, isFile: true, abs: '/w/a.js' } });
  const byLabel = (l) => file.find((i) => i !== '-' && i.label === l);
  assert.equal(byLabel('Open').kb, '⌘click');
  assert.equal(byLabel('Reveal in Finder').kb, '⌥⌘click');
  const dir = termMenuItems({ kind: 'path', text: 'a', st: { exists: true, isDir: true, abs: '/w/a' } });
  // A directory has no alt route — ⌘click already reveals it.
  assert.equal(dir.find((i) => i !== '-' && i.label === 'Reveal in Finder').kb, '⌘click');
});

// Platform is a parameter, so the Windows menu is checked from a Mac. Same
// rows, same order; only the key and the word for Finder are the machine's.
test('on Windows the menu says Ctrl and File Explorer, row for row', () => {
  const shapes = [
    { kind: 'url', text: 'https://example.com', st: null },
    { kind: 'path', text: 'src\\gone.js', st: null },
    { kind: 'path', text: 'src', st: { exists: true, isDir: true, abs: 'C:\\w\\src' } },
    { kind: 'path', text: 'src\\app.js', st: { exists: true, isFile: true, abs: 'C:\\w\\src\\app.js' } },
  ];
  for (const s of shapes) {
    const mac = termMenuItems(s, 'darwin'), win = termMenuItems(s, 'win32');
    assert.equal(win.length, mac.length);
    assert.deepEqual(win.map((i) => (i === '-' ? '-' : [!!i.off, i.copy])), mac.map((i) => (i === '-' ? '-' : [!!i.off, i.copy])));
  }
  const file = termMenuItems({ kind: 'path', text: 'a.js', st: { exists: true, isFile: true, abs: 'C:\\w\\a.js' } }, 'win32');
  assert.deepEqual(file.slice(0, 2), [{ label: 'Open', kb: 'Ctrl+click' }, { label: 'Reveal in File Explorer', kb: 'Ctrl+Alt+click' }]);
  const dir = termMenuItems({ kind: 'path', text: 'a', st: { exists: true, isDir: true, abs: 'C:\\w\\a' } }, 'win32');
  assert.deepEqual(dir[0], { label: 'Reveal in File Explorer', kb: 'Ctrl+click' });
  assert.deepEqual(termMenuItems({ kind: 'url', text: 'https://example.com', st: null }, 'win32')[0], { label: 'Open in browser', kb: 'Ctrl+click' });
});

test('a Mac menu is the one it has always been, asked for by name or by default', () => {
  const s = { kind: 'path', text: 'a.js', st: { exists: true, isFile: true, abs: '/w/a.js' } };
  assert.deepEqual(termMenuItems(s, 'darwin'), termMenuItems(s));
  assert.deepEqual(termMenuItems(s, 'darwin').slice(0, 2), [{ label: 'Open', kb: '⌘click' }, { label: 'Reveal in Finder', kb: '⌥⌘click' }]);
});
