// Following a transcript that is being written to, without ever reading it
// whole. Transcripts reach hundreds of megabytes, so every read here is bounded
// and starts where the last one stopped.
//
// This one uses real files in a temp directory rather than an injected fs: the
// module's entire job is byte offsets, partial lines and multibyte boundaries,
// and a fake fs would only prove the fake behaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readFrom, tailStart } = require('../src/main/transcript-tail.js');

function tmpFile(contents = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-tail-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, contents);
  return file;
}
const append = (file, s) => fs.appendFileSync(file, s);

test('reads the lines written so far and reports where it stopped', () => {
  const file = tmpFile('one\ntwo\n');
  const r = readFrom(file, 0);
  assert.deepEqual(r.lines, ['one', 'two']);
  assert.equal(r.offset, 8);
});

test('a second read returns only what was appended since', () => {
  const file = tmpFile('one\n');
  const first = readFrom(file, 0);
  append(file, 'two\nthree\n');
  const second = readFrom(file, first.offset);
  assert.deepEqual(second.lines, ['two', 'three']);
});

test('an unfinished last line is held back until its newline arrives', () => {
  // The CLI flushes mid-record constantly; half a line must never reach the
  // parser as if it were a whole one.
  const file = tmpFile('one\n{"type":"assis');
  const first = readFrom(file, 0);
  assert.deepEqual(first.lines, ['one']);
  assert.equal(first.offset, 4);

  append(file, 'tant"}\n');
  const second = readFrom(file, first.offset);
  assert.deepEqual(second.lines, ['{"type":"assistant"}']);
});

test('nothing new means no lines and the same offset', () => {
  const file = tmpFile('one\n');
  const first = readFrom(file, 0);
  const second = readFrom(file, first.offset);
  assert.deepEqual(second.lines, []);
  assert.equal(second.offset, first.offset);
});

test('a multibyte character split across two reads survives whole', () => {
  // Cutting a UTF-8 sequence in half and decoding each half yields two
  // replacement characters — and claude writes ✳, ⠐ and em dashes constantly.
  const file = tmpFile('');
  const line = '{"t":"✳ Cogitating — 中文"}\n';
  const bytes = Buffer.from(line, 'utf8');
  append(file, bytes.slice(0, 12));
  const first = readFrom(file, 0);
  assert.deepEqual(first.lines, []);

  fs.appendFileSync(file, bytes.slice(12));
  const second = readFrom(file, first.offset);
  assert.deepEqual(second.lines, ['{"t":"✳ Cogitating — 中文"}']);
});

test('a file that shrank is a different conversation — start over', () => {
  // /clear rewrites the transcript, and a resumed session can be replaced
  // wholesale. Reading from a stale offset would splice two conversations.
  const file = tmpFile('one\ntwo\nthree\n');
  const first = readFrom(file, 0);
  fs.writeFileSync(file, 'fresh\n');
  const second = readFrom(file, first.offset);
  assert.equal(second.reset, true);
  assert.deepEqual(second.lines, ['fresh']);
  assert.equal(second.offset, 6);
});

test('a transcript that does not exist yet is not an error', () => {
  // A session spawned a second ago has no file until its first turn.
  const r = readFrom(path.join(os.tmpdir(), 'nami-tail-nope', 'x.jsonl'), 0);
  assert.equal(r.missing, true);
  assert.deepEqual(r.lines, []);
  assert.equal(r.offset, 0);
});

test('one read is bounded, and the rest arrives on the next one', () => {
  const file = tmpFile('aaaa\nbbbb\ncccc\n');
  const first = readFrom(file, 0, { maxBytes: 7 });
  assert.deepEqual(first.lines, ['aaaa']);
  const second = readFrom(file, first.offset, { maxBytes: 7 });
  assert.deepEqual(second.lines, ['bbbb']);
});

test('a line longer than one read resyncs instead of stalling forever', () => {
  // A Read of a large file is a single enormous record. Waiting for it to fit
  // would freeze the tile; the giant line is skipped and the next one lands.
  const file = tmpFile('x'.repeat(50) + '\nsmall\n');
  const first = readFrom(file, 0, { maxBytes: 10 });
  assert.deepEqual(first.lines, []);
  assert.equal(first.dropped, true);
  assert.ok(first.offset > 0);

  let offset = first.offset, lines = [], guard = 0;
  while (guard++ < 20) {
    const r = readFrom(file, offset, { maxBytes: 10 });
    offset = r.offset;
    lines = lines.concat(r.lines);
    if (!r.lines.length && !r.dropped) break;
  }
  assert.ok(lines.includes('small'), 'resynced onto the next whole line');
});

test('tailStart reads a small transcript from the beginning', () => {
  assert.deepEqual(tailStart(4000, { window: 96 * 1024 }), { offset: 0, partial: false });
});

test('tailStart opens a huge transcript near its end, and says the first line is partial', () => {
  // 200MB of history is not what a card wants; the last screenful is.
  const r = tailStart(200 * 1024 * 1024, { window: 96 * 1024 });
  assert.equal(r.offset, 200 * 1024 * 1024 - 96 * 1024);
  assert.equal(r.partial, true);
});
