import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClockB, PTY_SETTLE_MS, PTY_DISCRETE_MS, PTY_DISCRETE_TRAIL_MS,
} from '../src/renderer/pty-notify.mjs';

// Fake time: schedule(ms, fn) runs when advance() crosses that mark.
function fakeTime() {
  let t = 0;
  let hid = 0;
  const q = [];
  return {
    now: () => t,
    schedule(ms, fn) {
      const h = ++hid;
      q.push({ h, at: t + ms, fn });
      return h;
    },
    cancel(h) {
      const i = q.findIndex((x) => x.h === h);
      if (i >= 0) q.splice(i, 1);
    },
    advance(ms) {
      t += ms;
      q.sort((a, b) => a.at - b.at || a.h - b.h);
      while (q.length && q[0].at <= t) q.shift().fn();
    },
  };
}

function clock() {
  const time = fakeTime();
  const sends = [];
  const b = createClockB({
    send: (m) => sends.push(m),
    now: time.now,
    schedule: time.schedule,
    cancel: time.cancel,
  });
  return { b, sends, time };
}

// ---- the hole we are patching ----------------------------------------------
// Replica of notifyPty in app.js before this branch: ptyDiscrete() makes
// delay 0 for 300ms, and delay 0 fires before the next frame's fit.
function runToday(sizes, { discrete = false, frameMs = 16 } = {}) {
  let t = 0;
  let fastUntil = 0;
  if (discrete) fastUntil = t + 300;
  const sends = [];
  let timer = null;
  const q = [];
  const flush = () => {
    q.sort((a, b) => a.at - b.at);
    while (q.length && q[0].at <= t) {
      const job = q.shift();
      if (job.dead) continue;
      job.fn();
    }
  };
  for (const [cols, rows] of sizes) {
    if (timer) timer.dead = true;
    const delay = t < fastUntil ? 0 : 140;
    const job = { at: t + delay, fn: () => sends.push({ cols, rows }) };
    timer = job;
    q.push(job);
    t += frameMs;
    flush();
  }
  t += 200;
  flush();
  return sends;
}

test('today: a discrete burst of five frames sends five times', () => {
  // This is the confirmation: expand / grip-drop calls ptyDiscrete(), then
  // Clock A fits for several frames. Each delay-0 timer fires before the next
  // fit, so the pty hears every intermediate size.
  const sends = runToday([[80, 24], [96, 24], [110, 28], [124, 30], [128, 32]], { discrete: true });
  assert.equal(sends.length, 5, `today sent ${sends.length}, expected 5 — if this fails the hole is already gone`);
});

test('today: a 140ms window-edge burst still coalesces to one', () => {
  const sends = runToday([[80, 24], [82, 24], [84, 24]], { discrete: false, frameMs: 16 });
  assert.equal(sends.length, 1);
});

// ---- the new clock ---------------------------------------------------------

test('discrete: five frames of changing size send once, at the last size', () => {
  const { b, sends, time } = clock();
  b.discrete();
  for (const cols of [80, 96, 110, 124, 128]) {
    b.notify('a', cols, 24);
    time.advance(16);
  }
  time.advance(PTY_DISCRETE_TRAIL_MS);
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0], { id: 'a', cols: 128, rows: 24 });
});

test('discrete: identical size is not sent twice', () => {
  const { b, sends, time } = clock();
  b.discrete();
  b.notify('a', 80, 24);
  time.advance(PTY_DISCRETE_TRAIL_MS);
  b.discrete();
  b.notify('a', 80, 24);
  time.advance(PTY_DISCRETE_TRAIL_MS);
  assert.equal(sends.length, 1);
});

test('settle: a window-edge drag sends once after 140ms of quiet', () => {
  const { b, sends, time } = clock();
  b.notify('a', 80, 24);
  time.advance(16);
  b.notify('a', 90, 24);
  time.advance(16);
  b.notify('a', 100, 24);
  time.advance(PTY_SETTLE_MS - 1);
  assert.equal(sends.length, 0);
  time.advance(2);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].cols, 100);
});

test('hold parks Clock B until flushPending', () => {
  const { b, sends, time } = clock();
  b.setHold('a', true);
  b.notify('a', 90, 24);
  time.advance(200);
  assert.equal(sends.length, 0);
  assert.equal(b.isPending('a'), true);
  b.setHold('a', false);
  b.flushPending('a', 100, 30);
  time.advance(PTY_SETTLE_MS);
  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0], { id: 'a', cols: 100, rows: 30 });
});

test('clearPending on a no-move press sends nothing', () => {
  const { b, sends, time } = clock();
  b.setHold('a', true);
  b.notify('a', 90, 24);
  b.setHold('a', false);
  b.clearPending('a');
  time.advance(200);
  assert.equal(sends.length, 0);
});

test('two tiles do not share a send', () => {
  const { b, sends, time } = clock();
  b.discrete();
  b.notify('a', 80, 24);
  b.notify('b', 40, 12);
  time.advance(PTY_DISCRETE_TRAIL_MS);
  assert.equal(sends.length, 2);
  const ids = sends.map((s) => s.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
});

test('constants match the comment in app.js', () => {
  assert.equal(PTY_SETTLE_MS, 140);
  assert.equal(PTY_DISCRETE_MS, 300);
  assert.ok(PTY_DISCRETE_TRAIL_MS > 0);
  assert.ok(PTY_DISCRETE_TRAIL_MS < PTY_SETTLE_MS);
});
