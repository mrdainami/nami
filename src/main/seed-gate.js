// Type the seed, but only press Enter where typing visibly landed.
//
// A seeded launch used to be two blind setTimeouts: write the text at ~2.5s,
// write '\r' 350ms later. Fine when the app has drawn its input box; wrong
// when it is showing a startup question instead — Kimi's trust dialog, a
// CLI's update prompt. Dialogs swallow typed text silently and treat Enter
// as "choose the highlighted answer", so the blind '\r' picked "Don't trust"
// on every Kimi launch before the user saw the screen.
//
// The one observable difference between the two states is the echo: an input
// box paints your typing back, a dialog does not. So the gate types the seed
// and watches the output. Seed text seen back → the app took it → Enter.
// Silence → the text went nowhere and is gone → wait and type it again, a
// bounded number of times, then give up and leave the keyboard to the user.
// It never answers a dialog, not even helpfully: no echo, no Enter.
//
// The echo check has to survive what a TUI does to typed text — colour it,
// break it at its own width, indent the continuation — and must not be
// fooled by a spinner narrating similar words while the dialog is up. ANSI
// is stripped, all whitespace removed, and only then is a fragment of the
// seed looked for.
//
// Pure: main.js owns the pty, this owns the timing. Timers are injectable
// for the same reason feedRunDone takes its scratchpad — testable without a
// terminal or a wall clock.

// CSI, OSC (BEL- or ST-terminated), and stray escapes. Enough to unpaint an
// echo; not a terminal emulator.
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?<>= ]*[A-Za-z]|\x1b./g;

const FRAGMENT = 12;      // collapsed chars of seed that count as "saw it"
const ECHO_KEEP = 4000;   // sliding window of unpainted output to search

function flatten(s) {
  return String(s || '').replace(ANSI_RE, '').replace(/\s+/g, '');
}

// Did this stretch of raw output paint the seed back?
function sawEcho(output, seed) {
  const needle = flatten(seed).slice(0, FRAGMENT);
  if (!needle) return false;
  return flatten(output).includes(needle);
}

function startSeedGate(opts) {
  const {
    write, seed,
    firstDelay = 2500, echoWindow = 900, retryEvery = 1800, maxAttempts = 12,
    setTimer = setTimeout, clearTimer = clearTimeout,
  } = opts;
  const needle = flatten(seed).slice(0, FRAGMENT);
  let state = 'idle';        // idle | typed | done | stopped
  let attempts = 0;
  let echoBuf = '';
  let timer = null;

  const arm = (fn, ms) => { timer = setTimer(fn, ms); };

  function attempt() {
    if (state === 'stopped') return;
    attempts++;
    echoBuf = '';
    state = 'typed';
    write(seed);
    // No echo by the next retry: the text was swallowed, type it again.
    // The window between echoWindow and retryEvery exists for slow painters —
    // a late echo in it still gets its Enter instead of a duplicate seed.
    if (attempts < maxAttempts) arm(attempt, retryEvery);
    else state = 'gave-up';
  }

  arm(attempt, firstDelay);

  return {
    onData(chunk) {
      // Only while our own typing is pending. After giving up, an echo is the
      // USER typing — following it with a ghost Enter would submit for them.
      if (state !== 'typed') return;
      echoBuf = (echoBuf + flatten(chunk)).slice(-ECHO_KEEP);
      if (needle && echoBuf.includes(needle)) {
        if (timer != null) clearTimer(timer);
        state = 'done';
        // A breath between echo and Enter, so a TUI mid-repaint is not fed
        // the newline into the same frame that painted the text.
        arm(() => { write('\r'); }, 120);
      }
    },
    stop() {
      state = 'stopped';
      if (timer != null) clearTimer(timer);
    },
  };
}

module.exports = { startSeedGate, sawEcho };
