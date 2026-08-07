import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, getField, setField, serializeDoc } from '../src/renderer/frontmatter.mjs';

const AGENT = `---
name: collector
description: Pulls structured data off pages
tools: browser, files, shell
---

You are the collector agent.
Do the thing.
`;

test('round-trip identity: parse then serialize is byte-identical', () => {
  assert.equal(serializeDoc(parseDoc(AGENT)), AGENT);
});

test('getField reads simple values', () => {
  const doc = parseDoc(AGENT);
  assert.equal(getField(doc, 'name'), 'collector');
  assert.equal(getField(doc, 'tools'), 'browser, files, shell');
  assert.equal(getField(doc, 'missing'), '');
});

test('setField edits one key, preserves unknown keys and body verbatim', () => {
  const src = `---
name: x
metadata:
  type: user
  extra: keep-me
description: old
# a comment line
---
Body stays.
`;
  const doc = parseDoc(src);
  setField(doc, 'description', 'new words');
  const out = serializeDoc(doc);
  assert.match(out, /description: new words\n/);
  assert.match(out, /metadata:\n  type: user\n  extra: keep-me\n/);
  assert.match(out, /# a comment line\n/);
  assert.match(out, /Body stays\.\n$/);
  assert.equal(getField(parseDoc(out), 'name'), 'x');
});

test('complex multiline value collapses to a single safe line when edited', () => {
  const src = `---
description: >-
  line one
  line two
name: y
---
b
`;
  const doc = parseDoc(src);
  assert.equal(getField(doc, 'description'), 'line one line two');
  setField(doc, 'description', 'flat now');
  const out = serializeDoc(doc);
  assert.match(out, /description: flat now\nname: y\n/);
  assert.doesNotMatch(out, /line one/);
});

test('values needing quotes get JSON-quoted', () => {
  const doc = parseDoc(AGENT);
  setField(doc, 'description', 'use when: things break "badly"');
  const out = serializeDoc(doc);
  assert.match(out, /description: "use when: things break \\"badly\\""\n/);
  assert.equal(getField(parseDoc(out), 'description'), 'use when: things break "badly"');
});

test('setField appends a missing key before the closing fence', () => {
  const doc = parseDoc(AGENT);
  setField(doc, 'model', 'sonnet');
  const out = serializeDoc(doc);
  assert.match(out, /model: sonnet\n---\n/);
});

test('no frontmatter: body only, setField creates the block', () => {
  const doc = parseDoc('just a body\n');
  assert.equal(doc.hasFrontmatter, false);
  assert.equal(serializeDoc(doc), 'just a body\n');
  setField(doc, 'name', 'fresh');
  assert.equal(serializeDoc(doc), '---\nname: fresh\n---\njust a body\n');
});

test('malformed frontmatter (unterminated fence) is flagged, not mangled', () => {
  const src = '---\nname: broken\nno closing fence\n';
  const doc = parseDoc(src);
  assert.equal(doc.hasFrontmatter, false);
  assert.equal(doc.malformed, true);
  assert.equal(serializeDoc(doc), src);
});

test('quoted values are unquoted on read', () => {
  const doc = parseDoc(`---\ndescription: "hello: world"\n---\nb\n`);
  assert.equal(getField(doc, 'description'), 'hello: world');
});
