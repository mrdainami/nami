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
// Two readers now, not one. The tree wants the folder; a file open on the desk
// wants to know whether it was the file that moved, so every flush carries the
// names as well — coalesced into a Set, absolute, and null when the platform
// declined to say which. See src/renderer/file-sync.mjs for what happens next.
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
  // dir -> { trail, ceil, files }. `files` is a Set of absolute paths, or null
  // for "the platform would not say" — see hit() for why null is not an empty
  // set. It is what lets an open tile decide whether the change was its file.
  const pending = new Map();

  // Whole segments, not a string prefix: a folder called distribution/ is not
  // dist/, and node_modules/junk/n7.js is node_modules however deep it sits.
  function ignored(rel) {
    for (const seg of String(rel).split(/[\\/]/)) if (seg && ignore.has(seg)) return true;
    return false;
  }

  // A recursive event names a path relative to the root. The tree wants the
  // folder that path lives in — that is the row whose listing changed, and
  // whose parent's "N items" is now wrong.
  const pFor = (r) => (r && r.startsWith('/') && !r.includes(':') ? path.posix : path);

  function dirOf(rel) {
    if (rel == null) return root;
    const s = String(rel).replace(/\\/g, '/');
    const cut = s.lastIndexOf('/');
    return cut <= 0 ? root : pFor(root).join(root, s.slice(0, cut));
  }

  // The thing that moved, absolute — which is the shape an open panel stores
  // its file as, so the renderer can match without rebuilding a path.
  function fileOf(rel) {
    if (rel == null) return null;
    const s = String(rel).replace(/\\/g, '/').replace(/\/+$/, '');
    if (!s) return null;
    return pFor(root).join(root, s);
  }

  function flush(dir) {
    const p = pending.get(dir);
    if (!p) return;
    if (p.trail) clearTimeoutFn(p.trail);
    if (p.ceil) clearTimeoutFn(p.ceil);
    pending.delete(dir);
    onChange(dir, p.files ? Array.from(p.files) : null);
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
      p = { trail: null, ceil: null, files: new Set() };
      pending.set(dir, p);
      // Set once on the first event of a burst and never reset — that is what
      // makes it a ceiling rather than a second debounce.
      p.ceil = setTimeoutFn(() => flush(dir), maxWaitMs);
    }
    // null poisons the whole flush rather than dropping one name into a list
    // that then reads as complete. A half-list is the one answer that lets an
    // open tile conclude "not mine" about the file that did change.
    const file = fileOf(rel);
    if (!file) p.files = null;
    else if (p.files) p.files.add(file);
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
