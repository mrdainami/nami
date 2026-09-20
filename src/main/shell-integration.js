// Where a Windows pane is, told by the shell because nothing else can say.
//
// On a Mac the question "where is this session now" is put to the OS: one lsof
// on the shell's pid (pty-cwd.js). Windows has no such call — a process's
// working folder lives in its own memory, and reading it means opening another
// process and walking its PEB. So the shell says instead. PowerShell runs a
// function called `prompt` before every prompt it shows, and that function can
// write an escape sequence on its way past:
//
//   ESC ] 9 ; 9 ; C:\work\atlas ESC \
//
// OSC 9;9 is the sequence Windows Terminal reads for the same purpose, so a
// profile that already emits it (oh-my-posh and starship both can) is speaking
// the dialect this parser listens for. Measured on Windows 11 through node-pty:
// ConPTY hands OSC 9;9, OSC 7 and OSC 1337 to the terminal untouched, and
// xterm.js has no handler for any of them, so nothing reaches the tile.
//
// pty-cwd.js rules OSC out for the Mac because it means a different shim for
// zsh, bash and fish. A Windows pane is always PowerShell (platform.js,
// paneShell), so here it is one shim, and there is no lsof to prefer.
//
// Three rules the hook is written around:
//
// It WRAPS the prompt, it does not replace it. The profile has already run by
// the time -Command does, so whatever `prompt` is at that moment — the stock
// one, oh-my-posh, starship, something hand-written — is kept and called, and
// what it returns is what the wrapper returns. $? is put back first, because
// those prompts colour themselves by whether the last command failed and the
// wrapper's own statements would otherwise have answered for it.
//
// It arrives as a launch argument, never typed. A pty echoes what is typed into
// it, and a tile that opens on a paragraph of Nami's own PowerShell is not
// acceptable (run-done.js learned the same thing about its suffix). -Command
// rather than a script file, because a stock Windows refuses to run script
// files at all (ExecutionPolicy Restricted) and says so in red.
//
// No -NoProfile. A pane is the user's own shell, and their profile is where
// their prompt, aliases and PATH additions live.
//
// One exception to "what it returns is what the wrapper returns". In a folder
// on a network share PowerShell has no drive to name, so the stock prompt
// prints the provider-qualified path:
//
//   PS Microsoft.PowerShell.Core\FileSystem::\\server\share\work>
//
// When the inner prompt's output is exactly that stock line, the wrapper hands
// back the same line with the plain path in it. Anything else — any prompt a
// person wrote or installed — passes through as it came.
//
// Pure: main.js owns the pty, this owns the text and the parsing.

const { isPowerShell } = require('./platform.js');

const WIN = 'win32';

// Single quotes only, and no newlines: this travels as one command-line
// argument, and every double quote in it would be one more thing for two layers
// of argument quoting to get right. Works in Windows PowerShell 5.1 and 7.
const CWD_HOOK = [
  '$global:__namiPrompt = $function:prompt',
  'function global:prompt { '
    + '$namiOk = $global:?; '
    + '$namiLoc = $executionContext.SessionState.Path.CurrentLocation; '
    + "$namiFs = $namiLoc.Provider.Name -eq 'FileSystem'; "
    + "if ($namiFs) { [Console]::Write([char]27 + ']9;9;' + $namiLoc.ProviderPath + [char]27 + '\\') }; "
    + "if (-not $namiOk) { Write-Error 'nami' -ErrorAction Ignore }; "
    + '$namiOut = & $global:__namiPrompt; '
    + "$namiTail = ('>' * ($nestedPromptLevel + 1)) + ' '; "
    + "if ($namiFs -and $namiOut -is [string] -and $namiLoc.Path -cne $namiLoc.ProviderPath -and $namiOut -ceq ('PS ' + $namiLoc.Path + $namiTail)) { 'PS ' + $namiLoc.ProviderPath + $namiTail } "
    + 'elseif ($null -ne $namiOut) { $namiOut } '
    + '}',
].join('; ');

const flag = (name) => (a) => String(a).toLowerCase() === name;

// The arguments a pane's shell is really started with.
//
// A pane starts PowerShell three ways (main.js, term:create):
//
//   []                          a plain interactive shell
//   -NoLogo -NoExit -Command …  a one-shot: the command runs, then a prompt
//   -NoLogo -Command …          an agent tile: the line is the script, and the
//                               shell ends with it
//
// The first two end at a prompt, so they get the hook. The third never shows
// one: the shell cannot move, and the folder it was started in is the answer
// for its whole life — which is what pty-cwd.js gives when nothing was told.
//
// In a one-shot the hook goes BEFORE the command. After it, the hook's own
// statements would sit between the command and the `$?` that run-done.js reads.
//
// Everything that is not PowerShell on Windows comes back as it was given.
function reportingArgs(shell, args = [], platform = process.platform) {
  const list = Array.isArray(args) ? args : [];
  if (platform !== WIN || !isPowerShell(shell)) return list;
  if (!list.length) return ['-NoExit', '-Command', CWD_HOOK];
  const at = list.findIndex(flag('-command'));
  if (at !== list.length - 2 || !list.some(flag('-noexit'))) return list;
  return [...list.slice(0, at + 1), `${CWD_HOOK}; ${list[at + 1]}`];
}

const OPEN = '\x1b]9;9;';
const CWD_RE = /\x1b\]9;9;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
// A Windows path can run to 32,767 characters, but one that long is not a
// folder anyone is working in. Past this an unfinished sequence is given up on,
// so a program that prints half of one cannot make the carry grow for ever.
const MAX_CARRY = 4096;

// Windows Terminal's own documentation writes the path in double quotes, and
// accepts it bare; take both. Only an absolute path is believed — this becomes
// the base a relative token is resolved against, and a relative base would
// quietly mean "relative to wherever Nami itself was started".
function cleanCwd(raw) {
  const p = String(raw || '').replace(/^"(.*)"$/, '$1');
  if (!p || /[\x00-\x1f\x7f]/.test(p)) return null;
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p) ? p : null;
}

// Feed one chunk of pty output. Returns the folder the shell last reported in
// it, or null when it reported none.
//
// Stateful for the same reason feedRunDone is: pty chunks are whatever was
// ready, and a sequence carrying a long path straddles two reads more often
// than run-done's short one does. `st` is a per-session { buf } scratchpad
// owned by the caller.
function feedCwd(st, chunk) {
  const s = String(chunk || '');
  if (!s) return null;
  const buf = (st.buf || '') + s;
  let found = null, end = 0, m;
  const re = new RegExp(CWD_RE.source, 'g'); // fresh lastIndex per call
  while ((m = re.exec(buf))) {
    end = re.lastIndex;
    const p = cleanCwd(m[1]);
    if (p) found = p; // last one in the chunk wins
  }
  // Carry only what could still become a sequence: one that has opened and not
  // closed, or a tail that is the first few bytes of an opening.
  const rest = buf.slice(end);
  const at = rest.lastIndexOf(OPEN);
  let keep = '';
  if (at >= 0) keep = rest.length - at <= MAX_CARRY ? rest.slice(at) : '';
  else for (let k = Math.min(OPEN.length - 1, rest.length); k > 0; k--) {
    if (rest.endsWith(OPEN.slice(0, k))) { keep = OPEN.slice(0, k); break; }
  }
  st.buf = keep;
  return found;
}

module.exports = { CWD_HOOK, reportingArgs, feedCwd, cleanCwd };
