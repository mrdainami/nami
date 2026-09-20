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

module.exports = { reachesCmd, shimSafe, shimSafeArgs };
