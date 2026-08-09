import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { scanTitles, claudeTitle, adoptTitle, shouldPushName } = require('../src/main/session-title.js');

// Shapes captured from a real transcript, claude 2.1.226.
const AI = (t, sid = 'abc') => JSON.stringify({ type: 'ai-title', aiTitle: t, sessionId: sid });
const CUSTOM = (t, sid = 'abc') => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: sid });
const NOISE = JSON.stringify({ type: 'assistant', message: { content: 'an ai-title is not in here' } });

test('reads the ai-title claude wrote for itself', () => {
  const text = [NOISE, AI('Investigate session naming alignment'), NOISE].join('\n');
  assert.equal(claudeTitle(text), 'Investigate session naming alignment');
});

test('an explicit name outranks the generated one, whatever the order', () => {
  assert.equal(claudeTitle([AI('Generated'), CUSTOM('build: dark mode')].join('\n')), 'build: dark mode');
  assert.equal(claudeTitle([CUSTOM('build: dark mode'), AI('Generated')].join('\n')), 'build: dark mode');
});

test('the newest title of a kind wins — claude re-titles as the work moves on', () => {
  assert.equal(claudeTitle([AI('First guess'), AI('What it really became')].join('\n')), 'What it really became');
});

test('a tail read landing mid-line skips the shard instead of throwing', () => {
  const text = '{"type":"assist' + '\n' + AI('Survived the cut');
  assert.equal(claudeTitle(text), 'Survived the cut');
});

test('a transcript with no title yet reads as unnamed', () => {
  assert.equal(claudeTitle([NOISE, NOISE].join('\n')), null);
  assert.equal(claudeTitle(''), null);
  assert.deepEqual(scanTitles(''), { ai: null, custom: null });
});

// ---- reading a live transcript --------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { readTailTitle } = require('../src/main/session-title.js');

function tmpTranscript() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nami-title-')), 'session.jsonl');
}

test('a transcript that does not exist yet reads as unnamed, not as a crash', () => {
  assert.equal(readTailTitle(path.join(os.tmpdir(), 'nami-no-such-session.jsonl')), null);
});

test('reads the current title out of a growing transcript', () => {
  const file = tmpTranscript();
  fs.writeFileSync(file, NOISE + '\n');
  assert.equal(readTailTitle(file), null);            // claude has not titled it yet
  fs.appendFileSync(file, AI('Fix the login flicker') + '\n');
  assert.equal(readTailTitle(file), 'Fix the login flicker');
  fs.appendFileSync(file, AI('Refactor the auth module') + '\n');
  assert.equal(readTailTitle(file), 'Refactor the auth module');   // it re-titled itself
  fs.appendFileSync(file, CUSTOM('db migration') + '\n');
  assert.equal(readTailTitle(file), 'db migration');               // a --name / rename wins
});

test('only the tail is read — a huge transcript costs the same as a small one', () => {
  const file = tmpTranscript();
  const fat = JSON.stringify({ type: 'assistant', message: 'x'.repeat(20000) }) + '\n';
  fs.writeFileSync(file, AI('Buried at the very top') + '\n');
  for (let i = 0; i < 400; i++) fs.appendFileSync(file, fat);      // ~8MB of turns
  assert.ok(fs.statSync(file).size > 5e6);
  assert.equal(readTailTitle(file), null);            // out of reach, and that is fine
  fs.appendFileSync(file, AI('Still current') + '\n');
  assert.equal(readTailTitle(file), 'Still current'); // claude repeats it every turn
});
