// A path that names another computer, and whether Nami may go there unasked.
//
// On Windows \\server\share\file is a path like any other, and that is the
// trouble with it. The moment anything stats it, reads it or puts it in an
// <img>, the PC connects to `server` and logs in with the owner's account —
// which hands that server a hash of their password to crack at leisure — and if
// the server does not answer, the caller waits out an SMB timeout. None of that
// needs a click. An agent's reply, a line some program printed in a terminal
// and a cwd report are all text nobody chose, so a path found in them is never
// touched on its own say-so.
//
// The rule: on Windows a path that begins with two separators, of either kind,
// looks remote. That takes in \\server\share, //server/share, and the device
// forms \\?\… and \\.\… with them, which can spell a share or a pipe and which
// nothing honest prints. Such a path is left alone — unless the folder the
// person opened is itself on that same \\server\share. People do keep projects
// on a share (a Mac's home folder is \\Mac\Home inside Parallels), and there
// every link and every cwd report is on it; that server was chosen by them.
//
// What someone does on purpose is not covered and does not come through here:
// choosing a folder in the Open dialog, or typing an address, is asking.
//
// Pure, and platform is a parameter, as in platform.js. A Mac has no such
// paths: there `//x` is a folder and `\\x` is a file name. The renderer cannot
// require this file, so paths.mjs keeps the same three functions, and
// tests/remote-path.test.mjs feeds both the same table.

const WIN = 'win32';

function looksRemote(p, platform = process.platform) {
  return platform === WIN && /^[\\/]{2}/.test(String(p == null ? '' : p));
}

// '\\server\share' in one spelling, or '' where there is no share to name: a
// local path, a server with nothing after it, and the device forms, whose
// "server" is a ? or a dot.
function shareOf(p, platform = process.platform) {
  if (platform !== WIN) return '';
  const m = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(String(p == null ? '' : p));
  if (!m || m[1] === '?' || m[1] === '.') return '';
  return `\\\\${m[1]}\\${m[2]}`.toLowerCase();
}

// `roots` are the folders somebody chose: the open project, the folder a pane
// was started in, the home folder.
function safeToTouch(p, roots = [], platform = process.platform) {
  if (!looksRemote(p, platform)) return true;
  const share = shareOf(p, platform);
  return !!share && (Array.isArray(roots) ? roots : []).some((r) => typeof r === 'string' && shareOf(r, platform) === share);
}

module.exports = { looksRemote, shareOf, safeToTouch };
