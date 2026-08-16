// agy brain transcripts read back as card events — fixtures trimmed from a
// real ~/.gemini/antigravity-cli transcript (agy 1.1.13, 2026-08-16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { agyTranscript, parseAgyTranscript } = require('../src/main/agy-transcript.js');
const { listConversations } = require('../src/main/session-store.js');

const J = (o) => JSON.stringify(o);
const LINES = [
  J({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: '2026-08-16T13:11:12Z',
      content: '<USER_REQUEST>\nReply with exactly: MARK\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nlocal time…\n</ADDITIONAL_METADATA>' }),
  J({ step_index: 1, source: 'SYSTEM', type: 'CONVERSATION_HISTORY', status: 'DONE' }),
  J({ step_index: 2, source: 'MODEL', type: 'VIEW_FILE', status: 'DONE', created_at: '2026-08-16T13:11:13Z',
      content: 'Created At: 2026-08-16T13:11:13+08:00\nCompleted At: 2026-08-16T13:11:13+08:00\nFile Path: `file:///repo/a.js`\ncontents…' }),
  J({ step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-08-16T13:11:14Z', content: 'MARK' }),
  J({ step_index: 4, source: 'SYSTEM', type: 'CHECKPOINT', status: 'DONE', content: '{{ CHECKPOINT 0 }}' }),
];

test('a brain transcript replays as the conversation, not the harness', () => {
  const { events } = parseAgyTranscript(LINES);
  assert.deepEqual(events.map((e) => e.kind), ['user', 'tool', 'tool_result', 'assistant']);
  assert.equal(events[0].text, 'Reply with exactly: MARK', 'wrapper and metadata blocks stripped');
  assert.equal(events[1].toolKind, 'read');
  assert.match(events[2].body, /^File Path/, 'the Created/Completed header drops');
  assert.equal(events[3].text, 'MARK');
});

test('the lister reads the CLI store, not the IDE\'s dead .pb dir', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-agy-'));
  const cli = path.join(home, '.gemini', 'antigravity-cli', 'conversations');
  const ide = path.join(home, '.gemini', 'antigravity', 'conversations');
  fs.mkdirSync(cli, { recursive: true }); fs.mkdirSync(ide, { recursive: true });
  fs.writeFileSync(path.join(ide, 'old-ide.pb'), 'x');
  fs.writeFileSync(path.join(cli, 'fresh-cli.db'), 'x');
  const r = listConversations({ agent: 'agy', cwd: '/x', home });
  assert.deepEqual(r.conversations.map((c) => c.id), ['fresh-cli'], 'CLI store wins');
  // transcript path resolves under the CLI store too
  const bdir = path.join(home, '.gemini', 'antigravity-cli', 'brain', 'fresh-cli', '.system_generated', 'logs');
  fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, 'transcript.jsonl'), LINES.join('\n') + '\n');
  assert.ok(agyTranscript('fresh-cli', home));
});
