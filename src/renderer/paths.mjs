// Everything the renderer assumes about what a file path looks like, in one
// place.
//
// The renderer has no Node `path`, so for years each screen did its own string
// work: split('/') for a file name, startsWith('/') for "is it absolute",
// 'file://' + path for an image. Every one of those was correct on a Mac and
// every one was invisible — nothing named them as platform decisions, so on
// Windows the tree showed whole paths as names, no printed path was clickable,
// and no image loaded.
//
// Same bargain as src/main/platform.js: pure, and platform is always a
// parameter. It defaults to the platform the app is really on, which the
// preload hands over as `dainami.platform`; under plain node there is no such
// thing, the default is '' and every function takes its POSIX column. That is
// what lets one machine test both columns, and what keeps the POSIX tests
// honest when they run on a Windows box.
//
// The platform is never guessed from the shape of a path. A parser here does
// have to know that `\` and `/` both separate on Windows — but whether `\` is a
// separator at all is decided by the platform, because on a Mac it is an
// ordinary character in a file name.

const WIN = 'win32';

export function currentPlatform() {
  const g = globalThis;
  if (g.dainami && g.dainami.platform) return g.dainami.platform;
  const body = g.document && g.document.body;
  return (body && body.dataset && body.dataset.platform) || '';
}

export function isWin(platform = currentPlatform()) { return platform === WIN; }

// The separator to write. Windows reads both, so this is only about what a
// path we build looks like — and it should look like the ones main sends us.
export function sepOf(platform = currentPlatform()) { return platform === WIN ? '\\' : '/'; }

const isSepAt = (s, i, win) => s[i] === '/' || (win && s[i] === '\\');

// How much of the front of a path names the volume rather than a folder in it:
// '/' on POSIX; on Windows 'C:\', '\\server\share\', a lone leading separator
// (rooted on the current drive), or 'C:' with nothing after it (relative to
// that drive's own cwd, which is rare and is NOT absolute).
function rootLength(s, win) {
  if (!win) return s[0] === '/' ? 1 : 0;
  const unc = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]*/.exec(s);
  if (unc) return unc[0].length;
  const drive = /^[A-Za-z]:[\\/]*/.exec(s);
  if (drive) return drive[0].length;
  return isSepAt(s, 0, true) ? 1 : 0;
}

// That root, as written: '' for a relative path.
export function rootOf(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  return s.slice(0, rootLength(s, platform === WIN));
}

export function isAbsolute(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  if (platform !== WIN) return s[0] === '/';
  return /^[A-Za-z]:[\\/]/.test(s) || isSepAt(s, 0, true);
}

// Absolute in a way nobody writes by accident. Windows calls a lone leading
// `\` absolute too, but in a chat reply that is an escape or a regex, not a
// file — so where text is being read for paths, only a drive, a share, or the
// forward slash the Mac has always taken counts.
export function isPrintedAbsolute(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  if (s[0] === '/') return true;
  return platform === WIN && (/^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\/]/.test(s));
}

// `~/x`, and on Windows `~\x` too. A bare `~` counts; `~name` does not.
export function isHomeRelative(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  return s[0] === '~' && (s.length === 1 || isSepAt(s, 1, platform === WIN));
}

// Is there a separator anywhere in this text? The cheap question asked of a
// whole terminal row before anything dearer is.
export function hasSeparator(text, platform = currentPlatform()) {
  const s = String(text == null ? '' : text);
  return s.indexOf('/') !== -1 || (platform === WIN && s.indexOf('\\') !== -1);
}

function lastSep(s, win) {
  const a = s.lastIndexOf('/');
  return win ? Math.max(a, s.lastIndexOf('\\')) : a;
}

// The folders and the name, without the root and without empty pieces.
export function splitSegments(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  const win = platform === WIN;
  const rest = s.slice(rootLength(s, win));
  return (win ? rest.split(/[\\/]+/) : rest.split('/')).filter(Boolean);
}

// Every piece between separators, empty ones and the root's included — for
// the callers that put the pieces straight back together.
export function splitAll(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  return platform === WIN ? s.split(/[\\/]/) : s.split('/');
}

// Whatever follows the last separator. Sliced, not rebuilt, so a name comes
// back exactly as it was written.
export function baseName(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  return s.slice(lastSep(s, platform === WIN) + 1);
}

// The folder a path sits in. A file at the top of a volume answers with the
// root itself ('/', 'C:\'), a bare name answers '' — there is no folder in it
// to name — and a root is its own parent.
export function dirName(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  const win = platform === WIN;
  const root = rootLength(s, win);
  let i = lastSep(s, win);
  if (i < root) return s.slice(0, root);
  while (i > root && isSepAt(s, i - 1, win)) i--;
  return s.slice(0, i);
}

function trimTrailingSeps(s, win) {
  let end = s.length;
  const root = rootLength(s, win);
  while (end > root && isSepAt(s, end - 1, win)) end--;
  return s.slice(0, end);
}

// One path under another. Nothing is collapsed — `..` stays where it was put,
// see normalize — and an empty base leaves the rest alone, which is what the
// old `(cwd ? cwd + '/' : '') + rel` did.
export function join(base, rel, platform = currentPlatform()) {
  const win = platform === WIN;
  const b = String(base == null ? '' : base);
  let r = String(rel == null ? '' : rel);
  if (win) r = r.replace(/\//g, '\\');
  if (!b) return r;
  if (!r) return b;
  const head = trimTrailingSeps(b, win);
  const glue = isSepAt(head, head.length - 1, win) ? '' : sepOf(platform);
  return head + glue + r;
}

// `./x` → `x`, and `.\x` on Windows. Only the one leading dot: anything more
// is the path's own business.
export function stripDotSlash(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  return s[0] === '.' && isSepAt(s, 1, platform === WIN) ? s.slice(2) : s;
}

// True when any segment is `..`. The places that scavenge a base folder off
// the screen refuse such a token outright rather than resolve it.
export function climbs(p, platform = currentPlatform()) {
  return splitSegments(p, platform).includes('..');
}

// Collapse `.`, `..` and doubled separators. A relative path may keep leading
// `..`s; an absolute one cannot climb above its root.
export function normalize(p, platform = currentPlatform()) {
  const s = String(p == null ? '' : p);
  const win = platform === WIN;
  const rootLen = rootLength(s, win);
  const abs = rootLen > 0;
  const parts = [];
  for (const seg of splitSegments(s, platform)) {
    if (seg === '.') continue;
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!abs) parts.push('..');
      continue;
    }
    parts.push(seg);
  }
  if (!win) return (abs ? '/' : '') + parts.join('/');
  let root = s.slice(0, rootLen).replace(/\//g, '\\');
  if (/^\\\\/.test(root)) root = root.replace(/\\+$/, '') + (parts.length ? '\\' : '');
  else root = root.replace(/\\{2,}$/, '\\');
  return root + parts.join('\\');
}

// A session's token → the path to open: `~` is the home folder, an absolute
// path is itself, anything else hangs off the session's folder.
export function resolveFrom(token, cwd, home, platform = currentPlatform()) {
  const t = String(token == null ? '' : token);
  if (isHomeRelative(t, platform) && t.length > 1) return (home || '') + t.slice(1);
  if (isAbsolute(t, platform)) return t;
  return join(cwd || '', stripDotSlash(t, platform), platform);
}

// The form two paths are compared in: one separator, no trailing one, and on
// Windows one case, because C:\Proj and c:\proj are the same folder there.
function comparable(p, win) {
  const s = trimTrailingSeps(String(p == null ? '' : p), win);
  return win ? s.replace(/\\/g, '/').toLowerCase() : s;
}

// True when child is parent itself or lives beneath it. The boundary is the
// separator, never the prefix: /proj-evil starts with /proj as a string and is
// a different folder.
export function isInside(parent, child, platform = currentPlatform()) {
  if (!parent || !child) return false;
  const win = platform === WIN;
  const a = comparable(parent, win), c = comparable(child, win);
  if (c === a) return true;
  return c.startsWith(a.endsWith('/') ? a : a + '/');
}

// What is left of child below parent: '' for the folder itself, null when it
// is not inside at all. Separators come back as they were written.
export function relativeTo(parent, child, platform = currentPlatform()) {
  if (!isInside(parent, child, platform)) return null;
  const win = platform === WIN;
  const s = String(child);
  let i = trimTrailingSeps(String(parent), win).length;
  while (i < s.length && isSepAt(s, i, win)) i++;
  return s.slice(i);
}

// Absolute path → file:// URL; the renderer has no pathToFileURL. Each segment
// is encoded on its own so a `#` or a space in a name survives, but a drive's
// colon must not be — file:///C%3A/ is not a drive to Chromium. A UNC server
// becomes the URL's host, which is how Windows itself writes one.
export function toFileUrl(absPath, platform = currentPlatform()) {
  const s = String(absPath == null ? '' : absPath);
  if (platform !== WIN) return 'file://' + s.split('/').map(encodeURIComponent).join('/');
  const tail = splitSegments(s, platform).map(encodeURIComponent).join('/');
  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/.exec(s);
  if (unc) return 'file://' + encodeURIComponent(unc[1]) + '/' + encodeURIComponent(unc[2]) + (tail ? '/' + tail : '');
  const drive = /^[A-Za-z]:/.exec(s);
  return 'file:///' + (drive ? drive[0] + '/' : '') + tail;
}

// The same, for a folder that relative links will hang off: it has to end in
// exactly one slash or the last folder is read as a file name and dropped.
export function toDirUrl(absDir, platform = currentPlatform()) {
  const url = toFileUrl(absDir, platform);
  return url.endsWith('/') ? url : url + '/';
}

// file:// URL → the path in it, in the platform's own spelling. Not decoded:
// the callers differ on whether what they hold is encoded, and say so.
export function fromFileUrl(url, platform = currentPlatform()) {
  const m = /^file:\/\/([^/]*)(.*)$/i.exec(String(url == null ? '' : url));
  if (!m) return String(url == null ? '' : url);
  const host = /^localhost$/i.test(m[1]) ? '' : m[1];
  if (platform !== WIN) return m[2];
  if (host) return '\\\\' + host + m[2].replace(/\//g, '\\');
  return m[2].replace(/^\/+(?=[A-Za-z]:)/, '').replace(/\//g, '\\');
}

// A document's nami-doc:// address: the folder it is served from, encoded
// whole as the first segment, then the path within it. The twin of buildDocUrl
// in src/main/doc-protocol.js, which decodes the root with the real `path` —
// so on Windows the root stays a backslashed C:\ path inside its one segment
// and only the part after it is slash-separated.
export function docUrlFor(rootDir, relSegments) {
  return 'nami-doc://doc/' + encodeURIComponent(rootDir) + '/' + relSegments.join('/');
}

// Is this draft the start of a /command, or a path someone pasted? A command is
// one word; a second separator of either kind means a path, on any platform.
export function isSlashCommandDraft(text) {
  const v = String(text == null ? '' : text);
  return v[0] === '/' && !/[\s\\]/.test(v) && v.indexOf('/', 1) === -1;
}
