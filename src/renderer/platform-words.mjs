// The words and keys that belong to the machine, not to Nami, in one place.
//
// Nami was written on a Mac and talked like one: "Reveal in Finder", "on this
// Mac", ⌘N. Every one of those was right, and none of them was marked as a
// platform decision — they were just strings, about seventy of them, spread
// over a dozen files. On Windows each one is a small lie: there is no Finder,
// no ⌘ key to press, and the sentence "it stays on your Mac" is said to someone
// who does not own one.
//
// Same bargain as paths.mjs: pure, and platform is always a parameter. It
// defaults to the platform the app is really on; under plain node there is none
// and everything here takes its Mac column, which is what keeps the Mac tests
// honest on any machine. Anything that is not Windows reads the Mac column.
//
// The Mac column is what the app printed before this file existed, character
// for character. The tests hold it to that.

import { currentPlatform } from './paths.mjs';

const WIN = 'win32';

// ---- keys --------------------------------------------------------------------
// A Mac writes a chord as glyphs, tight: ⇧⌘N. Windows writes words with plus
// signs, and puts the modifiers in one fixed order — Ctrl+Alt+Shift — whatever
// order the Mac had them in. So ⌥⌘click is Ctrl+Alt+click, not Alt+Ctrl+click.
const WIN_CAPS = {
  '⌘': 'Ctrl', '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift',
  '⌫': 'Backspace', '⌦': 'Delete', '↵': 'Enter', 'Return': 'Enter', '⇥': 'Tab',
};
const WIN_MODS = ['Ctrl', 'Alt', 'Shift'];

// Key caps, one per array entry, which is what the shortcuts sheet draws: each
// entry becomes a <kbd>, and the word 'click' is drawn as "+ click".
export function keys(list, platform = currentPlatform()) {
  if (platform !== WIN) return list;
  const caps = list.map((k) => WIN_CAPS[k] || k);
  // ⌃ and ⌘ both land on Ctrl; a PC keyboard has one, and one cap says it.
  const mods = WIN_MODS.filter((m) => caps.includes(m));
  return [...mods, ...caps.filter((k) => !WIN_MODS.includes(k))];
}

const joined = (caps, platform) => caps.join(platform === WIN ? '+' : '');

// The same chord as one piece of text, for a menu row or a button: '⇧⌘N' on a
// Mac, 'Ctrl+Shift+N' on Windows.
export function kb(list, platform = currentPlatform()) {
  return joined(keys(list, platform), platform);
}

// "⌘ Click to open…" is how the Mac hint has always read, glyphs then a space.
// With words the space reads as two separate things, so Windows joins it up.
export function clickWith(mods, platform = currentPlatform()) {
  return platform === WIN ? kb([...mods, 'Click'], platform) : kb(mods, platform) + ' Click';
}

// ---- Nami's own chords -------------------------------------------------------
// These are not a translation, which is why they are a table and not a call to
// keys(). On a Mac ⌘N can never collide with a terminal, because a terminal has
// no use for ⌘. On Windows the app's modifier and the terminal's are the same
// key: inside a pane Ctrl+N, Ctrl+W, Ctrl+K and Ctrl+O belong to the shell and
// to whatever agent is running in it, and they must stay there. So each chord
// has a Ctrl+Shift form that works everywhere, a pane included — the Windows
// Terminal convention — and that is the form Nami prints, because a key that
// works only some of the time is one nobody learns. The plain Ctrl forms still
// work wherever a terminal does not have the keyboard (term-keys.mjs has the
// rule, and the list of which chords get through).
//
// New session is Ctrl+Shift+T and not Ctrl+Shift+N: the Mac had already given
// ⇧⌘N to New Window, and Ctrl+Shift+N is New Window everywhere on Windows too.
// T is "new tab" in Windows Terminal, which is the nearest thing to a session.
// Settings and Save keep the plain form: no terminal takes Ctrl+comma, and a
// file is saved from its editor, where Ctrl+S is Nami's already.
//
// Trash is Ctrl+Delete on Windows because Delete is the key Windows deletes a
// file with. The handler has always taken either key.
export const APP_CHORDS = {
  'new-session': { mac: ['⌘', 'N'], win: ['Ctrl', 'Shift', 'T'] },
  'new-window': { mac: ['⇧', '⌘', 'N'], win: ['Ctrl', 'Shift', 'N'] },
  'agents': { mac: ['⌘', 'K'], win: ['Ctrl', 'Shift', 'K'] },
  'open-folder': { mac: ['⌘', 'O'], win: ['Ctrl', 'Shift', 'O'] },
  'settings': { mac: ['⌘', ','], win: ['Ctrl', ','] },
  'save': { mac: ['⌘', 'S'], win: ['Ctrl', 'S'] },
  'close-pane': { mac: ['⌘', 'W'], win: ['Ctrl', 'Shift', 'W'] },
  'trash': { mac: ['⌘', '⌫'], win: ['Ctrl', 'Delete'] },
};

export function chord(name, platform = currentPlatform()) {
  const c = APP_CHORDS[name];
  if (!c) throw new Error('No such chord: ' + name);
  return platform === WIN ? c.win : c.mac;
}

export function chordText(name, platform = currentPlatform()) {
  return joined(chord(name, platform), platform);
}

// ---- words -------------------------------------------------------------------
// Nouns first, then the few whole sentences whose grammar differs — a sentence
// that only swaps a noun is built where it is used, from the noun.
const MAC_WORDS = Object.freeze({
  os: 'Mac',
  finder: 'Finder',
  // The one-word button on a file's bar.
  finderShort: 'Finder',
  reveal: 'Reveal in Finder',
  thisMac: 'this Mac',
  yourMac: 'your Mac',
  theMac: 'the Mac',
  dock: 'Dock',
  trash: 'Trash',
  keychain: 'Keychain',
  menuBar: 'menu bar',
  holdToOpen: 'Hold Command (⌘) and click a link or file path in a session. Web links open in your browser. Files open here in Nami.',
  // The line under the shortcuts sheet. A Mac needs its glyphs named; Windows
  // has no glyphs, and the thing worth saying there is what Shift is for.
  keyLegend: '⌘ Command · ⌥ Option · ⇧ Shift',
  noAgentYet: 'No agent is installed yet. Press ' + chordText('new-session', 'darwin') + ' to add one first.',
  shortcutsLabel: '⌘ Shortcuts & gestures',
});

const WIN_WORDS = Object.freeze({
  os: 'Windows',
  finder: 'File Explorer',
  finderShort: 'Explorer',
  reveal: 'Reveal in File Explorer',
  thisMac: 'this PC',
  yourMac: 'your PC',
  theMac: 'the PC',
  dock: 'taskbar',
  // With its article, because that is how Windows itself says it: a file is
  // moved "to the Recycle Bin", never "to Recycle Bin".
  trash: 'the Recycle Bin',
  keychain: 'Windows credentials',
  menuBar: 'menu',
  holdToOpen: 'Hold Ctrl and click a link or file path in a session. Web links open in your browser. Files open here in Nami.',
  keyLegend: 'Ctrl+Shift keys work inside a terminal too',
  noAgentYet: 'No agent is installed yet. Press ' + chordText('new-session', WIN) + ' to add one first.',
  shortcutsLabel: 'Shortcuts & gestures',
});

export function words(platform = currentPlatform()) {
  return platform === WIN ? WIN_WORDS : MAC_WORDS;
}
