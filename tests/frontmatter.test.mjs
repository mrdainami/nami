import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDoc, getField, setField, serializeDoc, editsAsFrontmatter } from '../src/renderer/frontmatter.mjs';

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

// ---- which files may be edited through the form at all ----------------------

test('only markdown edits as frontmatter', () => {
  assert.equal(editsAsFrontmatter('/p/.claude/agents/foo.md'), true);
  assert.equal(editsAsFrontmatter('/p/agents/foo.markdown'), true);
  assert.equal(editsAsFrontmatter('/p/.codex/agents/foo.toml'), false);
  assert.equal(editsAsFrontmatter('/p/.opencode/opencode.json'), false);
  assert.equal(editsAsFrontmatter(''), false);
  assert.equal(editsAsFrontmatter(null), false);
});

// Why the guard has to exist upstream rather than inside setField: on a file
// with no fence, creating frontmatter is the *correct* behaviour for markdown.
// It is only wrong because the file might not be markdown.
test('setField fabricates frontmatter on a fenceless file — which is why TOML must never reach it', () => {
  const toml = 'name = "toml-critic"\ndescription = "Reads the TOML nobody else reads."\n'
    + 'developer_instructions = """\nBe exacting.\n"""\n';
  const doc = parseDoc(toml);
  assert.equal(doc.hasFrontmatter, false, 'no --- fence, so it parses as bare body');
  setField(doc, 'name', 'toml-critic');
  const out = serializeDoc(doc);
  assert.match(out, /^---\nname: toml-critic\n---/, 'a YAML block is prepended');
  assert.match(out, /name = "toml-critic"/, 'and the original TOML is still below it');
  assert.equal(editsAsFrontmatter('/p/.codex/agents/toml-critic.toml'), false,
    'which is exactly what the guard prevents');
});
