// What right-clicking a link in a session offers.
//
// ⌘-click already has three destinations — browser, editor tile, Finder — and
// the only way to learn them is to be told. The menu says them out loud, and
// adds the one modifier keys cannot do: put the thing on the clipboard.
//
// Copy is why this exists. The hard-wrap join in term-wrap.mjs is inference,
// and inference misses; the frozen-cwd retry needs a live pty and there is not
// always one. Both of those end with an address on screen that you cannot
// click, and the answer to that has to be something better than retyping it.
//
// Which means the menu is offered on *scanner* hits, not stat hits. A path
// whose stat missed still gets a menu — Open inert and saying why, Copy
// working. Gated on the stat it would disappear in exactly the case it is for.
// Decoration stays gated: nothing dead is ever underlined, and the underline
// keeps meaning "this opens".
//
// Plain data out, no DOM, so the shapes are testable without a terminal —
// showMenu already knows how to render a list like this, and treeMenu already
// produces one.

// The label a copy row carries. Two, because "Copy link" on a file path reads
// like it would copy a hyperlink, and "Copy path" on a url reads like a bug.
function copyRow(kind, value) {
  return { label: kind === 'url' ? 'Copy link' : 'Copy path', copy: value };
}

export function termMenuItems({ kind, text, st }) {
  if (kind === 'url') {
    return [
      { label: 'Open in browser', kb: '⌘click' },
      '-',
      // The text as printed, not urlTarget's normalised form: a bare www host
      // opens as https:// but must paste back as what was on screen.
      copyRow(kind, text),
    ];
  }

  // No stat, or one that missed. Everything about this row stays as it looks
  // today — no underline, no pointer, no ⌘-click — but it can be copied, and
  // the menu says why it cannot be opened rather than leaving you to wonder.
  if (!st || !st.exists) {
    return [
      { label: 'Open', kb: 'not found', off: true },
      '-',
      copyRow(kind, text),
    ];
  }

  // A directory has no second route: ⌘-click already reveals it rather than
  // opening a tile, so advertising ⌥⌘ here would name a shortcut that does
  // nothing different.
  if (st.isDir) {
    return [
      { label: 'Reveal in Finder', kb: '⌘click' },
      '-',
      copyRow(kind, st.abs || text),
    ];
  }

  return [
    { label: 'Open', kb: '⌘click' },
    { label: 'Reveal in Finder', kb: '⌥⌘click' },
    '-',
    copyRow(kind, st.abs || text),
  ];
}
