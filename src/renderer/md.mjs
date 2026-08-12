// Nami — a small markdown renderer and a matching highlighter.
//
// Two exits from the same tokeniser:
//   renderMarkdown(text)    → real HTML for the editor's Read tab
//   highlightMarkdown(text) → the same text with its markers intact, wrapped in
//                             spans, so it can sit behind a transparent
//                             textarea and colour what you type.
//
// No dependency and no HTML passthrough: everything is escaped first, so a file
// containing <script> renders as the literal characters.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// One pass, alternation ordered by precedence — code spans match first, so
// `**not bold**` inside backticks stays literal. Underscore emphasis is
// deliberately absent: snake_case identifiers are far more common than _em_.
// The bare-URL branch comes last so `[text](url)` and code spans win first, and
// it stops before the punctuation that ends a sentence around a link.
const INLINE = /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\bhttps?:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,;:!?])/g;

// Emphasis recurses into its own content — `**[title](url)**` is a bold LINK,
// not bold text that happens to contain brackets. A one-pass tokeniser gave
// the whole span to the strong rule and the link inside rendered literal
// (unclickable, found in a real Notion reply). Each level takes a fresh
// regex: recursing through the same global RegExp object would clobber the
// outer replace's lastIndex.
function inlineEsc(s) {
  return s.replace(new RegExp(INLINE.source, 'g'), (m, code, link, strong, del, em, bare) => {
    if (code) return `<code>${code.slice(1, -1)}</code>`;
    if (link) {
      const cut = link.lastIndexOf('](');
      return `<a href="${link.slice(cut + 2, -1)}">${inlineEsc(link.slice(1, cut))}</a>`;
    }
    if (strong) return `<strong>${inlineEsc(strong.slice(2, -2))}</strong>`;
    if (del) return `<del>${inlineEsc(del.slice(2, -2))}</del>`;
    if (em) return `<em>${inlineEsc(em.slice(1, -1))}</em>`;
    return `<a href="${bare}">${bare}</a>`;
  });
}

function inline(raw) { return inlineEsc(esc(raw)); }

// ---- where a link in the Read view points -----------------------------------
// Pure: hand it an href and the path of the doc it came from, get back what the
// click should do. The app never navigates on an href it did not classify, so
// an unknown scheme is a no-op rather than a trip to the shell.
function normalizePath(p) {
  const abs = p.startsWith('/');
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!abs) parts.push('..');
      continue;
    }
    parts.push(seg);
  }
  return (abs ? '/' : '') + parts.join('/');
}

export function docHrefTarget(href, docPath) {
  let h = String(href == null ? '' : href).trim();
  if (!h) return { kind: 'ignore' };
  if (h.startsWith('#')) return { kind: 'anchor', target: h.slice(1) };
  if (/^https?:\/\//i.test(h)) return { kind: 'url', target: h };
  if (/^www\./i.test(h)) return { kind: 'url', target: 'https://' + h };
  if (/^file:\/\//i.test(h)) h = h.replace(/^file:\/\/(localhost)?/i, '');
  else if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return { kind: 'ignore' };

  h = h.split('#')[0].split('?')[0];
  try { h = decodeURIComponent(h); } catch (_) {}
  if (!h) return { kind: 'ignore' };
  if (h.startsWith('~') || h.startsWith('/')) return { kind: 'path', target: h.startsWith('~') ? h : normalizePath(h) };

  const dir = String(docPath || '').slice(0, String(docPath || '').lastIndexOf('/'));
  if (!dir) return { kind: 'ignore' };   // a doc with no path can't anchor a relative link
  return { kind: 'path', target: normalizePath(dir + '/' + h) };
}

// ---- block -----------------------------------------------------------------
export function renderMarkdown(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const out = [];
  let list = null;      // 'ul' | 'ol' | null
  let fence = null;     // open fence marker, or null
  let fenceBuf = [];
  let para = [];

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closePara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeAll = () => { closePara(); closeList(); };

  for (const line of lines) {
    const fenceHit = line.match(/^\s*(```|~~~)/);
    if (fence) {
      if (fenceHit && fenceHit[1] === fence) {
        out.push(`<pre class="md-pre"><code>${esc(fenceBuf.join('\n'))}</code></pre>`);
        fence = null; fenceBuf = [];
      } else fenceBuf.push(line);
      continue;
    }
    if (fenceHit) { closeAll(); fence = fenceHit[1]; fenceBuf = []; continue; }

    if (!line.trim()) { closeAll(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeAll(); const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { closeAll(); out.push('<hr />'); continue; }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { closeAll(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      closePara();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }

    closeList();
    para.push(line.trim());
  }
  if (fence) out.push(`<pre class="md-pre"><code>${esc(fenceBuf.join('\n'))}</code></pre>`);
  closeAll();
  return out.join('\n');
}

// ---- highlight underlay ----------------------------------------------------
// Every character survives, markers included, so the layer lines up
// glyph-for-glyph with the textarea sitting on top of it.
function hlInline(raw) {
  return esc(raw).replace(INLINE, (m, code, link, strong, del, em, bare) => {
    const mark = (t) => `<span class="hl-mark">${t}</span>`;
    if (code) return `<span class="hl-code">${mark('`')}${code.slice(1, -1)}${mark('`')}</span>`;
    if (link) {
      const cut = link.lastIndexOf('](');
      return `${mark('[')}<span class="hl-link">${link.slice(1, cut)}</span>${mark(link.slice(cut))}`;
    }
    if (strong) return `<span class="hl-strong">${mark('**')}${strong.slice(2, -2)}${mark('**')}</span>`;
    if (del) return `<span class="hl-mark">${del}</span>`;
    if (em) return `<span class="hl-em">${mark('*')}${em.slice(1, -1)}${mark('*')}</span>`;
    return `<span class="hl-link">${bare}</span>`;
  });
}

export function highlightMarkdown(text) {
  let fence = false;
  const out = String(text == null ? '' : text).split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return `<span class="hl-fence">${esc(line)}</span>`; }
    if (fence) return `<span class="hl-code">${esc(line)}</span>`;

    const h = line.match(/^(#{1,6})(\s+)(.*)$/);
    if (h) return `<span class="hl-h hl-h${h[1].length}"><span class="hl-mark">${h[1]}${h[2]}</span>${hlInline(h[3])}</span>`;
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) return `<span class="hl-mark">${esc(line)}</span>`;

    const quote = line.match(/^(\s*>\s?)(.*)$/);
    if (quote) return `<span class="hl-quote"><span class="hl-mark">${esc(quote[1])}</span>${hlInline(quote[2])}</span>`;

    const bullet = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (bullet) return `<span class="hl-mark">${esc(bullet[1])}</span>${hlInline(bullet[2])}`;

    return hlInline(line);
  });
  // a trailing newline needs something after it or the layer scrolls short
  return out.join('\n') + '\n';
}

export function isMarkdownPath(p) { return /\.(md|markdown|mdx)$/i.test(String(p || '')); }
