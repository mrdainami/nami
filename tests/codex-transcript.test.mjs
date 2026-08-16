// Codex rollouts read back as card events — fixtures trimmed from real
// rollouts on this Mac (cli 0.147): the huge session_meta line, injected
// user records, exec_command with its output, apply_patch, reasoning
// summaries, and the task_started/task_complete brackets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { codexRollout, parseCodexRollout, codexBacklog } = require('../src/main/codex-transcript.js');

const J = (o) => JSON.stringify(o);
const R = (type, payload, timestamp) => J({ timestamp: timestamp || '2026-08-16T12:00:00.000Z', type, payload });

const FIXTURE = [
  R('session_meta', { id: 'th_1', cwd: '/repo' }),
  R('event_msg', { type: 'task_started', turn_id: 't1' }, '2026-08-16T12:00:00.000Z'),
  R('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context><cwd>/repo</cwd></environment_context>' }] }),
  R('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /repo\n…' }] }),
  R('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<skills_instructions>…' }] }),
  R('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rename greet to welcome' }] }),
  R('response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Scanning for call sites first.' }], encrypted_content: 'gAAAA…' }),
  R('response_item', { type: 'reasoning', summary: [], encrypted_content: 'gAAAA…' }),
  R('response_item', { type: 'function_call', name: 'exec_command', call_id: 'call_1', arguments: J({ cmd: "/bin/zsh -lc \"grep -rl 'greet(' src/\"" }) }),
  R('response_item', { type: 'function_call_output', call_id: 'call_1', output: 'src/greet.js\nProcess exited with code 0' }),
  R('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'call_2', input: '*** Begin Patch\n…' }),
  R('response_item', { type: 'custom_tool_call_output', call_id: 'call_2', output: 'Done. Process exited with code 1' }),
  R('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Renamed across 3 files.' }] }),
  R('event_msg', { type: 'token_count', total: 1200 }),
  R('event_msg', { type: 'task_complete', turn_id: 't1' }, '2026-08-16T12:00:42.000Z'),
];

test('a rollout replays as the conversation, not the bookkeeping', () => {
  const { events, partial } = parseCodexRollout(FIXTURE);
  assert.equal(partial, false);
  assert.deepEqual(events.map((e) => e.kind),
    ['user', 'thinking', 'tool', 'tool_result', 'tool', 'tool_result', 'assistant', 'turn_end']);
  assert.equal(events[0].text, 'rename greet to welcome', 'injected user records never render');
  assert.equal(events[1].text, 'Scanning for call sites first.', 'encrypted-only reasoning is silent');
  assert.equal(events[2].name, 'Bash');
  assert.equal(events[2].toolKind, 'execute');
  assert.equal(events[2].input.command, "grep -rl 'greet(' src/", 'the zsh -lc wrapper unwraps');
  assert.equal(events[3].toolId, 'call_1');
  assert.equal(events[3].isError, false);
  assert.equal(events[4].toolKind, 'edit', 'apply_patch is an edit');
  assert.equal(events[5].isError, true, 'a non-zero exit is an errored row');
  assert.equal(events[7].durationMs, 42000, 'turn duration from the task brackets');
});

test('codexRollout finds the file its thread id names', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-codex-'));
  const dir = path.join(home, '.codex', 'sessions', '2026', '08', '16');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-2026-08-16T12-00-00-th_abc123.jsonl');
  fs.writeFileSync(file, FIXTURE.join('\n') + '\n');
  assert.equal(codexRollout('th_abc123', home), file);
  assert.equal(codexRollout('th_missing', home), null);
  const back = codexBacklog(file);
  assert.equal(back.events.length, 8);
  assert.equal(back.partial, false);
});
