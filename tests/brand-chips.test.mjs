import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipHtml, isBrandKey } from '../src/renderer/icons.mjs';

// A chip's colour has always answered "what kind of thing is this?" — one hue
// per kind, never per id. Brand marks are the deliberate exception: Claude's
// orange and OpenAI's black are what those tools look like everywhere else, and
// a wall of identically-tinted glyphs makes six agents read as one. Kind still
// colours everything that has no brand of its own, terminals included.

test('a known brand carries its own identity', () => {
  assert.equal(isBrandKey('claude'), true);
  assert.match(chipHtml({ key: 'claude', kind: 'agent' }), /data-brand="claude"/);
});

test('every brand we draw a mark for can be coloured', () => {
  for (const key of ['claude', 'openai', 'gemini', 'opencode', 'hermes', 'kimi']) {
    assert.equal(isBrandKey(key), true, `${key} should be a brand`);
    assert.match(chipHtml({ key, kind: 'agent' }), new RegExp(`data-brand="${key}"`));
  }
});

test('a plain terminal stays a kind, not a brand', () => {
  // the one Calvin called out: shells are grey because they are shells
  const html = chipHtml({ code: '❯', kind: 'shell' });
  assert.doesNotMatch(html, /data-brand/);
  assert.match(html, /data-kind="shell"/);
});

test('kind survives alongside brand, so layout rules still apply', () => {
  const html = chipHtml({ key: 'claude', kind: 'agent' });
  assert.match(html, /data-kind="agent"/);
});

test('a type glyph is not a brand', () => {
  // skill/command/agent are our own drawings, not somebody's logo
  assert.equal(isBrandKey('skill'), false);
  assert.doesNotMatch(chipHtml({ key: 'skill', kind: 'skill' }), /data-brand/);
});

test('an unknown key falls back to the two-letter code, uncoloured', () => {
  const html = chipHtml({ key: 'nosuchtool', code: 'NS', kind: 'agent' });
  assert.doesNotMatch(html, /data-brand/);
  assert.match(html, />NS</);
});

test('no inline colour is ever emitted', () => {
  // the rule that outlives this change: hues live in CSS, one place per theme
  for (const key of ['claude', 'openai', 'gemini', 'hermes']) {
    assert.doesNotMatch(chipHtml({ key, kind: 'agent' }), /style=|#[0-9a-fA-F]{3,6}/);
  }
});
