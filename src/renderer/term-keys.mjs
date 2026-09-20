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
// The same single key is why Nami's own shortcuts need a rule here too. On a
// Mac they are ⌘ keys and no terminal has ever wanted one. On Windows they are
// Ctrl keys, and with a pane focused xterm turns Ctrl+N, Ctrl+W, Ctrl+K and
// Ctrl+O into ^N, ^W, ^K and ^O and cancels the keydown — measured, not
// guessed: the shortcut silently did nothing and the shell got a control
// character. Those keys have to stay with the terminal. PSReadLine, readline
// and every agent's prompt use them, and an app that eats Ctrl+W or Ctrl+K from
// a shell is broken in a way its user will not forgive.
//
// So, Windows Terminal's answer again: the app's chords inside a pane carry a
// Shift. Ctrl+Shift+<key> is handed back to the app ('app' below: xterm is told
// the key is not its own, nothing is cancelled, and the keydown carries on up
// to onGlobalKey and the menu). The plain Ctrl forms still work wherever a
// terminal does not have the keyboard, exactly as before.
//
//   Ctrl+Shift+T    new session — "new tab" there. Not N: ⇧⌘N was already New
//                   Window on the Mac, and Ctrl+Shift+N is New Window here.
//   Ctrl+Shift+N    new window
//   Ctrl+Shift+K    the agent picker
//   Ctrl+Shift+O    open a folder
//   Ctrl+Shift+W    close the active pane
//   Ctrl+Shift+S    save — for a preview open over a pane that has the focus
//   Ctrl+,          settings. No terminal takes it; it is named so that stays so.
//   Ctrl+1 / 2 / 3  the sidebar's three tabs, which live in the View menu. No
//                   shell can be sent Ctrl+1, and xterm's reading of Ctrl+3 is
//                   Escape, which is nobody's intention.
//
// C, V and A with Ctrl+Shift are taken, above, and are never app chords.
// platform-words.mjs prints these; a test holds the two files together.
//
// Pure: a key event in, a word out. app.js owns the terminal and the clipboard.

// The letter a key means. `key` follows the layout, which is right for Dvorak
// and AZERTY; on a layout with no Latin letters (Russian, Greek) it is not a
// letter at all, and the physical key is the only thing left to go by.
//
// Only then, though. A key that types ASCII punctuation is a Latin layout
// saying "this is not a letter": Dvorak's comma sits on the physical W, and
// reading that as W would make Ctrl+Shift+comma close a pane.
function letterOf(e) {
  const key = String(e.key || '');
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  if (key.length === 1 && key.charCodeAt(0) < 128) return '';
  const m = /^Key([A-Z])$/.exec(String(e.code || ''));
  return m ? m[1].toLowerCase() : '';
}

const SHIFT_CHORDS = { t: 'new-session', n: 'new-window', k: 'agents', o: 'open-folder', w: 'close-pane', s: 'save' };

// The key that types a comma, wherever the layout put it. With Shift held it
// types '<' on a US keyboard and ';' on a German one, so then it is the
// physical key — unless the layout has a letter there.
const isComma = (e) => e.key === ',' || (e.code === 'Comma' && !/^[a-z]$/i.test(String(e.key || '')));
const isTabDigit = (e) => /^Digit[123]$/.test(String(e.code || '')) || (!e.code && /^[123]$/.test(String(e.key || '')));

// Which of Nami's commands a keydown is asking for, in the form that works with
// a terminal focused. The names are the menu's (app-menu.js COMMANDS), plus
// 'new-window'. Null on a Mac, always: its keys are read where they always were.
export function appChord(e, { platform = '' } = {}) {
  if (platform !== 'win32' || !e) return null;
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  if (isComma(e)) return 'settings';
  return (e.shiftKey && SHIFT_CHORDS[letterOf(e)]) || null;
}

// 'copy' | 'paste' | 'select-all' | 'app', or null for "this one is xterm's".
export function termKeyAction(e, { platform = '', hasSelection = false } = {}) {
  if (platform !== 'win32' || !e) return null;
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = letterOf(e);
  if (k === 'c') return (e.shiftKey || hasSelection) ? 'copy' : null;
  if (k === 'v') return 'paste';
  if (k === 'a' && e.shiftKey) return 'select-all';
  if (appChord(e, { platform }) || (!e.shiftKey && isTabDigit(e))) return 'app';
  return null;
}
