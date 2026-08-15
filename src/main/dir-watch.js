// Keeps the Workspace tree honest: one recursive watcher on the open project, so
// a file a session just wrote shows up without a click — wherever it landed.
//
// Recursive, and watching folders you have not opened, because that is the case
// that was broken. Watching only the root and the expanded folders meant an
// agent scaffolding into a collapsed ui/ fired nothing at all: the folder had no
// watcher, and writing inside it does not touch the root, so the root's watcher
// stayed silent too. The row said "0 items" over four files on disk and no
// amount of waiting fixed it — only collapsing the folder and opening it again.
//
// The earlier design went non-recursive on volume, arguing that a collapsed
// dist/ churning through a build was the difference between a watcher you keep
// and one you turn off. The concern is real; going blind is not the answer.
// Measured with 200 files landing in node_modules: 205 events, 202 of them
// dropped by the path test below before any work happened. Filter and coalesce.
//
// fs.watch is injectable so the tests never touch a real disk.
//
// Note this is the opposite call from watchTitle's poll in main.js, and
// deliberately so: transcripts are append-storms where a watcher fires
// constantly and tells you nothing new, while a directory listing changes
// rarely and every change matters.

const fs = require('fs');
const path = require('path');

// The same names dir:list filters out (see IGNORE in main.js). Filtering here,
// before the debounce, is not an optimisation — .git's mtime moves on every git
// command a session runs, and without this the tree re-lists through an entire
// rebase for no visible reason.
const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '.next', '.cache']);

const DEBOUNCE_MS = 200;
// The ceiling. A trailing debounce alone starves: an agent writing faster than
// the window resets the timer on every file, so the flush never arrives and the
// tree updates only once the agent stops. That is exactly what it looked like
// from the outside — "it only appears after it finishes".
const MAX_WAIT_MS = 800;

function createDirWatch({
  watch = fs.watch,
  onChange = () => {},
  ignore = IGNORE,
  debounceMs = DEBOUNCE_MS,
  maxWaitMs = MAX_WAIT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let handle = null;
  let root = null;
  const pending = new Map();   // dir -> { trail, ceil }

  // Whole segments, not a string prefix: a folder called distribution/ is not
  // dist/, and node_modules/junk/n7.js is node_modules however deep it sits.
  function ignored(rel) {
    for (const seg of String(rel).split(/[\\/]/)) if (seg && ignore.has(seg)) return true;
    return false;
  }

  // A recursive event names a path relative to the root. The tree wants the
  // folder that path lives in — that is the row whose listing changed, and
  // whose parent's "N items" is now wrong.
  function dirOf(rel) {
    if (rel == null) return root;
    const s = String(rel).replace(/\\/g, '/');
    const cut = s.lastIndexOf('/');
    return cut <= 0 ? root : path.join(root, s.slice(0, cut));
  }

  function flush(dir) {
    const p = pending.get(dir);
    if (!p) return;
    if (p.trail) clearTimeoutFn(p.trail);
    if (p.ceil) clearTimeoutFn(p.ceil);
    pending.delete(dir);
    onChange(dir);
  }

  function hit(rel) {
    // A null filename means the platform would not say what moved. Emitting is
    // the safe read: a missed change leaves a lying sidebar, an extra re-list
    // costs one readdir.
    if (rel != null && ignored(rel)) return;
    if (!root) return;
    const dir = dirOf(rel);
    let p = pending.get(dir);
    if (!p) {
      p = { trail: null, ceil: null };
      pending.set(dir, p);
      // Set once on the first event of a burst and never reset — that is what
      // makes it a ceiling rather than a second debounce.
      p.ceil = setTimeoutFn(() => flush(dir), maxWaitMs);
    }
    if (p.trail) clearTimeoutFn(p.trail);
    p.trail = setTimeoutFn(() => flush(dir), debounceMs);
  }

  // One project, one watcher. Called when the open folder changes, not while
  // drawing the tree: what is watched is a property of the project, and tying it
  // to a render meant booting on the Sessions tab watched nothing at all.
  function watchRoot(dir) {
    if (dir && dir === root && handle) return { watching: 1, failed: 0 };
    close();
    if (!dir) return { watching: 0, failed: 0 };
    try {
      root = dir;
      handle = watch(dir, { recursive: true }, (_type, filename) => hit(filename));
      return { watching: 1, failed: 0 };
    } catch (_) {
      // A folder that vanished, or one the OS will not hand us a descriptor for.
      // Not fatal: every re-list still works, the tree just stops correcting
      // itself until the next project switch.
      handle = null; root = null;
      return { watching: 0, failed: 1 };
    }
  }

  function close() {
    if (handle) { try { handle.close(); } catch (_) {} }
    handle = null; root = null;
    for (const p of pending.values()) {
      if (p.trail) clearTimeoutFn(p.trail);
      if (p.ceil) clearTimeoutFn(p.ceil);
    }
    pending.clear();
  }

  return { watchRoot, close, count: () => (handle ? 1 : 0), root: () => root };
}

module.exports = { createDirWatch, IGNORE, DEBOUNCE_MS, MAX_WAIT_MS };
