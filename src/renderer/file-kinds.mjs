// Pure file-type + path helpers shared by the renderer and unit tests. No DOM, no Electron.
// What a path LOOKS like — its separator, its root — is paths.mjs's business;
// everything here asks it, and takes the platform last the way it does.

import { currentPlatform, isWin, sepOf, rootOf, splitSegments, relativeTo, baseName, dirName, toFileUrl, docUrlFor } from './paths.mjs';

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
export function tailPath(p, keep = 2, platform = currentPlatform()) {
  const s = String(p || '');
  if (!s || s === '/') return s;
  const sep = sepOf(platform);
  const root = rootOf(s, platform);
  const parts = splitSegments(s, platform);
  // '' for /abs, 'C:' for a drive, '~' for home. A path with no root spends
  // its first piece as the lead, which is how `~/work` always read.
  const lead = root ? root.replace(/[\\/]+$/, '') : (parts[0] || '');
  const segs = root ? parts : parts.slice(1);
  if (segs.length <= keep) return lead + sep + segs.join(sep);
  return '…' + sep + segs.slice(-keep).join(sep);
}

// Single-quoting: safe to paste into a shell or a chat message. POSIX closes
// the quote to escape one; PowerShell, which is what a pane runs on Windows,
// doubles it instead — the same two rules as shellQuote in claude-args.js.
export function shellQuote(p, platform = currentPlatform()) {
  if (isWin(platform)) return "'" + String(p).replace(/'/g, "''") + "'";
  return "'" + String(p).replace(/'/g, "'\\''") + "'";
}

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
// plus `~`, which expands, and `\`, which escapes. On Windows the part below
// the root is written with forward slashes before it is judged: every agent
// reads `@src/app.js` there, and a backslash at a prompt is never just a
// character. Off Windows a backslash is part of a name, and such a name quotes.
//
// The root boundary is the separator, never the prefix: '/Users/cal/nami-other'
// starts with '/Users/cal/nami' as a string and is a different folder. On
// Windows the same folder spelled in another case is still the same folder.
const MENTION_SAFE = /^[\p{L}\p{N}._\-/+@]+$/u;
export function pathRef(path, root, isDir, platform = currentPlatform()) {
  const abs = String(path || '');
  // A project opened at the top of a volume ('/', 'C:\\') has no folder to be
  // below: pinned as "quote everything" long before Windows, and kept.
  const base = splitSegments(root, platform).length ? String(root) : '';
  const below = relativeTo(base, abs, platform) || '';
  const rel = isWin(platform) ? below.replace(/\\/g, '/') : below;
  if (!rel || !MENTION_SAFE.test(rel)) return shellQuote(abs, platform) + ' ';
  return '@' + rel + (isDir ? '/' : '') + ' ';
}

// Absolute path → file:// URL (renderer has no Node pathToFileURL).
export function fileUrl(absPath, platform = currentPlatform()) {
  return toFileUrl(absPath, platform);
}

// A viewed HTML file → its nami-doc:// URL, served from its own folder as root so
// its relative images resolve while the page stays cross-origin to Nami. Mirrors
// buildDocUrl in src/main/doc-protocol.js, which is the side that has a real
// `path`: the root it decodes must be absolute by that module's lights, so on
// Windows it goes over as the backslashed C:\ folder it is.
export function docUrl(absPath, platform = currentPlatform()) {
  const root = dirName(absPath, platform) || sepOf(platform);
  return docUrlFor(root, [encodeURIComponent(baseName(absPath, platform))]);
}
