// The shell announcing that the command Nami typed into it has finished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { doneSuffix, feedRunDone } = require('../src/main/run-done.js');

const SEQ = (code) => `\x1b]1337;NamiRunDone=${code}\x07`;

test('a finished command reports its exit code', () => {
  assert.equal(feedRunDone({}, 'installing…\n' + SEQ(0)), 0);
  assert.equal(feedRunDone({}, SEQ(1)), 1);
  assert.equal(feedRunDone({}, SEQ(127)), 127);
});

// The whole point of reading the code rather than assuming success: a failed
// install must never be announced as an agent that is ready to use.
test('a failure is a failure, not a zero', () => {
  const st = {};
  assert.equal(feedRunDone(st, 'curl: (6) Could not resolve host\n' + SEQ(6)), 6);
});

test('ordinary output says nothing', () => {
  const st = {};
  assert.equal(feedRunDone(st, 'downloading  ████  100%\n'), null);
  assert.equal(feedRunDone(st, '\x1b]0;⠐ Some session title\x07'), null);
  assert.equal(feedRunDone(st, '❯ '), null);
  assert.equal(feedRunDone(st, ''), null);
});

// pty chunks are whatever the kernel had ready. A 26-byte escape lands split
// across two reads often enough that a stateless parser would miss installs at
// random — the worst possible failure, because it looks like it works.
test('the sequence is still found when it straddles two chunks', () => {
  const seq = SEQ(0);
  for (let cut = 1; cut < seq.length; cut++) {
    const st = {};
    assert.equal(feedRunDone(st, 'done\n' + seq.slice(0, cut)), null, `cut at ${cut}`);
    assert.equal(feedRunDone(st, seq.slice(cut)), 0, `cut at ${cut}`);
  }
});

test('it survives being split three ways', () => {
  const seq = SEQ(42);
  const st = {};
  assert.equal(feedRunDone(st, seq.slice(0, 5)), null);
  assert.equal(feedRunDone(st, seq.slice(5, 11)), null);
  assert.equal(feedRunDone(st, seq.slice(11)), 42);
});

// A tile can stream megabytes before the command ends. The carry buffer holds
// only enough to reassemble one split escape.
test('the carry buffer does not grow with the output', () => {
  const st = {};
  for (let i = 0; i < 500; i++) feedRunDone(st, 'x'.repeat(1000));
  assert.ok(st.buf.length < 64, `carry grew to ${st.buf.length}`);
  assert.equal(feedRunDone(st, SEQ(0)), 0);
});

// ---- the other half: what the shell is actually asked to print -------------
// Asserting the parser against a string this file wrote proves nothing about
// whether a real shell emits it. So run it.
test('a real zsh emits the sequence, with the real exit code', () => {
  for (const [cmd, want] of [['true', 0], ['false', 1], ['(exit 7)', 7], ['ls /nope/nope', 1]]) {
    const out = execFileSync('/bin/zsh', ['-c', doneSuffix(cmd)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(feedRunDone({}, out), want, `for \`${cmd}\``);
  }
});

// A command that ends the shell itself — a bare `exit`, or an installer that
// execs — never reaches the printf. Nothing is lost: killing the shell fires
// the pty's own exit, which the tile already listens to. Worth pinning so the
// gap stays a known one.
test('a command that ends the shell reports nothing here, and that is fine', () => {
  let out = '';
  try {
    execFileSync('/bin/zsh', ['-c', doneSuffix('exit 7')], { encoding: 'utf8' });
  } catch (e) { out = e.stdout || ''; }
  assert.equal(feedRunDone({}, out), null);
});

test('a real zsh reports the failing stage of a pipeline', () => {
  // the shape an install actually has: fetch | interpreter
  const out = execFileSync('/bin/zsh', ['-c', doneSuffix('echo hi | grep -q nothing')], { encoding: 'utf8' });
  assert.equal(feedRunDone({}, out), 1);
});

test('nothing of the sequence is left visible in the output', () => {
  const out = execFileSync('/bin/zsh', ['-c', doneSuffix('echo installed')], { encoding: 'utf8' });
  assert.match(out, /installed/);
  // no literal escape text leaked into what the user reads
  assert.doesNotMatch(out, /printf|033|NamiRunDone=%s/);
});
