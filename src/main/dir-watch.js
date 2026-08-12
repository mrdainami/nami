// Keeps the Workspace tree honest: one fs.watch per directory the renderer can
// actually see, so a file a session just wrote shows up without a click.
//
// The renderer declares the *whole* visible set every time — root plus every
// expanded folder — and this module diffs it against what is open. Declaring
// the full set rather than deltas is the point: there is no incremental state
// on either side, so no sequence of collapses and re-expands can leave the two
// disagreeing about what is being watched.
//
// Non-recursive on purpose. A collapsed dist/ churning through a build is
// invisible to us, which is the difference between a watcher you keep and one
// you turn off. fs.watch is injectable so the tests never touch a real disk.
//
// Note this is the opposite call from watchTitle's poll in main.js, and
// deliberately so: transcripts are append-storms where a watcher fires
// constantly and tells you nothing new, while a directory listing changes
// rarely and every change matters.

const fs = require('fs');

// The same names dir:list filters out (see IGNORE in main.js). Filtering here,
// before the debounce, is not an optimisation — .git's mtime moves on every git
// command a session runs, and without this the tree re-lists through an entire
// rebase for no visible reason.
const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '.next', '.cache']);

const MAX_WATCHERS = 64;
const DEBOUNCE_MS = 200;

function createDirWatch({
  watch = fs.watch,
  onChange = () => {},
  ignore = IGNORE,
  debounceMs = DEBOUNCE_MS,
  max = MAX_WATCHERS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const open = new Map();     // dir -> watcher handle
  const timers = new Map();   // dir -> pending debounce

  function hit(dir, filename) {
    // A null filename means the platform would not say what moved. Emitting is
    // the safe read: a missed change leaves a lying sidebar, an extra re-list
    // costs one readdir.
    if (filename != null && ignore.has(String(filename))) return;
    const prev = timers.get(dir);
    if (prev) clearTimeoutFn(prev);
    timers.set(dir, setTimeoutFn(() => { timers.delete(dir); onChange(dir); }, debounceMs));
  }

  function openOne(dir) {
    try {
      open.set(dir, watch(dir, { recursive: false }, (_type, filename) => hit(dir, filename)));
      return true;
    } catch (_) {
      // A directory that vanished between listing and watching, or one the OS
      // will not hand us a descriptor for. Not fatal: the focus re-list still
      // covers it, and refusing to open the other 63 would be worse.
      return false;
    }
  }

  function closeOne(dir) {
    const h = open.get(dir);
    if (h) { try { h.close(); } catch (_) {} }
    open.delete(dir);
    const t = timers.get(dir);
    if (t) { clearTimeoutFn(t); timers.delete(dir); }
  }

  // The full visible set, in tree order. Past the cap the tail is dropped —
  // tree order means what you can see wins — and the count is returned rather
  // than swallowed, because a silently half-watched tree is the bug this whole
  // module exists to remove.
  function declare(paths) {
    const want = [];
    const seen = new Set();
    for (const p of paths || []) {
      if (typeof p !== 'string' || !p || seen.has(p)) continue;
      seen.add(p); want.push(p);
    }
    const kept = want.slice(0, max);
    const keep = new Set(kept);
    for (const dir of [...open.keys()]) if (!keep.has(dir)) closeOne(dir);
    let failed = 0;
    for (const dir of kept) if (!open.has(dir) && !openOne(dir)) failed += 1;
    return { watching: open.size, overflow: want.length - kept.length, failed };
  }

  function closeAll() {
    for (const dir of [...open.keys()]) closeOne(dir);
  }

  return { declare, closeAll, count: () => open.size };
}

module.exports = { createDirWatch, IGNORE, MAX_WATCHERS, DEBOUNCE_MS };
