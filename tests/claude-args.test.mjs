import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { claudeSpawnArgs, projectSlug } = require('../src/main/claude-args.js');

const SID = '9f2c41ab-0000-4000-8000-c7d088e30000';

test('a fresh panel pins its own conversation id', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID, hasTranscript: false }), ['--session-id', SID]);
});

test('a restored panel resumes its OWN conversation, never --continue', () => {
  // this is the whole fix: four tiles restore as four conversations
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: SID, hasTranscript: true }), ['--resume', SID]);
});

test('a restored-but-never-used panel starts fresh keeping its id', () => {
  // --resume on a conversation with no transcript errors out of the CLI
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: SID, hasTranscript: false }), ['--session-id', SID]);
});

test('a legacy snapshot without an id falls back to --continue', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: null, hasTranscript: false }), ['--continue']);
});

test('no id, no restore: bare spawn', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: null, hasTranscript: false }), []);
});

test('a deliberately named tile pushes its name down into claude', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID, name: 'build: dark mode' }),
    ['--session-id', SID, '--name', 'build: dark mode']);
});

test('the name rides along on a resume too, so a rename sticks', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: true, sid: SID, hasTranscript: true, name: 'db migration' }),
    ['--resume', SID, '--name', 'db migration']);
});

test('an unnamed tile spawns exactly as before — no empty --name', () => {
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID, name: '   ' }), ['--session-id', SID]);
  assert.deepEqual(claudeSpawnArgs({ cont: false, sid: SID }), ['--session-id', SID]);
});

test('projectSlug matches claude transcript folder naming', () => {
  assert.equal(projectSlug('/Users/calvinhia/Desktop/dainami-cli'), '-Users-calvinhia-Desktop-dainami-cli');
  assert.equal(projectSlug('/tmp/a.b_c'), '-tmp-a-b-c');
});
