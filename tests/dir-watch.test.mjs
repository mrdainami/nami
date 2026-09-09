import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDirWatch, IGNORE } = require('../src/main/dir-watch.js');

// A stand-in for fs.watch: one recursive watcher, and the test fires events at
// it the way the OS would — with a path relative to the root, not a bare name.
function fakeWatch() {
  const opened = [];
  const closed = [];
  let live = null;
  function watch(dir, opts, cb) {
    opened.push({ dir, recursive: !!(opts && opts.recursive) });
    live = { dir, cb, close() { closed.push(dir); live = null; } };
    return live;
  }
  watch.opened = opened;
  watch.closed = closed;
  watch.fire = (rel) => {
    if (!live) throw new Error('nothing is being watched');
    live.cb('change', rel);
  };
  watch.isOpen = () => !!live;
  return watch;
}

// Fake timers, so the debounce and its ceiling are asserted rather than slept
// through. advance(ms) runs whatever has come due, in order.
function fakeClock() {
  let now = 0;
  const jobs = [];
  const setT = (fn, ms) => { const j = { fn, at: now + ms, live: true }; jobs.push(j); return j; };
  const clearT = (j) => { if (j) j.live = false; };
  setT.advance = (ms) => {
    const target = now + ms;
    for (;;) {
      const due = jobs.filter((j) => j.live && j.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at; due.live = false; due.fn();
    }
    now = target;
  };
  return { setT, clearT };
}

function harness(opts = {}) {
  const watch = fakeWatch();
  const { setT, clearT } = fakeClock();
  const changed = [];
  const events = [];            // the same flushes, with the file names attached
  const w = createDirWatch({
    watch,
    onChange: (dir, files) => { changed.push(dir); events.push({ dir, files }); },
    setTimeoutFn: setT,
    clearTimeoutFn: clearT,
    ...opts,
  });
  return { w, watch, changed, events, advance: setT.advance };
}

// ---- one watcher, on the root ----------------------------------------------

test('watching a project opens exactly one recursive watcher', () => {
  const { w, watch } = harness();
  w.watchRoot('/p');
  assert.equal(watch.opened.length, 1);
  assert.deepEqual(watch.opened[0], { dir: '/p', recursive: true });
  assert.equal(w.count(), 1);
});

test('watching a second project closes the first', () => {
  const { w, watch } = harness();
  w.watchRoot('/p');
  w.watchRoot('/q');
  assert.deepEqual(watch.closed, ['/p']);
  assert.deepEqual(watch.opened.map((o) => o.dir), ['/p', '/q']);
  assert.equal(w.count(), 1, 'one project, one watcher — never two');
});

test('watching the same project twice does not churn the watcher', () => {
  const { w, watch } = harness();
  w.watchRoot('/p');
  w.watchRoot('/p');
  assert.equal(watch.opened.length, 1, 'the open handle was kept');
  assert.deepEqual(watch.closed, []);
});

test('watching nothing closes what was open', () => {
  const { w, watch } = harness();
  w.watchRoot('/p');
  w.watchRoot(null);
  assert.deepEqual(watch.closed, ['/p']);
  assert.equal(w.count(), 0);
});

test('a root that cannot be watched is reported, not thrown', () => {
  const { setT, clearT } = fakeClock();
  const w = createDirWatch({
    watch: () => { throw new Error('ENOENT'); },
    onChange: () => {}, setTimeoutFn: setT, clearTimeoutFn: clearT,
  });
  const res = w.watchRoot('/gone');
  assert.equal(res.watching, 0);
  assert.equal(res.failed, 1);
  assert.equal(w.count(), 0);
});

// ---- which directory changed ------------------------------------------------
// This is the whole point of going recursive: an event carries a path, and the
// tree needs the folder that path sits in — however deep it is.

test('a file at the root reports the root', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire('README.md');
  advance(1000);
  assert.deepEqual(changed, ['/p']);
});

test('a file three folders down reports its own folder', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire('src/ui/parts/a.js');
  advance(1000);
  assert.deepEqual(changed, ['/p/src/ui/parts'],
    'the folder the file is in — not the root, and not the file');
});

test('a new folder one level down reports the folder holding it', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire('src/components');
  advance(1000);
  assert.deepEqual(changed, ['/p/src']);
});

test('changes in different folders are reported separately', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire('ui/a.js');
  watch.fire('api/b.js');
  advance(1000);
  assert.deepEqual(changed.sort(), ['/p/api', '/p/ui']);
});

test('a null filename reports the root — correctness beats quiet', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire(null);
  advance(1000);
  assert.deepEqual(changed, ['/p']);
});

// ---- which files changed ----------------------------------------------------
// The tree only ever needed the folder. A file open on the desk needs to know
// whether it was the one that moved, and re-reading every open panel on every
// event is how a build turns into a hundred pointless reads.

test('a flush names the file that moved, as a path the renderer can match', () => {
  const { w, watch, events, advance } = harness();
  w.watchRoot('/p');
  watch.fire('src/ui/parts/a.js');
  advance(1000);
  assert.deepEqual(events, [{ dir: '/p/src/ui/parts', files: ['/p/src/ui/parts/a.js'] }],
    'absolute, because that is what an open panel stores');
});

test('several files in one folder coalesce into one flush naming all of them', () => {
  const { w, watch, events, advance } = harness();
  w.watchRoot('/p');
  watch.fire('notes.md');
  watch.fire('todo.md');
  advance(1000);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].files.sort(), ['/p/notes.md', '/p/todo.md']);
});

test('the same file written twice inside the window is named once', () => {
  const { w, watch, events, advance } = harness();
  w.watchRoot('/p');
  watch.fire('notes.md');
  watch.fire('notes.md');
  advance(1000);
  assert.deepEqual(events[0].files, ['/p/notes.md'], 'a Set, not a log');
});

test('a null filename says "unknown" rather than naming nothing', () => {
  // The platform would not tell us what moved. Naming no files would read as
  // "nothing you have open changed", which is the one answer that is certainly
  // wrong — so the renderer is told to re-check every panel instead.
  const { w, watch, events, advance } = harness();
  w.watchRoot('/p');
  watch.fire(null);
  advance(1000);
  assert.deepEqual(events, [{ dir: '/p', files: null }]);
});

test('one unknown event inside a burst leaves the whole flush unknown', () => {
  const { w, watch, events, advance } = harness();
  w.watchRoot('/p');
  watch.fire('notes.md');
  watch.fire(null);
  watch.fire('todo.md');
  advance(1000);
  assert.equal(events.length, 1);
  assert.equal(events[0].files, null, 'a partial list is worse than no list');
});

test('each folder carries only its own files', () => {
  const { w, watch, events, advance } = harness();
  w.watchRoot('/p');
  watch.fire('ui/a.js');
  watch.fire('api/b.js');
  advance(1000);
  const byDir = Object.fromEntries(events.map((e) => [e.dir, e.files]));
  assert.deepEqual(byDir, { '/p/ui': ['/p/ui/a.js'], '/p/api': ['/p/api/b.js'] });
});

test('a fresh burst starts a fresh file list', () => {
  const { w, watch, events, advance } = harness();
  w.watchRoot('/p');
  watch.fire('a.md');
  advance(1000);
  watch.fire('b.md');
  advance(1000);
  assert.deepEqual(events.map((e) => e.files), [['/p/a.md'], ['/p/b.md']],
    'the second flush does not still carry the first one\'s file');
});

// ---- the ignore list, on the path not the name ------------------------------

test('an ignored folder anywhere in the path drops the event', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  for (const rel of [
    'node_modules/junk/n7.js',      // the case a name-only test misses
    '.git/refs/heads/master',
    'src/.git/x',
    'dist/bundle.js',
    'a/b/.DS_Store',
  ]) watch.fire(rel);
  advance(2000);
  assert.deepEqual(changed, [], 'every one dropped before any work happened');
  assert.ok(IGNORE.has('node_modules'), 'the set is the one dir:list filters on');
});

test('a real change alongside ignored noise still lands', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire('node_modules/a/b.js');
  watch.fire('.git/index');
  watch.fire('notes.md');
  advance(1000);
  assert.deepEqual(changed, ['/p']);
});

test('a folder merely starting with an ignored name is not ignored', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire('distribution/plan.md');
  advance(1000);
  assert.deepEqual(changed, ['/p/distribution'],
    'the test is on whole path segments, not on a string prefix');
});

// ---- the debounce, and its ceiling ------------------------------------------

test('two events inside the window emit one change', () => {
  const { w, watch, changed, advance } = harness({ debounceMs: 200 });
  w.watchRoot('/p');
  watch.fire('a.txt');
  watch.fire('b.txt');
  advance(199);
  assert.deepEqual(changed, [], 'nothing before the window closes');
  advance(1);
  assert.deepEqual(changed, ['/p'], 'coalesced into one');
});

test('a steady write storm flushes at the ceiling instead of starving', () => {
  const { w, watch, changed, advance } = harness({ debounceMs: 200, maxWaitMs: 800 });
  w.watchRoot('/p');
  // An agent writing every 50ms: each event resets the trailing timer, so
  // without a ceiling the tree stays silent for as long as the agent works.
  for (let i = 0; i < 40; i++) { watch.fire('f' + i + '.txt'); advance(50); }
  assert.ok(changed.length >= 2,
    'the tree was corrected while the writing was still going on, not after');
  assert.ok(changed.every((d) => d === '/p'));
});

test('the ceiling fires no later than maxWaitMs after the first event', () => {
  const { w, watch, changed, advance } = harness({ debounceMs: 200, maxWaitMs: 800 });
  w.watchRoot('/p');
  watch.fire('a.txt');
  for (let i = 0; i < 7; i++) { advance(100); watch.fire('b' + i + '.txt'); }  // t = 700
  assert.deepEqual(changed, [], 'still inside the ceiling');
  advance(100);                                                                // t = 800
  assert.deepEqual(changed, ['/p'], 'flushed on the ceiling, mid-storm');
});

test('after a ceiling flush the next storm gets its own ceiling', () => {
  const { w, watch, changed, advance } = harness({ debounceMs: 200, maxWaitMs: 800 });
  w.watchRoot('/p');
  for (let i = 0; i < 20; i++) { watch.fire('f' + i); advance(100); }
  advance(1000);
  assert.ok(changed.length >= 2, 'a long storm yields several corrections');
  const quiet = changed.length;
  advance(5000);
  assert.equal(changed.length, quiet, 'and nothing keeps firing once it stops');
});

test('each folder keeps its own timers — a storm in one does not hold up another', () => {
  const { w, watch, changed, advance } = harness({ debounceMs: 200, maxWaitMs: 800 });
  w.watchRoot('/p');
  watch.fire('ui/a.js');                                         // t=0, ui ceiling at 800
  for (let t = 100; t <= 700; t += 100) { advance(100); watch.fire('ui/x' + t + '.js'); }
  assert.deepEqual(changed, [], 't=700: ui is still being written to, ceiling not yet up');
  watch.fire('api/b.js');                                        // t=700, and then quiet
  advance(100);                                                  // t=800
  assert.deepEqual(changed, ['/p/ui'], 'ui flushed on its own ceiling, mid-storm');
  advance(100);                                                  // t=900
  assert.deepEqual(changed, ['/p/ui', '/p/api'], 'api flushed on its own trailing window');
});

// ---- teardown ---------------------------------------------------------------

test('close drops the watcher and every pending flush', () => {
  const { w, watch, changed, advance } = harness();
  w.watchRoot('/p');
  watch.fire('a.txt');
  w.close();
  assert.equal(w.count(), 0);
  assert.deepEqual(watch.closed, ['/p']);
  advance(5000);
  assert.deepEqual(changed, [], 'a pending debounce must not fire after teardown');
});
