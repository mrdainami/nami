import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPtyCwd, TTL_MS } = require('../src/main/pty-cwd.js');

// A stand-in for child_process.execFile: answers from a script, and records
// every invocation so "did it shell out at all" is asserted rather than
// assumed. The real thing is never called — a test that runs lsof would pass
// on this machine and fail on a build box.
function fakeExec(answers) {
  const calls = [];
  const run = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    const next = answers.shift();
    if (!next) return cb(new Error('no answer queued'), '');
    setImmediate(() => cb(next.err || null, next.out || ''));
  };
  run.calls = calls;
  return run;
}

// Frozen clock: the TTL is asserted, not slept through.
function clock(start = 0) {
  let now = start;
  const fn = () => now;
  fn.advance = (ms) => { now += ms; };
  return fn;
}

const LSOF_OUT = 'p48221\nfcwd\nn/Users/cal/work/atlas/src/renderer\n';

test('reads the cwd out of lsof -Fn output', async () => {
  const run = fakeExec([{ out: LSOF_OUT }]);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock() });
  assert.equal(await ptyCwd(48221), '/Users/cal/work/atlas/src/renderer');
  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.calls[0].args, ['-a', '-d', 'cwd', '-p', '48221', '-Fn']);
});

test('a path with spaces survives — only the leading n is stripped', async () => {
  const run = fakeExec([{ out: 'p1\nfcwd\nn/Users/cal/My Work/a b\n' }]);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock() });
  assert.equal(await ptyCwd(1), '/Users/cal/My Work/a b');
});

test('a second ask inside the TTL does not shell out again', async () => {
  const run = fakeExec([{ out: LSOF_OUT }]);
  const now = clock();
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now });
  await ptyCwd(48221);
  now.advance(TTL_MS - 1);
  assert.equal(await ptyCwd(48221), '/Users/cal/work/atlas/src/renderer');
  assert.equal(run.calls.length, 1, 'cache should have answered');
});

test('past the TTL it asks again — a session that cd\'d must not stay stale', async () => {
  const run = fakeExec([{ out: LSOF_OUT }, { out: 'p1\nfcwd\nn/Users/cal/work/atlas/tests\n' }]);
  const now = clock();
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now });
  await ptyCwd(48221);
  now.advance(TTL_MS + 1);
  assert.equal(await ptyCwd(48221), '/Users/cal/work/atlas/tests');
  assert.equal(run.calls.length, 2);
});

test('a failed lsof is null, not a throw — the caller keeps the frozen answer', async () => {
  const run = fakeExec([{ err: new Error('exit 1') }]);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock() });
  assert.equal(await ptyCwd(999), null);
});

test('output with no n row is null', async () => {
  const run = fakeExec([{ out: 'p48221\nfcwd\n' }]);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock() });
  assert.equal(await ptyCwd(48221), null);
});

test('a failure is cached too — a dead pid must not be asked 60 times a minute', async () => {
  const run = fakeExec([{ err: new Error('exit 1') }]);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock() });
  await ptyCwd(999);
  assert.equal(await ptyCwd(999), null);
  assert.equal(run.calls.length, 1);
});

test('off darwin it answers null without running anything', async () => {
  const run = fakeExec([{ out: LSOF_OUT }]);
  const ptyCwd = createPtyCwd({ run, platform: 'win32', now: clock() });
  assert.equal(await ptyCwd(48221), null);
  assert.equal(run.calls.length, 0);
});

test('no pid is null without running anything', async () => {
  const run = fakeExec([]);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock() });
  assert.equal(await ptyCwd(0), null);
  assert.equal(await ptyCwd(undefined), null);
  assert.equal(run.calls.length, 0);
});

test('the timeout is passed down — a hung lsof must not hang the hover', async () => {
  const run = fakeExec([{ out: LSOF_OUT }]);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock() });
  await ptyCwd(48221);
  assert.ok(run.calls[0].opts.timeout > 0 && run.calls[0].opts.timeout <= 1000);
});

test('the cache is bounded — a long session must not grow it forever', async () => {
  const answers = [];
  for (let i = 0; i < 205; i++) answers.push({ out: 'p1\nfcwd\n/n' });
  const run = fakeExec(answers);
  const ptyCwd = createPtyCwd({ run, platform: 'darwin', now: clock(), max: 100 });
  for (let i = 1; i <= 205; i++) await ptyCwd(i);
  assert.ok(ptyCwd.size() <= 100, 'cache grew past its cap: ' + ptyCwd.size());
});
