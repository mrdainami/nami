// Does this element own the keyboard? Asked by the global key handler before a
// bare key does something app-wide — Enter renaming the selected rail row, ⌘⌫
// trashing it. A tag check alone is not enough: the Markdown editor is a
// ProseMirror contenteditable, and a bare Enter there is a paragraph, not a
// command. Takes any object shaped like an element so it can be tested without
// a DOM.
export function isTypingTarget(el) {
  if (!el) return false;
  if (/^(INPUT|TEXTAREA)$/.test(el.tagName || '')) return true;
  return !!el.isContentEditable;
}
