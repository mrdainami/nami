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

test('text colours are restricted to Nami tokens or safe CSS colours', () => {
  assert.equal(colourSpan('coral', 'important'), '<span style="color:var(--red-ink)">important</span>');
  assert.equal(colourSpan('#445566', '<unsafe>'), '<span style="color:#445566">&lt;unsafe&gt;</span>');
  assert.equal(colourSpan('url(javascript:alert(1))', 'nope'), 'nope');
});
