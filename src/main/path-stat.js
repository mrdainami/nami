// Resolve a token clicked in a terminal (absolute, ~, or relative to a base).
// `relative` is reported because it is the only case a second base could
// change: an absolute path that is missing is missing everywhere.
//
// This used to live in main.js and use statSync. Two things moved it here.
//
// A token is text a program printed, and on Windows `\\evil\share\a.md` is a
// token: statting it logs the PC in to that server (remote-path.js). So the
// path is checked first, after it has been resolved — a relative token read
// against a folder on a share is on that share — and one that looks remote is
// answered "not there" without the disk being asked, unless one of `roots`
// (the pane's own folder, the home folder) is on that same share.
//
// And the stat is awaited. A hover asks this for every path on a line, and a
// share that has gone away answers after an SMB timeout: synchronous, that was
// the whole app standing still for it.
//
// Platform, the home folder and the stat itself are parameters, so a Mac can
// test the Windows column without a disk.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { safeToTouch } = require('./remote-path');

async function statToken(token, base, { roots = [], platform = process.platform, home = os.homedir(), stat = fs.promises.stat } = {}) {
  const lib = platform === 'win32' ? path.win32 : path.posix;
  let relative = false;
  try {
    let p = String(token || '').trim().replace(/[)>,.:'"]+$/, '');
    if (!p) return { exists: false, relative: false };
    const tilde = p.startsWith('~');
    if (tilde) p = lib.join(home, p.slice(1));
    relative = !tilde && !lib.isAbsolute(p);
    if (relative) p = lib.resolve(base || home, p);
    if (!safeToTouch(p, roots, platform)) return { exists: false, relative };
    const st = await stat(p);
    return { exists: true, isFile: st.isFile(), isDir: st.isDirectory(), abs: p, relative };
  } catch (_) { return { exists: false, relative }; }
}

module.exports = { statToken };
