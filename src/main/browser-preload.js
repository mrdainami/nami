// Isolated selection helper: only geometry and public page metadata cross IPC.
// Comments, microphones, recipients and all annotation UI belong to Nami.
const { ipcRenderer } = require('electron');
const documentId = crypto.randomUUID();
const tracked = new Map();
let highlightRoot = null, helperStyle = null, captureId = null;
const pickerCursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="7" fill="none" stroke="Highlight" stroke-width="2"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="Highlight" stroke-width="2" fill="none"/></svg>')}") 12 12, crosshair`;
function updateCursor() {
  if (helperStyle) helperStyle.textContent = (active ? `html,body,body *{cursor:${pickerCursor} !important}` : '') + (captureId ? '::selection{background:transparent!important;color:inherit!important}' : '');
}
let active = false, showAnnotations = false, pointer = null, frame = 0, sequence = 0, suppressClick = false, consumed = false;
function textualPoint(x, y) {
  const caret = document.caretRangeFromPoint?.(x, y) || document.caretPositionFromPoint?.(x, y);
  const node = caret?.startContainer || caret?.offsetNode;
  return !!(node && node.nodeType === 3 && /\S/.test(node.nodeValue || ''));
}
const rectangle = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
const viewport = () => ({ width: innerWidth, height: innerHeight });
function locator(el) {
  // Selectors cannot cross a shadow/frame boundary. Do not invent one.
  if (!el || el.getRootNode() !== document || el.tagName === 'IFRAME') return '';
  if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
  const parts = [];
  for (let node = el; node?.nodeType === 1; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const siblings = node.parentElement ? [...node.parentElement.children].filter((e) => e.tagName === node.tagName) : [];
    parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
  }
  return parts.join(' > ');
}
const textOf = (el) => (el?.innerText || el?.getAttribute?.('aria-label') || el?.getAttribute?.('alt') || '').slice(0, 16000);
function geometry(item) {
  if (item.stale) return { selectionId: item.selectionId, stale: true };
  if (item.kind === 'region') return { selectionId: item.selectionId, rect: { ...item.rect, x: item.rect.x - scrollX, y: item.rect.y - scrollY }, stale: false };
  const connected = item.el?.isConnected && (item.kind !== 'text' || item.range?.commonAncestorContainer.isConnected);
  const text = item.kind === 'text' ? item.range?.toString().slice(0, 16000) : textOf(item.el);
  if (!connected || text !== item.text) { item.stale = true; return { selectionId: item.selectionId, stale: true }; }
  const source = item.kind === 'text' ? item.range : item.el;
  return { selectionId: item.selectionId, rect: rectangle(source.getBoundingClientRect()), rects: [...source.getClientRects()].slice(0, 100).map(rectangle), stale: false };
}
function drawHighlights(hover) {
  if (!highlightRoot) return;
  if (captureId || !showAnnotations) { highlightRoot.replaceChildren(); return; }
  const nodes = [...tracked.values()].flatMap((item) => { const value = geometry(item); return value.stale ? [] : (value.rects?.length ? value.rects : value.rect ? [value.rect] : []).map((r) => ({ r, dashed: false })); });
  if (hover?.rect) nodes.push({ r: hover.rect, dashed: true });
  highlightRoot.replaceChildren(...nodes.slice(0, 2000).map(({ r, dashed }) => { const node = document.createElement('span'); node.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${Math.max(0, r.width)}px;height:${Math.max(0, r.height)}px;box-sizing:border-box;outline:1px ${dashed ? 'dashed' : 'solid'} Highlight;background:${dashed ? 'transparent' : 'color-mix(in srgb, Highlight 12%, transparent)'};pointer-events:none`; return node; }));
}
function layout(hover) {
  drawHighlights(hover);
  ipcRenderer.send('browser:annotation-layout', { documentId, viewport: viewport(), selections: [...tracked.values()].map(geometry), ...(hover ? { hover } : {}) });
}
function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; layout(); }); }
function select(el, range, rect, channel = 'browser:selection') {
  const kind = rect ? 'region' : range ? 'text' : 'component';
  const selectionId = documentId + ':' + (++sequence);
  const text = kind === 'text' ? range.toString().slice(0, 16000) : kind === 'region' ? '' : textOf(el);
  const item = { selectionId, kind, el, range, text, ...(rect ? { rect: { ...rect, x: rect.x + scrollX, y: rect.y + scrollY } } : {}) };
  tracked.set(selectionId, item);
  if (tracked.size > 200) tracked.delete(tracked.keys().next().value);
  ipcRenderer.send(channel, { ...geometry(item), documentId, kind, viewport: viewport(), text,
    locator: kind === 'region' ? '' : locator(el), label: kind === 'region' ? 'Visual region' : kind === 'text' ? 'Selected text' : el?.tagName?.toLowerCase() || 'Page component', title: document.title });
  pointer = null; consumed = true; updateCursor(); schedule();
}
ipcRenderer.on('browser:annotate-mode', (_e, value) => {
  active = typeof value === 'object' ? !!value.active : !!value; showAnnotations = active;
  pointer = null; suppressClick = false; consumed = false; updateCursor(); schedule();
});
ipcRenderer.on('browser:annotation-capture', (_e, value) => {
  if (value?.documentId !== documentId || typeof value?.requestId !== 'string') return;
  captureId = value.requestId; updateCursor(); drawHighlights();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (captureId === value.requestId) {
      const item = tracked.get(value.selectionId);
      const selection = item ? geometry(item) : null;
      ipcRenderer.send('browser:annotation-capture-ready', { requestId: captureId, documentId, selection, viewport: viewport() });
    }
  }));
});
ipcRenderer.on('browser:annotation-capture-end', (_e, value) => {
  if (value?.requestId !== captureId) return;
  captureId = null; updateCursor(); schedule();
});
function selectedText(channel = 'browser:selection') {
  const selected = window.getSelection();
  if (!selected?.toString().trim() || !selected.rangeCount) return;
  const range = selected.getRangeAt(0).cloneRange(), node = range.commonAncestorContainer;
  if (channel === 'browser:selection') showAnnotations = true;
  select(node.nodeType === 1 ? node : node.parentElement, range, null, channel);
}
ipcRenderer.on('browser:selection-request', () => selectedText());
ipcRenderer.on('browser:annotation-track', (_e, value) => {
  for (const id of Array.isArray(value?.remove) ? value.remove.slice(0, 200) : []) tracked.delete(id);
  schedule();
});
window.addEventListener('pointerdown', (event) => {
  if (event.isTrusted) ipcRenderer.send('browser:focus');
  if (!active) return;
  pointer = { x: event.clientX, y: event.clientY, el: event.composedPath()[0] };
  suppressClick = true; consumed = false;
  event.stopImmediatePropagation();
  if (!textualPoint(event.clientX, event.clientY)) event.preventDefault();
}, true);
window.addEventListener('pointermove', (event) => {
  if (!active) return;
  event.stopImmediatePropagation();
  if (pointer) {
    const selected = window.getSelection();
    if (!selected?.toString().trim()) {
      layout({ rect: { x: Math.min(pointer.x, event.clientX), y: Math.min(pointer.y, event.clientY), width: Math.abs(pointer.x - event.clientX), height: Math.abs(pointer.y - event.clientY) } });
    }
  } else {
    const el = event.composedPath()[0];
    if (el?.getBoundingClientRect) layout({ rect: rectangle(el.getBoundingClientRect()) });
  }
}, true);
window.addEventListener('pointerup', (event) => {
  if (!active) return;
  event.stopImmediatePropagation();
  const start = pointer; pointer = null;
  if (!start) return;
  const dx = Math.abs(event.clientX - start.x), dy = Math.abs(event.clientY - start.y);
  const selected = window.getSelection();
  if ((dx >= 3 || dy >= 3) && selected?.toString().trim() && selected.rangeCount) {
    const range = selected.getRangeAt(0).cloneRange();
    const node = range.commonAncestorContainer;
    select(node.nodeType === 1 ? node : node.parentElement, range);
    return;
  }
  if (dx >= 3 && dy >= 3) {
    event.preventDefault();
    const rect = { x: Math.min(start.x, event.clientX), y: Math.min(start.y, event.clientY), width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) };
    if (rect.width >= 3 && rect.height >= 3) select(null, null, rect);
  }
}, true);
// Prevent page click/default navigation, including the click following pointerup.
window.addEventListener('click', (event) => {
  if (!active && !suppressClick) return;
  event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
  if (active && !consumed) select(event.composedPath()[0]);
  consumed = false;
}, true);
window.addEventListener('mousedown', (event) => { if (active) { event.stopImmediatePropagation(); if (!textualPoint(event.clientX, event.clientY)) event.preventDefault(); } }, true);
window.addEventListener('mouseup', (event) => {
  if (active || pointer || suppressClick) { event.stopImmediatePropagation(); return; }
  selectedText('browser:text-selection');
}, true);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && showAnnotations) { event.preventDefault(); event.stopImmediatePropagation(); active = false; showAnnotations = false; pointer = null; suppressClick = false; consumed = false; updateCursor(); schedule(); ipcRenderer.send('browser:annotation-end'); }
}, true);
window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
window.addEventListener('DOMContentLoaded', () => {
  helperStyle = document.createElement('style');
  document.documentElement.appendChild(helperStyle); updateCursor();
  const highlightHost = document.createElement('div');
  highlightHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  highlightHost.setAttribute('aria-hidden', 'true');
  // Only public selection rectangles live here. Closed shadow prevents accidental
  // inheritance/page selector interference; it is not used as a secrecy boundary.
  highlightRoot = highlightHost.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(highlightHost);
  new MutationObserver((changes) => {
    // Regions have no stable DOM anchor. Any page content mutation makes them snapshots.
    if (changes.some((change) => change.target !== helperStyle && !helperStyle.contains(change.target))) for (const item of tracked.values()) if (item.kind === 'region') item.stale = true;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
});
