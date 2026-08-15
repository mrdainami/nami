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

// The end of a path, for a label with one line to spend. A destination answers
// one question — which folder is this landing in — and the last couple of
// segments answer it; the head is a prefix you already chose and can't read at
// 11px anyway. Truncated here rather than with `direction: rtl`, which renders
// correctly right up until a path contains a bracket and then silently reorders
// it. Anything already short enough is returned untouched: an ellipsis that
// hides nothing is just decoration.
export function tailPath(p, keep = 2) {
  const s = String(p || '');
  if (!s || s === '/') return s;
  const parts = s.replace(/\/+$/, '').split('/');
  const lead = parts[0];                       // '' for /abs, '~' for home
  const segs = parts.slice(1).filter(Boolean);
  if (segs.length <= keep) return lead + '/' + segs.join('/');
  return '…/' + segs.slice(-keep).join('/');
}

// POSIX single-quoting: safe to paste into a shell or a chat message.
export function shellQuote(p) { return "'" + String(p).replace(/'/g, "'\\''") + "'"; }

// The text a dragged path types into a session, trailing space included so no
// caller has to remember it.
//
// Inside the open folder it is an `@` mention — every launch reads that as "go
// open this", it costs nothing for a huge file, and it works for a folder. Only
// the part below the root has to be clean, so a project living in "My Project"
// still mentions fine; that is the case the absolute form handles worse.
//
// Everything else quotes the absolute path, which is what a Finder drop already
// produces.
//
// MENTION_SAFE is an allowlist, not a denylist, because the two ways of being
// wrong do not cost the same. Wrongly calling a name unsafe costs a mention:
// you get the quoted absolute path, which works everywhere and always has.
// Wrongly calling one safe puts `$(...)`, a backtick or a `;` unquoted at a
// live shell prompt — injectToSession ends at api.termWrite for a terminal
// session, which is a pty. dropFilesOnPanel has quoted unconditionally since it
// was written; the mention branch must not be the hole beside it.
//
// Unicode letters and digits are in the set deliberately: a project full of
// Japanese filenames should still mention, and no shell treats them specially.
// What is left out is every POSIX metacharacter, quote, bracket, and space —
// plus `~`, which expands, and `\`, because this is POSIX-only for the same
// reason fileUrl and docUrl are.
//
// The root boundary is the separator, never the prefix: '/Users/cal/nami-other'
// starts with '/Users/cal/nami' as a string and is a different folder.
const MENTION_SAFE = /^[\p{L}\p{N}._\-/+@]+$/u;
export function pathRef(path, root, isDir) {
  const abs = String(path || '');
  const base = String(root || '').replace(/\/+$/, '');
  const inside = base && abs.indexOf(base + '/') === 0;
  const rel = inside ? abs.slice(base.length + 1) : '';
  if (!rel || !MENTION_SAFE.test(rel)) return shellQuote(abs) + ' ';
  return '@' + rel + (isDir ? '/' : '') + ' ';
}

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
