// All card DOM lives here, not in app.js — app.js gains only the switch, the
// mount and the event route. buildCards() returns a handle app.js drives with
// rows from session-cards.mjs; every callback the cards need comes in through
// ctx, so this module never reaches back into app state.
//
// If a card is ever poorer than the terminal it filters, that is a bug: prose
// renders as markdown (md.mjs escapes before it parses, so a card cannot be
// made to run HTML), URLs open in the browser, bare paths are statted before
// they light up, and fenced code scrolls inside its own block.

import { renderMarkdown } from './md.mjs';
import { pixIcon } from './icons.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Line art for paper and operator; the glass themes flip to pixel glyphs via
// the same .uni-i / .pix-i pattern the head buttons use.
const SEND_SVG = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12.2V4.2M4.6 7.6 8 4.2l3.4 3.4"/></svg>`;
const MIC_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="1.6" width="4" height="7" rx="2"/><path d="M3.6 7.4a4.4 4.4 0 0 0 8.8 0M8 11.8v2.6"/></svg>`;

// How many lines a diff shows before admitting the cut.
const DIFF_DEL_CAP = 40;
const DIFF_ADD_CAP = 60;

function q(sel, el) { return el.querySelector(sel); }

// ---- prose -----------------------------------------------------------------
// Markdown first (escaped-then-parsed), then a light pass that wraps
// path-looking tokens so a click can stat-and-open them. Only text nodes are
// touched; a path inside a fenced block stays code.
const PATH_RE = /(^|[\s(])((?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+|[\w.@-]+\.(?:mjs|js|ts|tsx|jsx|css|html|json|md|py|rs|go|sh|yml|yaml|toml)(?::\d+)?)/g;

function linkifyPaths(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('a, pre, .cd-path')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (PATH_RE.test(n.nodeValue)) hits.push(n);
    PATH_RE.lastIndex = 0;
  }
  for (const n of hits) {
    const frag = document.createDocumentFragment();
    let last = 0;
    const text = n.nodeValue;
    text.replace(PATH_RE, (m, lead, token, idx) => {
      frag.appendChild(document.createTextNode(text.slice(last, idx) + lead));
      const a = document.createElement('a');
      a.className = 'cd-path';
      a.textContent = token;
      a.dataset.path = token;
      frag.appendChild(a);
      last = idx + m.length;
      return m;
    });
    frag.appendChild(document.createTextNode(text.slice(last)));
    n.parentNode.replaceChild(frag, n);
  }
}

function proseHtml(text) {
  const el = document.createElement('div');
  el.className = 'cd-md';
  el.innerHTML = renderMarkdown(String(text || ''));
  linkifyPaths(el);
  return el;
}

// ---- diffs -----------------------------------------------------------------
function diffEl(diff) {
  const wrap = document.createElement('div');
  wrap.className = 'cd-diff';
  const del = String(diff.oldText || '').split('\n');
  const add = String(diff.newText || '').split('\n');
  if (del.length > 1 && del.at(-1) === '') del.pop();
  if (add.length > 1 && add.at(-1) === '') add.pop();
  const cut = (lines, cap, cls, mark) => {
    if (lines.length === 1 && lines[0] === '') return '';
    const shown = lines.slice(0, cap);
    let html = `<pre class="cd-diff-b ${cls}">${shown.map((l) => `<span>${mark} ${esc(l)}</span>`).join('\n')}</pre>`;
    if (lines.length > cap) html += `<div class="cd-diff-more">… ${lines.length - cap} more lines</div>`;
    return html;
  };
  wrap.innerHTML = `${diff.path ? `<div class="cd-diff-path"><a class="cd-path" data-path="${esc(diff.path)}">${esc(diff.path)}</a></div>` : ''}
    ${cut(del, DIFF_DEL_CAP, 'del', '−')}${cut(add, DIFF_ADD_CAP, 'add', '+')}
    ${diff.more ? `<div class="cd-diff-more">… and ${diff.more} more edit${diff.more > 1 ? 's' : ''} in this call</div>` : ''}`;
  return wrap;
}

// ---- rows ------------------------------------------------------------------
function renderRow(ctx, row) {
  const el = document.createElement('div');
  el.className = 'cd-row cd-' + row.kind;

  if (row.kind === 'user') {
    el.innerHTML = `<span class="m">❯</span><span class="tx"></span>`;
    q('.tx', el).textContent = row.command ? '/' + row.text.replace(/^\//, '') : row.text;
    el.classList.toggle('cd-cmd', !!row.command);
    return el;
  }

  if (row.kind === 'assistant') {
    el.dataset.n = String(row.text || '').length;
    el.appendChild(proseHtml(row.text));
    return el;
  }

  if (row.kind === 'thinking') {
    // Collapsed by default: thought is context, not content.
    el.innerHTML = `<button class="cd-th-head">⋯ Thought <span class="cd-th-arr">▸</span></button><div class="cd-th-body" hidden></div>`;
    q('.cd-th-body', el).appendChild(proseHtml(row.text));
    q('.cd-th-head', el).onclick = () => {
      const open = el.classList.toggle('open');
      q('.cd-th-body', el).hidden = !open;
      q('.cd-th-arr', el).textContent = open ? '▾' : '▸';
    };
    return el;
  }

  if (row.kind === 'tool') {
    el.innerHTML = `<div class="cd-line">
        <span class="cd-kd"></span>
        <span class="cd-ic"></span>
        <span class="cd-lb"></span>
        <span class="cd-dt"></span>
      </div><div class="cd-open" hidden></div>`;
    updateRow(ctx, el, row);
    q('.cd-line', el).onclick = () => {
      if (!el.dataset.body) return;
      el.classList.toggle('open');
      q('.cd-open', el).hidden = !el.classList.contains('open');
    };
    return el;
  }

  if (row.kind === 'plan') {
    const marks = { completed: '☑', in_progress: '◐', pending: '☐' };
    el.innerHTML = `<div class="cd-plan-t">Plan</div>` + row.todos.map((t) =>
      `<div class="cd-plan-i ${esc(t.status)}"><span class="mk">${marks[t.status] || '☐'}</span><span>${esc(t.text)}</span></div>`).join('');
    return el;
  }

  if (row.kind === 'permission') {
    updatePermission(ctx, el, row);
    return el;
  }

  if (row.kind === 'note') { el.textContent = row.text; return el; }
  if (row.kind === 'error') { el.innerHTML = `<span class="m">✕</span><span class="tx"></span>`; q('.tx', el).textContent = row.text; return el; }

  if (row.kind === 'turn_end') {
    el.textContent = `done in ${row.duration}` + (row.costUsd ? ` · $${row.costUsd.toFixed(2)}` : '');
    return el;
  }

  el.textContent = row.text || '';
  return el;
}

function updateRow(ctx, el, row) {
  if (row.kind === 'permission') { updatePermission(ctx, el, row); return; }
  // Streaming prose: an adapter re-emits the same row id with more text.
  if (row.kind === 'assistant' || row.kind === 'thinking') {
    const n = String(row.text || '').length;
    if (String(el.dataset.n || '') === String(n)) return;
    el.dataset.n = n;
    const host = row.kind === 'assistant' ? el : q('.cd-th-body', el);
    if (host) { const old = q('.cd-md', host); if (old) old.remove(); host.appendChild(proseHtml(row.text)); }
    return;
  }
  if (row.kind !== 'tool') return;
  el.classList.toggle('err', !!row.isError);
  el.classList.toggle('pending', !!row.pending);
  q('.cd-kd', el).textContent = row.glyph || '•';
  q('.cd-ic', el).textContent = row.pending ? '·' : (row.isError ? '✕' : '✓');
  q('.cd-lb', el).textContent = row.label;
  q('.cd-dt', el).textContent = row.detail;

  const open = q('.cd-open', el);
  const hasDiff = row.diff && (row.diff.oldText || row.diff.newText);
  const children = row.children && row.children.length;
  el.dataset.body = (row.body || hasDiff || children) ? '1' : '';
  // Rebuilt each update: a tool mutates once, when its result lands.
  open.innerHTML = '';
  if (hasDiff) open.appendChild(diffEl(row.diff));
  if (row.body) {
    const pre = document.createElement('pre');
    pre.className = 'cd-body';
    pre.textContent = row.body + (row.truncated ? '\n\n… cut here — the whole thing is in Term' : '');
    open.appendChild(pre);
  }
  if (children) {
    const sub = document.createElement('div');
    sub.className = 'cd-sub';
    sub.innerHTML = `<div class="cd-sub-t">sub-agent · ${row.children.length} step${row.children.length > 1 ? 's' : ''}</div>`;
    for (const c of row.children) sub.appendChild(renderRow(ctx, c));
    open.appendChild(sub);
  }
  if (!el.dataset.body) { el.classList.remove('open'); open.hidden = true; }
}

// The approval card renders what the agent sent: its title, its description,
// the diff it attached, one button per option it offered. Settled, it folds to
// one quiet line — the ask is history, not a control.
function updatePermission(ctx, el, row) {
  if (row.resolved) {
    const picked = row.options.find((o) => o.id === row.resolved);
    el.classList.remove('cd-perm-open');
    el.classList.add('cd-perm-done');
    el.innerHTML = `<span class="cd-kd">${row.resolved === 'deny' || row.resolved === 'cancelled' ? '✕' : '✓'}</span><span class="tx"></span>`;
    q('.tx', el).textContent = `${row.title} — ${picked ? picked.label : row.resolved === 'cancelled' ? 'cancelled' : 'answered'}`;
    return;
  }
  el.classList.add('cd-perm-open');
  el.innerHTML = `<div class="cd-perm-t"><span class="cd-perm-mk">?</span><span class="cd-perm-name"></span></div>
    <div class="cd-perm-d"></div>
    <div class="cd-perm-diff"></div>
    <div class="cd-perm-b"></div>`;
  q('.cd-perm-name', el).textContent = row.title;
  const d = q('.cd-perm-d', el);
  const detail = row.description || summarizeInput(row);
  if (detail) d.textContent = detail; else d.remove();
  const command = row.input && row.input.command;
  if (command) {
    const pre = document.createElement('pre');
    pre.className = 'cd-body cd-perm-cmd';
    pre.textContent = command;
    q('.cd-perm-diff', el).before(pre);
  }
  if (row.diff && (row.diff.oldText || row.diff.newText)) q('.cd-perm-diff', el).appendChild(diffEl(row.diff));
  const bar = q('.cd-perm-b', el);
  for (const opt of row.options) {
    const b = document.createElement('button');
    b.className = 'cd-perm-btn' + (opt.id === 'deny' ? ' deny' : '') + (opt.id === 'allow' ? ' allow' : '');
    b.textContent = opt.label;
    b.onclick = () => ctx.onPermission(row.permissionId, opt.id);
    bar.appendChild(b);
  }
}

function summarizeInput(row) {
  const i = row.input || {};
  if (i.file_path) return i.file_path;
  if (i.url) return i.url;
  return '';
}

// ---- the whole card surface ------------------------------------------------
// ctx: { onSend(text), onPermission(id, optionId), onInterrupt(), onMic(),
//        onOpenPath(path, ev), onOpenUrl(url), commands() -> [names] }
export function buildCards(ctx) {
  const el = document.createElement('div');
  el.className = 'tile-cards';
  el.innerHTML = `<div class="cd-note" hidden></div>
    <div class="cd-list"></div>
    <div class="cd-menu" hidden></div>
    <div class="cd-ask">
      <span class="m">❯</span>
      <select class="cd-model" hidden title="Model"></select>
      <input class="cd-input" type="text" placeholder="Reply to this session…" />
      <button class="cd-mic-btn" title="Dictate into this session"><span class="uni-i">${MIC_SVG}</span><span class="pix-i">${pixIcon('mic')}</span></button>
      <button class="cd-send-btn" title="Send" disabled><span class="uni-i">${SEND_SVG}</span><span class="pix-i">${pixIcon('send')}</span></button>
    </div>`;

  const list = q('.cd-list', el);
  const note = q('.cd-note', el);
  const menu = q('.cd-menu', el);
  const input = q('.cd-input', el);
  const sendBtn = q('.cd-send-btn', el);
  const micBtn = q('.cd-mic-btn', el);
  const rowEls = new Map();

  // One delegated click serves every path and url in every row.
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    if (a.classList.contains('cd-path')) { ctx.onOpenPath(a.dataset.path, ev); return; }
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href)) { ctx.onOpenUrl(href); return; }
    // Antigravity links files as file:// URLs; they resolve like a bare path.
    if (/^file:/i.test(href)) {
      try { ctx.onOpenPath(decodeURIComponent(new URL(href).pathname), ev); } catch (_) {}
    }
  });

  // Filled means armed; empty means outline and muted.
  const arm = () => { sendBtn.disabled = !input.value.trim(); };
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    arm();
    hideMenu();
    ctx.onSend(text);
  };
  sendBtn.onclick = submit;
  micBtn.onclick = (e) => { e.stopPropagation(); ctx.onMic(); };

  // `/` offers the agent's own commands, where it published them.
  function refreshMenu() {
    const v = input.value;
    if (!v.startsWith('/') || v.includes(' ')) { hideMenu(); return; }
    const all = (ctx.commands && ctx.commands()) || [];
    const want = v.slice(1).toLowerCase();
    const hits = all.filter((c) => String(c).toLowerCase().startsWith(want)).slice(0, 8);
    if (!hits.length) { hideMenu(); return; }
    menu.innerHTML = hits.map((c) => `<button class="cd-menu-i" data-c="${esc(c)}">/${esc(c)}</button>`).join('');
    menu.hidden = false;
    for (const b of menu.querySelectorAll('.cd-menu-i')) {
      b.onclick = () => { input.value = '/' + b.dataset.c + ' '; input.focus(); arm(); hideMenu(); };
    }
  }
  function hideMenu() { menu.hidden = true; }

  input.addEventListener('input', () => { arm(); refreshMenu(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') {
      if (!menu.hidden) hideMenu();
      else ctx.onInterrupt();
      e.preventDefault();
    } else if (e.key === 'Tab' && !menu.hidden) {
      const first = menu.querySelector('.cd-menu-i');
      if (first) { first.click(); e.preventDefault(); }
    }
    e.stopPropagation();
  });

  function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 80; }
  function scrollToEnd(now) {
    const go = () => { list.scrollTop = list.scrollHeight; };
    if (now) requestAnimationFrame(go); else go();
  }

  // Rows only ever append, and a row mutates in place when its state moves, so
  // a full rebuild is reserved for a reset — it would otherwise close every
  // expanded row and throw away the scroll position.
  function feed(rows, full) {
    if (full) { list.innerHTML = ''; rowEls.clear(); }
    const stick = nearBottom();
    for (const row of rows) {
      const seen = rowEls.get(row.id);
      if (seen) { updateRow(ctx, seen, row); continue; }
      const rowEl = renderRow(ctx, row);
      rowEls.set(row.id, rowEl);
      list.appendChild(rowEl);
    }
    if (stick) scrollToEnd(false);
  }

  function setNote(text, urgent) {
    note.textContent = text || '';
    note.hidden = !text;
    note.classList.toggle('urgent', !!urgent);
  }

  const modelSel = q('.cd-model', el);
  modelSel.onchange = () => { if (ctx.onModel) ctx.onModel(modelSel.value); };
  modelSel.addEventListener('keydown', (e) => e.stopPropagation());
  function setModels(models) {
    if (!models || !Array.isArray(models.options) || !models.options.length) { modelSel.hidden = true; return; }
    modelSel.innerHTML = models.options.map((m) =>
      `<option value="${esc(m.value)}"${m.value === models.current ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
    modelSel.hidden = false;
  }

  return {
    el, list, input,
    feed, setNote, scrollToEnd, setModels,
    isEmpty: () => !list.children.length,
    insertText: (t) => {
      input.focus();
      try { document.execCommand('insertText', false, t); } catch (_) { input.value += t; }
      arm();
    },
    setFontSize: (px) => { el.style.fontSize = px ? px + 'px' : ''; },
  };
}
