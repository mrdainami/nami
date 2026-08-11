// The path rules for the nami-doc:// scheme, kept pure so they can be tested
// without launching Electron — because the rule that matters here is a security
// boundary, and a security boundary you cannot test in isolation is one you are
// trusting rather than checking.
//
// A viewed HTML page is served from its own origin so its relative images load
// and it still cannot reach Nami (see main.js and the design note). This file
// answers one question for the handler: given a request URL, what real file on
// disk does it mean, and is that file inside the folder the document was opened
// from? Anything that resolves outside the root — via .., an absolute path, or a
// symlink pointing away — is refused, so a hostile page cannot walk the disk.

const path = require('path');
const fs = require('fs');

// A nami-doc URL is  nami-doc://doc/<root>/<rel>  where both parts are
// percent-encoded absolute-ish path pieces. Host is always "doc"; the first
// path segment is the encoded root directory, the rest is the resource within
// it. Keeping the root in the URL means one handler serves every open document
// without any shared mutable state.
function buildDocUrl(root, target) {
  const rel = path.relative(root, target);
  return 'nami-doc://doc/' + encodeURIComponent(root) + '/' + rel.split(path.sep).map(encodeURIComponent).join('/');
}

// Parse a request URL back to { root, filePath } or null if it is malformed.
// Does not touch the disk; resolveWithinRoot does that.
function parseDocUrl(urlString) {
  let u;
  try { u = new URL(urlString); } catch (_) { return null; }
  if (u.protocol !== 'nami-doc:' || u.host !== 'doc') return null;
  // pathname is  /<encodedRoot>/<rel...>
  const parts = u.pathname.replace(/^\/+/, '').split('/');
  if (parts.length < 1 || !parts[0]) return null;
  let root;
  try { root = decodeURIComponent(parts[0]); } catch (_) { return null; }
  let rel;
  try { rel = parts.slice(1).map(decodeURIComponent).join('/'); } catch (_) { return null; }
  if (!path.isAbsolute(root)) return null;
  return { root, rel };
}

// The gate. Returns the real file path only when it sits inside root after every
// .. is collapsed and every symlink is followed; null otherwise. `realpath` is
// injected so the symlink test can be exercised deterministically.
function resolveWithinRoot(root, rel, io = fs) {
  // A rel that is itself absolute (or uses .. to climb) must not win. Joining
  // then re-checking containment catches both.
  const joined = path.resolve(root, rel);
  const rootReal = safeReal(root, io);
  if (!rootReal) return null;

  // The file may not exist yet is not our concern — a document only references
  // files that do. Resolve the real path of whatever exists along the chain: if
  // the target exists, realpath it; if not, it cannot be served anyway.
  const targetReal = safeReal(joined, io);
  if (!targetReal) return null;

  if (!isInside(rootReal, targetReal)) return null;
  return targetReal;
}

function safeReal(p, io) {
  try { return io.realpathSync(p); } catch (_) { return null; }
}

// True when child is root itself or lives beneath it. Compared on path segments
// so /foo/bar is inside /foo but /foo-secret is not (a plain startsWith would
// wrongly accept the second).
function isInside(root, child) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

module.exports = { buildDocUrl, parseDocUrl, resolveWithinRoot, isInside };
