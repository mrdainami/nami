// The registry that owns one live agent runtime per tile. A fake adapter
// stands in for the SDK so lifecycle is what's tested, not Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AgentSessions, ADAPTERS, claudeTranscript } = require('../src/main/agent-session.js');

class FakeAdapter {
  constructor({ id, onEvent }) { this.id = id; this.onEvent = onEvent; this.sent = []; this.closed = false; FakeAdapter.made.push(this); }
  async start(opts) { this.startOpts = opts; return true; }
  send(t) { this.sent.push(t); }
  resolvePermission(pid, opt) { this.resolved = [pid, opt]; }
  interrupt() { this.interrupted = true; }
  close() { this.closed = true; }
}
FakeAdapter.made = [];

async function withFake(fn) {
  FakeAdapter.made = [];
  ADAPTERS.fake = FakeAdapter;
  try { return await fn(); } finally { delete ADAPTERS.fake; }
}

test('start / send / permission / interrupt / stop route to the one adapter', async () => {
  await withFake(async () => {
    const reg = new AgentSessions();
    const r = await reg.start({ id: 't1', agent: 'fake', cwd: '/repo', onEvent: () => {} });
    assert.equal(r.ok, true);
    assert.ok(reg.send('t1', 'hello'));
    assert.ok(reg.permission('t1', 'p1', 'allow'));
    assert.ok(reg.interrupt('t1'));
    const a = FakeAdapter.made[0];
    assert.deepEqual(a.sent, ['hello']);
    assert.deepEqual(a.resolved, ['p1', 'allow']);
    assert.ok(a.interrupted);
    assert.ok(reg.stop('t1'));
    assert.ok(a.closed);
    assert.equal(reg.has('t1'), false);
  });
});

test('an unknown agent refuses with a reason instead of hanging', async () => {
  const reg = new AgentSessions();
  const r = await reg.start({ id: 't1', agent: 'mystery', cwd: '/repo', onEvent: () => {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /mystery/);
});

test('a second start on the same tile closes the first runtime — never two', async () => {
  await withFake(async () => {
    const reg = new AgentSessions();
    await reg.start({ id: 't1', agent: 'fake', cwd: '/repo', onEvent: () => {} });
    await reg.start({ id: 't1', agent: 'fake', cwd: '/repo', onEvent: () => {} });
    assert.equal(FakeAdapter.made.length, 2);
    assert.ok(FakeAdapter.made[0].closed, 'the first runtime must die');
    assert.ok(!FakeAdapter.made[1].closed);
    assert.equal(reg.size, 1);
    reg.stopAll();
  });
});

test('stopAll reaps everything, or just what the filter names', async () => {
  await withFake(async () => {
    const reg = new AgentSessions();
    await reg.start({ id: 'a', agent: 'fake', cwd: '/repo', onEvent: () => {} });
    await reg.start({ id: 'b', agent: 'fake', cwd: '/repo', onEvent: () => {} });
    reg.stopAll((id) => id === 'a');
    assert.equal(reg.has('a'), false);
    assert.equal(reg.has('b'), true);
    reg.stopAll();
    assert.equal(reg.size, 0);
  });
});

test('claudeTranscript finds the file the pty path would resume', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-t-'));
  const cwd = '/repo/proj';
  const dir = path.join(home, '.claude', 'projects', '-repo-proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ses_test.jsonl'), '{}\n');
  assert.ok(claudeTranscript(cwd, 'ses_test', home));
  assert.equal(claudeTranscript(cwd, 'ses_other', home), null);
  assert.equal(claudeTranscript(cwd, null, home), null);
  fs.rmSync(home, { recursive: true, force: true });
});
