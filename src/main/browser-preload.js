// Runs in the isolated world of browser pages. No Nami API is exposed to them.
const { ipcRenderer } = require('electron');
window.addEventListener('pointerdown', (event) => { if (event.isTrusted) ipcRenderer.send('browser:focus'); }, true);
let active = false, hovered = null, oldOutline = '';
function clear() { if (hovered) hovered.style.outline = oldOutline; hovered = null; }
function locator(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = [];
  for (let node = el; node && node.nodeType === 1 && parts.length < 6; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const siblings = node.parentElement ? [...node.parentElement.children].filter((e) => e.tagName === node.tagName) : [];
    parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
  }
  return parts.join(' > ');
}
ipcRenderer.on('browser:annotate-mode', (_e, value) => { active = !!value; clear(); });
window.addEventListener('mousemove', (event) => {
  if (!active || event.target === hovered) return;
  clear(); hovered = event.target;
  if (hovered?.style) { oldOutline = hovered.style.outline; hovered.style.outline = '2px solid #ef6461'; }
}, true);
window.addEventListener('click', (event) => {
  if (!active) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const el = event.target;
  const rect = el.getBoundingClientRect();
  ipcRenderer.send('browser:selection', { text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').slice(0, 16000),
    locator: locator(el), label: el.tagName.toLowerCase(), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  active = false; clear();
}, true);
window.addEventListener('mouseup', () => {
  if (active) return;
  const selection = window.getSelection();
  if (selection?.toString().trim()) ipcRenderer.send('browser:text-selection', { text: selection.toString().slice(0, 16000), label: 'Selected text' });
}, true);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && active) { active = false; clear(); ipcRenderer.send('browser:annotation-end'); }
}, true);
