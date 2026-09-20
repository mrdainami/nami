// Free text, and a program that is really a .cmd file.
//
// npm installs every CLI on Windows as a shim: claude.cmd, codex.cmd,
// opencode.cmd. A .cmd is not a program. Windows runs it by handing the whole
// command line to cmd.exe, which reads it as a command — `&` begins a second
// one, `%NAME%` is filled in from the environment, and a `"` decides what the
// next `&` means — and the shim then passes its arguments on as %*, which puts
// them through cmd.exe once more. spawnPlan (platform.js) escapes a line for
// that journey, but a pane is not started by spawnPlan. node-pty builds the
// line itself and quotes only an argument that has a space in it, and a run
// tile's line is PowerShell's to build, which escapes no quote at all. So a
// first message of `resize it to 5" wide & echo PWNED` ran echo, and
// `%USERNAME%` arrived as the user's name (measured in the Windows 11 VM,
// through the installed app's own node-pty).
//
// The answer is not better quoting, because PowerShell's half of it cannot be
// made exact: inside the quotes it adds, cmd.exe still fills in %NAME%, and
// there is no way to write a % that survives. Where the program is a shim, text
// somebody else may have written does not travel as an argument at all. A first
// message is simply not sent that way (seed-launch.js); the one argument with
// no other road, the session's name, is reduced to characters cmd.exe does
// nothing with. A real claude.exe — the native installer, which is what most
// people have — gets every character exactly as before, and so does a Mac.
//
// Pure, and platform is a parameter, as in platform.js.

const WIN = 'win32';

// Will this program's arguments be read by cmd.exe? Decided from the path the
// scan resolved (bin-cache.js), never from the name typed. Only a full path to
// a real .exe or .com says no. A shim, a script, a bare name and an empty
// answer all say yes: a bare name is whatever the shell finds first, and npm's
// claude.cmd is found as readily as claude.exe.
function reachesCmd(program, platform = process.platform) {
  if (platform !== WIN) return false;
  return !/^([A-Za-z]:|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)[\\/].*\.(exe|com)$/i.test(String(program || ''));
}

// What is left of `text` once cmd.exe has nothing to act on. The quote goes
// too, and not only the operators: node-pty leaves an argument without a space
// unquoted, so `a&calc` has to be safe bare, and a quote inside a quoted one
// would turn the quoting inside out. A line break or a tab becomes a space,
// since cmd.exe stops reading at the first newline; other control characters
// are dropped.
function shimSafe(text) {
  return String(text == null ? '' : text)
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/["%&|<>^!()\x00-\x1f\x7f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// A whole argument list on its way to `program`. Handed back untouched — the
// same array — unless it is going to a shim. Flags and ids have nothing in them
// to remove, so in practice this changes a name or an agent's slug and nothing
// else. One reduced to nothing becomes `_`, so that the flag in front of it
// does not take the next flag for its value.
function shimSafeArgs(args, program, platform = process.platform) {
  if (!reachesCmd(program, platform)) return args;
  return (Array.isArray(args) ? args : []).map((a) => shimSafe(a) || '_');
}

// ---- going round the shim ---------------------------------------------------
// Holding a first message back is safe, and it is not what a Mac does: Codex and
// OpenCode only come from npm, so on Windows they were never once handed one.
// But a shim is a few generated lines that find node and run a single script,
// and Nami can do that itself. Started as `node.exe codex.js …`, the program is
// a real .exe, the arguments go straight to it, and cmd.exe never sees them.
//
// shimTarget reads the text of a .cmd and says what it runs, or null. It is
// strict on purpose, since whatever it returns gets a stranger's text as an
// argument: every line must be one npm's cmd-shim is known to write, the one
// thing run must be node on one script (or one .exe, which is what opencode's
// package puts in `bin`) with %* and nothing else, and the target must be a
// file that exists inside the shim's own folder. A flag from the shebang, a
// variable set for the program (pnpm sets NODE_PATH), a hand-written wrapper —
// each is a null, and a null means the shim is used as before, with the
// message held and the name reduced.
//
// `node` is where the caller found node.exe, for the shim that has none beside
// it. A full path or nothing: a bare `node` is looked for in the current folder
// first, and that folder is somebody's project (platform.js, CMD_GUARD).
const win = require('path').win32;

const FULL_PATH = /^([A-Za-z]:|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)[\\/]/;
const SHIM_LINES = new Set([
  'echo off', 'goto start', ':find_dp0', 'set dp0=%~dp0', 'exit /b', ':start', 'setlocal', 'call :find_dp0',
  'if exist "%dp0%\\node.exe" (', 'if exist "%~dp0\\node.exe" (', 'set "_prog=%dp0%\\node.exe"', ') else (',
  'set "_prog=node"', 'set pathext=%pathext:;.js;=;%', ')', 'endlocal', 'exit /b %errorlevel%',
]);
// The words npm puts in front of the command so that Ctrl-C does not ask
// "Terminate batch job?". They run nothing.
const SHIM_LEAD = 'endlocal & goto #_undefined_# 2>nul || title %comspec% & ';
const SHIM_RUNS = /^(?:("%_prog%"|"%dp0%\\node\.exe"|"%~dp0\\node\.exe"|node)\s+)?"(%dp0%|%~dp0)\\([^"%]+)"\s+%\*$/i;

function shimTarget(text, shimPath, { exists, node = '' } = {}) {
  const shim = String(shimPath || '');
  if (!FULL_PATH.test(shim) || !/\.cmd$/i.test(shim) || typeof exists !== 'function') return null;
  const seen = new Set();
  let viaNode = null, target = null, usesProg = false, usesDp0 = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^@/, '');
    if (!line) continue;
    if (!line.includes('%*')) {
      const known = line.replace(/\s+/g, ' ').toLowerCase();
      if (!SHIM_LINES.has(known)) return null;
      seen.add(known);
      continue;
    }
    const m = SHIM_RUNS.exec(line.toLowerCase().startsWith(SHIM_LEAD) ? line.slice(SHIM_LEAD.length) : line);
    if (!m) return null;
    if (target !== null && (target !== m[3] || viaNode !== !!m[1])) return null;
    target = m[3]; viaNode = !!m[1];
    usesProg = usesProg || /^"%_prog%"$/i.test(m[1] || '');
    usesDp0 = usesDp0 || m[2].toLowerCase() === '%dp0%';
  }
  if (target === null) return null;
  // A variable nothing in the file sets would be read from the environment.
  if (usesProg && !(seen.has('set "_prog=node"') && seen.has('set "_prog=%dp0%\\node.exe"'))) return null;
  if (usesDp0 && !seen.has('set dp0=%~dp0')) return null;
  if (!(viaNode ? /\.[cm]?js$/i : /\.exe$/i).test(target)) return null;
  const parts = target.split('\\');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[:/]/.test(part))) return null;
  const dir = win.dirname(shim);
  const found = win.join(dir, target);
  if (!exists(found)) return null;
  if (!viaNode) return { file: found, args: [] };
  const beside = win.join(dir, 'node.exe');
  const program = exists(beside) ? beside : String(node || '');
  return reachesCmd(program, WIN) ? null : { file: program, args: [found] };
}

module.exports = { reachesCmd, shimSafe, shimSafeArgs, shimTarget };
