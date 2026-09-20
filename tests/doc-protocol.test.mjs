// The security boundary of the nami-doc:// scheme: a served path must resolve
// inside the folder its document was opened from, and nowhere else. These are
// the tests that make that a checked rule rather than a trusted one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDocUrl, parseDocUrl, resolveWithinRoot, isInside } = require('../src/main/doc-protocol.js');
const path = require('path');

// Every path here is made with path.resolve, because that is what the gate does
// to them. On a Mac '/root' is already the answer; on Windows it is C:\root, and
// a symlink stub keyed by a literal '/root/escape' never matches what the gate
// asks it — the escape is then served and the test proves nothing. abs() is an
// absolute path anywhere on the disk, under() one inside the opened folder.
const abs = (p) => path.resolve(p);
const ROOT = abs('/root');
const under = (rel) => path.join(ROOT, rel);

// A stub realpath that behaves like the real one: it follows a symlinked path
// component wherever it appears, not only when the whole path matches. `links`
// maps a symlink path to its target; a target of null means "does not exist".
const realpath = (links = {}) => {
  const resolve = (p) => {
    // Longest symlink prefix first, so /root/link resolves before /root. The
    // separator is the platform's: the gate hands this native paths.
    const keys = Object.keys(links).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (links[k] === null && p === k) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      if (p === k) return resolve(links[k]);
      if (p.startsWith(k + path.sep)) return resolve(links[k] + p.slice(k.length));
    }
    return p;
  };
  return { realpathSync: resolve };
};

// --- url round trip ----------------------------------------------------------

test('a built url parses back to the same root and file', () => {
  const root = abs('/Users/x/reports');
  const url = buildDocUrl(root, path.join(root, 'q3', 'chart.png'));
  const parsed = parseDocUrl(url);
  assert.equal(parsed.root, root);
  assert.equal(parsed.rel, 'q3/chart.png');   // url-shaped on every OS
});

test('a path with spaces and unicode survives the round trip', () => {
  const root = abs('/Users/x/My Reports');
  const url = buildDocUrl(root, path.join(root, 'café ☕.png'));
  const parsed = parseDocUrl(url);
  assert.equal(parsed.root, root);
  assert.equal(parsed.rel, 'café ☕.png');
});

test('a non-nami-doc url is rejected', () => {
  assert.equal(parseDocUrl('file:///etc/passwd'), null);
  assert.equal(parseDocUrl('http://evil.test/x'), null);
  assert.equal(parseDocUrl('nami-doc://other/foo'), null); // wrong host
});

// --- the gate ----------------------------------------------------------------

test('a sibling file inside the root resolves', () => {
  const io = realpath();
  assert.equal(resolveWithinRoot(ROOT, 'chart.png', io), under('chart.png'));
});

test('a nested file inside the root resolves', () => {
  const io = realpath();
  assert.equal(resolveWithinRoot(ROOT, 'assets/img/logo.svg', io), under('assets/img/logo.svg'));
});

test('.. climbing out of the root is refused', () => {
  const io = realpath();
  assert.equal(resolveWithinRoot(under('docs'), '../../etc/passwd', io), null);
  // And spelled with the platform's own separator, which on Windows is the
  // backslash a url can smuggle in as %5C.
  assert.equal(resolveWithinRoot(under('docs'), ['..', '..', 'etc', 'passwd'].join(path.sep), io), null);
});

test('an absolute rel pointing elsewhere is refused', () => {
  // path.resolve(ROOT, '/etc/passwd') drops ROOT entirely, which is outside.
  const io = realpath();
  assert.equal(resolveWithinRoot(ROOT, '/etc/passwd', io), null);
  // The same file in the platform's full form — C:\etc\passwd on Windows.
  assert.equal(resolveWithinRoot(ROOT, abs('/etc/passwd'), io), null);
});

test('a symlink that points outside the root is refused', () => {
  // /root/escape is a symlink to /etc; following it must not serve /etc/passwd.
  const io = realpath({ [under('escape')]: abs('/etc') });
  assert.equal(resolveWithinRoot(ROOT, 'escape/passwd', io), null);
});

test('a symlink that stays inside the root is allowed', () => {
  const io = realpath({ [under('link')]: under('real') });
  assert.equal(resolveWithinRoot(ROOT, 'link/x.png', io), under('real/x.png'));
});

test('a file that does not exist is refused rather than served', () => {
  const io = realpath({ [under('missing.png')]: null });
  assert.equal(resolveWithinRoot(ROOT, 'missing.png', io), null);
});

// --- isInside, the containment primitive -------------------------------------

test('a sibling-named folder is not inside', () => {
  // the classic startsWith bug: /root-secret must not count as inside /root
  assert.equal(isInside(ROOT, abs('/root-secret/x')), false);
  assert.equal(isInside(ROOT, under('x')), true);
  assert.equal(isInside(ROOT, ROOT), true);
});

test('the same path on another drive is not inside',
  { skip: process.platform !== 'win32' && 'drive letters are a Windows idea; a Mac has one tree' }, () => {
  // path.relative cannot express a hop between drives, so it hands back the
  // child whole and absolute — the case isInside's isAbsolute check exists for.
  const elsewhere = (ROOT[0].toUpperCase() === 'Z' ? 'Y' : 'Z') + ROOT.slice(1);
  assert.equal(isInside(ROOT, path.join(elsewhere, 'x')), false);
  assert.equal(resolveWithinRoot(ROOT, path.join(elsewhere, 'x'), realpath()), null);
});
