// Which windows a relaunch brings back.
//
// The rule on a Mac is simple because quitting and closing are two acts: a
// window you close on purpose is gone for good, and ⌘Q finds every other window
// still open and writes them down. Windows and Linux have one act. Closing the
// last window IS quitting, so by the time anything is written down the window
// that mattered has already been destroyed, the list is empty, and tomorrow
// Nami opens on "no folder" — having forgotten the one place you were working.
//
// So off the Mac, the last window to close is remembered as still open. Closing
// a window while others remain is still a close on purpose, there as here.
//
// Pure: main.js owns the windows, this owns the decision.
function rememberedWindows({ open = [], lastClosed = null, platform = process.platform } = {}) {
  if (open.length || platform === 'darwin' || !lastClosed) return open;
  return [lastClosed];
}

module.exports = { rememberedWindows };
