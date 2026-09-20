// The chat pane's markdown emitter is DOM-free on purpose: these tests run in
// plain node and pin the exact markup the transcript styles against. Every
// claim here is one the before/after mockup made to Calvin — a table is a
// <table> in a scrolling wrap, agent text can never inject markup, and the
// path-linkify contract (bare <code> with untouched text) survives the parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline } from '../src/renderer/acp-markdown.mjs';

test('table renders as a real table inside the scroll wrap', () => {
  const html = renderMarkdown('| Agent | Cmds |\n|---|---|\n| claude | 96 |\n| kimi | 35 |');
  assert.match(html, /<div class="cw-tablewrap"><table>/);
  assert.match(html, /<th>Agent<\/th>/);
  assert.match(html, /<td>kimi<\/td>/);
  assert.doesNotMatch(html, /\|/);
});

test('nested unordered list keeps its nesting', () => {
  const html = renderMarkdown('- top\n  - inner one\n  - inner two\n- next');
  assert.match(html, /<ul><li>top<ul><li>inner one<\/li>/);
});

test('ordered list is an <ol> that keeps its start number', () => {
  const html = renderMarkdown('3. third\n4. fourth');
  assert.match(html, /<ol start="3"><li>third<\/li><li>fourth<\/li><\/ol>/);
});

test('task list becomes disabled checkboxes', () => {
  const html = renderMarkdown('- [x] done thing\n- [ ] open thing');
  assert.match(html, /<li class="task"><input type="checkbox" checked disabled> done thing/);
  assert.match(html, /<li class="task"><input type="checkbox" disabled> open thing/);
});

test('headings, blockquote and rule come out as elements', () => {
  const html = renderMarkdown('## Roster\n\n> a note\n\n---');
  assert.match(html, /<h2>Roster<\/h2>/);
  assert.match(html, /<blockquote><p>a note<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('em, strong, strikethrough, and a link inside bold', () => {
  const html = renderMarkdown('*it* **bold** ~~gone~~ **[docs](https://x.dev)**');
  assert.match(html, /<i>it<\/i>/);
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<b><a href="https:\/\/x.dev" data-link>docs<\/a><\/b>/);
});

test('bare URLs autolink with data-link for the app opener', () => {
  const html = renderMarkdown('see https://dainami.ai for more');
  assert.match(html, /<a href="https:\/\/dainami.ai" data-link>https:\/\/dainami.ai<\/a>/);
});

test('fenced code keeps the copy-button wrap, closed or half-streamed', () => {
  const closed = renderMarkdown('```sh\necho hi\n```');
  assert.match(closed, /<div class="cw-codewrap"><button class="cw-copy" data-copy>copy<\/button><pre class="cw-code">echo hi<\/pre><\/div>/);
  const open = renderMarkdown('```sh\necho hi');
  assert.match(open, /<pre class="cw-code">echo hi<\/pre>/);
});

test('inline code stays a bare <code> so path-linkify still matches', () => {
  const html = renderMarkdown('open `src/renderer/app.js` now');
  assert.match(html, /<code>src\/renderer\/app.js<\/code>/);
});

test('raw HTML from the agent is shown as text, never markup', () => {
  const html = renderMarkdown('hi <script>alert(1)</script> <b>bye</b>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;bye&lt;\/b&gt;/);
});

test('raw HTML inside emphasis and code is escaped too', () => {
  const html = renderMarkdown('**<img src=x onerror=1>** and `<svg>`');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<code>&lt;svg&gt;<\/code>/);
});

test('remote images become links, local images become file thumbnails', () => {
  const remote = renderMarkdown('![chart](https://evil.example/p.png)');
  assert.doesNotMatch(remote, /<img/);
  assert.match(remote, /<a href="https:\/\/evil.example\/p.png" data-link>chart<\/a>/);
  const local = renderMarkdown('![shot](shots/app.png)');
  assert.match(local, /<img class="cw-imgout" data-open="shots\/app.png"/);
});

test('escaped markdown characters render as the plain character', () => {
  const html = renderMarkdown('\\*not bold\\*');
  assert.match(html, /\*not bold\*/);
  assert.doesNotMatch(html, /<b>/);
});

test('single newlines inside a paragraph still break, like today', () => {
  const html = renderMarkdown('line one\nline two');
  assert.match(html, /line one<br>line two/);
});

test('renderInline formats spans but never opens block elements', () => {
  const html = renderInline('a **bold** `code` [x](https://x.dev) note');
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /<code>code<\/code>/);
  assert.doesNotMatch(html, /<p>|<h\d|<ul|<table/);
});

test('plain multi-paragraph prose gets paragraphs, no stray whitespace nodes', () => {
  const html = renderMarkdown('first block\n\nsecond block');
  assert.equal(html, '<p>first block</p><p>second block</p>');
});

test('loose task list (blank lines between items) never leaks the [x] text', () => {
  const html = renderMarkdown('- [x] done thing\n\n- [ ] open thing');
  assert.doesNotMatch(html, /\[x\]|\[ \]/);
  assert.match(html, /<li class="task"><input type="checkbox" checked disabled> done thing<\/li>/);
});

// A drive letter has the shape of a URL scheme. Which one `C:` is, is the
// platform's call — never the text's.
test('hasScheme: on Windows a drive path is a path, and a real scheme is still a scheme', async () => {
  const { hasScheme } = await import('../src/renderer/acp-markdown.mjs');
  for (const p of ['C:\\pics\\a.png', 'C:/pics/a.png', 'd:\\a.png', '\\\\nas\\share\\a.png']) assert.equal(hasScheme(p, 'win32'), false, p);
  for (const u of ['https://x.test/a.png', 'file:///C:/pics/a.png', 'data:image/png;base64,AA', 'javascript:alert(1)', 'mailto:a@b.c']) assert.equal(hasScheme(u, 'win32'), true, u);
  assert.equal(hasScheme('pics\\a.png', 'win32'), false);
  assert.equal(hasScheme('C:a.png', 'win32'), true, 'drive-relative is not absolute, and nobody writes it; it stays a link');
});

test('hasScheme: the Mac column is what it always was — c:/x is a URL there', async () => {
  const { hasScheme } = await import('../src/renderer/acp-markdown.mjs');
  for (const platform of ['darwin', '']) {
    assert.equal(hasScheme('C:/pics/a.png', platform), true);
    assert.equal(hasScheme('C:\\pics\\a.png', platform), true);
    assert.equal(hasScheme('/Users/x/a.png', platform), false);
    assert.equal(hasScheme('https://x.test/a.png', platform), true);
  }
});

test('a Windows absolute image path becomes an inline image on Windows and stays a link on a Mac', () => {
  const was = globalThis.dainami;
  try {
    globalThis.dainami = { platform: 'win32' };
    assert.match(renderMarkdown('![shot](C:\\pics\\a.png)'), /<img class="cw-imgout" data-open="C:\\pics\\a\.png" data-imgsrc="C:\\pics\\a\.png" alt="shot">/);
    assert.match(renderMarkdown('![shot](C:/pics/a.png)'), /<img class="cw-imgout" data-open="C:\/pics\/a\.png"/);
    assert.match(renderMarkdown('![shot](https://x.test/a.png)'), /<a href="https:\/\/x\.test\/a\.png" data-link>shot<\/a>/, 'a reply still cannot make the app fetch');
    assert.doesNotMatch(renderMarkdown('![x](javascript:alert(1).png)'), /<img|href/);
    globalThis.dainami = { platform: 'darwin' };
    assert.match(renderMarkdown('![shot](C:/pics/a.png)'), /<a href="C:\/pics\/a\.png" data-link>shot<\/a>/);
    assert.match(renderMarkdown('![shot](/Users/x/a.png)'), /<img class="cw-imgout" data-open="\/Users\/x\/a\.png"/);
  } finally { if (was === undefined) delete globalThis.dainami; else globalThis.dainami = was; }
});
