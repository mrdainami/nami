// One offline reference, shared by Settings and Quick Start.
export const OPEN_OUTPUT_COPY = 'Hold Command (⌘) and click a link or file path in a session. Web links open in your browser. Files open here in Nami.';

export const SHORTCUT_GROUPS = [
  {
    icon: 'link', title: 'Links & files',
    rows: [
      ['Open a web link', ['⌘', 'click'], 'In session output · opens your browser'],
      ['Open a file in Nami', ['⌘', 'click'], 'In session output · opens the file here'],
      ['Reveal a file in Finder', ['⌥', '⌘', 'click']],
      ['Reveal a folder in Finder', ['⌘', 'click']],
      ['Open link actions', ['Right-click'], 'Open, copy, or reveal — depending on the link'],
    ],
    note: 'Reading a document? Links in Read mode open with a normal click.',
  },
  {
    icon: 'keyboard', title: 'Everyday shortcuts',
    rows: [
      ['New session', ['⌘', 'N']],
      ['Open the agent picker', ['⌘', 'K']],
      ['Open a folder', ['⌘', 'O']],
      ['New window', ['⇧', '⌘', 'N']],
      ['Open Settings', ['⌘', ',']],
      ['Save the active file', ['⌘', 'S']],
      ['Close the active pane', ['⌘', 'W']],
      ['Dismiss a dialog or leave an expanded pane', ['Esc']],
    ],
  },
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
      ['Rename a selected file or folder', ['Return'], 'When the workspace list has focus'],
      ['Move a selected item to Trash', ['⌘', '⌫'], 'When the workspace list has focus'],
      ['Add selected file content to a session', ['⇧', '⌘', 'Return'], 'From the file’s selection toolbar'],
    ],
  },
];
