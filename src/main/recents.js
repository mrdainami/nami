// The Recents list — pure list logic, no fs and no electron, so it can be
// tested directly. main.js owns persistence and the missing-folder check.
//
// A row is { path, at, pinned }. Two rules shape the list:
//   · pinned rows sort first and are never evicted — one stray peek at
//     ~/Downloads must not be able to push a real project off the list;
//   · unpinned rows are a plain most-recent-first eight.

const RECENTS_CAP = 8;

// The list used to be a bare array of path strings. Anything that isn't a
// usable row is dropped rather than carried forward half-formed.
function migrateRecents(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((r) => (typeof r === 'string' ? { path: r, at: 0, pinned: false } : r))
    .filter((r) => r && typeof r.path === 'string' && r.path)
    .map((r) => ({ path: r.path, at: Number(r.at) || 0, pinned: !!r.pinned }));
}

function sortRecents(rows) {
  return rows.slice().sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.at - a.at));
}

// The cap applies only to unpinned rows, so a pinned list longer than the cap
// is allowed — the user asked for every one of those.
function capRecents(rows, cap = RECENTS_CAP) {
  const seen = new Set();
  const unique = rows.filter((r) => (seen.has(r.path) ? false : seen.add(r.path)));
  const pinned = unique.filter((r) => r.pinned);
  const rest = sortRecents(unique.filter((r) => !r.pinned)).slice(0, cap);
  return sortRecents([...pinned, ...rest]);
}

// Opening a folder moves it to the front and stamps it, keeping whatever pin it
// already had — opening a pinned folder must not silently unpin it.
function rememberFolderIn(rows, folder, at, cap = RECENTS_CAP) {
  const prev = rows.find((r) => r.path === folder);
  const rest = rows.filter((r) => r.path !== folder);
  return capRecents([{ path: folder, at, pinned: !!(prev && prev.pinned) }, ...rest], cap);
}

function setPinnedIn(rows, folder, pinned, cap = RECENTS_CAP) {
  const next = rows.map((r) => (r.path === folder ? { ...r, pinned: !!pinned } : r));
  return capRecents(next, cap);
}

function removeFrom(rows, folder) {
  return rows.filter((r) => r.path !== folder);
}

module.exports = { RECENTS_CAP, migrateRecents, sortRecents, capRecents, rememberFolderIn, setPinnedIn, removeFrom };
