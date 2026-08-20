import test from 'node:test';
import assert from 'node:assert/strict';

import {
  richMarkdownPath,
  editorModesFor,
  relativeMarkdownPath,
  markdownImageUrl,
  markdownAssetKind,
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

test('picked assets become portable document-relative markdown paths', () => {
  assert.equal(relativeMarkdownPath('/p/docs/note.md', '/p/docs/image.png'), './image.png');
  assert.equal(relativeMarkdownPath('/p/docs/note.md', '/p/assets/demo.mp4'), '../assets/demo.mp4');
  assert.equal(relativeMarkdownPath('/p/docs/note.md', '/p/docs/diagrams/flow.svg'), './diagrams/flow.svg');
  assert.equal(relativeMarkdownPath('/p/docs/note.md', 'https://example.com/a.png'), 'https://example.com/a.png');
});

test('Markdown image URLs resolve beside the note without double-encoding spaces', () => {
  assert.equal(
    markdownImageUrl('/p/docs/note.md', './assets/my%20diagram.png'),
    'nami-doc://doc/%2Fp%2Fdocs/./assets/my%20diagram.png',
  );
  assert.equal(markdownImageUrl('/p/docs/note.md', 'https://example.com/image.png'), 'https://example.com/image.png');
  assert.equal(markdownImageUrl('/p/docs/note.md', '/Users/me/image.png'), null);
});

test('asset kinds stay small and predictable', () => {
  assert.equal(markdownAssetKind('./shot.png'), 'image');
  assert.equal(markdownAssetKind('./walkthrough.MP4?raw=1'), 'video');
  assert.equal(markdownAssetKind('./notes.md'), 'markdown');
  assert.equal(markdownAssetKind('./archive.zip'), 'file');
});

test('text colours are restricted to Nami tokens or safe CSS colours', () => {
  assert.equal(colourSpan('coral', 'important'), '<span style="color:var(--red-ink)">important</span>');
  assert.equal(colourSpan('#445566', '<unsafe>'), '<span style="color:#445566">&lt;unsafe&gt;</span>');
  assert.equal(colourSpan('url(javascript:alert(1))', 'nope'), 'nope');
});
