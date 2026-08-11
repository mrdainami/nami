// Pure file-type + path helpers shared by the renderer and unit tests. No DOM, no Electron.

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac']);

function extOf(p) {
  const base = String(p || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

// 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'text' — text is the default; the
// editor's read decides at open time whether it's really editable (binary/huge →
// fallback card).
export function fileKind(p) {
  const e = extOf(p);
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (e === 'pdf') return 'pdf';
  // Rendered, not edited: the common case is a report or dashboard an agent just
  // built, and what you want on the desk is the page, not its source.
  if (e === 'html' || e === 'htm') return 'html';
  return 'text';
}

// POSIX single-quoting: safe to paste into a shell or a chat message.
export function shellQuote(p) { return "'" + String(p).replace(/'/g, "'\\''") + "'"; }

// Absolute POSIX path → file:// URL (renderer has no Node pathToFileURL).
export function fileUrl(absPath) {
  return 'file://' + String(absPath).split('/').map(encodeURIComponent).join('/');
}

// A viewed HTML file → its nami-doc:// URL, served from its own folder as root so
// its relative images resolve while the page stays cross-origin to Nami. Mirrors
// buildDocUrl in src/main/doc-protocol.js; kept here too because the renderer has
// no path module and this is the one place a POSIX dirname is enough.
export function docUrl(absPath) {
  const parts = String(absPath).split('/');
  const root = parts.slice(0, -1).join('/') || '/';
  const rel = parts[parts.length - 1];
  return 'nami-doc://doc/' + encodeURIComponent(root) + '/' + encodeURIComponent(rel);
}
