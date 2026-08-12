// The ACP adapter, tested against frames real agents produced (OpenCode and
// Hermes, recorded 2026-08-12, sanitised). handleFrame() takes parsed JSON-RPC
// messages directly: no child process, no protocol guesswork.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AcpAdapter, ACP_AGENTS } = require('../src/main/adapters/acp.js');
const { EVENT_KINDS } = require('../src/main/agent-events.js');

function fixtureFrames(name) {
  return fs.readFileSync(new URL(`./fixtures/agents/${name}`, import.meta.url), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
    .filter((r) => r.dir === 'in')
    .map((r) => r.msg);
}

// An adapter wired for replay: writes are captured, never sent anywhere.
function makeAdapter(agent = 'opencode') {
  const events = [];
  const writes = [];
  const a = new AcpAdapter({ id: 't1', cwd: '/repo', agent, onEvent: (e) => events.push(e) });
  a._write = (frame) => writes.push(frame);
  return { a, events, writes };
}

test('both ACP agents are in the table with their spawn spec', () => {
  assert.ok(ACP_AGENTS.opencode.args.includes('acp'));
  assert.ok(ACP_AGENTS.hermes.args.includes('acp'));
});

test('every event out of a full replay is in the vocabulary', () => {
  for (const f of ['opencode-acp.jsonl', 'opencode-write.jsonl', 'opencode-ask.jsonl', 'hermes-acp.jsonl', 'hermes-acp2.jsonl']) {
    const { a, events } = makeAdapter(f.startsWith('hermes') ? 'hermes' : 'opencode');
    for (const m of fixtureFrames(f)) a.handleFrame(m);
    for (const e of events) assert.ok(EVENT_KINDS.has(e.kind), `${f}: '${e.kind}' not in vocabulary`);
  }
});

test('message chunks coalesce into one assistant row that grows, not eighteen rows', () => {
  const { a, events } = makeAdapter();
  for (const m of fixtureFrames('opencode-acp.jsonl')) a.handleFrame(m);
  const texts = events.filter((e) => e.kind === 'assistant');
  assert.ok(texts.length >= 2, 'chunks should re-emit the growing text');
  const ids = new Set(texts.map((e) => e.id));
  assert.equal(ids.size, 1, 'one burst of chunks must share one row id');
  const last = texts.at(-1);
  assert.ok(last.text.length > texts[0].text.length, 'text must accumulate');
});

test('hermes thought chunks become one growing thinking row', () => {
  const { a, events } = makeAdapter('hermes');
  for (const m of fixtureFrames('hermes-acp2.jsonl')) a.handleFrame(m);
  const thoughts = events.filter((e) => e.kind === 'thinking');
  assert.ok(thoughts.length >= 2);
  assert.equal(new Set(thoughts.map((e) => e.id)).size, 1);
});

test('a typed tool_call keeps its ACP kind and its completion carries the output', () => {
  const { a, events } = makeAdapter();
  for (const m of fixtureFrames('opencode-write.jsonl')) a.handleFrame(m);
  const tools = events.filter((e) => e.kind === 'tool');
  assert.ok(tools.some((t) => t.toolKind === 'execute'));
  assert.ok(tools.some((t) => t.toolKind === 'read'));
  const results = events.filter((e) => e.kind === 'tool_result');
  assert.ok(results.some((r) => r.body && r.body.includes('README.md')), 'the ls output must land on the row');
});

test('a tool_call_update that improves the title re-emits the same row, not a new one', () => {
  const { a, events } = makeAdapter();
  // opencode announces `bash` then updates the same call to `ls`
  for (const m of fixtureFrames('opencode-write.jsonl')) a.handleFrame(m);
  const execEvents = events.filter((e) => e.kind === 'tool' && e.toolKind === 'execute');
  const perTool = new Map();
  for (const t of execEvents) perTool.set(t.toolId, (perTool.get(t.toolId) || 0) + 1);
  assert.ok([...perTool.values()].some((n) => n >= 2), 'the update must re-emit the call');
  const named = execEvents.filter((e) => e.name === 'ls');
  assert.ok(named.length >= 1, 'the improved title must arrive');
});

test('a permission renders what the agent sent: its own options, its own diff', () => {
  const { a, events, writes } = makeAdapter();
  for (const m of fixtureFrames('opencode-ask.jsonl')) a.handleFrame(m);
  const perm = events.find((e) => e.kind === 'permission');
  assert.ok(perm, 'no permission event');
  assert.ok(perm.options.length >= 3);
  assert.deepEqual(perm.options.map((o) => o.id).slice(0, 3), ['once', 'always', 'reject']);
  assert.match(perm.options[0].label, /Allow once/);
  assert.ok(perm.diff && perm.diff.newText === 'captured', 'the diff the ask carried must ride the event');

  // Answering sends the agent's own optionId back on the same rpc id.
  a.resolvePermission(perm.permissionId, 'always');
  const reply = writes.find((w) => w.result && w.result.outcome);
  assert.ok(reply, 'no outcome reply written');
  assert.equal(reply.result.outcome.outcome, 'selected');
  assert.equal(reply.result.outcome.optionId, 'always');
  const resolved = events.find((e) => e.kind === 'permission_resolved');
  assert.equal(resolved.optionId, 'always');
});

test('fs/read_text_file is answered with the file, fs/write_text_file writes only inside cwd', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-acp-'));
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello acp');
  const events = [];
  const writes = [];
  const a = new AcpAdapter({ id: 't2', cwd: tmp, agent: 'opencode', onEvent: (e) => events.push(e) });
  a._write = (f) => writes.push(f);

  a.handleFrame({ jsonrpc: '2.0', id: 9, method: 'fs/read_text_file', params: { sessionId: 's', path: path.join(tmp, 'a.txt') } });
  assert.equal(writes.at(-1).result.content, 'hello acp');

  a.handleFrame({ jsonrpc: '2.0', id: 10, method: 'fs/write_text_file', params: { sessionId: 's', path: path.join(tmp, 'b.txt'), content: 'written' } });
  assert.equal(fs.readFileSync(path.join(tmp, 'b.txt'), 'utf8'), 'written');
  assert.ok(writes.at(-1).result, 'write acked');

  // Outside the folder the session was given: refused, not performed.
  a.handleFrame({ jsonrpc: '2.0', id: 11, method: 'fs/write_text_file', params: { sessionId: 's', path: '/tmp/nami-acp-escape.txt', content: 'nope' } });
  assert.ok(writes.at(-1).error, 'escape must be refused');
  assert.ok(!fs.existsSync('/tmp/nami-acp-escape.txt'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the command list the agent publishes reaches init', () => {
  const { a, events } = makeAdapter();
  for (const m of fixtureFrames('opencode-acp.jsonl')) a.handleFrame(m);
  const inits = events.filter((e) => e.kind === 'init');
  const withCmds = inits.find((e) => e.commands && e.commands.length);
  assert.ok(withCmds, 'available_commands_update never surfaced');
  const names = withCmds.commands.map((c) => c.name);
  assert.ok(names.includes('customize-opencode'));
  assert.ok(withCmds.commands.some((c) => c.description), 'descriptions must ride through');
});

test('an unknown sessionUpdate kind is ignored, never thrown on', () => {
  const { a, events } = makeAdapter();
  a.handleFrame({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'brand_new_thing', data: 1 } } });
  a.handleFrame({ jsonrpc: '2.0', method: 'session/update', params: null });
  a.handleFrame(null);
  assert.equal(events.filter((e) => e.kind === 'error').length, 0);
});

test('settlePending closes every dangling call — hermes never completes its tool_calls', () => {
  const { a, events } = makeAdapter('hermes');
  for (const m of fixtureFrames('hermes-acp2.jsonl')) a.handleFrame(m);
  const calls = events.filter((e) => e.kind === 'tool').map((e) => e.toolId);
  const settledBefore = new Set(events.filter((e) => e.kind === 'tool_result').map((e) => e.toolId));
  assert.ok(calls.some((id) => !settledBefore.has(id)), 'the capture really does dangle a call');
  a.settlePending();
  const settledAfter = new Set(events.filter((e) => e.kind === 'tool_result').map((e) => e.toolId));
  for (const id of calls) assert.ok(settledAfter.has(id), 'every call must settle at end of turn');
});
