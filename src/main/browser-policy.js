// Browser page data is untrusted. Keep this boundary independent of Electron.
function browserUrl(value) {
  let text = String(value || '').trim();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(text)) text = 'http://' + text;
  if (text === 'about:blank') return text;
  const url = new URL(text);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an http:// or https:// address.');
  return url.href;
}
const clean = (s, max) => String(s || '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, max);
function cleanSelection(value, url) {
  if (!value || typeof value !== 'object') throw new Error('No selection.');
  return { url: clean(url, 4096), text: clean(value.text, 16000), locator: clean(value.locator, 2000),
    label: clean(value.label, 200), note: clean(value.note, 4000), capturedAt: Date.now() };
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
module.exports = { browserUrl, cleanSelection, Access, clean };
