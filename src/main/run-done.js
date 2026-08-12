// "Did the command Nami typed into that shell finish, and how did it go?"
//
// A kind:'run' tile is a real interactive login shell with a command written
// into it. That is deliberate — it sources the user's rc file, it can ask for a
// sudo password, and it stays alive afterwards so the output can be read. The
// cost is that the shell, not Nami, owns the command: pty exit only fires when
// the *shell* dies, which for an install is usually never. So the install tile
// sat at a prompt with nothing in the app knowing the install had finished, and
// the user was told to go and press ⌘N.
//
// The shell can just say. Appending a printf to the command makes it announce
// its own exit code the moment it lands:
//
//   curl … | bash; printf '\033]1337;NamiRunDone=%s\007' "$?"
//
// OSC 1337 is a private-use operating system command. xterm.js parses and
// discards handlers it does not know, so nothing appears in the tile — the same
// channel Nami already reads claude's session titles from (osc-title.js), used
// the other way round.
//
// `;` and not `&&`, so a failed install still reports.
//
// What the code is worth, measured rather than assumed: `$?` after a pipeline
// is the status of its LAST stage. Four of the six install commands are
// `curl … | bash`, and a curl that fails outright still leaves bash reading an
// empty script and exiting 0 — verified against a real pty, unreachable host,
// exit 0. So a zero here means "the shell got to the end", not "it worked".
// Only the scan can say an agent was installed, and the caller treats it that
// way. A non-zero, on the other hand, is always real.
//
// `set -o pipefail` would sharpen this, and is deliberately not used: it would
// mean running the user's command in a subshell with options they did not
// choose, to improve a message that is already backed by something better.
//
// One gap, deliberately left: a command that ends the shell itself — a bare
// `exit`, an installer that execs — never reaches the printf. That case kills
// the pty, which fires term:exit, which the tile already listens to. Two
// signals, no hole between them.
//
// Pure: main.js owns the pty, this owns the parsing.

const OPEN = ']1337;NamiRunDone=';
const DONE_RE = /\]1337;NamiRunDone=(-?\d{1,5})(?:|\\)/;

// The suffix appended to a run command. Single-quoted so the shell expands
// nothing in it; "$?" quoted so an empty status cannot swallow the argument.
function doneSuffix(command) {
  return `${command}; printf '\\033]1337;NamiRunDone=%s\\007' "$?"`;
}

// The suffix cannot be TYPED into an interactive shell, which is how a run tile
// used to be driven: a pty echoes its input, so the user watched Nami's own
// printf scroll past on the end of their install line. Measured in the real
// app — sentinelVisible: true — and unacceptable in a tile people read.
//
// So a one-shot is spawned with the command instead of sent it. Nothing is
// typed, so nothing is echoed, and the tile shows only what the command
// printed. The caller writes the `$ command` header itself, straight to the
// renderer, so the tile still says what it is running.
//
// `exec <shell> -i` at the end is what keeps the tile a terminal afterwards
// rather than a corpse — and it is a fresh interactive shell, so it re-reads
// the rc file the installer just wrote a PATH line into. The prompt you are
// left with can run the thing that was installed; the one that ran the install
// could not.
function oneShotArgs(shell, command) {
  return ['-i', '-c', `${doneSuffix(command)}; exec ${shell} -i`];
}

// Feed one chunk of pty output. Returns the exit code once, or null.
//
// Stateful because a 12-byte escape can straddle two reads — pty chunks are
// whatever the kernel had ready, not lines. `st` is a per-session { buf }
// scratchpad owned by the caller, exactly like feedOscTitle's { last }.
function feedRunDone(st, chunk) {
  const s = String(chunk || '');
  if (!s) return null;
  // Only carry a tail long enough to hold a split sequence. Without this cap a
  // long-running tile would accumulate every byte it ever printed.
  const buf = (st.buf || '') + s;
  const m = DONE_RE.exec(buf);
  if (m) {
    st.buf = '';
    const code = Number(m[1]);
    return Number.isFinite(code) ? code : 0;
  }
  const keep = OPEN.length + 8;
  st.buf = buf.length > keep ? buf.slice(-keep) : buf;
  return null;
}

module.exports = { doneSuffix, oneShotArgs, feedRunDone, DONE_RE };
