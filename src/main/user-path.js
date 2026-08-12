// The PATH the user actually has, as opposed to the one a GUI app is handed.
//
// Launched from a terminal, Electron inherits the shell's PATH and everything
// works. Launched from the Dock — which is how every user launches it —
// launchd hands the app `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else. No
// homebrew, no nvm, no bun, no ~/.local/bin. Every agent Nami then spawns
// inherits that stump, so tools the user definitely has installed are missing
// inside their own session, with no error that points at the cause.
//
// So we ask the user's login shell once, at startup, and hand the answer to
// every session we spawn. One probe per app run: the shell is interactive (the
// only kind that reads .zshrc) and costs a second or two, which is fine once
// and unacceptable per tile.
const { execFile } = require('node:child_process');
const { loginShell } = require('./platform.js');

// Keep whatever the login shell reports, then append anything the running
// process has that the shell did not mention. Order matters — the shell's own
// precedence is the user's intent — and a dev run started from a terminal must
// not lose entries it was started with.
function mergePath(loginPath, currentPath) {
  const parts = String(loginPath || '').split(':').filter(Boolean);
  const seen = new Set(parts);
  for (const p of String(currentPath || '').split(':').filter(Boolean)) {
    if (!seen.has(p)) { seen.add(p); parts.push(p); }
  }
  return parts.join(':');
}

// An interactive shell may greet, warn, or print a version manager banner
// before it answers. The PATH is the last line that looks like one.
function pathFromOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith('/')) return lines[i];
  return '';
}

function probe() {
  const sh = loginShell();
  return new Promise((resolve) => {
    execFile(sh.file, sh.args('printf %s "$PATH"'), { timeout: 8000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

let pending = null;
// Resolves to the PATH sessions should run with. Never rejects: a shell that
// fails to answer leaves the app exactly where it was, which is survivable,
// where a thrown error would take the terminal down with it.
function userPath({ exec = probe, env = process.env } = {}) {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => exec())
      .then((out) => mergePath(pathFromOutput(out), env.PATH))
      .catch(() => String(env.PATH || ''));
  }
  return pending;
}

// One probe per app run is right for a PATH that does not move — and wrong for
// the one moment it does. An installer run inside Nami writes a PATH line into
// .zshrc, and every tile opened afterwards was still being handed the PATH from
// before the install. Detection did not care (it spawns a fresh login shell
// each time) but the adapters did: they spawn against this PATH, so an agent
// Nami had just installed was unspawnable until the app was restarted.
//
// So the memo is dropped when something changes it. The next userPath() asks
// the shell again; nothing else has to know.
function refreshUserPath() { pending = null; }

// Tests need a clean slate; nothing in the app calls this.
function resetForTests() { pending = null; }

module.exports = { userPath, mergePath, pathFromOutput, refreshUserPath, resetForTests };
