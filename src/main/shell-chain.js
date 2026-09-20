// "Do this, then that, but only if this worked" — as one line a run tile can
// show and the user can watch.
//
// The renderer used to write that line itself, in two places, as
// `a && b && c` with `~` for home. Both halves are zsh. Windows PowerShell 5.1
// reads `&&` as a syntax error and stops before running anything, and git is
// handed `~` as it stands, because on Windows nothing expands it on the way.
//
// So the line is composed here, once, for the shell that will run it. The shell
// and the platform are parameters (see platform.js), which is what lets a Mac
// test the exact line a PC is given.
//
// Pure: no fs, no spawning. The caller supplies a real home folder.

const path = require('path');
const { isPowerShell, paneShell } = require('./platform.js');
const { shellQuote } = require('./claude-args.js');

// Each step is a finished command, already quoted for `shell`.
//
// POSIX is `a && b && c`, exactly as before.
//
// PowerShell nests instead: `a; if ($?) { b; if ($?) { c } }`. `$?` is the one
// test that works for every kind of step — measured in Windows PowerShell 5.1:
// false after a program that exits non-zero, false after a cmdlet that fails
// (where $LASTEXITCODE says nothing at all), and still true after a program
// that writes to stderr and exits 0, which is how git reports progress.
//
// Nesting rather than `if (-not $?) { exit }`, because `exit` would take the
// tile's shell with it, and the tile is where the user reads what went wrong.
// A step that fails is simply the last thing that ran, with its own error as
// the last thing on screen, and $LASTEXITCODE is left as that step set it for
// run-done.js to report.
function chainLine(steps, shell = '') {
  const list = (Array.isArray(steps) ? steps : []).map((s) => String(s == null ? '' : s).trim()).filter(Boolean);
  if (!isPowerShell(shell)) return list.join(' && ');
  return list.reduceRight((rest, step) => (rest ? `${step}; if ($?) { ${rest} }` : step), '');
}

// A connector's folder is named after its repo, and that name is typed into a
// shell. Anything but a plain name is refused rather than quoted — the same
// rule connections.js keeps for service ids.
const REPO_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

// Clone a connector's repo into ~/.nami/connectors/<name> and build it.
//
// `dir` and `entry` are returned as well as the line, so nothing else has to
// know where a connector lands: on a Mac they keep the `~` the line has always
// used (main expands it when it stats or writes a config); on a PC they are
// real paths, because there is no shell between Nami and git to expand one.
//
// npm is `npm.cmd` on a PC. Node ships an npm.ps1 next to it, PowerShell picks
// the .ps1 first, and a stock Windows refuses to run any script at all
// ("running scripts is disabled on this system") — so a bare `npm install`
// fails on exactly the clean machine an install is for. The .cmd is the same
// program with no policy in its way.
function connectorInstall({ repo, home = '', platform = process.platform, shell = paneShell(platform) } = {}) {
  const url = String(repo || '');
  if (!REPO_RE.test(url)) return null;
  const name = url.split('/').pop();
  if (platform === 'win32') {
    const dir = path.win32.join(home, '.nami', 'connectors', name);
    const q = shellQuote(dir, shell);
    const steps = [`git clone ${url} ${q}`, `Set-Location -LiteralPath ${q}`, 'npm.cmd install', 'npm.cmd run build'];
    return { dir, entry: path.win32.join(dir, 'dist', 'index.js'), steps, command: chainLine(steps, shell) };
  }
  const dir = '~/.nami/connectors/' + name;
  const steps = [`git clone ${url} ${dir}`, `cd ${dir}`, 'npm install', 'npm run build'];
  return { dir, entry: dir + '/dist/index.js', steps, command: chainLine(steps, shell) };
}

module.exports = { chainLine, connectorInstall };
