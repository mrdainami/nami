// Where might a short path live, when not in the card's own folder?
//
// A CLI that swept /some/long/folder answers with paths relative to it —
// codex prints `workshop-banner/scene.png` after being pointed at a
// scratchpad three lines earlier. The card's cwd is the wrong base, so the
// stat misses and the link is dead, even though the right base is sitting in
// the scrollback in plain sight: in the user's own prompt, or in the CLI's
// earlier output.
//
// So: harvest the absolute folders recently visible in the card, and let the
// caller try a missed relative token against each. The disk arbitrates, the
// same bargain the loose reglue makes — a base is only believed if the
// joined path actually exists, so a wrong guess costs a stat and changes
// nothing. Every absolute token contributes itself AND its parent, because
// prose names the folder about as often as it names a file in it.
//
// Pure string work, same reason as term-links.mjs: testable without a
// terminal, and the caller owns all the buffer walking and stat calls.

import { scanLinks } from './term-links.mjs';

// Absolute folder candidates from one glued run of terminal text, order
// preserved, deduped, capped. Relative tokens and URLs contribute nothing.
export function basesFromText(text, cap = 6) {
  const out = [];
  const seen = new Set();
  const add = (b) => { if (b && b !== '/' && !seen.has(b) && out.length < cap) { seen.add(b); out.push(b); } };
  for (const link of scanLinks(text)) {
    if (link.kind !== 'path' || link.text[0] !== '/') continue;
    add(link.text);
    add(link.text.slice(0, link.text.lastIndexOf('/')) || null);
    if (out.length >= cap) break;
  }
  return out;
}

// A short token under a base, or null when the token is not the kind of
// path a base applies to. `..` is refused outright: a scavenged base plus a
// climbing token could name anything on the disk, and nothing on screen
// vouches for it.
export function joinBase(base, token) {
  let t = String(token || '');
  if (!t || t[0] === '/' || t[0] === '~') return null;
  if (t.startsWith('./')) t = t.slice(2);
  if (t === '..' || t.startsWith('../') || t.includes('/../') || t.endsWith('/..')) return null;
  if (!t) return null;
  return base.replace(/\/$/, '') + '/' + t;
}
