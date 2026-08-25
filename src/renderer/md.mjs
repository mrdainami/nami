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

import { highlightCode } from './md-code.mjs';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// One pass, alternation ordered by precedence — code spans match first, so
// `**not bold**` inside backticks stays literal. Underscore emphasis is
// deliberately absent: snake_case identifiers are far more common than _em_.
// The bare-URL branch comes last so `[text](url)` and code spans win first, and
// it stops before the punctuation that ends a sentence around a link.
const INLINE = /(`[^`\n]+`)|(==[^=\n]+==)|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*\*[^*\n]+\*\*\*)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\bhttps?:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,;:!?])/g;

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
// The renderer's own inline pass adds one branch over the highlighter's:
// images. It cannot share INLINE — the underlay's group order is part of its
// contract — so the image-aware alternation lives here. An image only becomes
// an <img> when the caller's resolveImage approves the src (the Read tab maps
// doc-relative paths through nami-doc://); with no resolver only data: URIs
// render, everything else stays a link — a card never fetches on its own.
// Emphasis recurses into its own content — `**[title](url)**` is a bold LINK
// (found literal in a real Notion reply) — through a fresh regex each level:
// recursing through one global RegExp would clobber the outer lastIndex.
const INLINE_R = /(`[^`\n]+`)|(==[^=\n]+==)|(!\[[^\]\n]*\]\([^)\s]+\))|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*\*[^*\n]+\*\*\*)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\bhttps?:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,;:!?])/g;

function inlineEscR(s, resolve) {
  return s.replace(new RegExp(INLINE_R.source, 'g'), (m, code, mark, img, link, both, strong, del, em, bare) => {
    let cut;
    if (code) return `<code>${code.slice(1, -1)}</code>`;
    if (mark) return `<mark>${inlineEscR(mark.slice(2, -2), resolve)}</mark>`;
    if (both) return `<strong><em>${inlineEscR(both.slice(3, -3), resolve)}</em></strong>`;
    if (img) {
      cut = img.lastIndexOf('](');
      const src = img.slice(cut + 2, -1);
      const alt = img.slice(2, cut);
      const url = resolve ? resolve(src) : (/^data:/i.test(src) ? src : null);
      return url ? `<img src="${url}" alt="${alt}">` : `<a href="${src}">${alt}</a>`;
    }
    if (link) {
      cut = link.lastIndexOf('](');
      return `<a href="${link.slice(cut + 2, -1)}">${inlineEscR(link.slice(1, cut), resolve)}</a>`;
    }
    if (strong) return `<strong>${inlineEscR(strong.slice(2, -2), resolve)}</strong>`;
    if (del) return `<del>${inlineEscR(del.slice(2, -2), resolve)}</del>`;
    if (em) return `<em>${inlineEscR(em.slice(1, -1), resolve)}</em>`;
    return `<a href="${bare}">${bare}</a>`;
  });
}

const SAFE_COLOUR = /^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|var\(--(?:red-ink|green|amber-ink|muted)\))$/i;
function inlineRaw(raw, resolve) {
  const preserved = [];
  const text = String(raw == null ? '' : raw).replace(
    /<span\s+style="color:\s*([^";]+);?">([^<]*)<\/span>/gi,
    (whole, colour, body) => {
      if (!SAFE_COLOUR.test(String(colour).trim())) return whole;
      const token = `\uE000${preserved.length}\uE001`;
      preserved.push(`<span style="color:${esc(String(colour).trim())}">${esc(body)}</span>`);
      return token;
    },
  );
  let html = inlineEscR(esc(text), resolve);
  preserved.forEach((span, index) => { html = html.replace(`\uE000${index}\uE001`, span); });
  return html;
}

function attachmentKind(href) {
  const clean = String(href || '').split(/[?#]/)[0];
  if (/\.(?:m4v|mov|mp4|ogv|webm)$/i.test(clean)) return 'video';
  if (/^https?:/i.test(clean)) return '';
  if (/\.(?:md|markdown)$/i.test(clean)) return '';
  return /\.[a-z0-9]{1,12}$/i.test(clean) ? 'file' : '';
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

// Consume one whole list region: items at any indent, indented continuation
// lines joining their item, blank lines allowed while the region continues.
function listBlock(lines, start) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && (LIST_RE.test(lines[j]) || /^\s{2,}\S/.test(lines[j]))) { i = j; continue; }
      break;
    }
    const m = line.match(LIST_RE);
    if (m) { items.push({ ind: m[1].length, ord: /\d/.test(m[2][0]), num: parseInt(m[2], 10) || 1, text: m[3] }); i++; continue; }
    if (/^\s{2,}\S/.test(line) && items.length) { items[items.length - 1].text += ' ' + line.trim(); i++; continue; }
    break;
  }
  return { items, next: i };
}

// Indent drives nesting; a type change at one indent closes and reopens; an
// ordered list keeps its first number. Task markers become real checkboxes,
// disabled — the Read tab shows state, it doesn't edit it.
function renderList(items, inl) {
  const out = [];
  const stack = []; // { ind, tag }
  const closeOne = () => { const l = stack.pop(); out.push(`</li></${l.tag}>`); };
  for (const it of items) {
    const tag = it.ord ? 'ol' : 'ul';
    while (stack.length && it.ind < stack[stack.length - 1].ind) closeOne();
    if (stack.length && it.ind === stack[stack.length - 1].ind && stack[stack.length - 1].tag !== tag) closeOne();
    if (!stack.length || it.ind > stack[stack.length - 1].ind) {
      out.push(`<${tag}${it.ord && it.num !== 1 ? ` start="${it.num}"` : ''}>`);
      stack.push({ ind: it.ind, tag });
    } else out.push('</li>');
    const task = it.text.match(/^\[( |x|X)\]\s+(.*)$/);
    if (task) out.push(`<li class="md-task"><input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}>${inl(task[2])}`);
    else out.push(`<li>${inl(it.text)}`);
  }
  while (stack.length) closeOne();
  return out.join('');
}

// A table is a |-row over a separator of pipes, dashes and colons; the colons
// carry the alignment. Rows render until the first non-| line.
function tableAt(lines, i, inl) {
  if (!/\|/.test(lines[i] || '')) return null;
  const sep = lines[i + 1];
  if (!sep || !/^[\s|:-]+$/.test(sep) || !sep.includes('-') || !sep.includes('|')) return null;
  const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const aligns = cells(sep).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : ''));
  // <br> is the one line break GFM allows in a cell (a newline would end the
  // row) — render it as a real break, each segment through the inline pass
  const cell = (c) => c.split(/<br\s*\/?>/i).map(inl).join('<br>');
  const tr = (row, tag) => '<tr>' + cells(row).map((c, k) =>
    `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${cell(c)}</${tag}>`).join('') + '</tr>';
  let html = `<table><thead>${tr(lines[i], 'th')}</thead><tbody>`;
  let j = i + 2;
  while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim()) { html += tr(lines[j], 'td'); j++; }
  return { html: `<div class="md-tablewrap">${html}</tbody></table></div>`, next: j };
}

// One pass over the lines, from startIdx, emitting blocks with their
// exclusive end line — the shared engine behind both faces below. Behavior
// is renderMarkdown's, unchanged; the boundaries are what streaming needs.
function blockPass(lines, opts, startIdx) {
  const inl = (raw) => inlineRaw(raw, opts.resolveImage);
  const code = (lang, body) => (opts.streaming ? esc(body) : highlightCode(lang, body));
  const out = [];
  const push = (html, end) => out.push({ html, end });
  let fence = null;     // open fence marker, or null
  let fenceLang = '';
  let fenceBuf = [];
  let para = [];
  // Two things the plain join lost: a line of only <br /> tags is the block
  // editor's way of keeping a deliberate empty line (render it as one), and a
  // line ending in two spaces is markdown's own hard break.
  const closePara = (end) => {
    if (!para.length) return;
    let html = '';
    para.forEach((line, k) => {
      const brOnly = /^(?:\s*<br\s*\/?>)+\s*$/i.test(line);
      if (k) html += brOnly || /  $/.test(para[k - 1]) || /^(?:\s*<br\s*\/?>)+\s*$/i.test(para[k - 1]) ? '<br>' : ' ';
      html += brOnly ? '<br>'.repeat(Math.max(0, (line.match(/<br/gi) || []).length - (k ? 1 : 0))) : inl(line.replace(/\s+$/, ''));
    });
    push(`<p>${html}</p>`, end);
    para = [];
  };

  let i = startIdx;
  // Frontmatter — only at the very top of a whole document, rendered as one
  // quiet meta block instead of the rules-and-junk the old renderer made.
  if (!opts.sub && !opts.noFm && startIdx === 0 && lines[0] === '---') {
    let e = 1;
    while (e < lines.length && lines[e].trim() !== '---') e++;
    if (e < lines.length) {
      const fm = lines.slice(1, e).map((l) => {
        const m = l.match(/^([\w][\w-]*):\s*(.*)$/);
        return m ? `<b>${esc(m[1])}</b>: ${esc(m[2])}` : esc(l);
      }).join('<br>');
      push(`<div class="md-fm">${fm}</div>`, e + 1);
      i = e + 1;
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      const closeHit = line.match(/^\s*(```|~~~)\s*$/);
      if (closeHit && closeHit[1] === fence) {
        push(`<pre class="md-pre">${fenceLang ? `<span class="md-lang">${esc(fenceLang)}</span>` : ''}<code>${code(fenceLang, fenceBuf.join('\n'))}</code></pre>`, i + 1);
        fence = null; fenceBuf = []; fenceLang = '';
      } else fenceBuf.push(line);
      continue;
    }
    const fh = line.match(/^\s*(```|~~~)\s*(\S+)?\s*$/);
    if (fh) { closePara(i); fence = fh[1]; fenceLang = fh[2] || ''; fenceBuf = []; continue; }

    if (!line.trim()) { closePara(i); continue; }

    // CommonMark allows up to 3 leading spaces — wrapped TUI transcripts
    // (codex stores a 2-space hanging indent) depend on it.
    const h = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (h) { closePara(i); const n = h[1].length; push(`<h${n}>${inl(h[2])}</h${n}>`, i + 1); continue; }

    // Setext: an underline promotes the pending paragraph. A bare --- with
    // nothing pending is still a rule, checked next.
    if (para.length && /^\s*=+\s*$/.test(line)) { push(`<h1>${inl(para.join(' '))}</h1>`, i + 1); para = []; continue; }
    if (para.length && /^\s*-+\s*$/.test(line)) { push(`<h2>${inl(para.join(' '))}</h2>`, i + 1); para = []; continue; }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { closePara(i); push('<hr />', i + 1); continue; }

    if (/^\s*>/.test(line)) {
      closePara(i);
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      i--;
      push(`<blockquote>${renderMarkdown(q.join('\n'), { ...opts, sub: true })}</blockquote>`, i + 1);
      continue;
    }

    const tb = tableAt(lines, i, inl);
    if (tb) { closePara(i); push(tb.html, tb.next); i = tb.next - 1; continue; }

    if (LIST_RE.test(line)) {
      closePara(i);
      const lb = listBlock(lines, i);
      push(renderList(lb.items, inl), lb.next);
      i = lb.next - 1;
      continue;
    }

    const attachment = line.trim().match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    const attachmentType = attachment && attachmentKind(attachment[2]);
    if (attachmentType) {
      closePara(i);
      push(`<a class="md-attachment md-attachment--${attachmentType}" href="${esc(attachment[2])}"><b>${attachmentType === 'video' ? '▶' : '↗'}</b><span>${inl(attachment[1])}</span></a>`, i + 1);
      continue;
    }

    para.push(line.replace(/^\s+/, ''));   // keep the tail: two trailing spaces are a hard break
  }
  if (fence) push(`<pre class="md-pre">${fenceLang ? `<span class="md-lang">${esc(fenceLang)}</span>` : ''}<code>${code(fenceLang, fenceBuf.join('\n'))}</code></pre>`, lines.length);
  closePara(lines.length);
  return out;
}

export function renderMarkdown(text, opts = {}) {
  const lines = String(text == null ? '' : text).split('\n');
  return blockPass(lines, opts, 0).map((b) => b.html).join('\n');
}

// The streaming face: same engine, but appends reuse the frozen prefix.
// All but the trailing 2 blocks are stable — and a block that could still
// change (the possibly-extended last line, an open fence, pending paragraph)
// is by construction inside that live tail. `state` goes back in on the next
// call; non-append input resets wholesale.
export function renderMarkdownStream(text, prev, opts = {}) {
  const src = String(text == null ? '' : text);
  const lines = src.split('\n');
  let stable = [];
  let startIdx = 0;
  if (prev && typeof prev.text === 'string' && Array.isArray(prev.blocks) && src.startsWith(prev.text)) {
    // an append may extend prev's final line, so no frozen block may end at
    // or past it — trim until the boundary sits strictly before that line
    const prevLastLine = prev.text.split('\n').length - 1;
    let keep = Math.max(0, prev.blocks.length - 2);
    while (keep > 0 && prev.blocks[keep - 1].end > prevLastLine) keep--;
    stable = prev.blocks.slice(0, keep);
    startIdx = keep ? stable[keep - 1].end : 0;
  }
  const tail = blockPass(lines, startIdx > 0 ? { ...opts, noFm: true } : opts, startIdx);
  const blocks = stable.concat(tail);
  return {
    blocks,
    stableCount: stable.length,
    state: { text: src, blocks, parsedLines: lines.length - startIdx },
  };
}

// ---- highlight underlay ----------------------------------------------------
// Every character survives, markers included, so the layer lines up
// glyph-for-glyph with the textarea sitting on top of it.
function hlInline(raw) {
  return esc(raw).replace(INLINE, (m, code, highlight, link, both, strong, del, em, bare) => {
    const mark = (t) => `<span class="hl-mark">${t}</span>`;
    if (code) return `<span class="hl-code">${mark('`')}${code.slice(1, -1)}${mark('`')}</span>`;
    if (highlight) return `<span class="hl-highlight">${mark('==')}${highlight.slice(2, -2)}${mark('==')}</span>`;
    if (both) return `<span class="hl-strong"><span class="hl-em">${mark('***')}${both.slice(3, -3)}${mark('***')}</span></span>`;
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

    const h = line.match(/^( {0,3})(#{1,6})(\s+)(.*)$/);
    if (h) return `<span class="hl-h hl-h${h[2].length}"><span class="hl-mark">${h[1]}${h[2]}${h[3]}</span>${hlInline(h[4])}</span>`;
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

// Plain text with its links made real — for rows that must never render as
// markdown (the user's own words) but whose URLs and paths should still
// click. Escape-first like everything else; a path needs two segments so
// "either/or" stays prose.
export function linkifyPlain(text) {
  return esc(text).replace(
    /(\bhttps?:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,;:!?])|((?:~|\.{0,2})?\/[\w.@-]+(?:\/[\w.@-]+)+(?::\d+)?)/g,
    (m, url, p) => (url
      ? `<a href="${url}">${url}</a>`
      : `<a class="cd-path" data-path="${p}">${p}</a>`),
  );
}

export function isMarkdownPath(p) { return /\.(md|markdown|mdx)$/i.test(String(p || '')); }
