import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, highlightMarkdown, docHrefTarget } from '../src/renderer/md.mjs';

// ---- what a clicked link in the Read view means ---------------------------

test('a web link goes to the browser', () => {
  assert.deepEqual(docHrefTarget('https://opencode.ai/docs', '/p/README.md'),
    { kind: 'url', target: 'https://opencode.ai/docs' });
  assert.deepEqual(docHrefTarget('www.opencode.ai', '/p/README.md'),
    { kind: 'url', target: 'https://www.opencode.ai' });
});

test('a link to another file opens here, resolved next to the doc', () => {
  assert.deepEqual(docHrefTarget('docs/spec.md', '/p/README.md'),
    { kind: 'path', target: '/p/docs/spec.md' });
  assert.deepEqual(docHrefTarget('./spec.md', '/p/docs/README.md'),
    { kind: 'path', target: '/p/docs/spec.md' });
  assert.deepEqual(docHrefTarget('../notes.md', '/p/docs/README.md'),
    { kind: 'path', target: '/p/notes.md' });
  assert.deepEqual(docHrefTarget('/abs/x.md', '/p/README.md'),
    { kind: 'path', target: '/abs/x.md' });
  assert.deepEqual(docHrefTarget('~/.claude/CLAUDE.md', '/p/README.md'),
    { kind: 'path', target: '~/.claude/CLAUDE.md' });
});

test('a heading link stays inside the doc', () => {
  assert.deepEqual(docHrefTarget('#install', '/p/README.md'), { kind: 'anchor', target: 'install' });
});

test('a file link drops its heading and decodes escapes', () => {
  assert.deepEqual(docHrefTarget('spec.md#usage', '/p/README.md'),
    { kind: 'path', target: '/p/spec.md' });
  assert.deepEqual(docHrefTarget('./my%20notes.md', '/p/README.md'),
    { kind: 'path', target: '/p/my notes.md' });
});

test('anything that is not a page or a file is ignored', () => {
  // no scheme may ever reach the shell — this is the one that matters
  assert.equal(docHrefTarget('javascript:alert(1)', '/p/README.md').kind, 'ignore');
  assert.equal(docHrefTarget('mailto:cal@dainami.ai', '/p/README.md').kind, 'ignore');
  assert.equal(docHrefTarget('', '/p/README.md').kind, 'ignore');
  assert.equal(docHrefTarget('vscode://file/x', '/p/README.md').kind, 'ignore');
});

test('a doc with no path of its own still resolves what it can', () => {
  assert.equal(docHrefTarget('https://x.com', null).kind, 'url');
  assert.equal(docHrefTarget('docs/spec.md', null).kind, 'ignore');
});

// ---- bare URLs in the source become links ---------------------------------

test('a bare URL renders as a link', () => {
  assert.match(renderMarkdown('see https://opencode.ai/docs here'),
    /<a href="https:\/\/opencode\.ai\/docs">https:\/\/opencode\.ai\/docs<\/a>/);
});

test('a markdown link still wins over the bare-URL rule', () => {
  assert.match(renderMarkdown('[the docs](https://opencode.ai/docs)'),
    /<a href="https:\/\/opencode\.ai\/docs">the docs<\/a>/);
});

test('a URL in backticks stays literal', () => {
  const html = renderMarkdown('run `curl https://opencode.ai/install`');
  assert.match(html, /<code>curl https:\/\/opencode\.ai\/install<\/code>/);
  assert.doesNotMatch(html, /<a /);
});

test('trailing punctuation is not part of a bare URL', () => {
  assert.match(renderMarkdown('read https://opencode.ai/docs.'),
    /<a href="https:\/\/opencode\.ai\/docs">https:\/\/opencode\.ai\/docs<\/a>\./);
});

test('the edit-mode highlighter still keeps every character', () => {
  const src = 'see https://opencode.ai/docs and [x](y) and **b**';
  const text = highlightMarkdown(src).replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  assert.equal(text, src + '\n');
});

// Calvin hit this in a real Notion reply: **[title](url)** rendered as
// literal bold text, unclickable — the one-pass tokeniser gave the whole
// span to the strong rule and never parsed inside it. Emphasis recurses now.
test('a link wrapped in bold is a bold link, not literal brackets', () => {
  const html = renderMarkdown('**[Invoice Summary](https://app.notion.com/p/x-3ba754)**');
  assert.match(html, /<strong><a href="https:\/\/app\.notion\.com\/p\/x-3ba754">Invoice Summary<\/a><\/strong>/);
});

test('emphasis and links nest both ways; code spans stay literal', () => {
  assert.match(renderMarkdown('*[x](https://e.com/a)*'), /<em><a href="https:\/\/e\.com\/a">x<\/a><\/em>/);
  assert.match(renderMarkdown('[**x** y](https://e.com/b)'), /<a href="https:\/\/e\.com\/b"><strong>x<\/strong> y<\/a>/);
  assert.match(renderMarkdown('`**[x](u)**`'), /<code>\*\*\[x\]\(u\)\*\*<\/code>/);
});
