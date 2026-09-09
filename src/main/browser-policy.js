// Browser page data is untrusted. Keep this boundary independent of Electron.
function browserUrl(value) {
  let text = String(value || '').trim();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(text)) text = 'http://' + text;
  if (text === 'about:blank') return text;
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an http:// or https:// address.');
  return url.href;
}
// Only human address-bar input is normalized. Agent navigation stays strict.
function userBrowserUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^(\/|~\/|[a-z]:\\)/i.test(text)) throw new Error('Open local HTML through the workspace file browser.');
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(text)) return browserUrl('http://' + text);
  if (!/\s/.test(text) && /^(?:[a-z0-9\u0080-\uffff](?:[a-z0-9\u0080-\uffff-]*[a-z0-9\u0080-\uffff])?\.)+[a-z\u0080-\uffff]{2,}(?::\d+)?(?:[/?#]|$)/i.test(text)) return browserUrl('https://' + text);
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return browserUrl(text);
  return 'https://www.google.com/search?q=' + encodeURIComponent(text);
}
const clean = (s, max) => String(s || '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, max);
function cleanSelection(value, url) {
  if (!value || typeof value !== 'object') throw new Error('No selection.');
  return { url: clean(url, 4096), text: clean(value.text, 16000), locator: clean(value.locator, 2000),
    label: clean(value.label, 200), note: clean(value.note, 4000), capturedAt: Date.now(),
    selectionId: clean(value.selectionId, 100), documentId: clean(value.documentId, 100),
    kind: ['component', 'text', 'region'].includes(value.kind) ? value.kind : 'text',
    rect: cleanRect(value.rect), rects: Array.isArray(value.rects) ? value.rects.slice(0, 100).map(cleanRect).filter(Boolean) : [],
    viewport: cleanViewport(value.viewport) };
}
function cleanRect(value) {
  if (!value || !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(value[k]) && Math.abs(value[k]) <= 1000000)) return null;
  if (value.width < 0 || value.height < 0) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}
function cleanViewport(value) {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height)) return null;
  return { width: Math.max(0, Math.min(value.width, 100000)), height: Math.max(0, Math.min(value.height, 100000)) };
}
function cleanAnnotationLayout(value) {
  if (!value || typeof value !== 'object') return null;
  return { documentId: clean(value.documentId, 100), viewport: cleanViewport(value.viewport),
    hover: value.hover ? { rect: cleanRect(value.hover.rect) } : null,
    selections: Array.isArray(value.selections) ? value.selections.slice(0, 200).filter((s) => s && typeof s === 'object').map((s) => ({ selectionId: clean(s.selectionId, 100), stale: !!s.stale, rect: cleanRect(s.rect), rects: Array.isArray(s.rects) ? s.rects.slice(0, 100).map(cleanRect).filter(Boolean) : [] })) : [] };
}
class Access {
  constructor() { this.sessions = new Map(); }
  register(id, windowId, title = '') {
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid session.');
    const old = this.sessions.get(id);
    if (old && old.windowId !== windowId) throw new Error('Session belongs to another window.');
    if (old) old.title = clean(title, 200);
    else this.sessions.set(id, { windowId, title: clean(title, 200), views: new Set(), inbox: [] });
  }
  get(id, windowId) {
    const s = this.sessions.get(id);
    if (!s || (windowId !== undefined && s.windowId !== windowId)) throw new Error('Session is no longer available.');
    return s;
  }
  grant(id, windowId, views) { this.get(id, windowId).views = new Set(views); }
  allows(id, view) { return !!this.sessions.get(id)?.views.has(view); }
  removeWindow(id) { for (const [key, s] of this.sessions) if (s.windowId === id) this.sessions.delete(key); }
}
module.exports = { cleanAnnotationLayout, userBrowserUrl, browserUrl, cleanSelection, Access, clean };
