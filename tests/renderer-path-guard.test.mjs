// The renderer reads file paths through src/renderer/paths.mjs, checked rather
// than remembered.
//
// Nami shipped for the Mac with about thirty places that took `/` for the only
// separator and built file:// URLs by gluing strings. Each one was correct on a
// Mac, so nothing ever failed, and on Windows every one of them was a bug: whole
// paths for names in the tree, no clickable path in a terminal, no image in a
// chat. They were found by grep, one port late.
//
// So the grep runs here, every time. A line in src/renderer that splits, tests
// or glues a path by hand fails until it goes through paths.mjs — or until a
// person decides it is not a file path at all and says so below. A URL has
// slashes on every platform, and so does a /command; those are what the
// allowlist is for, and it is short on purpose.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDERER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer');

// The one file allowed to know what a separator is, and code we did not write.
const EXEMPT_FILES = new Set(['paths.mjs']);
const EXEMPT_DIRS = new Set(['vendor']);

// What a hand-rolled path looks like. Quotes of any kind, because the habit
// does not care which.
const Q = '([\'"`])';
const BANNED = [
  { name: "split('/')", re: new RegExp('\\.split\\(\\s*' + Q + '\\/\\1\\s*\\)') },
  { name: "lastIndexOf('/')", re: new RegExp('\\.lastIndexOf\\(\\s*' + Q + '\\/\\1') },
  { name: "indexOf('/')", re: new RegExp('\\.indexOf\\(\\s*' + Q + '\\/\\1') },
  { name: "startsWith('/')", re: new RegExp('\\.startsWith\\(\\s*' + Q + '\\/\\1') },
  { name: "'file://' +", re: new RegExp(Q + 'file:\\/\\/\\/?\\1\\s*\\+') },
  { name: '`file://${…}`', re: /`file:\/\/\/?\$\{/ },
];

// Slashes that are not a file path. Keyed by file and by a piece of the line,
// never by line number — a line number is wrong by the next commit. Every entry
// says what the slash really is, and an entry that no longer matches anything
// fails the last test here, so the list cannot quietly outlive its reasons.
//
// Empty today. The two entries it opened with were a connector's docs URL being
// split for its last segment; that moved to the main process with the rest of
// the connector install, and the test below made sure they left with it.
//   { file: 'x.mjs', snippet: "url.split('/').pop()", why: 'last segment of a URL' },
const ALLOWED = [];

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

// A comment may say split('/') as often as it likes; only code is held to this.
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

function findHits() {
  const hits = [];
  for (const { file, text } of sources(RENDERER)) {
    text.split('\n').forEach((line, i) => {
      if (isComment(line)) return;
      for (const b of BANNED) if (b.re.test(line)) hits.push({ file, line: i + 1, what: b.name, code: line.trim() });
    });
  }
  return hits;
}

const allowedBy = (hit) => ALLOWED.find((a) => a.file === hit.file && hit.code.includes(a.snippet));

test('the guard can still see what it is guarding against', () => {
  // If a pattern rots, the scan below passes for the wrong reason.
  const bad = [
    "const name = p.split('/').pop();",
    'const name = p.split("/").pop();',
    "const dir = p.slice(0, p.lastIndexOf('/'));",
    "if (run.text.indexOf('/') !== -1) {",
    "if (t.startsWith('/')) open(t);",
    "img.src = 'file://' + encodeURI(path);",
    'img.src = "file://" + path;',
    'img.src = `file://${path}`;',
  ];
  for (const line of bad) assert.ok(BANNED.some((b) => b.re.test(line)), 'not caught: ' + line);
  const fine = [
    "input.value = '/' + name + ' ';",
    "const name = baseName(p);",
    "if (/^https?:\\/\\//.test(url)) api.openLink(url);",
    "const parts = text.split('\\n');",
  ];
  for (const line of fine) assert.ok(!BANNED.some((b) => b.re.test(line)), 'wrongly caught: ' + line);
});

test('no renderer code takes a file path apart by hand', () => {
  const stray = findHits().filter((h) => !allowedBy(h));
  assert.deepEqual(stray, [], stray.length
    ? 'These read a path as if `/` were the only separator:\n'
      + stray.map((h) => `  src/renderer/${h.file}:${h.line}  ${h.what}\n      ${h.code}`).join('\n')
      + '\n\nOn Windows a path is C:\\Users\\you\\file.txt, and a file URL is file:///C:/Users/you/file.txt.\n'
      + 'Use src/renderer/paths.mjs — baseName, dirName, isAbsolute, join, isInside, toFileUrl\n'
      + 'and the rest — which takes the platform into account and is tested for both.\n'
      + 'If the slash is not a file path at all (a URL, a /command), add the line to\n'
      + 'ALLOWED in this file, with what it really is.'
    : '');
});

test('every allowlist entry still earns its place', () => {
  const hits = findHits();
  const idle = ALLOWED.filter((a) => !hits.some((h) => h.file === a.file && h.code.includes(a.snippet)));
  assert.deepEqual(idle, [], 'Allowed but no longer in the code — take these out of ALLOWED: '
    + idle.map((a) => a.file + ' · ' + a.snippet).join(', '));
});
