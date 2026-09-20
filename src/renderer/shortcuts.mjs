// One offline reference, shared by Settings and Quick Start.
//
// The rows are written once, in the Mac's keys, and platform-words.mjs turns
// them into the keys of the machine the sheet is drawn on. Nami's own chords
// are asked for by name, because on Windows they are not a translation: ⌘N is
// Ctrl+Shift+T there, the form that still works with a terminal pane focused.
import { currentPlatform } from './paths.mjs';
import { words, keys, chord } from './platform-words.mjs';

const WIN = 'win32';

export function openOutputCopy(platform = currentPlatform()) { return words(platform).holdToOpen; }

export function shortcutGroups(platform = currentPlatform()) {
  const w = words(platform);
  const k = (list) => keys(list, platform);
  const c = (name) => chord(name, platform);
  const everyday = {
    icon: 'keyboard', title: 'Everyday shortcuts',
    rows: [
      ['New session', c('new-session')],
      ['Open the agent picker', c('agents')],
      ['Open a folder', c('open-folder')],
      ['New window', c('new-window')],
      ['Open Settings', c('settings')],
      ['Save the active file', c('save')],
      ['Close the active pane', c('close-pane')],
      ['Dismiss a dialog or leave an expanded pane', ['Esc']],
    ],
  };
  // Only Windows has anything to explain here. A Mac's ⌘ never reaches a
  // terminal, so there is one form of each key and nothing to say about it.
  if (platform === WIN) everyday.note = 'Inside a terminal, Ctrl+N, Ctrl+K, Ctrl+O and Ctrl+W belong to the program running there, so these use Ctrl+Shift. Anywhere else the plain Ctrl key works too.';
  return [
    {
      icon: 'link', title: 'Links & files',
      rows: [
        ['Open a web link', k(['⌘', 'click']), 'In session output · opens your browser'],
        ['Open a file in Nami', k(['⌘', 'click']), 'In session output · opens the file here'],
        ['Reveal a file in ' + w.finder, k(['⌥', '⌘', 'click'])],
        ['Reveal a folder in ' + w.finder, k(['⌘', 'click'])],
        ['Open link actions', ['Right-click'], 'Open, copy, or reveal — depending on the link'],
      ],
      note: 'Reading a document? Links in Read mode open with a normal click.',
    },
    everyday,
    {
      icon: 'desk', title: 'Arrange your desk',
      rows: [
        ['Reorder a pane', ['Drag header']],
        ['Resize a pane', ['Drag handle']],
        ['Reset a pane’s size', ['Double-click handle']],
        ['Rename a session', ['Double-click title']],
      ],
    },
    {
      icon: 'file', title: 'In the workspace',
      rows: [
        ['Rename a selected file or folder', k(['Return']), 'When the workspace list has focus'],
        ['Move a selected item to ' + w.trash, c('trash'), 'When the workspace list has focus'],
        ['Add selected file content to a session', k(['⇧', '⌘', 'Return']), 'From the file’s selection toolbar'],
      ],
    },
  ];
}

// What the app imports: the sheet for the machine it is running on.
export const OPEN_OUTPUT_COPY = openOutputCopy();
export const SHORTCUT_GROUPS = shortcutGroups();
