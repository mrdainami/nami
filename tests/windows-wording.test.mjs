// No Mac word reaches a Windows screen, checked rather than remembered.
//
// Nami learned to talk on a Mac: "Reveal in Finder", "on this Mac", ⌘N. About
// seventy strings said so, and on Windows each one is a small lie — there is no
// Finder to reveal in and no ⌘ key to press. They all moved onto
// src/renderer/platform-words.mjs. This file is what keeps them there, in two
// halves:
//
//   1. Everything a module can be asked to say for 'win32' under plain node —
//      the shortcuts sheet, the library shelves, the link menu and hint, the
//      usage pane, the microphone errors, the application menu, the words
//      themselves — is collected and read for Mac words.
//   2. app.js and the other screens cannot be imported without a window, so
//      their source is read instead, the way renderer-path-guard.test.mjs reads
//      it for hand-rolled paths. A Mac word in code, outside a comment, fails
//      until it comes from platform-words.mjs — or until a person says below
//      why it can never be seen on Windows.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { words, kb, clickWith, chordText, APP_CHORDS } from '../src/renderer/platform-words.mjs';
import { shortcutGroups, openOutputCopy } from '../src/renderer/shortcuts.mjs';
import { shelfGroups } from '../src/renderer/library-groups.mjs';
import { termMenuItems } from '../src/renderer/term-menu.mjs';
import { linkHintText } from '../src/renderer/link-hint.mjs';
import { usageContent } from '../src/renderer/usage-pane.mjs';
import { micErrorText } from '../src/renderer/mic-error.mjs';
import appMenu from '../src/main/app-menu.js';

const RENDERER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer');

// What a Mac says and Windows does not. "Mac" as a word of its own, so that
// `maybeLoadMac` and a MAC address are not what this is about.
const MAC_WORDS = [
  { name: 'Mac', re: /\bMac\b/ },
  { name: 'macOS', re: /\bmacOS\b/ },
  { name: 'Finder', re: /\bFinder\b/ },
  { name: 'Keychain', re: /\bKeychain\b/ },
  { name: 'Dock', re: /\bDock\b/ },
  { name: 'a Mac key glyph', re: /[⌘⌥⇧⌃⌫⌦↵⇥]/ },
];
const macWordsIn = (text) => MAC_WORDS.filter((w) => w.re.test(text)).map((w) => w.name);

// ---- 1 · what the modules say ----------------------------------------------

// Every string inside a value, however it is nested.
function stringsIn(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringsIn(v, out));
  return out;
}

const LINK_SHAPES = [
  { kind: 'url', text: 'https://example.com', st: null },
  { kind: 'path', text: 'src\\gone.js', st: null },
  { kind: 'path', text: 'src\\gone.js', st: { exists: false } },
  { kind: 'path', text: 'src', st: { exists: true, isDir: true, abs: 'C:\\w\\src' } },
  { kind: 'path', text: 'src\\app.js', st: { exists: true, isFile: true, abs: 'C:\\w\\src\\app.js' } },
];

const USAGE = {
  accounts: [
    { id: 'a', providerId: 'claude', providerName: 'Claude', accountId: 'claude:local', name: 'Claude', windowLabel: '5 hours', windowKey: '5h', remaining: 40, status: 'ok' },
    { id: 'b', providerId: 'codex', providerName: 'Codex', name: 'Codex', status: 'unavailable' },
    { id: 'c', providerId: 'grok', providerName: 'Grok', name: 'Grok', status: 'unavailable' },
  ],
};

const MIC_ERRORS = ['NotAllowedError', 'NotReadableError', 'SecurityError', 'NotFoundError', 'OverconstrainedError']
  .map((name) => Object.assign(new Error('x'), { name }));

function everythingSaid(platform) {
  const menu = appMenu.menuItems(appMenu.buildMenuTemplate({ open() {}, send() {}, newWindow() {}, platform }));
  return stringsIn([
    words(platform),
    Object.keys(APP_CHORDS).map((name) => chordText(name, platform)),
    kb(['⇧', '⌘', '↵'], platform), kb(['⇧', '⇥'], platform), clickWith(['⌥', '⌘'], platform),
    shortcutGroups(platform), openOutputCopy(platform),
    shelfGroups(platform).map((g) => g.label),
    LINK_SHAPES.map((s) => termMenuItems(s, platform)),
    LINK_SHAPES.map((s) => linkHintText(s, platform)),
    usageContent(USAGE, platform), usageContent({}, platform),
    MIC_ERRORS.map((e) => micErrorText(e, platform)),
    menu.map((item) => item.label).filter(Boolean),
  ]);
}

test('the collector really hears the app: on a Mac it finds the Mac words', () => {
  // If this goes quiet the test below passes for the wrong reason.
  const said = everythingSaid('darwin').join('\n');
  for (const must of ['Reveal in Finder', 'Agents on this Mac', '⌘click', '⌥⌘ Click to reveal in Finder', 'installed on this Mac', 'No quota on this Mac yet', '⌘ Command']) {
    assert.ok(said.includes(must), 'never heard: ' + must);
  }
});

test('nothing a module says on Windows is a Mac word', () => {
  const stray = everythingSaid('win32').filter((s) => macWordsIn(s).length);
  assert.deepEqual(stray, [], 'Said on Windows:\n' + stray.map((s) => '  ' + s.slice(0, 140)).join('\n'));
});

test('and Windows hears its own words in their place', () => {
  const said = everythingSaid('win32').join('\n');
  for (const must of ['Reveal in File Explorer', 'Agents on this PC', 'Ctrl+click', 'Ctrl+Alt+Click to reveal in File Explorer', 'installed on this PC', 'No quota on this PC yet', 'Ctrl+Shift+T']) {
    assert.ok(said.includes(must), 'never heard: ' + must);
  }
});

// ---- 2 · what the source says ----------------------------------------------

// The one file allowed to spell a Mac word out, and code we did not write.
const EXEMPT_FILES = new Set(['platform-words.mjs']);
const EXEMPT_DIRS = new Set(['vendor']);

// Mac words that can stay where they are. Keyed by file and by a piece of the
// line, never by line number. Every entry says why a Windows user cannot see
// it, and an entry that no longer matches anything fails the last test here.
const ALLOWED = [
  { file: 'browser-pane.mjs', snippet: "keychain:'Waiting for Keychain'",
    why: "the import worker only reports the 'keychain' stage for cookies and passwords, and importCapability refuses both on Windows (browser-import-worker.js)" },
  { file: 'browser-pane.mjs', snippet: "'Unlock macOS Keychain to import saved passwords.'",
    why: 'the browser import screens belong to the browser-import work, which decides per platform what is offered; this tooltip names macOS outright' },
  { file: 'browser-pane.mjs', snippet: 'Allow Keychain access if macOS asks.',
    why: 'same screen: shown only when nothing is unavailable, and on Windows the sign-in categories always are' },
];

function sources(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { if (!EXEMPT_DIRS.has(entry.name)) out.push(...sources(path.join(dir, entry.name), at)); continue; }
    if (!/\.(mjs|js|html)$/.test(entry.name) || EXEMPT_FILES.has(at)) continue;
    out.push({ file: at, text: fs.readFileSync(path.join(dir, entry.name), 'utf8') });
  }
  return out;
}

// A comment may say Finder as often as it likes; only code is held to this.
// That is whole-line comments, and a `// …` trailing a statement — with a space
// before it, so the slashes of https:// are not taken for one.
const isComment = (line) => /^\s*(\/\/|\*|\/\*|<!--)/.test(line);
const codeOf = (line) => line.replace(/\s\/\/\s.*$/, '')
  // Glyphs handed TO platform-words are its input, not something on screen:
  // kb(['⇧', '⌘', '↵']) prints Ctrl+Shift+Enter on Windows.
  .replace(/\b(kb|keys|clickWith|k)\(\[[^\]]*\]/g, '$1([');

function findHits() {
  const hits = [];
  for (const { file, text } of sources(RENDERER)) {
    text.split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      for (const what of macWordsIn(codeOf(line))) hits.push({ file, line: i + 1, what, code: line.trim().slice(0, 200) });
    });
  }
  return hits;
}

const allowedBy = (hit) => ALLOWED.find((a) => a.file === hit.file && hit.code.includes(a.snippet));

test('the guard can still see what it is guarding against', () => {
  const bad = [
    "items.push({ label: 'Reveal in Finder', run });",
    'row.innerHTML = `<span class="desc">looking for agents on this Mac…</span>`;',
    "toast('Open it from ⌘N — new session, pick the agent.');",
    '<span class="kbd">opens the Mac dialog</span>',
    "title = 'Unlock macOS Keychain first';",
    'Open Nami from the Dock and it will not be there.',
    '<button class="btn">Save ⌘S</button>',
  ];
  for (const line of bad) assert.ok(macWordsIn(codeOf(line)).length, 'not caught: ' + line);
  const fine = [
    "items.push({ label: W.reveal, run });",
    'row.innerHTML = `<span class="desc">looking for agents on ${W.thisMac}…</span>`;',
    "if (keepMac) await loadMacLibrary(); else maybeLoadMac();",
    "const cardFinder = q('.card-finder', wrap);",
    "button.textContent = 'Add to session… ' + kb(['⇧', '⌘', '↵'], api.platform);",
    "refreshAgents();   // pre-detect so ⌘N is instant",
    "api.openUrl('https://nami.dainami.ai/docs/'); // the Mac page",
  ];
  for (const line of fine) assert.deepEqual(macWordsIn(codeOf(line)), [], 'wrongly caught: ' + line);
});

test('no renderer code spells out a Mac word that Windows would read', () => {
  const stray = findHits().filter((h) => !allowedBy(h));
  assert.deepEqual(stray, [], stray.length
    ? 'These would show a Mac word on Windows:\n'
      + stray.map((h) => `  src/renderer/${h.file}:${h.line}  ${h.what}\n      ${h.code}`).join('\n')
      + '\n\nUse src/renderer/platform-words.mjs: words(platform).thisMac / .finder / .reveal,\n'
      + 'kb([…]) for a chord written in Mac glyphs, chordText(name) for one of Nami\'s own.\n'
      + 'The Mac column there is what the Mac has always printed, so nothing changes on a Mac.\n'
      + 'If Windows can never see the line, add it to ALLOWED in this file and say why.'
    : '');
});

test('every allowlist entry still earns its place', () => {
  const hits = findHits();
  const idle = ALLOWED.filter((a) => !hits.some((h) => h.file === a.file && h.code.includes(a.snippet)));
  assert.deepEqual(idle, [], 'Allowed but no longer in the code — take these out of ALLOWED: '
    + idle.map((a) => a.file + ' · ' + a.snippet).join(', '));
});

test('the Start Here note written into a new project speaks to the machine it is on', async () => {
  const { createRequire } = await import('node:module');
  const { startHereNote } = createRequire(import.meta.url)('../src/main/start-here.js');
  const win = startHereNote('demo', 'win32');
  assert.doesNotMatch(win, /\bMac\b|⌘|Finder/);
  assert.match(win, /nowhere else on your PC/);
  assert.match(win, /\*\*Ctrl\+Shift\+T\*\*/);   // the form that works with a terminal focused
  const mac = startHereNote('demo', 'darwin');
  assert.match(mac, /nowhere else on your Mac/);
  assert.match(mac, /\*\*⌘N\*\*/);
});
