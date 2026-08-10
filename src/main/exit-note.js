// What to tell the user when a session's process goes away.
//
// The raw number is not the answer. A pty killed with SIGHUP — which is what
// node-pty's kill() sends, and therefore what quitting Nami, closing a window,
// or closing a tile all send — exits 129, and "[process exited · 129]" reads as
// a crash to anyone who does not know that 129 is 128+1. It is the most normal
// event in the app, reported in its most alarming form.
//
// So: say who ended it. Nami closing a session says so. A program that finished
// on its own says so. Only a genuine fault keeps the number, because there the
// number is the one useful thing.
const SIGNALS = { 1: 'SIGHUP', 2: 'SIGINT', 3: 'SIGQUIT', 9: 'SIGKILL', 15: 'SIGTERM' };

// node-pty reports a signal death either as `signal` or, on some platforms, as
// an exit code of 128+n with no signal field. Normalise both into a name.
function signalName({ code, signal } = {}) {
  if (typeof signal === 'number') return SIGNALS[signal] || ('signal ' + signal);
  if (typeof signal === 'string' && signal) return signal;
  const n = Number(code);
  if (Number.isFinite(n) && n > 128 && n < 160) return SIGNALS[n - 128] || ('signal ' + (n - 128));
  return '';
}

function exitNote({ code, signal, deliberate } = {}) {
  // Nami pulled the plug: quitting, closing the window, closing the tile. The
  // user did this, so there is nothing to report but the fact.
  if (deliberate) return 'session closed';
  const sig = signalName({ code, signal });
  // Ctrl-C is the user too, just from inside the terminal.
  if (sig === 'SIGINT') return 'stopped';
  // A hangup we did not ask for means the terminal went away underneath the
  // process — worth naming, because it is not the program's own doing.
  if (sig === 'SIGHUP') return 'terminal closed';
  if (sig) return 'stopped · ' + sig;
  if (Number(code) === 0) return 'finished';
  return 'exited · ' + (code === undefined || code === null ? '?' : code);
}

module.exports = { exitNote, signalName };
