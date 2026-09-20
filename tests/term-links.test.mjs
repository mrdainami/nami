import test from 'node:test';
import assert from 'node:assert/strict';
import { scanLinks } from '../src/renderer/term-links.mjs';

const kinds = (s) => scanLinks(s).map((l) => `${l.kind}:${l.text}`);

test('a URL is one whole link, scheme included', () => {
  assert.deepEqual(kinds('See https://opencode.ai/docs/themes for details'),
    ['url:https://opencode.ai/docs/themes']);
});

test('the path matcher never eats a URL', () => {
  // the old regex turned this into the bogus file path /opencode.ai/docs/themes
  const found = scanLinks('open https://opencode.ai/docs/themes now');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'url');
});

test('a localhost dev server is a link, with or without a scheme', () => {
  assert.deepEqual(kinds('Docs at http://localhost:3000/preview'), ['url:http://localhost:3000/preview']);
  assert.deepEqual(kinds('serving on localhost:5173'), ['url:localhost:5173']);
});

test('file paths still resolve, in every shape an agent prints them', () => {
  assert.deepEqual(kinds('Updated /Users/cal/dainami-cli/src/renderer/app.js'),
    ['path:/Users/cal/dainami-cli/src/renderer/app.js']);
  assert.deepEqual(kinds('the file is at ~/.config/opencode/opencode.jsonc'),
    ['path:~/.config/opencode/opencode.jsonc']);
  assert.deepEqual(kinds('⏺ Read(src/renderer/paper.css)'), ['path:src/renderer/paper.css']);
});

test('a file:line reference links the file and remembers the line', () => {
  const [l] = scanLinks('Read src/main/main.js:585 and fix it');
  assert.equal(l.kind, 'path');
  assert.equal(l.text, 'src/main/main.js');
  assert.equal(l.line, 585);
  const [c] = scanLinks('app.js:883:12 is the spot');
  assert.equal(c.line, 883);
  assert.equal(c.col, 12);
});

test('closing punctuation is not part of the link', () => {
  assert.deepEqual(kinds('(see https://opencode.ai/docs).'), ['url:https://opencode.ai/docs']);
  assert.deepEqual(kinds('edited src/renderer/app.js, then ran tests'), ['path:src/renderer/app.js']);
  assert.deepEqual(kinds('"src/main/main.js"'), ['path:src/main/main.js']);
});

test('offsets point at the link inside the line', () => {
  const line = 'Updated src/renderer/app.js today';
  const [l] = scanLinks(line);
  assert.equal(line.slice(l.start, l.end), 'src/renderer/app.js');
});

test('prose is not a link', () => {
  assert.deepEqual(kinds('Nothing else — just this single issue ready to go out.'), []);
  assert.deepEqual(kinds('e.g. the theme is fine'), []);
  assert.deepEqual(kinds('i.e. done'), []);
});

test('several links on one line all come back, in order', () => {
  const found = scanLinks('src/main/main.js and https://opencode.ai/docs and app.js');
  assert.deepEqual(found.map((l) => l.kind), ['path', 'url', 'path']);
  assert.ok(found[0].start < found[1].start && found[1].start < found[2].start);
});

// ---- Windows ---------------------------------------------------------------
// The platform is named on every call: a backslash is a separator on Windows
// and an ordinary character everywhere else, so the same line reads two ways.
const winKinds = (s) => scanLinks(s, 'win32').map((l) => `${l.kind}:${l.text}`);

test('windows: a drive path is one whole link', () => {
  assert.deepEqual(winKinds('Updated C:\\src\\app.js'), ['path:C:\\src\\app.js']);
  assert.deepEqual(winKinds('Updated C:/src/app.js today'), ['path:C:/src/app.js']);
  assert.deepEqual(winKinds('wrote C:\\Users\\cal\\nami\\src\\renderer\\app.js.'), ['path:C:\\Users\\cal\\nami\\src\\renderer\\app.js']);
  assert.deepEqual(winKinds('Read(D:\\work\\notes.md)'), ['path:D:\\work\\notes.md']);
  // printed as JSON, every backslash arrives doubled; the disk reads it the same
  assert.deepEqual(winKinds('"file_path": "C:\\\\src\\\\app.js",'), ['path:C:\\\\src\\\\app.js']);
});

test('windows: relative paths, dotted or bare, with either separator', () => {
  assert.deepEqual(winKinds('see .\\src\\app.js'), ['path:.\\src\\app.js']);
  assert.deepEqual(winKinds('see ..\\shared\\util.mjs'), ['path:..\\shared\\util.mjs']);
  assert.deepEqual(winKinds('see src\\app.js'), ['path:src\\app.js']);
  assert.deepEqual(winKinds('in ~\\.config\\opencode\\opencode.jsonc now'), ['path:~\\.config\\opencode\\opencode.jsonc']);
  assert.deepEqual(winKinds('in .github\\workflows\\ci.yml'), ['path:.github\\workflows\\ci.yml']);
  assert.deepEqual(winKinds('a folder: node_modules\\xterm\\lib'), ['path:node_modules\\xterm\\lib']);
  assert.deepEqual(winKinds('mixed src/renderer\\app.js'), ['path:src/renderer\\app.js']);
});

test('windows: a network share is a link', () => {
  assert.deepEqual(winKinds('copied to \\\\server\\share\\file.txt'), ['path:\\\\server\\share\\file.txt']);
  assert.deepEqual(winKinds('from \\\\Mac\\Home\\Documents\\a.md, then'), ['path:\\\\Mac\\Home\\Documents\\a.md']);
  assert.deepEqual(winKinds('\\\\nas\\c$\\logs\\out.log'), ['path:\\\\nas\\c$\\logs\\out.log']);
});

test('windows: file:line:col survives a drive letter and a backslash', () => {
  const [a] = scanLinks('at C:\\src\\app.js:12:3 it throws', 'win32');
  assert.equal(a.text, 'C:\\src\\app.js');
  assert.equal(a.line, 12);
  assert.equal(a.col, 3);
  const [b] = scanLinks('src\\app.js:12:3', 'win32');
  assert.equal(b.text, 'src\\app.js');
  assert.equal(b.line, 12);
  assert.equal(b.col, 3);
  const [c] = scanLinks('.\\src\\main.js:585 and fix it', 'win32');
  assert.equal(c.text, '.\\src\\main.js');
  assert.equal(c.line, 585);
  assert.equal(c.col, undefined);
});

test('windows: offsets point at the link inside the line', () => {
  const line = 'Updated C:\\src\\app.js today';
  const [l] = scanLinks(line, 'win32');
  assert.equal(line.slice(l.start, l.end), 'C:\\src\\app.js');
});

test('windows: prose, switches, dates and escapes are not links', () => {
  assert.deepEqual(winKinds('Nothing else — just this single issue ready to go out.'), []);
  assert.deepEqual(winKinds('e.g. the theme is fine'), []);
  assert.deepEqual(winKinds('yes and\\or no'), [], 'one backslash between two plain words is prose');
  assert.deepEqual(winKinds('dir /s /b'), []);
  assert.deepEqual(winKinds('xcopy /e /y'), []);
  assert.deepEqual(winKinds('on 20\\09\\2026 it shipped'), [], 'nothing but digits is a date');
  assert.deepEqual(winKinds('print "line one\\nline two"'), []);
  assert.deepEqual(winKinds('use \\n for a newline and \\t for a tab'), []);
  assert.deepEqual(winKinds('ratio a:b is fine'), []);
  assert.deepEqual(winKinds('note:\\tindented'), [], 'a colon after a word is not a drive');
});

test('windows: everything the Mac links, Windows links too', () => {
  assert.deepEqual(winKinds('See https://opencode.ai/docs/themes for details'), ['url:https://opencode.ai/docs/themes']);
  assert.deepEqual(winKinds('serving on localhost:5173'), ['url:localhost:5173']);
  assert.deepEqual(winKinds('⏺ Read(src/renderer/paper.css)'), ['path:src/renderer/paper.css']);
  assert.deepEqual(winKinds('the file is at ~/.config/opencode/opencode.jsonc'), ['path:~/.config/opencode/opencode.jsonc']);
  assert.deepEqual(winKinds('app.js:883:12 is the spot'), ['path:app.js']);
  for (const s of ['09/20/2026', 'and/or', 'ipconfig /all']) assert.deepEqual(winKinds(s), kinds(s), 'a forward slash reads as it does on the Mac: ' + s);
});

test('off Windows a backslash is still just a character', () => {
  // byte for byte what these lines gave before Windows was taught anything
  assert.deepEqual(kinds('Updated C:\\src\\app.js'), ['path:app.js']);
  assert.deepEqual(kinds('see src\\app.js'), ['path:app.js']);
  assert.deepEqual(kinds('copied to \\\\server\\share\\file.txt'), ['path:file.txt']);
  assert.deepEqual(scanLinks('see src\\app.js', 'darwin'), scanLinks('see src\\app.js'));
});
