// Kimi wire logs read back as card events — fixtures trimmed from real
// wires on this Mac (protocol 1.5): the prompt, think/text parts, a Bash
// tool.call with its result, and the turn.ended duration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { kimiWire, parseKimiWire, kimiBacklog } = require('../src/main/kimi-transcript.js');

const J = (o) => JSON.stringify(o);
const WIRE = [
  J({ type: 'metadata', protocol_version: '1.5' }),
  J({ type: 'turn.prompt', input: [{ type: 'text', text: 'hey whats good' }], time: 1 }),
  J({ type: 'context.append_loop_event', event: { type: 'step.begin', step: 1 }, time: 2 }),
  J({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'Simple greeting.' } }, time: 3 }),
  J({ type: 'context.append_loop_event', event: { type: 'tool.call', toolCallId: 'Bash_0', name: 'Bash', args: { command: 'ls' } }, time: 4 }),
  J({ type: 'context.append_loop_event', event: { type: 'tool.result', toolCallId: 'Bash_0', result: { output: 'README.md' } }, time: 5 }),
  J({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'Not much — ready to help.' } }, time: 6 }),
  J({ type: 'usage.record', usage: { output: 47 }, time: 7 }),
  J({ type: 'turn.ended', turnId: 0, reason: 'completed', durationMs: 4753, time: 8 }),
];

test('a wire log replays as the conversation, not the protocol', () => {
  const { events, partial } = parseKimiWire(WIRE);
  assert.equal(partial, false);
  assert.deepEqual(events.map((e) => e.kind), ['user', 'thinking', 'tool', 'tool_result', 'assistant', 'turn_end']);
  assert.equal(events[0].text, 'hey whats good');
  assert.equal(events[2].name, 'Bash');
  assert.equal(events[2].toolKind, 'execute', 'Claude-shaped names map by kind');
  assert.equal(events[3].body, 'README.md');
  assert.equal(events[5].durationMs, 4753);
});

test('kimiWire resolves the file through the session index', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-kimi-'));
  const sdir = path.join(home, 'sessions', 's1');
  fs.mkdirSync(path.join(sdir, 'agents', 'main'), { recursive: true });
  fs.writeFileSync(path.join(sdir, 'agents', 'main', 'wire.jsonl'), WIRE.join('\n') + '\n');
  fs.mkdirSync(path.join(home, '.kimi-code'), { recursive: true });
  fs.writeFileSync(path.join(home, '.kimi-code', 'session_index.jsonl'),
    J({ sessionId: 'sess_1', sessionDir: sdir, workDir: '/repo' }) + '\n');
  const file = kimiWire('sess_1', home);
  assert.ok(file, 'the index names the dir');
  assert.equal(kimiBacklog(file).events.length, 6);
  assert.equal(kimiWire('sess_missing', home), null);
});
