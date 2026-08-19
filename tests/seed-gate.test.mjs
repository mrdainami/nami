import { test } from 'node:test';
import assert from 'node:assert/strict';
import seedGate from '../src/main/seed-gate.js';
const { startSeedGate, sawEcho } = seedGate;

// A hand-cranked clock: timers fire only when the test advances it, so every
// race in the gate is a deterministic sequence here.
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { id++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (t) => timers.delete(t),
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let next = null;
        for (const [tid, t] of timers) if (t.at <= until && (!next || t.at < next.t.at)) next = { tid, t };
        if (!next) break;
        timers.delete(next.tid);
        now = next.t.at;
        next.t.fn();
      }
      now = until;
    },
  };
}

const SEED = 'Read .kimi-code/agents/reviewer.md and adopt it as your role.';

function harness(overrides = {}) {
  const c = clock();
  const writes = [];
  const gate = startSeedGate(Object.assign({
    write: (s) => writes.push(s),
    seed: SEED,
    firstDelay: 2500, echoWindow: 900, retryEvery: 1800, maxAttempts: 4,
    setTimer: c.setTimer, clearTimer: c.clearTimer,
  }, overrides));
  return { c, writes, gate };
}

test('sawEcho: an echoed seed is found through ANSI paint and rewrapping', () => {
  // What codex actually does to a typed line: colour it, break it at its own
  // width, indent the continuation.
  const painted = '\x1b[22m Read .kimi-code/agents/reviewer\r\n\x1b[11;1H  .md and adopt';
  assert.equal(sawEcho(painted, SEED), true);
});

test('sawEcho: a spinner narrating similar words is not an echo', () => {
  assert.equal(sawEcho('\x1b[1G\x1b[0K/ Reading configuration files', SEED), false);
});

test('an input box that echoes gets the seed and one Enter', () => {
  const { c, writes, gate } = harness();
  c.advance(2500);
  assert.deepEqual(writes, [SEED], 'seed typed at firstDelay');
  gate.onData('\x1b[38;5;231m' + SEED);          // the app painted the typing back
  c.advance(200);
  assert.deepEqual(writes, [SEED, '\r'], 'Enter follows a seen echo');
  c.advance(60000);
  assert.deepEqual(writes, [SEED, '\r'], 'and only once');
});

test('a silent dialog never gets Enter — the seed is retyped instead', () => {
  const { c, writes, gate } = harness();
  c.advance(2500);
  gate.onData("Trust this folder?\r\n> Don't trust");  // dialog repaints, no echo
  c.advance(1800);
  assert.deepEqual(writes, [SEED, SEED], 'no echo: swallowed text is retyped');
  assert.ok(!writes.includes('\r'), 'and Enter is never sent into the dialog');
});

test('the dialog answered mid-flight, a later attempt lands', () => {
  const { c, writes, gate } = harness();
  c.advance(2500 + 1800);                        // attempt 1 swallowed, attempt 2 typed
  gate.onData(SEED.slice(0, 30));                // now there is an input box echoing
  gate.onData(SEED.slice(30));
  c.advance(200);
  assert.equal(writes.filter((w) => w === '\r').length, 1);
});

test('a slow echo still gets its Enter, not a duplicate seed', () => {
  const { c, writes, gate } = harness();
  c.advance(2500);
  c.advance(1200);                               // echoWindow passed, retry not yet due
  gate.onData(SEED);                             // batched repaint arrives late
  c.advance(200);
  assert.deepEqual(writes, [SEED, '\r']);
  c.advance(60000);
  assert.equal(writes.filter((w) => w === SEED).length, 1, 'no retype after a late echo');
});

test('bounded: after maxAttempts silent tries it gives up typing', () => {
  const { c, writes } = harness();
  c.advance(2500 + 1800 * 10);
  assert.equal(writes.filter((w) => w === SEED).length, 4, 'maxAttempts seeds, then silence');
  assert.ok(!writes.includes('\r'));
});

test('stop() ends everything — a dead session gets no ghost typing', () => {
  const { c, writes, gate } = harness();
  c.advance(2500);
  gate.stop();
  gate.onData(SEED);
  c.advance(60000);
  assert.deepEqual(writes, [SEED], 'nothing after stop, not even the Enter');
});
