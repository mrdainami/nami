// Isolated selection helper: only geometry and public page metadata cross IPC.
// Comments, microphones, recipients and all annotation UI belong to Nami.
const { ipcRenderer } = require('electron');
const documentId = crypto.randomUUID();
const tracked = new Map();
let highlightRoot = null, helperStyle = null, captureId = null;
function updateCursor() {
  if (helperStyle) helperStyle.textContent = (active ? `html,body,body *{cursor:${mode === 'text' ? 'text' : 'crosshair'} !important}` : '') + (captureId ? '::selection{background:transparent!important;color:inherit!important}' : '');
}
let active = false, showAnnotations = false, mode = 'component', pointer = null, frame = 0, sequence = 0, suppressClick = false;
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
  const rects = [...tracked.values()].flatMap((item) => { const value = geometry(item); return value.stale ? [] : value.rects?.length ? value.rects : value.rect ? [value.rect] : []; });
  if (hover?.rect) rects.push(hover.rect);
  highlightRoot.replaceChildren(...rects.slice(0, 2000).map((r) => { const node = document.createElement('span'); node.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${Math.max(0, r.width)}px;height:${Math.max(0, r.height)}px;box-sizing:border-box;outline:1px solid Highlight;background:color-mix(in srgb, Highlight 12%, transparent);pointer-events:none`; return node; }));
}
function layout(hover) {
  drawHighlights(hover);
  ipcRenderer.send('browser:annotation-layout', { documentId, viewport: viewport(), selections: [...tracked.values()].map(geometry), ...(hover ? { hover } : {}) });
}
function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; layout(); }); }
function select(el, range, rect) {
  const kind = rect ? 'region' : range ? 'text' : 'component';
  const selectionId = documentId + ':' + (++sequence);
  const text = kind === 'text' ? range.toString().slice(0, 16000) : kind === 'region' ? '' : textOf(el);
  const item = { selectionId, kind, el, range, text, ...(rect ? { rect: { ...rect, x: rect.x + scrollX, y: rect.y + scrollY } } : {}) };
  tracked.set(selectionId, item);
  if (tracked.size > 200) tracked.delete(tracked.keys().next().value);
  ipcRenderer.send('browser:selection', { ...geometry(item), documentId, kind, viewport: viewport(), text,
    locator: kind === 'region' ? '' : locator(el), label: kind === 'region' ? 'Visual region' : kind === 'text' ? 'Selected text' : el?.tagName?.toLowerCase() || 'Page component', title: document.title });
  active = false; pointer = null; updateCursor(); schedule();
}
ipcRenderer.on('browser:annotate-mode', (_e, value) => {
  active = typeof value === 'object' ? !!value.active : !!value; showAnnotations = active;
  mode = ['component', 'text', 'region'].includes(value?.mode) ? value.mode : 'component'; pointer = null; suppressClick = false; updateCursor(); schedule();
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
ipcRenderer.on('browser:annotation-track', (_e, value) => {
  for (const id of Array.isArray(value?.remove) ? value.remove.slice(0, 200) : []) tracked.delete(id);
  schedule();
});
window.addEventListener('pointerdown', (event) => {
  if (event.isTrusted) ipcRenderer.send('browser:focus');
  if (!active) return;
  pointer = { x: event.clientX, y: event.clientY, el: event.composedPath()[0] };
  suppressClick = true;
  event.stopImmediatePropagation();
  // Text dragging needs Chromium's default selection, but never page handlers.
  if (mode !== 'text') event.preventDefault();
}, true);
window.addEventListener('pointermove', (event) => {
  if (!active) return;
  event.stopImmediatePropagation();
  if (mode === 'region' && pointer) {
    layout({ rect: { x: Math.min(pointer.x, event.clientX), y: Math.min(pointer.y, event.clientY), width: Math.abs(pointer.x - event.clientX), height: Math.abs(pointer.y - event.clientY) } });
  } else if (mode === 'component') {
    const el = event.composedPath()[0];
    if (el?.getBoundingClientRect) layout({ rect: rectangle(el.getBoundingClientRect()) });
  }
}, true);
window.addEventListener('pointerup', (event) => {
  if (!active) return;
  event.stopImmediatePropagation();
  if (mode === 'region' && pointer) {
    event.preventDefault();
    const rect = { x: Math.min(pointer.x, event.clientX), y: Math.min(pointer.y, event.clientY), width: Math.abs(pointer.x - event.clientX), height: Math.abs(pointer.y - event.clientY) };
    if (rect.width >= 3 && rect.height >= 3) select(null, null, rect);
  } else if (mode === 'text') {
    const selected = window.getSelection();
    if (selected?.toString().trim() && selected.rangeCount) {
      const range = selected.getRangeAt(0).cloneRange();
      const node = range.commonAncestorContainer;
      select(node.nodeType === 1 ? node : node.parentElement, range);
    }
  }
}, true);
// Prevent page click/default navigation, including the click following pointerup.
window.addEventListener('click', (event) => {
  if (!active && !suppressClick) return;
  event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
  if (active && mode === 'component') select(event.composedPath()[0]);
}, true);
window.addEventListener('mousedown', (event) => { if (active) { event.stopImmediatePropagation(); if (mode !== 'text') event.preventDefault(); } }, true);
window.addEventListener('mouseup', (event) => {
  if (active || pointer || suppressClick) { event.stopImmediatePropagation(); return; }
  const selected = window.getSelection();
  if (selected?.toString().trim()) ipcRenderer.send('browser:text-selection', { text: selected.toString().slice(0, 16000), label: 'Selected text', documentId, viewport: viewport(), rect: selected.rangeCount ? rectangle(selected.getRangeAt(0).getBoundingClientRect()) : null });
}, true);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && showAnnotations) { event.preventDefault(); event.stopImmediatePropagation(); active = false; showAnnotations = false; pointer = null; suppressClick = false; updateCursor(); schedule(); ipcRenderer.send('browser:annotation-end'); }
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
