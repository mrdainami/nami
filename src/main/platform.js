// Everything Nami assumes about the operating system, in one place.
//
// These assumptions used to be scattered as literals: '/bin/zsh' in four call
// sites, `command -v` inside a template string, three absolute paths where
// Claude Code might live, and a macOS-only titleBarStyle. Each was correct and
// each was invisible — nothing named them as platform decisions, so a port
// meant finding them by failure rather than by reading.
//
// Nami ships macOS-only on purpose (see the shipping spec), so the darwin
// column is the one that is exercised and verified. The win32 column is written
// from the documented install paths of each tool and is NOT verified — it
// exists so that adding Windows is filling in a table rather than an
// excavation, and every entry in it should be treated as a hypothesis until it
// has run on a real Windows machine.
//
// Pure by design: no electron, no fs, no process spawning, and platform is
// always a parameter. That keeps it testable from `node --test`, which cannot
// pretend to be Windows any other way.

const WIN = 'win32';

// A shell so locked down it cannot run a startup file, so it can never tell us
// where anything is. These are real login shells for service and locked
// accounts, and picking one would silently break every probe.
const DEAD_SHELLS = new Set(['/usr/bin/false', '/bin/false', '/usr/sbin/nologin', '/sbin/nologin', '/usr/bin/true', '/bin/true']);

// The shell used to ask the user's own environment a question — "is claude on
// your PATH", "add this MCP server". It must be a login shell AND an
// interactive one. Login alone is not enough: zsh reads .zshrc only when
// interactive, and .zshrc is where installers write their PATH lines — bun,
// opencode and nvm among them. With `-lc` those lines are never read, so a
// Dock-launched Nami (which inherits no PATH at all) reported perfectly
// well-installed agents as missing. Started from a terminal it looked fine,
// because the inherited PATH was covering for it.
function loginShell(platform = process.platform, env = process.env) {
  if (platform === WIN) {
    // -NoProfile is deliberate and differs from the Unix branch: PowerShell
    // profiles are slow and are not where PATH comes from on Windows.
    //
    // The PATH question is asked of the registry, not of $env:PATH. A child
    // PowerShell inherits Nami's own environment, so $env:PATH would hand back
    // exactly what we already have — and miss the entry an installer wrote a
    // minute ago, which is the one case the probe exists for.
    return {
      file: 'powershell.exe',
      args: (cmd) => ['-NoProfile', '-Command', cmd],
      pathCmd: "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
    };
  }
  // Ask people in their own shell — a bash user's PATH lives in .bashrc, and
  // zsh would never read it. Anything that is not plainly an absolute path to a
  // usable shell falls back, since launchd does not always set SHELL for a GUI
  // app and a wrong guess costs every detection.
  const shell = String((env && env.SHELL) || '');
  const file = shell.startsWith('/') && !DEAD_SHELLS.has(shell) ? shell : '/bin/zsh';
  return { file, args: (cmd) => ['-l', '-i', '-c', cmd], pathCmd: 'printf %s "$PATH"' };
}

// PowerShell by any of its names: Windows PowerShell, pwsh, with or without a
// path in front or .exe behind. Everything that builds a command line asks
// this, because quoting, chaining and exit codes all differ from a POSIX shell.
function isPowerShell(shell) {
  return /(^|[\\/])(powershell|pwsh)(\.exe)?$/i.test(String(shell || ''));
}

// The shell a pane runs. On a Mac that is the user's own. On Windows SHELL is
// ignored on purpose: nothing native sets it, and Git Bash sets it to
// /usr/bin/bash, which is a path that does not exist outside Git Bash.
//
// `pwsh` is where PowerShell 7 was found, or nothing (pwsh-find.js does the
// looking, because this module does no I/O). Someone who installed 7 expects
// to be in it: it chains with `&&`, speaks UTF-8 and draws better. Windows
// PowerShell 5.1 is on every PC and is what everyone else gets — which is why
// a command line Nami builds itself must always run on 5.1, whatever this
// returns.
function paneShell(platform = process.platform, env = process.env, pwsh = '') {
  if (platform === WIN) return pwsh || 'powershell.exe';
  return (env && env.SHELL) || '/bin/zsh';
}

// Arguments that make `shell` run `line` as its script and end when it ends.
// Interactive on POSIX so the rc file is read; PowerShell reads its profile
// either way.
function scriptArgs(shell, line) {
  return isPowerShell(shell) ? ['-NoLogo', '-Command', line] : ['-i', '-c', line];
}

// How to start a program without a shell getting a say in its arguments.
//
// npm installs every CLI on Windows as a .cmd file, and Node refuses to spawn
// one directly. `shell: true` gets past that by joining the arguments with
// spaces and handing the line to cmd.exe unquoted — so "my server" arrives as
// two arguments, and "x & calc" arrives as two commands. This goes through
// cmd.exe as well, because it has to, but escapes the line first: each argument
// quoted the way the C runtime unquotes it, then every character cmd.exe would
// act on given a caret. windowsVerbatimArguments stops Node quoting it again.
//
// A bare name takes the same road, since only cmd.exe will find claude.cmd for
// `claude`. A real .exe, and everything on a Mac, is handed back as it came.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function cmdArg(arg) {
  let s = String(arg == null ? '' : arg);
  s = s.replace(/(\\*)"/g, '$1$1\\"');   // backslashes before a quote are doubled, the quote escaped
  s = s.replace(/(\\*)$/, '$1$1');         // and so are the ones the closing quote would otherwise eat
  return `"${s}"`.replace(CMD_META, '^$1');
}

function spawnPlan(file, args = [], platform = process.platform, env = process.env) {
  const list = Array.isArray(args) ? args : [];
  if (platform !== WIN || /\.(exe|com)$/i.test(String(file))) return { file, args: list, options: {} };
  const line = [String(file).replace(CMD_META, '^$1'), ...list.map(cmdArg)].join(' ');
  return {
    file: (env && env.ComSpec) || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}

// What separates one PATH entry from the next.
function pathDelimiter(platform = process.platform) { return platform === WIN ? ';' : ':'; }

// Where to look when the shell probe comes back empty — a .zshrc that prints a
// banner, refuses to run without a tty, or does not exist must degrade to a
// worse answer, never to "you have no agents installed". The running PATH goes
// first (it is the truth when Nami *was* started from a terminal), then the
// documented install location of each CLI we know about.
function binSearchDirs({ home = '', env = {}, platform = process.platform } = {}) {
  const win = platform === WIN;
  const sep = win ? '\\' : '/';
  const join = (...parts) => parts.filter(Boolean).join(sep);
  const fromPath = String((env && env.PATH) || '').split(win ? ';' : ':');
  const known = win ? [
    join(home, '.local', 'bin'),
    join(env.APPDATA, 'npm'),
    join(env.LOCALAPPDATA, 'Programs'),
    join(env.LOCALAPPDATA, 'agy', 'bin'),
    join(env.LOCALAPPDATA, 'Antigravity'),   // antigravity.google/cli/install.ps1
    join(home, '.grok', 'bin'),              // x.ai/cli/install.ps1
    join(env.LOCALAPPDATA, 'hermes', 'bin'),
    join(env.LOCALAPPDATA, 'hermes', 'hermes-agent', 'bin'),
    join(home, '.kimi-code', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.claude', 'local'),
  ] : [
    join(home, '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.opencode/bin'),   // opencode.ai/install
    join(home, '.bun/bin'),        // bun-installed CLIs
    join(home, '.cargo/bin'),
    join(home, '.npm-global/bin'),
    join(home, '.volta/bin'),
    join(home, '.claude/local'),
    '/usr/bin',
  ];
  return [...new Set([...fromPath, ...known].filter(Boolean))];
}

// "Is this command installed, and where?" — printing the resolved path or
// nothing at all. Must stay silent on failure: a missing agent is an ordinary
// answer here, not an error.
function whichCommand(bin, platform = process.platform) {
  // Applications only. npm writes three shims for every CLI — codex, codex.cmd
  // and codex.ps1 — and PowerShell prefers the .ps1. A stock Windows refuses to
  // run script files at all (ExecutionPolicy Restricted), so the path it would
  // hand back by default is the one form of the program that cannot start. The
  // .cmd is an application, runs under any policy, and is what this returns.
  if (platform === WIN) return `(Get-Command ${bin} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source`;
  return `command -v ${bin}`;
}

// Where a logged-in Claude Code install lands. Order matters: an explicit
// CLAUDE_CODE_EXECUTABLE always wins, then the official installer's location,
// then package managers. Returns candidates only — the caller checks existence,
// because this module does no I/O.
function claudeCandidates({ home = '', env = {}, platform = process.platform } = {}) {
  const sep = platform === WIN ? '\\' : '/';
  const join = (...parts) => parts.filter(Boolean).join(sep);
  if (platform === WIN) {
    return [
      env.CLAUDE_CODE_EXECUTABLE,
      join(home, '.local', 'bin', 'claude.exe'),   // native installer (install.ps1)
      join(env.APPDATA, 'npm', 'claude.cmd'),      // npm -g
      join(home, '.claude', 'local', 'claude.exe'),
    ].filter(Boolean);
  }
  return [
    env.CLAUDE_CODE_EXECUTABLE,
    join(home, '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.claude/local/claude'),
  ].filter(Boolean);
}

// Window chrome. macOS hides the title bar but keeps the traffic lights inset
// over our own header; Windows has no equivalent, so it gets a hidden frame
// with an overlay tinted to match the paper header rather than a system bar
// sitting on top of the design.
//
// The overlay takes the theme's own background, so the three window buttons sit
// on the desk rather than on a strip of paper above a dark one. The symbols go
// light or dark by how bright that background is, which keeps a theme added
// later from needing an entry here.
function windowChrome(platform = process.platform, background = '#fffdf6') {
  if (platform === WIN) {
    const hex = /^#[0-9a-f]{6}$/i.test(background) ? background : '#fffdf6';
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const bright = (0.299 * r + 0.587 * g + 0.114 * b) > 140;
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: hex, symbolColor: bright ? '#2f2b26' : '#f2efe8', height: 38 } };
  }
  // The sheet is edge-to-edge, so the renderer reserves a 22px lights deck at
  // the top (see .lights-deck in paper.css). y gives the 12px buttons 11px of
  // air above, Chrome-style; they overhang the deck's foot by 1px, which still
  // clears the topbar's centred content by ~11px.
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 11 } };
}

// Where PowerShell 7 might be, best guess first. PATH leads because it is what
// the user would get by typing `pwsh` — the MSI, winget, scoop and the Store
// alias all put it there — and the MSI's own folder follows for a Nami that
// was started before the installer's PATH edit reached it. Candidates only:
// the caller checks them, because this module does no I/O. Nothing off
// Windows, where the pane shell is the user's own and is never second-guessed.
function pwshCandidates({ env = {}, pathValue, platform = process.platform } = {}) {
  if (platform !== WIN) return [];
  const e = env || {};
  const dirs = String(pathValue != null ? pathValue : (e.PATH || e.Path || '')).split(';')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1').replace(/\\+$/, '')).filter(Boolean);
  for (const root of [e.ProgramFiles, e.ProgramW6432]) if (root) dirs.push(`${root}\\PowerShell\\7`);
  const seen = new Set();
  return dirs.map((d) => `${d}\\pwsh.exe`).filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
}

// The folder to start a spawnPlan child in.
//
// cmd.exe will not run in a network folder. Started in \\server\share\work it
// prints three lines about UNC paths to stderr and carries on from C:\Windows —
// so the tool behind the .cmd shim runs in the Windows directory, and the
// complaint lands in a chat as though the agent had said it (measured on
// Windows 11). A plan that does not go through cmd.exe is unaffected: a real
// .exe starts in a UNC folder without comment.
//
// So a cmd.exe plan is started from the home folder instead, and the caller
// passes the real folder to the tool in words (ACP sends it in session/new).
// `pushd` would get cmd.exe into the share, but by mapping a drive letter: the
// tool would then report U:\ paths that match nothing Nami knows, and handing
// out drive letters on someone's PC is not a thing a helper process should do.
const UNC_RE = /^[\\/]{2}[^\\/]/;
function planCwd(plan, cwd, { home = '', env = {}, platform = process.platform } = {}) {
  const viaCmd = !!(plan && plan.options && plan.options.windowsVerbatimArguments);
  if (platform !== WIN || !viaCmd || !UNC_RE.test(String(cwd || ''))) return cwd;
  // A redirected profile can be on a share too; the Windows folder is where
  // cmd.exe would have ended up anyway, only now without the complaint.
  return [home, env && env.SystemRoot].find((d) => d && !UNC_RE.test(d)) || 'C:\\Windows';
}

module.exports = { loginShell, whichCommand, claudeCandidates, windowChrome, binSearchDirs, pathDelimiter, isPowerShell, paneShell, scriptArgs, spawnPlan, pwshCandidates, planCwd };
