// The fence tokenizer — colours the common languages, escapes everything,
// and refuses to guess: an unknown language comes back as escaped plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightCode } from '../src/renderer/md-code.mjs';

test('js: keywords, strings, numbers, comments get classed spans', () => {
  const html = highlightCode('js', 'const x = "hi"; // note\nreturn 42;');
  assert.match(html, /<span class="tok-kw">const<\/span>/);
  assert.match(html, /<span class="tok-str">&quot;hi&quot;<\/span>/);
  assert.match(html, /<span class="tok-com">\/\/ note<\/span>/);
  assert.match(html, /<span class="tok-num">42<\/span>/);
  assert.match(html, /<span class="tok-kw">return<\/span>/);
});

test('python: def/return, f-string, hash comment', () => {
  const html = highlightCode('python', 'def greet(name):\n    return f"hi"  # done');
  assert.match(html, /<span class="tok-kw">def<\/span>/);
  assert.match(html, /<span class="tok-kw">return<\/span>/);
  assert.match(html, /<span class="tok-str">f&quot;hi&quot;<\/span>/);
  assert.match(html, /<span class="tok-com"># done<\/span>/);
});

test('shell: comments and strings, no keyword noise in plain words', () => {
  const html = highlightCode('sh', 'echo "hello" # greet\nls -la');
  assert.match(html, /<span class="tok-str">&quot;hello&quot;<\/span>/);
  assert.match(html, /<span class="tok-com"># greet<\/span>/);
});

test('json: keys distinct from string values, numbers classed', () => {
  const html = highlightCode('json', '{"name": "x", "n": 3}');
  assert.match(html, /<span class="tok-key">&quot;name&quot;<\/span>/);
  assert.match(html, /<span class="tok-str">&quot;x&quot;<\/span>/);
  assert.match(html, /<span class="tok-num">3<\/span>/);
});

test('diff: whole lines classed add/del, context untouched', () => {
  const html = highlightCode('diff', '-old line\n+new line\n context');
  assert.match(html, /<span class="tok-del">-old line<\/span>/);
  assert.match(html, /<span class="tok-add">\+new line<\/span>/);
  assert.match(html, /\n context/);
});

test('unknown language: escaped plain text, no spans', () => {
  const html = highlightCode('brainfuck', 'a < b & c');
  assert.equal(html, 'a &lt; b &amp; c');
});

test('no language: escaped plain text', () => {
  assert.equal(highlightCode('', '<script>'), '&lt;script&gt;');
});

test('injection inside a known language stays escaped', () => {
  const html = highlightCode('js', 'const s = "</code><script>alert(1)</script>";');
  assert.ok(!html.includes('<script>'), 'raw script tag must not survive');
  assert.ok(!html.includes('</code>'), 'raw close tag must not survive');
  assert.match(html, /tok-str/);
});

test('strings win over comment markers inside them', () => {
  const html = highlightCode('js', 'const u = "http://x"; // real comment');
  assert.match(html, /<span class="tok-str">&quot;http:\/\/x&quot;<\/span>/);
  assert.match(html, /<span class="tok-com">\/\/ real comment<\/span>/);
});
