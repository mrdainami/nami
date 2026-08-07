import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OpenAISession } from '../src/main/openai-driver.js';

function fakeFetch(script) {
  // script: array of response message objects, returned one per call
  let n = 0;
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const msg = script[Math.min(n, script.length - 1)]; n += 1;
    return { ok: true, json: async () => ({ choices: [{ message: msg }] }), text: async () => '' };
  };
  impl.calls = calls;
  return impl;
}

function collect(session) {
  const events = [];
  session.onEvent = (ev) => {
    events.push(ev);
    if (ev.kind === 'permission') session.resolvePermission(ev.permissionId, events.allow !== false);
  };
  return events;
}

test('tool round-trip: model calls run_command, output feeds back, final text ends turn', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-drv-'));
  const f = fakeFetch([
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'echo hello-world' }) } }] },
    { role: 'assistant', content: 'The command printed hello-world.' },
  ]);
  const s = new OpenAISession({ id: 't1', cwd, config: { baseUrl: 'http://x/v1', model: 'test' }, fetchImpl: f });
  const events = collect(s);
  s.send('run echo');
  while (s.running || !events.some((e) => e.kind === 'result')) await new Promise((r) => setTimeout(r, 20));
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, ['user_echo', 'tool', 'permission', 'tool_result', 'assistant', 'result']);
  assert.equal(events.find((e) => e.kind === 'tool_result').isError, false);
  // the second model call must have received the tool output
  const second = f.calls[1].body.messages;
  const toolMsg = second.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /hello-world/);
  assert.equal(events.find((e) => e.kind === 'result').ok, true);
});

test('denied permission: tool is not executed, denial is reported to the model', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-drv-'));
  const marker = path.join(cwd, 'must-not-exist.txt');
  const f = fakeFetch([
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: marker, content: 'x' }) } }] },
    { role: 'assistant', content: 'Understood, skipping the write.' },
  ]);
  const s = new OpenAISession({ id: 't2', cwd, config: { baseUrl: 'http://x/v1', model: 'test' }, fetchImpl: f });
  const events = collect(s);
  events.allow = false;
  s.send('write a file');
  while (s.running || !events.some((e) => e.kind === 'result')) await new Promise((r) => setTimeout(r, 20));
  assert.ok(!fs.existsSync(marker), 'file must not be written after deny');
  const toolMsg = f.calls[1].body.messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /denied/);
  assert.equal(events.find((e) => e.kind === 'tool_result').isError, true);
});

test('reads inside cwd are auto-allowed (no permission event)', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-drv-'));
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'paper');
  const f = fakeFetch([
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'note.txt' }) } }] },
    { role: 'assistant', content: 'It says paper.' },
  ]);
  const s = new OpenAISession({ id: 't3', cwd, config: { baseUrl: 'http://x/v1', model: 'test' }, fetchImpl: f });
  const events = collect(s);
  s.send('read the note');
  while (s.running || !events.some((e) => e.kind === 'result')) await new Promise((r) => setTimeout(r, 20));
  assert.ok(!events.some((e) => e.kind === 'permission'), 'no permission for in-cwd read');
  const toolMsg = f.calls[1].body.messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.content, 'paper');
});

test('HTTP error surfaces as error + failed result', async () => {
  const f = async () => ({ ok: false, status: 500, text: async () => 'boom', json: async () => ({}) });
  const s = new OpenAISession({ id: 't4', cwd: os.tmpdir(), config: { baseUrl: 'http://x/v1', model: 'test' }, fetchImpl: f });
  const events = collect(s);
  s.send('hi');
  while (s.running || !events.some((e) => e.kind === 'result')) await new Promise((r) => setTimeout(r, 20));
  assert.ok(events.some((e) => e.kind === 'error' && /500/.test(e.message)));
  assert.equal(events.find((e) => e.kind === 'result').ok, false);
});
