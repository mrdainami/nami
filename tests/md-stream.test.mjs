// The streaming face of the renderer: block boundaries, a frozen prefix
// that survives appends untouched, plain fences while streaming, and O(n)
// total parse work. The still face (renderMarkdown) must not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderMarkdownStream } from '../src/renderer/md.mjs';

const DOC1 = '# Title\n\nfirst paragraph here.\n\nsecond paragraph';
const DOC2 = DOC1 + ' grows longer.\n\nthird paragraph lands.';
const DOC3 = DOC2 + '\n\n```js\nconst x = 1;\n';          // fence opens, unclosed
const DOC4 = DOC3 + 'const y = 2;\n```\n\nafter the fence.';

test('blocks join up to exactly what renderMarkdown produces', () => {
  for (const doc of [DOC1, DOC2, DOC4]) {
    const r = renderMarkdownStream(doc, null, {});
    assert.equal(r.blocks.map((b) => b.html).join('\n'), renderMarkdown(doc));
  }
});

test('append reuses the stable prefix — same html strings, no re-parse', () => {
  const r1 = renderMarkdownStream(DOC1, null, {});
  const r2 = renderMarkdownStream(DOC2, r1.state, {});
  assert.ok(r2.stableCount >= 1, 'something must freeze');
  for (let i = 0; i < r2.stableCount; i++) {
    assert.equal(r2.blocks[i].html, r1.blocks[i].html, 'frozen block ' + i + ' unchanged');
  }
  // parse work is only the tail: strictly fewer lines than a full parse
  assert.ok(r2.state.parsedLines < DOC2.split('\n').length, 'tail-only parse');
});

test('an open fence never freezes; it settles once closed', () => {
  const r2 = renderMarkdownStream(DOC2, null, {});
  const r3 = renderMarkdownStream(DOC3, r2.state, { streaming: true });
  const last = r3.blocks[r3.blocks.length - 1].html;
  assert.match(last, /<pre class="md-pre">/);
  assert.ok(r3.stableCount < r3.blocks.length, 'open fence is in the live tail');
  const r4 = renderMarkdownStream(DOC4, r3.state, { streaming: true });
  assert.equal(r4.blocks.map((b) => b.html).join('\n').includes('const y'), true);
});

test('streaming renders fences plain; settled render colours them', () => {
  const doc = '```js\nconst x = 1;\n```';
  const live = renderMarkdownStream(doc, null, { streaming: true });
  assert.ok(!/tok-kw/.test(live.blocks.map((b) => b.html).join('')), 'no tokens mid-stream');
  assert.match(live.blocks[0].html, /const x = 1;/);
  const settled = renderMarkdownStream(doc, null, {});
  assert.match(settled.blocks.map((b) => b.html).join(''), /tok-kw/);
});

test('non-append input resets instead of trusting the prefix', () => {
  const r1 = renderMarkdownStream(DOC2, null, {});
  const r = renderMarkdownStream('completely different text', r1.state, {});
  assert.equal(r.blocks.map((b) => b.html).join('\n'), renderMarkdown('completely different text'));
});

test('total parse work over many appends stays linear-ish', () => {
  let state = null;
  let text = '';
  let totalParsed = 0;
  for (let i = 0; i < 60; i++) {
    text += 'paragraph number ' + i + ' with some words in it.\n\n';
    const r = renderMarkdownStream(text, state, { streaming: true });
    state = r.state;
    totalParsed += r.state.parsedLines;
  }
  const fullEvery = (60 * 61) / 2 * 2; // what quadratic re-parse would cost in lines
  assert.ok(totalParsed < fullEvery / 3, `parsed ${totalParsed} lines, quadratic would be ~${fullEvery}`);
});

test('frontmatter only ever binds at the very top, stream or not', () => {
  const doc = '---\ntitle: x\n---\nbody text';
  const r = renderMarkdownStream(doc, null, {});
  assert.match(r.blocks[0].html, /md-fm/);
  const grown = renderMarkdownStream(doc + '\n\n---\n\nmore', r.state, {});
  const joined = grown.blocks.map((b) => b.html).join('\n');
  assert.equal(joined, renderMarkdown(doc + '\n\n---\n\nmore'));
});
