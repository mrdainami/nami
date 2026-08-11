import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, shellQuote, fileUrl } from '../src/renderer/file-kinds.mjs';

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
