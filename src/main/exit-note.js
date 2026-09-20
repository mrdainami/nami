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

// Windows has no signals. A process that dies there exits with an NTSTATUS
// value, and node-pty hands it over as it came: Ctrl+C measured on a real
// Windows 11 pty is -1073741510, which is 0xC000013A read as a signed number;
// other reporters give the same status unsigned, 3221225786. Either way it is
// ten digits that mean nothing to the person reading the tile, so the ones that
// actually turn up are spelled out. Keyed unsigned; see ntStatus below.
const NT_CTRL_C = 0xC000013A;
const NT_WORDS = {
  0xC0000005: 'crashed · access violation',
  0xC0000017: 'crashed · out of memory',
  0xC000001D: 'crashed · illegal instruction',
  0xC0000094: 'crashed · divide by zero',
  0xC00000FD: 'crashed · stack overflow',
  0xC0000135: 'could not start · a DLL it needs is missing',
  0xC0000139: 'could not start · a DLL it needs is the wrong version',
  0xC0000142: 'could not start · a DLL failed to load',
  0xC0000374: 'crashed · heap corruption',
  0xC0000409: 'crashed · stack buffer overrun',
};

// The status as Windows writes it, or 0 when the code is an ordinary exit code.
// Every fatal NTSTATUS has its top two bits set, which no program's own exit
// code does, so the range alone tells the two apart.
function ntStatus(code) {
  const n = Number(code);
  if (!Number.isInteger(n)) return 0;
  const u = n >>> 0;
  return u >= 0xC0000000 ? u : 0;
}

// node-pty reports a signal death either as `signal` or, on some platforms, as
// an exit code of 128+n with no signal field. Normalise both into a name.
// 128+n is a POSIX habit: on Windows 130 is just a program that returned 130.
function signalName({ code, signal } = {}, platform = process.platform) {
  if (typeof signal === 'number' && signal > 0) return SIGNALS[signal] || ('signal ' + signal);
  if (typeof signal === 'string' && signal) return signal;
  if (platform === 'win32') return '';
  const n = Number(code);
  if (Number.isFinite(n) && n > 128 && n < 160) return SIGNALS[n - 128] || ('signal ' + (n - 128));
  return '';
}

// The Windows reading of a code, or '' when it is one the shared wording below
// already says well — 0, 1, and anything else a program chose for itself.
function windowsNote(code) {
  const status = ntStatus(code);
  // Ctrl+C, and the same status when the console is closed under a program.
  // Both are the user, exactly as SIGINT is on a Mac.
  if (status === NT_CTRL_C) return 'stopped';
  if (status) return NT_WORDS[status] || ('crashed · 0x' + status.toString(16).toUpperCase());
  // cmd.exe's own code for a name it could not find, which is what a batch
  // file passes on when the tool it wraps is not installed.
  if (Number(code) === 9009) return 'exited · command not recognized';
  return '';
}

function exitNote({ code, signal, deliberate } = {}, platform = process.platform) {
  // Nami pulled the plug: quitting, closing the window, closing the tile. The
  // user did this, so there is nothing to report but the fact.
  if (deliberate) return 'session closed';
  if (platform === 'win32') {
    const words = windowsNote(code);
    if (words) return words;
  }
  const sig = signalName({ code, signal }, platform);
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
