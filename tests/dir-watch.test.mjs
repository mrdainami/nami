import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDirWatch, IGNORE } = require('../src/main/dir-watch.js');

// A stand-in for fs.watch: hands back a handle the test can fire events on,
// and records every close so watcher leaks are visible rather than inferred.
function fakeWatch() {
  const handles = new Map();
  const closed = [];
  function watch(dir, _opts, cb) {
    const h = { dir, cb, closed: false, close() { this.closed = true; closed.push(dir); } };
    handles.set(dir, h);
    return h;
  }
  watch.handles = handles;
  watch.closed = closed;
  watch.fire = (dir, filename) => {
    const h = handles.get(dir);
    if (!h) throw new Error('no watcher open on ' + dir);
    h.cb('change', filename);
  };
  return watch;
}

// Fake timers, so debounce is asserted rather than slept through.
function fakeClock() {
  let now = 0;
  const jobs = [];
  const setT = (fn, ms) => { const j = { fn, at: now + ms, live: true }; jobs.push(j); return j; };
  const clearT = (j) => { if (j) j.live = false; };
  setT.advance = (ms) => {
    now += ms;
    for (const j of jobs.slice()) if (j.live && j.at <= now) { j.live = false; j.fn(); }
  };
  return { setT, clearT };
}

function harness(opts = {}) {
  const watch = fakeWatch();
  const { setT, clearT } = fakeClock();
  const changed = [];
  const w = createDirWatch({
    watch,
    onChange: (dir) => changed.push(dir),
    setTimeoutFn: setT,
    clearTimeoutFn: clearT,
    ...opts,
  });
  return { w, watch, changed, advance: setT.advance };
}

test('declares exactly the directories asked for', () => {
  const { w, watch } = harness();
  w.declare(['/p', '/p/src', '/p/src/main']);
  assert.deepEqual([...watch.handles.keys()], ['/p', '/p/src', '/p/src/main']);
  assert.equal(w.count(), 3);
});

test('re-declaring a subset closes the dropped ones and reopens nothing', () => {
  const { w, watch } = harness();
  w.declare(['/p', '/p/src', '/p/src/main']);
  const firstHandle = watch.handles.get('/p');
  w.declare(['/p', '/p/src']);
  assert.deepEqual(watch.closed, ['/p/src/main'], 'only the collapsed dir closes');
  assert.equal(w.count(), 2);
  assert.equal(watch.handles.get('/p'), firstHandle, '/p was kept, not churned');
});

test('two events inside the debounce window emit one change', () => {
  const { w, watch, changed, advance } = harness({ debounceMs: 200 });
  w.declare(['/p']);
  watch.fire('/p', 'a.txt');
  watch.fire('/p', 'b.txt');
  advance(199);
  assert.deepEqual(changed, [], 'nothing before the window closes');
  advance(1);
  assert.deepEqual(changed, ['/p'], 'coalesced into one');
});

test('events in different directories debounce independently', () => {
  const { w, watch, changed, advance } = harness({ debounceMs: 200 });
  w.declare(['/p', '/p/src']);
  watch.fire('/p', 'a.txt');
  watch.fire('/p/src', 'b.txt');
  advance(200);
  assert.deepEqual(changed.sort(), ['/p', '/p/src']);
});

test('the watcher cap holds, and the overflow is reported not swallowed', () => {
  const { w } = harness({ max: 64 });
  const many = Array.from({ length: 100 }, (_, i) => '/p/d' + i);
  const res = w.declare(many);
  assert.equal(w.count(), 64);
  assert.equal(res.overflow, 36);
  assert.equal(res.watching, 64);
});

test('an ignored name emits nothing — .git must not storm the tree', () => {
  const { w, watch, changed, advance } = harness();
  w.declare(['/p']);
  for (const name of ['.git', 'node_modules', '.DS_Store', 'dist']) watch.fire('/p', name);
  advance(1000);
  assert.deepEqual(changed, [], 'every ignored name was dropped at the source');
  assert.ok(IGNORE.has('.git'), 'the set is the one dir:list filters on');
});

test('a real change alongside ignored noise still lands', () => {
  const { w, watch, changed, advance } = harness();
  w.declare(['/p']);
  watch.fire('/p', '.git');
  watch.fire('/p', 'notes.md');
  advance(1000);
  assert.deepEqual(changed, ['/p']);
});

test('a null filename emits — correctness beats quiet when the OS tells us nothing', () => {
  const { w, watch, changed, advance } = harness();
  w.declare(['/p']);
  watch.fire('/p', null);
  advance(1000);
  assert.deepEqual(changed, ['/p']);
});

test('closeAll drops every watcher and pending timer', () => {
  const { w, watch, changed, advance } = harness();
  w.declare(['/p', '/p/src']);
  watch.fire('/p', 'a.txt');
  w.closeAll();
  assert.equal(w.count(), 0);
  assert.deepEqual(watch.closed.sort(), ['/p', '/p/src']);
  advance(1000);
  assert.deepEqual(changed, [], 'a pending debounce must not fire after teardown');
});

test('declaring the same set twice is a no-op, not a churn', () => {
  const { w, watch } = harness();
  w.declare(['/p', '/p/src']);
  w.declare(['/p', '/p/src']);
  assert.deepEqual(watch.closed, []);
  assert.equal(w.count(), 2);
});

test('a directory that cannot be watched is skipped, not fatal', () => {
  const watch = fakeWatch();
  const boom = (dir, opts, cb) => {
    if (dir === '/p/gone') throw new Error('ENOENT');
    return watch(dir, opts, cb);
  };
  const { setT, clearT } = fakeClock();
  const w = createDirWatch({ watch: boom, onChange: () => {}, setTimeoutFn: setT, clearTimeoutFn: clearT });
  const res = w.declare(['/p', '/p/gone', '/p/src']);
  assert.equal(w.count(), 2, 'the two good dirs are still watched');
  assert.equal(res.failed, 1);
});

test('duplicate paths in one declaration count once', () => {
  const { w } = harness();
  w.declare(['/p', '/p', '/p/src']);
  assert.equal(w.count(), 2);
});
