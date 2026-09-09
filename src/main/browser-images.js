// Annotation images are private captures, addressed by opaque IDs. An MCP
// request can never choose a filesystem path or read an ungranted image.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { storePng } = require('./pasted-images');
class AnnotationImageStore {
  constructor(directory) {
    this.directory = directory; this.images = new Map();
    this.retained = new Set(fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.png$/.test(name)).map(name => path.join(directory, name)) : []);
  }
  add(windowId, image, meta = {}) {
    if (this.images.size >= 400) throw new Error('Too many annotation images. Remove old notes first.');
    const bytes = image.toPNG(), file = storePng(this.directory, bytes), id = randomUUID();
    const size = image.getSize();
    const entry = { id, windowId, path: file, mimeType: 'image/png', width: size.width, height: size.height, ...meta, recipients: new Set() };
    this.images.set(id, entry);
    return { id, path: file, mimeType: entry.mimeType, width: entry.width, height: entry.height,
      thumbnail: image.resize({ width: Math.min(240, size.width) }).toDataURL(), dataUrl: image.toDataURL() };
  }
  get(id, windowId) { const e = this.images.get(id); if (!e || (windowId !== undefined && e.windowId !== windowId)) throw new Error('Annotation image is unavailable.'); return e; }
  grant(id, windowId, recipients) { const e = this.get(id, windowId); for (const recipient of recipients) e.recipients.add(recipient); if (recipients.length) { e.inserted = true; this.retained.add(e.path); } }
  read(id, recipient) {
    const e = this.get(id);
    if (!e.recipients.has(recipient)) throw new Error('This annotation image is not shared with the session.');
    return { content: [{ type: 'text', text: JSON.stringify({ id, tabId: e.tabId, url: e.url, capturedAt: e.capturedAt }) },
      { type: 'image', mimeType: 'image/png', data: fs.readFileSync(e.path).toString('base64') }] };
  }
  discard(id, windowId) {
    const e = this.get(id, windowId);
    if (e.recipients.size) return; // Already-inserted references remain readable until their sessions close.
    this.images.delete(id);
    if (!this.retained.has(e.path) && ![...this.images.values()].some(x => x.path === e.path)) fs.rmSync(e.path, { force: true });
  }
  // An inserted file reference may live in a saved agent conversation. Revoke
  // its tool grant on close, but retain the PNG like other pasted attachments.
  removeRecipient(id) { for (const e of [...this.images.values()]) { e.recipients.delete(id); if (!e.recipients.size && e.inserted) this.images.delete(e.id); } }
  removeWindow(windowId) { for (const e of [...this.images.values()]) if (e.windowId === windowId) { e.recipients.clear(); if (e.inserted) this.images.delete(e.id); else this.discard(e.id, windowId); } }
}
// Selection rectangles arrive in page CSS coordinates. Electron capturePage
// uses view DIP coordinates; page zoom is already reflected by viewport size.
function captureRect(rect, viewport, bounds) {
  if (!rect || !viewport || ![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0 || rect.width <= 0 || rect.height <= 0) throw new Error('Select a visible area to capture.');
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width), bottom = Math.min(viewport.height, rect.y + rect.height);
  if (right <= x || bottom <= y) throw new Error('The selected area is outside the visible page. Select it again.');
  const scaleX = bounds.width / viewport.width, scaleY = bounds.height / viewport.height;
  const left = Math.floor(x * scaleX), top = Math.floor(y * scaleY);
  return { x: left, y: top, width: Math.min(bounds.width, Math.ceil(right * scaleX)) - left, height: Math.min(bounds.height, Math.ceil(bottom * scaleY)) - top };
}
module.exports = { AnnotationImageStore, captureRect };
