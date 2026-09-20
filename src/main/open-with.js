// Where a file opened from Finder lands.
//
// (Or from File Explorer. Windows has no open-file event — the path comes in on
// the command line, see launch-args.js — but from here on it is the same path
// asking the same question, and it gets the same answer.)
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
  const s = String(p || '').replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  const dir = i > 0 ? s.slice(0, i) : '/';
  // The parent of C:\notes.md is the drive, and a drive keeps its slash: a bare
  // "C:" means wherever that drive's current directory happens to be.
  return /^[a-zA-Z]:$/.test(dir) ? dir + '\\' : dir;
}

// How a name is compared. Windows names do not differ by case, and a path from
// a command line arrives in whatever case it was typed, so `c:\work` has to find
// the window open on `C:\Work`. Platform is a parameter, as in platform.js; a
// Mac compares exactly as it always has.
const folded = (p, platform) => (platform === 'win32' ? String(p || '').toLowerCase() : String(p || ''));

// Separator-aware, so "/proj-evil" is not read as living under "/proj". Same
// boundary test as the renderer's path-guard, for the same reason.
function contains(folder, filePath, platform) {
  if (!folder) return false;
  const r = folded(folder, platform).replace(/[\\/]+$/, '');
  const f = folded(filePath, platform);
  return f.startsWith(r + '/') || f.startsWith(r + '\\');
}

const depth = (folder) => String(folder).split(/[\\/]/).filter(Boolean).length;

// windows: [{ id, folder }] — folder may be null for a window with nothing open.
// Returns { action, id, folder }:
//   here       — that window already holds the file; just open the tile
//   adopt      — that window switches to the file's parent folder first
//   new-window — nothing is open; make a window on the parent folder
function chooseTarget({ filePath, windows = [], focusedId = null, platform = process.platform }) {
  const dir = dirOf(filePath);
  const holding = windows.filter((w) => w.folder && contains(w.folder, filePath, platform));
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

// A folder instead of a file: `Nami.exe C:\work`. There is no parent to fall
// back on and nothing to adopt — switching somebody's desk to another folder
// because a command was typed elsewhere would take their sessions with it. So
// it is the window already open on that folder, or a new one.
//
// One exception, because it takes nothing from anybody: a window with no folder
// open has no sessions and no desk to lose. Leaving it there and opening a
// second window beside it hands the user an empty Nami to close by hand every
// time — and on Windows, where that empty window is what a plain relaunch
// restores, it was the normal case rather than the odd one.
function chooseFolderTarget({ folder, windows = [], focusedId = null, platform = process.platform }) {
  const same = (a) => folded(a, platform).replace(/[\\/]+$/, '') === folded(folder, platform).replace(/[\\/]+$/, '');
  const open = windows.filter((w) => w.folder && same(w.folder));
  if (open.length) {
    const best = open.find((w) => w.id === focusedId) || open[0];
    return { action: 'here', id: best.id, folder: best.folder };
  }
  const empty = windows.filter((w) => !w.folder);
  if (empty.length) return { action: 'replace-empty', id: (empty.find((w) => w.id === focusedId) || empty[0]).id, folder };
  return { action: 'new-window', id: null, folder };
}

module.exports = { OPEN_EXT, handles, chooseTarget, chooseFolderTarget };
