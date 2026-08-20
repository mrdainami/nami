// The Read tab's renderer against real markdown — every construct the 2026-08
// sweep found mangled, asserted block by block. Same security stance as ever:
// zero-dependency, escape-first, no HTML passthrough.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/renderer/md.mjs';

const FIXTURE = [
  '---',
  'title: release notes',
  'owner: cal',
  '---',
  'Nami 0.9 — cards update',
  '=======================',
  '',
  'Second heading',
  '--------------',
  '',
  '| area | change | status |',
  '|------|--------|:------:|',
  '| cards | mode chip | done |',
  '',
  '- [x] six claude modes',
  '- [ ] acp passthrough',
  '- library drawers',
  '  - connections master',
  '  - agents master',
  '- a long item that wraps',
  '  onto a second line',
  '',
  '3. third',
  '4. fourth',
  '',
  '> quoted line one,',
  '> quoted line two',
  '',
  '![wave](shots/wave.png)',
  '',
  '```js',
  'const x = 1;',
  '```',
].join('\n');

test('frontmatter becomes one quiet meta block, never rules-and-junk', () => {
  const html = renderMarkdown(FIXTURE);
  assert.match(html, /<div class="md-fm"><b>title<\/b>: release notes<br><b>owner<\/b>: cal<\/div>/);
  assert.ok(!html.startsWith('<hr'), 'the old rendering opened with a bogus <hr>');
});

test('setext underlines make real headings', () => {
  const html = renderMarkdown(FIXTURE);
  assert.match(html, /<h1>Nami 0\.9 — cards update<\/h1>/);
  assert.match(html, /<h2>Second heading<\/h2>/);
  assert.ok(!/=====/.test(html), 'the underline itself must not survive as text');
});

test('a GFM table renders as a table with its alignment, not pipe soup', () => {
  const html = renderMarkdown(FIXTURE);
  assert.match(html, /<table><thead><tr><th>area<\/th><th>change<\/th><th style="text-align:center">status<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>cards<\/td><td>mode chip<\/td><td style="text-align:center">done<\/td>/);
  assert.ok(!/<p>\| area/.test(html));
});

test('task boxes become disabled checkboxes with their state', () => {
  const html = renderMarkdown(FIXTURE);
  assert.match(html, /<li class="md-task"><input type="checkbox" disabled checked>six claude modes/);
  assert.match(html, /<li class="md-task"><input type="checkbox" disabled>acp passthrough/);
  assert.ok(!/\[x\]|\[ \]/.test(html), 'the markers must not print as text');
});

test('indent nests lists; a wrapped line stays inside its item', () => {
  const html = renderMarkdown(FIXTURE);
  assert.match(html, /<li>library drawers<ul><li>connections master<\/li><li>agents master<\/li><\/ul><\/li>/);
  assert.match(html, /<li>a long item that wraps onto a second line<\/li>/);
  assert.ok(!/<p>onto a second line<\/p>/.test(html), 'the continuation must not fall out as a paragraph');
});

test('an ordered list keeps its start number', () => {
  assert.match(renderMarkdown(FIXTURE), /<ol start="3"><li>third<\/li><li>fourth<\/li><\/ol>/);
});

test('consecutive quote lines group into one blockquote', () => {
  const html = renderMarkdown(FIXTURE);
  const quotes = html.match(/<blockquote>/g) || [];
  assert.equal(quotes.length, 1);
  assert.match(html, /<blockquote><p>quoted line one, quoted line two<\/p><\/blockquote>/);
});

test('images render through the resolver; without one they stay links', () => {
  const withResolver = renderMarkdown(FIXTURE, { resolveImage: (src) => 'nami-doc://doc/x/' + src });
  assert.match(withResolver, /<img src="nami-doc:\/\/doc\/x\/shots\/wave\.png" alt="wave">/);
  const without = renderMarkdown(FIXTURE);
  assert.match(without, /<a href="shots\/wave\.png">wave<\/a>/);
  assert.ok(!/<img/.test(without));
  // a data: image needs no resolver — it fetches nothing
  assert.match(renderMarkdown('![dot](data:image/gif;base64,R0lGOD)'), /<img src="data:image\/gif;base64,R0lGOD" alt="dot">/);
});

test('a fence keeps its language as a corner label, tokens classed, body escaped', () => {
  const html = renderMarkdown(FIXTURE);
  assert.match(html, /<pre class="md-pre"><span class="md-lang">js<\/span><code><span class="tok-kw">const<\/span> x = <span class="tok-num">1<\/span>;<\/code><\/pre>/);
  assert.match(renderMarkdown('```\n<script>alert(1)</script>\n```'), /&lt;script&gt;/);
  // a known language must escape too — colouring never reintroduces markup
  assert.match(renderMarkdown('```js\nconst s = "<script>";\n```'), /&lt;script&gt;/);
});

test('hostile content in new constructs is escaped, never markup', () => {
  const evil = renderMarkdown('| a |\n|---|\n| <script>alert(1)</script> |');
  assert.ok(!/<script>/.test(evil));
  assert.match(evil, /&lt;script&gt;/);
  const evilTask = renderMarkdown('- [ ] <img src=x onerror=alert(1)>');
  assert.ok(!/onerror=/.test(evilTask.replace(/&lt;[^&]*&gt;/g, '')), 'the payload must only survive as escaped text');
  const evilFm = renderMarkdown('---\ntitle: <b>x</b>\n---\nbody');
  assert.match(evilFm, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('what already worked still works: #-headings, hr, inline, plain paragraphs', () => {
  const html = renderMarkdown('# H\n\ntext **bold** `code` [t](https://x.dev) ~~gone~~\n\n---\n\nmore');
  assert.match(html, /<h1>H<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/x.dev">t<\/a>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<hr \/>/);
});

test('highlight and strictly limited text colour survive the read renderer', () => {
  const html = renderMarkdown('Use ==highlight== and <span style="color:#445566">colour</span>.');
  assert.match(html, /<mark>highlight<\/mark>/);
  assert.match(html, /<span style="color:#445566">colour<\/span>/);
  assert.doesNotMatch(renderMarkdown('<span style="color:url(javascript:alert(1))">bad</span>'), /<span/);
});

test('a standalone video or file link becomes a lightweight linked block', () => {
  const video = renderMarkdown('[Product walkthrough](./assets/demo.mp4)');
  assert.match(video, /class="md-attachment md-attachment--video"/);
  assert.match(video, /href="\.\/assets\/demo\.mp4"/);
  const file = renderMarkdown('[Research bundle](./research.zip)');
  assert.match(file, /class="md-attachment md-attachment--file"/);
  assert.match(renderMarkdown('See [the video](./demo.mp4) later\.'), /<p>See <a href="\.\/demo\.mp4">the video<\/a> later\.<\/p>/);
});

test('a --- under a paragraph is a setext h2, but alone it is still a rule', () => {
  assert.match(renderMarkdown('Title\n---'), /<h2>Title<\/h2>/);
  assert.match(renderMarkdown('para\n\n---\n\nafter'), /<hr \/>/);
});

test('triple-star bold-italic nests, stars never leak', () => {
  const html = renderMarkdown('a ***both*** b');
  assert.match(html, /<strong><em>both<\/em><\/strong>/);
  assert.ok(!/\*/.test(html), 'no literal stars in output');
});

test('triple-star inside a code span stays literal', () => {
  const html = renderMarkdown('`***x***`');
  assert.match(html, /<code>\*\*\*x\*\*\*<\/code>/);
});

test('wrapped text: up to 3 leading spaces keep block meaning (CommonMark)', () => {
  // codex's TUI stores continuation lines with a 2-space hanging indent
  const html = renderMarkdown('# Big title\n  ## Section\n   ### Sub\n  ---\n  Setext\n  ===');
  assert.match(html, /<h1>Big title<\/h1>/);
  assert.match(html, /<h2>Section<\/h2>/);
  assert.match(html, /<h3>Sub<\/h3>/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /<h1>Setext<\/h1>/);
  // 4+ spaces is not a heading — that is indented content
  assert.ok(!/<h2>deep<\/h2>/.test(renderMarkdown('    ## deep')));
});
