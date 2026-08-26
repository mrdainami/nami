// Markdown for the chat transcript. marked does the parsing (tables, nesting,
// GFM edge cases); this module owns every byte of the output. We walk the
// token tree ourselves instead of using marked's HTML renderer, so the markup
// stays exactly what paper.css styles against and agent text can only ever
// reach the DOM through esc(). DOM-free on purpose — tests/acp-markdown.test.mjs
// runs it in plain node.
import { Lexer } from './vendor/marked.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const OPTS = { gfm: true, breaks: true };
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

function inline(tokens) {
  let out = '';
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text': out += t.tokens ? inline(t.tokens) : (t.escaped ? t.text : esc(t.text)); break;
      case 'escape': out += esc(t.text); break;
      case 'strong': out += `<b>${inline(t.tokens)}</b>`; break;
      case 'em': out += `<i>${inline(t.tokens)}</i>`; break;
      case 'del': out += `<del>${inline(t.tokens)}</del>`; break;
      case 'codespan': out += `<code>${esc(t.text)}</code>`; break;
      case 'br': out += '<br>'; break;
      case 'link': {
        const href = String(t.href || '');
        if (/^javascript:/i.test(href.trim())) { out += inline(t.tokens); break; }
        out += `<a href="${esc(href)}" data-link>${inline(t.tokens)}</a>`;
        break;
      }
      case 'image': {
        const href = String(t.href || '');
        // local image paths get a real thumbnail (wire() fills the file:// src);
        // anything remote stays a link — a reply must not make the app fetch.
        if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && IMG_EXT.test(href)) {
          out += `<img class="cw-imgout" data-open="${esc(href)}" data-imgsrc="${esc(href)}" alt="${esc(t.text || '')}">`;
        } else if (/^javascript:/i.test(href.trim())) {
          out += esc(t.text || href);
        } else {
          out += `<a href="${esc(href)}" data-link>${esc(t.text || href)}</a>`;
        }
        break;
      }
      case 'html': out += esc(t.raw); break;
      default: out += esc(t.raw || t.text || '');
    }
  }
  return out;
}

function listBody(item) {
  // tight items carry 'text' block tokens (render inline, no <p>); loose ones
  // carry paragraphs; either way nested lists sit alongside as block tokens.
  let out = '';
  for (const t of item.tokens || []) {
    if (t.type === 'checkbox') continue; // drawn by the <li class="task"> input
    if (t.type === 'text') out += t.tokens ? inline(t.tokens) : esc(t.text);
    else out += blocks([t]);
  }
  return out;
}

function blocks(tokens) {
  let out = '';
  for (const t of tokens || []) {
    switch (t.type) {
      case 'space': break;
      case 'paragraph': out += `<p>${inline(t.tokens)}</p>`; break;
      case 'heading': out += (() => { const d = Math.min(t.depth, 4); return `<h${d}>${inline(t.tokens)}</h${d}>`; })(); break;
      case 'code':
        out += `<div class="cw-codewrap"><button class="cw-copy" data-copy>copy</button><pre class="cw-code">${esc(String(t.text).replace(/\n$/, ''))}</pre></div>`;
        break;
      case 'blockquote': out += `<blockquote>${blocks(t.tokens)}</blockquote>`; break;
      case 'hr': out += '<hr>'; break;
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul';
        const start = t.ordered && t.start !== 1 && t.start !== '' ? ` start="${Number(t.start)}"` : '';
        out += `<${tag}${start}>`;
        for (const item of t.items) {
          if (item.task) out += `<li class="task"><input type="checkbox"${item.checked ? ' checked' : ''} disabled> ${listBody(item)}</li>`;
          else out += `<li>${listBody(item)}</li>`;
        }
        out += `</${tag}>`;
        break;
      }
      case 'table': {
        out += '<div class="cw-tablewrap"><table><tr>';
        for (const h of t.header) out += `<th>${inline(h.tokens)}</th>`;
        out += '</tr>';
        for (const row of t.rows) {
          out += '<tr>';
          for (const cell of row) out += `<td>${inline(cell.tokens)}</td>`;
          out += '</tr>';
        }
        out += '</table></div>';
        break;
      }
      case 'html': out += `<p>${esc(t.raw).trim()}</p>`; break;
      case 'text': out += `<p>${t.tokens ? inline(t.tokens) : esc(t.text)}</p>`; break;
      case 'def': break;
      default: out += `<p>${esc(t.raw || t.text || '')}</p>`;
    }
  }
  return out;
}

export function renderMarkdown(text) {
  return blocks(new Lexer(OPTS).lex(String(text)));
}

// Spans only — for one-line chrome (notes, thought labels) where a block
// element would break the layout. Block syntax renders as its plain text.
export function renderInline(text) {
  return inline(new Lexer(OPTS).inlineTokens(String(text)));
}
