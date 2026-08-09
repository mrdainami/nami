// Claude publishes its own name for the live conversation as an OSC 0 terminal
// title, live in the PTY stream. Captured from a real session (CLI 2.1.226):
//
//   \x1b]0;✳ Claude Code\x07
//   \x1b]0;⠐ Calculate basic arithmetic problem\x07
//
// This is the only title source that stays correct after /resume, because it
// comes from the running process rather than from a session id guessed at spawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oscTitles, cleanAgentTitle, feedOscTitle } from '../src/main/osc-title.js';

const OSC = (s) => `\x1b]0;${s}\x07`;

test('pulls every OSC 0 title out of a chunk, BEL-terminated', () => {
  assert.deepEqual(oscTitles(OSC('✳ Claude Code') + 'ls -la\r\n' + OSC('⠐ Fix the parser')),
    ['✳ Claude Code', '⠐ Fix the parser']);
});

test('accepts the ST terminator as well as BEL', () => {
  assert.deepEqual(oscTitles('\x1b]0;⠂ Ship it\x1b\\'), ['⠂ Ship it']);
});

test('OSC 2 (window title) counts too; OSC 1 (icon name) does not', () => {
  assert.deepEqual(oscTitles('\x1b]2;⠐ Window\x07'), ['⠐ Window']);
  assert.deepEqual(oscTitles('\x1b]1;icon\x07'), []);
});

test('ordinary terminal output yields nothing', () => {
  assert.deepEqual(oscTitles('\x1b[31mred\x1b[0m plain text\r\n'), []);
});

test('strips the leading status glyph claude prefixes', () => {
  // ✳ is idle/ready; the braille frames are the working spinner.
  for (const g of ['✳', '⠂', '⠐', '⠄', '⡀', '·']) {
    assert.equal(cleanAgentTitle(`${g} Fix the parser`), 'Fix the parser');
  }
});

test('a title with no glyph survives intact', () => {
  assert.equal(cleanAgentTitle('Fix the parser'), 'Fix the parser');
});

test('the "Claude Code" placeholder is not a name', () => {
  // Shown before claude has titled the conversation. Adopting it would replace
  // a useful prompt-derived label with a generic one.
  assert.equal(cleanAgentTitle('✳ Claude Code'), null);
  assert.equal(cleanAgentTitle('Claude Code'), null);
  assert.equal(cleanAgentTitle('⠐ claude code'), null);
});

test('empty, glyph-only and whitespace titles are not names', () => {
  for (const t of ['', '   ', '✳', '✳ ', null, undefined]) assert.equal(cleanAgentTitle(t), null);
});

test('control bytes never reach the label', () => {
  // A title is captured from a live stream and rendered into the rail; a stray
  // BEL or a nested escape must be dropped, not carried into the DOM.
  assert.equal(cleanAgentTitle('⠐ Fix the\x07 parser'), 'Fix the parser');
  assert.equal(cleanAgentTitle('⠐ Fix\x1b[31m it'), 'Fix[31m it');
});

test('an over-long title is cut to the tile width with an ellipsis', () => {
  const long = 'x'.repeat(200);
  const got = cleanAgentTitle(`⠐ ${long}`);
  assert.ok(got.length <= 60, `got ${got.length}`);
  assert.ok(got.endsWith('…'));
});

test('feedOscTitle reports a title only when it actually changes', () => {
  let st = { last: null };
  assert.equal(feedOscTitle(st, OSC('✳ Claude Code')), null);          // placeholder
  assert.equal(feedOscTitle(st, OSC('⠐ Fix the parser')), 'Fix the parser');
  assert.equal(feedOscTitle(st, OSC('⠂ Fix the parser')), null);       // same name, new spinner frame
  assert.equal(feedOscTitle(st, OSC('✳ Fix the parser')), null);
  assert.equal(feedOscTitle(st, OSC('⠐ Ship the parser')), 'Ship the parser');
});

test('feedOscTitle takes the last title when a chunk carries several', () => {
  const st = { last: null };
  assert.equal(feedOscTitle(st, OSC('⠐ First') + OSC('⠂ Second')), 'Second');
});

test('feedOscTitle survives a chunk with no OSC at all', () => {
  const st = { last: 'Fix the parser' };
  assert.equal(feedOscTitle(st, 'just some output\r\n'), null);
  assert.equal(st.last, 'Fix the parser');
});
