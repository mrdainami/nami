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
