// What Ctrl+C means in a session on Windows.
//
// A Mac never has to ask. Copy is ⌘C and interrupt is Ctrl+C, two different
// keys, and the Edit menu's accelerators reach the terminal before xterm does.
// Windows has one key for both, and xterm sees it first: Ctrl+C is ^C, Ctrl+V
// is ^V, each keydown is cancelled, and the Edit menu never hears about either.
// So out of the box a selection cannot be copied from the keyboard at all, and
// paste only works where the program at the other end reads the clipboard
// itself — PowerShell's line editor does, an agent's prompt does not.
//
// The rule is Windows Terminal's, because that is where Windows hands were
// trained:
//
//   Ctrl+C          copies when text is selected, and clears the selection so
//                   that the next Ctrl+C is an interrupt again. With nothing
//                   selected it is ^C, untouched — a running program must
//                   always be stoppable.
//   Ctrl+V          pastes.
//   Ctrl+Shift+C/V  copy and paste, whatever is or is not selected.
//   Ctrl+Shift+A    selects the whole scrollback. Plain Ctrl+A stays with the
//                   shell, where it is "start of line".
//
// AltGr arrives as Ctrl+Alt, and is how half of Europe types @ and {, so
// anything with Alt held is left alone.
//
// Pure: a key event in, a word out. app.js owns the terminal and the clipboard.

// The letter a key means. `key` follows the layout, which is right for Dvorak
// and AZERTY; on a layout with no Latin letters (Russian, Greek) it is not a
// letter at all, and the physical key is the only thing left to go by.
function letterOf(e) {
  const key = String(e.key || '');
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  const m = /^Key([A-Z])$/.exec(String(e.code || ''));
  return m ? m[1].toLowerCase() : '';
}

// 'copy' | 'paste' | 'select-all', or null for "this one is xterm's".
export function termKeyAction(e, { platform = '', hasSelection = false } = {}) {
  if (platform !== 'win32' || !e) return null;
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = letterOf(e);
  if (k === 'c') return (e.shiftKey || hasSelection) ? 'copy' : null;
  if (k === 'v') return 'paste';
  if (k === 'a' && e.shiftKey) return 'select-all';
  return null;
}
