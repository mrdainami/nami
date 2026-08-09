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

// The shell used to ask the user's own environment a question — "is claude on
// your PATH", "add this MCP server". It must be a *login* shell: the whole
// point is to see the PATH the user actually has, which on macOS is assembled
// by .zshrc/.zprofile and is not inherited by a GUI-launched Electron app.
function loginShell(platform = process.platform) {
  if (platform === WIN) {
    // -NoProfile is deliberate and differs from the Unix branch: PowerShell
    // profiles are slow and are not where PATH comes from on Windows.
    return { file: 'powershell.exe', args: (cmd) => ['-NoProfile', '-Command', cmd] };
  }
  return { file: '/bin/zsh', args: (cmd) => ['-lc', cmd] };
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
  return { titleBarStyle: 'hiddenInset' };
}

module.exports = { loginShell, whichCommand, claudeCandidates, windowChrome };
