// The security boundary of the nami-doc:// scheme: a served path must resolve
// inside the folder its document was opened from, and nowhere else. These are
// the tests that make that a checked rule rather than a trusted one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDocUrl, parseDocUrl, resolveWithinRoot, isInside } = require('../src/main/doc-protocol.js');

// A stub realpath that behaves like the real one: it follows a symlinked path
// component wherever it appears, not only when the whole path matches. `links`
// maps a symlink path to its target; a target of null means "does not exist".
const realpath = (links = {}) => {
  const resolve = (p) => {
    // Longest symlink prefix first, so /root/link resolves before /root.
    const keys = Object.keys(links).sort((a, b) => b.length - a.length);
    for (const k of keys) {
      if (links[k] === null && p === k) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      if (p === k) return resolve(links[k]);
      if (p.startsWith(k + '/')) return resolve(links[k] + p.slice(k.length));
    }
    return p;
  };
  return { realpathSync: resolve };
};

// --- url round trip ----------------------------------------------------------

test('a built url parses back to the same root and file', () => {
  const url = buildDocUrl('/Users/x/reports', '/Users/x/reports/q3/chart.png');
  const parsed = parseDocUrl(url);
  assert.equal(parsed.root, '/Users/x/reports');
  assert.equal(parsed.rel, 'q3/chart.png');
});

test('a path with spaces and unicode survives the round trip', () => {
  const url = buildDocUrl('/Users/x/My Reports', '/Users/x/My Reports/café ☕.png');
  const parsed = parseDocUrl(url);
  assert.equal(parsed.root, '/Users/x/My Reports');
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
  assert.equal(resolveWithinRoot('/root', 'chart.png', io), '/root/chart.png');
});

test('a nested file inside the root resolves', () => {
  const io = realpath();
  assert.equal(resolveWithinRoot('/root', 'assets/img/logo.svg', io), '/root/assets/img/logo.svg');
});

test('.. climbing out of the root is refused', () => {
  const io = realpath();
  assert.equal(resolveWithinRoot('/root/docs', '../../etc/passwd', io), null);
});

test('an absolute rel pointing elsewhere is refused', () => {
  // path.resolve('/root', '/etc/passwd') === '/etc/passwd', which is outside.
  const io = realpath();
  assert.equal(resolveWithinRoot('/root', '/etc/passwd', io), null);
});

test('a symlink that points outside the root is refused', () => {
  // /root/escape is a symlink to /etc; following it must not serve /etc/passwd.
  const io = realpath({ '/root/escape': '/etc' });
  assert.equal(resolveWithinRoot('/root', 'escape/passwd', io), null);
});

test('a symlink that stays inside the root is allowed', () => {
  const io = realpath({ '/root/link': '/root/real' });
  assert.equal(resolveWithinRoot('/root', 'link/x.png', io), '/root/real/x.png');
});

test('a file that does not exist is refused rather than served', () => {
  const io = realpath({ '/root/missing.png': null });
  assert.equal(resolveWithinRoot('/root', 'missing.png', io), null);
});

// --- isInside, the containment primitive -------------------------------------

test('a sibling-named folder is not inside', () => {
  // the classic startsWith bug: /root-secret must not count as inside /root
  assert.equal(isInside('/root', '/root-secret/x'), false);
  assert.equal(isInside('/root', '/root/x'), true);
  assert.equal(isInside('/root', '/root'), true);
});
