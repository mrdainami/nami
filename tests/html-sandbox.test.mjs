// The rule that keeps an agent-written HTML page from reaching into Nami.
//
// A source assertion, from a real mistake caught by hand. The page runs in an
// iframe; whether it can read Nami depends on the pairing of its origin and its
// sandbox flags:
//
//   file:// or srcdoc + allow-same-origin  → SAME origin as Nami → can read it.
//     This is the hole. file:// URLs are one origin in Chromium, and a srcdoc
//     inherits its embedder's. A page granted it read parent.document out of
//     the app. Forbidden.
//
//   nami-doc:// + allow-same-origin        → the page's OWN origin, cross-origin
//     to Nami → cannot read it, and its relative images load. This is the safe
//     way to get fidelity, and the only place allow-same-origin is allowed.
//
// So the check is not "never allow-same-origin" — it is "allow-same-origin only
// on a nami-doc source". Plus the served policy must forbid the network, or a
// page could send out whatever it read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.resolve(dir, '../src/renderer/app.js'), 'utf8');
const main = fs.readFileSync(path.resolve(dir, '../src/main/main.js'), 'utf8');

// Each html iframe as a { sandbox, source } pair, however it is written —
// setAttribute + a following src/srcdoc assignment, or an inline attribute.
function iframeSandboxes(src) {
  const out = [];
  // setAttribute('sandbox', '...') then a nearby src=/srcdoc=
  const re = /setAttribute\(\s*['"]sandbox['"]\s*,\s*['"]([a-z\- ]*?)['"]\s*\)([\s\S]{0,240}?)(?:\.src\s*=\s*(\w+)|\.srcdoc\s*=)/g;
  let m;
  while ((m = re.exec(src))) {
    const sandbox = m[1].trim();
    const source = m[3] === 'docUrl' || /docUrl\(/.test(m[2]) ? 'nami-doc'
      : m[3] ? 'file' : 'srcdoc';
    out.push({ sandbox, source });
  }
  // inline sandbox="..." with docUrl(...) in the same template literal
  const re2 = /sandbox=["']([a-z\- ]*?)["'][\s\S]{0,80}?src=["']?\$\{[^}]*?(docUrl|fileUrl)\(/g;
  while ((m = re2.exec(src))) {
    out.push({ sandbox: m[1].trim(), source: m[2] === 'docUrl' ? 'nami-doc' : 'file' });
  }
  return out;
}

const frames = iframeSandboxes(app);

test('the html iframes are found (both edit-preview and viewer paths)', () => {
  assert.ok(frames.length >= 3, `expected at least 3 html iframes, found ${frames.length}`);
});

test('allow-same-origin appears only on a nami-doc source', () => {
  for (const f of frames) {
    if (f.sandbox.split(/\s+/).includes('allow-same-origin')) {
      assert.equal(f.source, 'nami-doc',
        `allow-same-origin on a ${f.source} iframe would let it read Nami`);
    }
  }
});

test('a srcdoc or file iframe is opaque (allow-scripts only)', () => {
  for (const f of frames) {
    if (f.source !== 'nami-doc') {
      assert.equal(f.sandbox, 'allow-scripts',
        `a ${f.source} iframe must be opaque, has "${f.sandbox}"`);
    }
  }
});

// --- the served policy -------------------------------------------------------

test('the doc protocol forbids the network so a page cannot exfiltrate', () => {
  assert.match(main, /connect-src 'none'/,
    "the served CSP must include connect-src 'none'");
});

test('the doc scheme is registered standard and secure (gives its own origin)', () => {
  assert.match(main, /scheme:\s*['"]nami-doc['"]/);
  assert.match(main, /standard:\s*true/);
  assert.match(main, /secure:\s*true/);
});
