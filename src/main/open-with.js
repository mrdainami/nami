// Where a file opened from Finder lands.
//
// macOS hands the app a path and nothing else. Nami is folder-shaped — a tile
// always sits on some folder's desk — so every incoming path has to be turned
// into a (window, folder) pair before anything can render. That decision is
// the whole of this module: pure, no Electron, so the four cases below are
// testable without a running app.
//
// Kept deliberately short. Only the types Nami already renders as a document,
// and only the ones a person would plausibly want a workbench to own. Images,
// video, audio and PDF are Preview's; .json and .yml belong to an editor.
// Being listed in "Open With" for everything is noise, not a feature.
const OPEN_EXT = ['md', 'markdown', 'mdx', 'txt', 'text'];

function extOf(p) {
  const base = String(p || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  // i > 0, not i >= 0: a leading dot names the file (".md"), it is not an
  // extension on an empty name.
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

function handles(filePath) { return OPEN_EXT.includes(extOf(filePath)); }

function dirOf(p) {
  const s = String(p || '').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i > 0 ? s.slice(0, i) : '/';
}

// Separator-aware, so "/proj-evil" is not read as living under "/proj". Same
// boundary test as the renderer's path-guard, for the same reason.
function contains(folder, filePath) {
  if (!folder) return false;
  const r = String(folder).replace(/\/+$/, '');
  return String(filePath).startsWith(r + '/');
}

const depth = (folder) => String(folder).split('/').filter(Boolean).length;

// windows: [{ id, folder }] — folder may be null for a window with nothing open.
// Returns { action, id, folder }:
//   here       — that window already holds the file; just open the tile
//   adopt      — that window switches to the file's parent folder first
//   new-window — nothing is open; make a window on the parent folder
function chooseTarget({ filePath, windows = [], focusedId = null }) {
  const dir = dirOf(filePath);
  const holding = windows.filter((w) => w.folder && contains(w.folder, filePath));
  if (holding.length) {
    // Deepest folder first: a window open on the file's own folder is a better
    // home than one open on the repo root three levels up. The focused window
    // breaks ties, so the desk being looked at wins when both are equal.
    let best = holding[0];
    for (const w of holding) {
      const d = depth(w.folder), bd = depth(best.folder);
      if (d > bd || (d === bd && w.id === focusedId)) best = w;
    }
    return { action: 'here', id: best.id, folder: best.folder };
  }
  // No window holds it. Hand it to the focused desk to adopt — falling back to
  // the last window, because a focusedId can go stale between the click and
  // the event, and spawning a window over a stale id would be a surprise.
  if (windows.length) {
    const target = windows.find((w) => w.id === focusedId) || windows[windows.length - 1];
    return { action: 'adopt', id: target.id, folder: dir };
  }
  return { action: 'new-window', id: null, folder: dir };
}

module.exports = { OPEN_EXT, handles, chooseTarget };
