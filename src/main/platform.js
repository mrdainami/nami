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
    return { file: 'powershell.exe', args: (cmd) => ['-NoProfile', '-Command', cmd] };
  }
  // Ask people in their own shell — a bash user's PATH lives in .bashrc, and
  // zsh would never read it. Anything that is not plainly an absolute path to a
  // usable shell falls back, since launchd does not always set SHELL for a GUI
  // app and a wrong guess costs every detection.
  const shell = String((env && env.SHELL) || '');
  const file = shell.startsWith('/') && !DEAD_SHELLS.has(shell) ? shell : '/bin/zsh';
  return { file, args: (cmd) => ['-l', '-i', '-c', cmd] };
}

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
    join(home, '.bun', 'bin'),
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
  if (platform === WIN) return `(Get-Command ${bin} -ErrorAction SilentlyContinue).Source`;
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
function windowChrome(platform = process.platform) {
  if (platform === WIN) {
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#fffdf6', symbolColor: '#2f2b26', height: 38 } };
  }
  // The sheet is edge-to-edge, so the renderer reserves a 30px lights deck at
  // the top; y centers the 12px buttons in it (see .lights-deck in paper.css).
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 9 } };
}

module.exports = { loginShell, whichCommand, claudeCandidates, windowChrome, binSearchDirs };
