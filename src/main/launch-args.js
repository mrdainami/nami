// What a command line is asking Nami to open.
//
// macOS never needs this: Finder hands a file over as an `open-file` event, and
// the path is never on the command line at all. Windows has no such event. A
// double-clicked file, "Open with", and `Nami.exe C:\work` typed in a terminal
// all arrive the same way — as arguments to a new process — so somebody has to
// read argv and say which of those arguments are things to open.
//
// Most of them are not. argv[0] is the program. In development the next plain
// argument is the app itself (`electron .`). Chromium and Electron add switches
// of their own, the updater adds more, and a few of Nami's own switches take
// their value as the next argument, so `--user-data C:\tmp\profile` has a
// perfectly real folder in it that nobody asked to open. What is left is read
// against the folder the launch came from, and kept only if it exists: a typo
// or a stray word must open nothing rather than an empty window on a folder
// that is not there.
//
// Pure, the way platform.js is: no electron, no fs of its own, and platform is
// a parameter, so the Windows reading is tested from a Mac. The caller supplies
// `stat`, which answers for one path or throws.
const path = require('node:path');

// Nami's switches whose value is the argument after them. Every other switch
// either stands alone or carries its value after an equals sign.
const TAKES_VALUE = new Set(['--user-data', '--screenshot', '--zoom']);

function kindOf(p, stat) {
  try {
    const s = typeof stat === 'function' ? stat(p) : null;
    if (s && s.isDirectory()) return 'folder';
    if (s && s.isFile()) return 'file';
  } catch (_) { /* not there, which is an ordinary answer */ }
  return '';
}

// Sorts paths into files and folders, in the order given, each one once. Names
// on Windows differ by more than case only when they are different names.
function sortPaths(paths, stat, platform) {
  const out = { files: [], folders: [] };
  const seen = new Set();
  for (const p of paths) {
    const key = platform === 'win32' ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = kindOf(p, stat);
    if (kind === 'file') out.files.push(p);
    else if (kind === 'folder') out.folders.push(p);
  }
  return out;
}

function launchArgs({ argv = [], cwd = '', isPackaged = true, platform = process.platform, stat } = {}) {
  const lib = platform === 'win32' ? path.win32 : path.posix;
  const plain = [];
  const list = Array.isArray(argv) ? argv.slice(1) : [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (typeof a !== 'string' || !a) continue;
    if (TAKES_VALUE.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    plain.push(a);
  }
  // `electron .` — unpackaged, the first plain argument is the app, not a
  // request. Packaged there is no such argument, and a dot means this folder.
  if (!isPackaged) plain.shift();
  // resolve() also tidies: forward slashes become the platform's own, `..` is
  // worked out, and a trailing separator goes, so one folder has one name.
  return sortPaths(plain.map((a) => lib.resolve(cwd || lib.sep, a)), stat, platform);
}

// A second launch reads its own command line and hands the answer across,
// because the argv Electron delivers to the running app is not the one that
// was typed: Chromium moves every switch in front of the arguments, which
// parts `--user-data` from its value. What arrives is still only a claim from
// another process, so it is checked again here — strings, absolute, present.
function fromHandoff(data, { platform = process.platform, stat } = {}) {
  const lib = platform === 'win32' ? path.win32 : path.posix;
  const listed = (v) => (Array.isArray(v) ? v : []).filter((p) => typeof p === 'string' && p && lib.isAbsolute(p));
  const given = data && typeof data === 'object' ? [...listed(data.files), ...listed(data.folders)] : [];
  // Tidied the way resolve() tidies above, so one folder keeps one name — but
  // without resolve(), which would read a driveless `\work` against a cwd that
  // belongs to this process and means nothing to the one that sent it.
  const tidy = (p) => {
    const n = lib.normalize(p);
    return n.length > lib.parse(n).root.length ? n.replace(/[\\/]+$/, '') : n;
  };
  return sortPaths(given.map(tidy), stat, platform);
}

module.exports = { launchArgs, fromHandoff };
