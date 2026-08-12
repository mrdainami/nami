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
  assert.equal(projectSlug('/Users/dev/code/nami'), '-Users-dev-code-nami');
  assert.equal(projectSlug('/tmp/a.b_c'), '-tmp-a-b-c');
});

// ---- what actually gets typed on the fallback path -------------------------
// With no resolvable binary, Nami spawns a shell and types the claude command
// into it. That path used to be reached through a seed marker that made it type
// a bare `claude`, dropping --session-id, --resume and --name. The id was then
// never pinned, so the title watcher followed a transcript nothing wrote and
// the tile came back empty on the next launch.
const { shellQuote } = require('../src/main/claude-args.js');
const typed = (o) => ['claude', ...claudeSpawnArgs(o)].map(shellQuote).join(' ');

test('the shell fallback types the whole command, not a bare claude', () => {
  assert.equal(
    typed({ sid: '90a00e7a-98c8-4d98-8f03-6a536cfd1aeb', cont: false, hasTranscript: false, name: null }),
    'claude --session-id 90a00e7a-98c8-4d98-8f03-6a536cfd1aeb',
  );
  assert.equal(
    typed({ sid: '90a00e7a', cont: true, hasTranscript: true, name: null }),
    'claude --resume 90a00e7a',
  );
  assert.equal(typed({ cont: true, sid: null }), 'claude --continue');
});

// A name is a sentence. Unquoted it arrives as four arguments and claude either
// errors or takes the first word as the name.
test('a multi-word session name survives being typed into a shell', () => {
  assert.equal(
    typed({ sid: 'abc', cont: false, hasTranscript: false, name: 'Add the export button' }),
    "claude --session-id abc --name 'Add the export button'",
  );
});

test('shellQuote leaves plain arguments alone and neutralises the rest', () => {
  assert.equal(shellQuote('--session-id'), '--session-id');
  assert.equal(shellQuote('/Users/x/.local/bin/claude'), '/Users/x/.local/bin/claude');
  assert.equal(shellQuote('two words'), "'two words'");
  assert.equal(shellQuote(''), "''");
  // nothing inside single quotes expands: no variable, no subshell, no glob
  assert.equal(shellQuote('$HOME'), "'$HOME'");
  assert.equal(shellQuote('`whoami`'), "'`whoami`'");
  assert.equal(shellQuote('a; rm -rf /'), "'a; rm -rf /'");
  assert.equal(shellQuote('*'), "'*'");
  // the one character single quotes cannot carry, closed and reopened
  assert.equal(shellQuote("Cal's button"), "'Cal'\\''s button'");
});
