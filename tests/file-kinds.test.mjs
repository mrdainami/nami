import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tailPath, fileKind, shellQuote, fileUrl, pathRef } from '../src/renderer/file-kinds.mjs';

test('fileKind: images', () => {
  for (const f of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg', 'g.bmp', 'h.ico', 'i.avif'])
    assert.equal(fileKind(f), 'image', f);
});
test('fileKind: video', () => {
  for (const f of ['clip.mp4', 'clip.webm', 'clip.MOV', 'clip.m4v']) assert.equal(fileKind(f), 'video', f);
});
test('fileKind: audio', () => {
  for (const f of ['x.mp3', 'x.wav', 'x.m4a', 'x.aac', 'x.ogg', 'x.flac']) assert.equal(fileKind(f), 'audio', f);
});
test('fileKind: pdf', () => { assert.equal(fileKind('doc.PDF'), 'pdf'); });
test('fileKind: html renders, in either spelling and any case', () => {
  for (const f of ['report.html', 'index.HTM', 'dash.Html']) assert.equal(fileKind(f), 'html', f);
});
test('fileKind: everything else is text', () => {
  for (const f of ['a.ts', 'Makefile', 'notes.md', 'x.json', 'no-ext', '/tmp/.hidden'])
    assert.equal(fileKind(f), 'text', f);
});
test('fileKind: full paths use the basename', () => {
  assert.equal(fileKind('/Users/cal/My Movies/demo.mp4'), 'video');
  assert.equal(fileKind('/Users/cal/dir.mp4/readme.txt'), 'text');
});
test('shellQuote: plain path', () => { assert.equal(shellQuote('/tmp/a.txt'), "'/tmp/a.txt'"); });
test('shellQuote: spaces stay inside quotes', () => { assert.equal(shellQuote('/tmp/My File.txt'), "'/tmp/My File.txt'"); });
test('shellQuote: embedded single quote', () => { assert.equal(shellQuote("/tmp/it's.txt"), "'/tmp/it'\\''s.txt'"); });
test('fileUrl: encodes spaces, keeps slashes', () => {
  assert.equal(fileUrl('/Users/cal/My File.png'), 'file:///Users/cal/My%20File.png');
});
test('fileUrl: encodes hash and question mark', () => {
  assert.equal(fileUrl('/tmp/a#b?.png'), 'file:///tmp/a%23b%3F.png');
});

test('tailPath keeps the end of a path — the part that says which folder', () => {
  // the head is noise you already chose; the tail answers "landing where?"
  assert.equal(tailPath('/private/tmp/claude-501/-Users-cal/scratchpad/treedemo/tests'), '…/treedemo/tests');
  assert.equal(tailPath('/Users/cal/work/atlas/src/main'), '…/src/main');
});

test('tailPath leaves anything already short alone — no decorative ellipsis', () => {
  assert.equal(tailPath('/tmp/atlas'), '/tmp/atlas');
  assert.equal(tailPath('/atlas'), '/atlas');
  assert.equal(tailPath('/'), '/');
  assert.equal(tailPath(''), '');
});

test('tailPath honours the home tilde rather than printing /Users/you', () => {
  assert.equal(tailPath('~/work/atlas'), '~/work/atlas');
  assert.equal(tailPath('~/work/atlas/src/renderer'), '…/src/renderer');
});

test('tailPath takes the segment count it is given', () => {
  assert.equal(tailPath('/a/b/c/d/e', 3), '…/c/d/e');
  assert.equal(tailPath('/a/b/c/d/e', 1), '…/e');
});

test('tailPath ignores a trailing slash instead of returning an empty tail', () => {
  assert.equal(tailPath('/Users/cal/work/atlas/src/'), '…/atlas/src');
});

// ---- pathRef: what a dragged path types into a session ---------------------
const ROOT = '/Users/cal/nami';

test('pathRef: inside the open folder becomes an @ mention', () => {
  assert.equal(pathRef(ROOT + '/src/main/main.js', ROOT), '@src/main/main.js ');
  assert.equal(pathRef(ROOT + '/README.md', ROOT), '@README.md ');
});

test('pathRef: a directory keeps its trailing slash', () => {
  assert.equal(pathRef(ROOT + '/src/renderer', ROOT, true), '@src/renderer/ ');
});

test('pathRef: outside the open folder falls back to a quoted absolute path', () => {
  assert.equal(pathRef('/Users/cal/Desktop/shot.png', ROOT), "'/Users/cal/Desktop/shot.png' ");
});

test('pathRef: a sibling folder with the same prefix is NOT inside', () => {
  // '/Users/cal/nami-other' starts with '/Users/cal/nami' as a string but is a
  // different folder — the boundary has to be the separator, not the prefix.
  assert.equal(pathRef('/Users/cal/nami-other/x.js', ROOT), "'/Users/cal/nami-other/x.js' ");
});

test('pathRef: whitespace in the relative path falls back to quoting', () => {
  // '@my notes.md' breaks at the space in a shell and in every mention parser;
  // the quoted absolute already works in all six launches.
  assert.equal(pathRef(ROOT + '/my notes.md', ROOT), "'/Users/cal/nami/my notes.md' ");
  assert.equal(pathRef(ROOT + '/src/My Docs/a.md', ROOT), "'/Users/cal/nami/src/My Docs/a.md' ");
});

test('pathRef: spaces in the ROOT do not spoil the mention', () => {
  // the mention is relative, so only the part below the root has to be clean —
  // this is the case a quoted absolute path handles worse, not better
  assert.equal(pathRef('/Users/cal/My Project/src/a.js', '/Users/cal/My Project'), '@src/a.js ');
});

test('pathRef: a root given with a trailing slash still matches', () => {
  assert.equal(pathRef(ROOT + '/src/a.js', ROOT + '/'), '@src/a.js ');
});

test('pathRef: the root itself has no relative form, so it quotes', () => {
  assert.equal(pathRef(ROOT, ROOT), "'/Users/cal/nami' ");
});

test('pathRef: no open folder means every path quotes', () => {
  assert.equal(pathRef('/Users/cal/nami/src/a.js', ''), "'/Users/cal/nami/src/a.js' ");
  assert.equal(pathRef('/Users/cal/nami/src/a.js', null), "'/Users/cal/nami/src/a.js' ");
});

test('pathRef: backslash paths are not POSIX, so they quote rather than guess', () => {
  // fileUrl and docUrl are POSIX-only for the same reason; a Windows path has no
  // relative form this function is willing to invent.
  assert.equal(pathRef('C:\\Users\\cal\\x.js', 'C:\\Users\\cal'), "'C:\\Users\\cal\\x.js' ");
});

test('pathRef: an embedded quote survives the fallback', () => {
  assert.equal(pathRef("/Users/cal/it's.txt", ROOT), "'/Users/cal/it'\\''s.txt' ");
});

test('pathRef: a shell metacharacter never rides out unquoted', () => {
  // The mention goes to a live pty for a terminal session. dropFilesOnPanel has
  // always quoted for this reason; the mention branch must not be the hole.
  // A repo you cloned can contain any of these.
  for (const name of ['$(id).txt', '`id`.md', 'a;whoami.txt', 'a&&b.md', 'a|b.md',
                      'a>out.md', 'a<in.md', "it's.md", 'a*.md', 'a?.md', 'a!.md',
                      'a#b.md', '~evil.md', 'a{b}.md', 'a[b].md', 'a"b.md']) {
    const out = pathRef(ROOT + '/' + name, ROOT);
    assert.equal(out[0], "'", name + ' must quote, got ' + out);
    assert.ok(!out.startsWith('@'), name + ' must not become a mention');
  }
});

test('pathRef: a newline in a name never rides out unquoted either', () => {
  // "nothing sends" is the promise; a raw newline at a pty prompt breaks it
  const out = pathRef(ROOT + '/a\nwhoami', ROOT);
  assert.ok(!out.startsWith('@'), 'newline must not become a mention');
});

test('pathRef: ordinary names are still mentions, punctuation and all', () => {
  // the guard must not be so broad that real filenames stop mentioning
  for (const name of ['main.js', 'file-kinds.mjs', 'my_file.txt', 'a.b.c.json',
                      'v1.2+build', 'CHANGELOG', '@scope/pkg.json'])
    assert.equal(pathRef(ROOT + '/' + name, ROOT), '@' + name + ' ', name);
});

test('pathRef: non-ASCII names still mention rather than degrading to a path', () => {
  assert.equal(pathRef(ROOT + '/仕様書.md', ROOT), '@仕様書.md ');
  assert.equal(pathRef(ROOT + '/café/notes.md', ROOT), '@café/notes.md ');
});

test('pathRef: a project opened at the volume root quotes everything', () => {
  // Pathological but pinned, so it is a decision rather than an accident: '/'
  // normalises to an empty root, and an empty root means no relative form.
  assert.equal(pathRef('/etc/hosts', '/'), "'/etc/hosts' ");
});

test('pathRef: an out-of-root folder gets no trailing slash', () => {
  // it is an absolute path, not a mention — the slash only disambiguates a
  // mention, and adding one here would just be a path that does not exist
  assert.equal(pathRef('/tmp/foo', ROOT, true), "'/tmp/foo' ");
});
