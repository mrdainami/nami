// Instructions only: never place terminal output, URLs, or local paths in the
// tooltip. The existing link resolver remains responsible for what can open.
export function linkHintText({ kind, st }) {
  if (kind === 'url') return ['⌘ Click to open in browser', 'Right-click for more options'];
  if (!st || !st.exists) return null;
  if (st.isDir) return ['⌘ Click to reveal in Finder', 'Right-click for more options'];
  if (st.isFile) return ['⌘ Click to open file', '⌥⌘ Click to reveal in Finder', 'Right-click for more options'];
  return null;
}

export function createLinkHint({ document, window, schedule = setTimeout, cancel = clearTimeout }) {
  let active = null;
  let revision = 0;
  function hide(owner) {
    if (active && owner !== undefined && active.owner !== owner) return false;
    // Also invalidate file lookups that have not reached the dwell timer yet.
    revision++;
    if (!active) return false;
    cancel(active.timer);
    if (active.node) active.node.remove();
    active = null;
    return true;
  }
  function show(target, point, owner) {
    hide();
    const lines = linkHintText(target);
    if (!lines || !point || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
    const pending = { owner, node: null, timer: null };
    active = pending;
    pending.timer = schedule(() => {
      if (active !== pending) return;
      const node = document.createElement('div');
      node.className = 'term-link-hint';
      node.setAttribute('role', 'tooltip');
      lines.forEach((text, index) => {
        const line = document.createElement(index === 0 ? 'strong' : 'span');
        line.textContent = text;
        node.appendChild(line);
      });
      document.body.appendChild(node);
      pending.node = node;
      const rect = node.getBoundingClientRect();
      const left = Math.max(12, Math.min(point.clientX + 14, window.innerWidth - rect.width - 12));
      const below = point.clientY + 18;
      const top = below + rect.height <= window.innerHeight - 12 ? below : Math.max(12, point.clientY - rect.height - 14);
      node.style.left = left + 'px';
      node.style.top = top + 'px';
    }, 300);
  }
  return { show, hide, get revision() { return revision; } };
}
