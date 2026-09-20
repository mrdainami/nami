import test from 'node:test';
import assert from 'node:assert/strict';

import {
  richMarkdownPath,
  editorModesFor,
  markdownImageUrl,
  colourSpan,
} from '../src/renderer/markdown-rich.mjs';

test('rich editing is deliberately limited to markdown, not mdx or other text', () => {
  assert.equal(richMarkdownPath('/p/readme.md'), true);
  assert.equal(richMarkdownPath('/p/README.markdown'), true);
  assert.equal(richMarkdownPath('/p/page.mdx'), false);
  assert.equal(richMarkdownPath('/p/note.txt'), false);
});

test('only rich markdown gets the three explicit document modes', () => {
  assert.deepEqual(editorModesFor('/p/readme.md'), ['read', 'edit', 'markdown']);
  assert.deepEqual(editorModesFor('/p/page.mdx'), ['read', 'markdown']);
  assert.deepEqual(editorModesFor('/p/page.html'), ['read', 'markdown']);
  assert.deepEqual(editorModesFor('/p/note.txt'), ['markdown']);
});

test('Markdown image URLs resolve beside the note without double-encoding spaces', () => {
  assert.equal(
    markdownImageUrl('/p/docs/note.md', './assets/my%20diagram.png'),
    'nami-doc://doc/%2Fp%2Fdocs/./assets/my%20diagram.png',
  );
  assert.equal(markdownImageUrl('/p/docs/note.md', 'https://example.com/image.png'), 'https://example.com/image.png');
  assert.equal(markdownImageUrl('/p/docs/note.md', '/Users/me/image.png'), null);
});

test('windows: Markdown image URLs carry the folder whole and the rest in slashes', () => {
  const root = encodeURIComponent('C:\\p\\my docs');
  assert.equal(markdownImageUrl('C:\\p\\my docs\\note.md', './assets/my%20diagram.png', 'win32'),
    'nami-doc://doc/' + root + '/./assets/my%20diagram.png');
  assert.equal(markdownImageUrl('C:\\p\\my docs\\note.md', 'assets\\shot one.png', 'win32'),
    'nami-doc://doc/' + root + '/assets/shot%20one.png', 'a backslash in the source is a separator there');
  assert.equal(markdownImageUrl('C:\\note.md', 'a.png', 'win32'), 'nami-doc://doc/' + encodeURIComponent('C:\\') + '/a.png');
  assert.equal(markdownImageUrl('C:\\p\\note.md', 'https://example.com/image.png', 'win32'), 'https://example.com/image.png');
  // a place of its own is not the document's to serve
  assert.equal(markdownImageUrl('C:\\p\\note.md', 'D:\\pics\\a.png', 'win32'), null);
  assert.equal(markdownImageUrl('C:\\p\\note.md', 'D:/pics/a.png', 'win32'), null);
  assert.equal(markdownImageUrl('C:\\p\\note.md', '\\\\nas\\pics\\a.png', 'win32'), null);
  assert.equal(markdownImageUrl('C:\\p\\note.md', '/Users/me/image.png', 'win32'), null);
  assert.equal(markdownImageUrl('C:\\p\\note.md', '~\\a.png', 'win32'), null);
});

test('windows: the main process reads a Markdown image URL back to the same file',
  { skip: process.platform !== 'win32' && 'parseDocUrl asks the real path module whether C:\\ is absolute; only Windows says yes' }, async () => {
    const { createRequire } = await import('node:module');
    const { parseDocUrl } = createRequire(import.meta.url)('../src/main/doc-protocol.js');
    assert.deepEqual(parseDocUrl(markdownImageUrl('C:\\p\\my docs\\note.md', 'assets\\shot one.png', 'win32')),
      { root: 'C:\\p\\my docs', rel: 'assets/shot one.png' });
  });

test('text colours are restricted to Nami tokens or safe CSS colours', () => {
  assert.equal(colourSpan('coral', 'important'), '<span style="color:var(--red-ink)">important</span>');
  assert.equal(colourSpan('#445566', '<unsafe>'), '<span style="color:#445566">&lt;unsafe&gt;</span>');
  assert.equal(colourSpan('url(javascript:alert(1))', 'nope'), 'nope');
});
