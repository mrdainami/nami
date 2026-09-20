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
const { buildChildEnv } = require('./session-env');
const { loginShell, pathDelimiter } = require('./platform.js');

// Keep whatever the login shell reports, then append anything the running
// process has that the shell did not mention. Order matters — the shell's own
// precedence is the user's intent — and a dev run started from a terminal must
// not lose entries it was started with.
function mergePath(loginPath, currentPath, platform = process.platform) {
  const sep = pathDelimiter(platform);
  // Windows paths are case-insensitive and the registry and the environment
  // rarely agree on the case of C:\Windows, so the same folder is one entry.
  const key = (p) => (platform === 'win32' ? p.toLowerCase().replace(/[\\/]+$/, '') : p);
  const parts = [];
  const seen = new Set();
  for (const p of [...String(loginPath || '').split(sep), ...String(currentPath || '').split(sep)]) {
    if (!p || seen.has(key(p))) continue;
    seen.add(key(p)); parts.push(p);
  }
  return parts.join(sep);
}

// An interactive shell may greet, warn, or print a version manager banner
// before it answers. The PATH is the last line that looks like one.
function pathFromOutput(stdout, platform = process.platform) {
  const looksLikePath = platform === 'win32' ? /^[a-zA-Z]:[\\/]/ : /^\//;
  const lines = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (looksLikePath.test(lines[i])) return lines[i];
  return '';
}

function probe({ settings = {}, env = process.env } = {}) {
  const sh = loginShell();
  return new Promise((resolve) => {
    execFile(sh.file, sh.args(sh.pathCmd), { timeout: 8000, env: buildChildEnv({ parentEnv: env, settings, purpose: 'probe' }) }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

let pending = null;
// Resolves to the PATH sessions should run with. Never rejects: a shell that
// fails to answer leaves the app exactly where it was, which is survivable,
// where a thrown error would take the terminal down with it.
function userPath({ exec = probe, env = process.env, settings = {}, platform = process.platform } = {}) {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => exec({ env, settings }))
      .then((out) => mergePath(pathFromOutput(out, platform), env.PATH, platform))
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
