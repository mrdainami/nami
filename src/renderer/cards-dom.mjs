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
import { pixIcon, iconKeyFor, iconSvg } from './icons.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function modeLabel(mode) {
  return {
    default: 'ask first', acceptEdits: 'accept edits', 'accept-edits': 'accept edits',
    plan: 'plan', auto: 'auto', dontAsk: "don't ask",
    bypassPermissions: 'bypass ⚠', 'skip-permissions': 'skip ⚠',
    build: 'build', 'full access': 'full access',
    // codex's own presets (auto shares claude's entry)
    'read-only': 'read-only', 'workspace-write': 'workspace write',
    'full-access': 'full access ⚠', bypass: 'bypass ⚠',
  }[mode] || mode;
}
// One stable colour per mode, worn everywhere the mode appears — the chip,
// the welcome pick, the mode menu — so shift⇥ state reads by hue before the
// word: neutral asks, blue for the careful modes (plan, read-only, don't
// ask), green for pre-approved work (accept edits, auto, workspace write),
// amber for anything that drops the guardrails (bypass, skip, full access).
export function modeClass(mode) {
  const m = String(mode || '');
  if (/bypass|skip|full-access/i.test(m)) return 'm-bypass';
  if (/plan|read-only|dontAsk/i.test(m)) return 'm-plan';
  if (/accept|workspace|^auto$/i.test(m)) return 'm-accept';
  return 'm-default';
}
// The composer's Enter decision, pure for the tests: a choice on screen owns
// Enter first (picker, then menu); after that plain ⏎ sends and a modified ⏎
// (⌥ or ⇧) breaks the line. Every other key is someone else's.
export function composerKeyAction(e, ui = {}) {
  if (e.key !== 'Enter') return null;
  if (ui.pickerOpen) return 'picker';
  if (ui.menuOpen) return 'menu';
  return (e.altKey || e.shiftKey) ? 'newline' : 'send';
}

function shortModel(m) {
  const s = String(m || '').split('/').pop();
  return s.length > 24 ? s.slice(0, 23) + '…' : s;
}

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
// Lessons paid for in screenshots: block spans must never also be joined with
// newlines inside a pre-wrap container (every line doubles), a diff opens as
// a one-line summary (`name · +N −M`) not a wall, and an expanded body scrolls
// inside a cap instead of taking the tile with it.
function diffLines(text) {
  const lines = String(text || '').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines.length === 1 && lines[0] === '' ? [] : lines;
}

export function diffCounts(diff) {
  return { add: diffLines(diff && diff.newText).length, del: diffLines(diff && diff.oldText).length };
}

function diffBody(diff) {
  const body = document.createElement('div');
  body.className = 'cd-diff-body';
  const cut = (lines, cap, cls, mark) => {
    if (!lines.length) return '';
    const shown = lines.slice(0, cap);
    let html = `<pre class="cd-diff-b ${cls}">${shown.map((l) => `<span>${mark} ${esc(l)}</span>`).join('')}</pre>`;
    if (lines.length > cap) html += `<div class="cd-diff-more">… ${lines.length - cap} more lines</div>`;
    return html;
  };
  body.innerHTML = `${diff.path ? `<div class="cd-diff-path"><a class="cd-path" data-path="${esc(diff.path)}">${esc(diff.path)}</a></div>` : ''}
    ${cut(diffLines(diff.oldText), DIFF_DEL_CAP, 'del', '−')}${cut(diffLines(diff.newText), DIFF_ADD_CAP, 'add', '+')}
    ${diff.more ? `<div class="cd-diff-more">… and ${diff.more} more edit${diff.more > 1 ? 's' : ''} in this call</div>` : ''}`;
  return body;
}

// summary: true → one collapsed line that toggles the body open.
function diffEl(diff, { summary = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'cd-diff';
  if (!summary) { wrap.appendChild(diffBody(diff)); return wrap; }
  const { add, del } = diffCounts(diff);
  const name = String(diff.path || '').split('/').filter(Boolean).pop() || 'diff';
  const sum = document.createElement('button');
  sum.className = 'cd-diff-sum';
  sum.innerHTML = `<span class="n">${esc(name)}</span><span class="c"><span class="arr">▸</span> <span class="plus">+${add}</span> <span class="minus">−${del}</span></span>`;
  const body = diffBody(diff);
  body.hidden = true;
  sum.onclick = (e) => {
    e.stopPropagation();
    body.hidden = !body.hidden;
    sum.querySelector('.arr').textContent = body.hidden ? '▸' : '▾';
  };
  wrap.append(sum, body);
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

  if (row.kind === 'intro') {
    // The welcome — the card-native TUI banner. Logo, name and version, the
    // folder, then the session's dials stacked (stable at every width), then
    // the keys. Pickers are live where the channel can switch; facts where it
    // cannot.
    el.dataset.n = `${row.model}|${row.mode}|${row.note || ''}`;
    const key = iconKeyFor(row.name || '');
    const mark = (key && iconSvg(key)) || `<span class="cd-wl-t">${esc(String(row.name || 'A').slice(0, 2).toUpperCase())}</span>`;
    el.innerHTML = `
      <div class="cd-wl">${mark}</div>
      <div class="cd-wn">${esc(row.name)}${row.version ? ` <span class="v">v${esc(row.version)}</span>` : ''}</div>
      <div class="cd-wf">${esc(shortPath(row.cwd))}</div>
      ${row.note ? `<div class="cd-wnote">${esc(row.note)}</div>` : ''}
      <div class="cd-wp">
        ${row.model ? `<button class="cd-wpick" data-act="model"><span class="lab">model</span><span class="val">${esc(shortModel(row.model))}</span><span class="c">⌄</span></button>` : ''}
        ${row.mode ? `<button class="cd-wpick" data-act="mode"><span class="lab">mode</span><span class="val ${modeClass(row.mode)}">${esc(modeLabel(row.mode))}</span><span class="c">⌄</span></button>` : ''}
      </div>
      <div class="cd-wh">/ commands · esc interrupts · shift⇥ cycles mode · ⌘↑ ⌘↓ walk turns</div>`;
    el.querySelectorAll('.cd-wpick').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.act === 'mode') { if (ctx.onModePick) ctx.onModePick(b); else if (ctx.onMode) ctx.onMode(); }
        else if (b.dataset.act === 'model' && ctx.onModelMenu) ctx.onModelMenu();
      };
    });
    return el;
  }

  if (row.kind === 'fold') {
    // A finished turn's work, folded to one line. Children render lazily —
    // most folds are never opened, and a long session holds many.
    const worked = row.duration ? `worked for ${esc(row.duration)}` : 'worked';
    el.innerHTML = `<button class="cd-fold-h"><span class="arr">▸</span> ${worked} · ${row.count} step${row.count > 1 ? 's' : ''}</button><div class="cd-fold-b" hidden></div>`;
    const body = q('.cd-fold-b', el);
    q('.cd-fold-h', el).onclick = () => {
      const open = el.classList.toggle('open');
      if (open && !body.childElementCount) for (const c of row.children) body.appendChild(renderRow(ctx, c));
      body.hidden = !open;
      q('.arr', el).textContent = open ? '▾' : '▸';
    };
    return el;
  }

  if (row.kind === 'edits') {
    el.innerHTML = `<div class="cd-edits-h">Edited ${row.files.length} file${row.files.length > 1 ? 's' : ''}</div>`;
    for (const f of row.files) {
      const name = String(f.path || '').split('/').filter(Boolean).pop() || f.path;
      const { add, del } = f.diff ? diffCounts(f.diff) : { add: 0, del: 0 };
      const line = document.createElement('button');
      line.className = 'cd-edits-f';
      line.innerHTML = `<span class="n" title="${esc(f.path)}">${esc(name)}</span><span class="c"><span class="plus">+${add}</span> <span class="minus">−${del}</span></span>`;
      el.appendChild(line);
      if (f.diff) {
        const body = diffBody(f.diff);
        body.hidden = true;
        el.appendChild(body);
        line.onclick = () => { body.hidden = !body.hidden; };
      }
    }
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

  if (row.kind === 'note') {
    el.textContent = row.text;
    // A note that knows the repair offers it — hermes' own `--setup`, run in
    // a terminal tile, exactly as the protocol advertised it.
    if (row.action && row.action.command && ctx.onRunCommand) {
      const b = document.createElement('button');
      b.className = 'cd-note-act';
      b.textContent = row.action.label || row.action.command;
      b.onclick = () => ctx.onRunCommand(row.action.command);
      el.appendChild(b);
    }
    return el;
  }
  if (row.kind === 'error') { el.innerHTML = `<span class="m">✕</span><span class="tx"></span>`; q('.tx', el).textContent = row.text; return el; }

  if (row.kind === 'turn_end') {
    // The meter alone marks the boundary — the channel badge is session
    // state and lives in the tile head (.t-channel), said once.
    const meter = [`done in ${row.duration}`];
    if (row.costUsd) meter.push(`$${row.costUsd.toFixed(2)}`);
    if (row.tokens) meter.push(`${row.tokens.toLocaleString()} tok`);
    el.innerHTML = `<span class="cd-meter">${esc(meter.join(' · '))}</span>`;
    return el;
  }

  el.textContent = row.text || '';
  return el;
}

function shortPath(p) {
  const s = String(p || '');
  return s.replace(/^\/Users\/[^/]+/, '~');
}

function updateRow(ctx, el, row) {
  if (row.kind === 'permission') { updatePermission(ctx, el, row); return; }
  if (row.kind === 'tool') el.dataset.kd = row.toolKind || 'other';
  if (row.kind === 'intro') {
    const key = `${row.model}|${row.mode}|${row.note || ''}`;
    if (el.dataset.n !== key) { const fresh = renderRow(ctx, row); el.replaceWith(fresh); }
    return;
  }
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
  el.dataset.body = (row.body || hasDiff || (children && !row.pending)) ? '1' : '';
  // Rebuilt each update: a tool mutates once, when its result lands.
  open.innerHTML = '';
  if (hasDiff) open.appendChild(diffEl(row.diff));
  if (row.body) {
    const pre = document.createElement('pre');
    pre.className = 'cd-body';
    pre.textContent = row.body + (row.truncated ? '\n\n… cut here — the whole thing is in Term' : '');
    open.appendChild(pre);
  }
  // A sub-agent you can watch: while its Task still runs, the children are a
  // live indented lane in the open; once it finishes they fold behind the
  // click, like any other body.
  let lane = q('.cd-lane', el);
  if (children && row.pending) {
    if (!lane) { lane = document.createElement('div'); lane.className = 'cd-lane'; el.appendChild(lane); }
    lane.innerHTML = `<div class="cd-sub-t">sub-agent · live</div>`;
    for (const c of row.children) lane.appendChild(renderRow(ctx, c));
  } else if (lane) {
    lane.remove();
  }
  if (children && !row.pending) {
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
    pre.className = 'cd-body cd-perm-cmd clamp';
    pre.textContent = command;
    pre.title = 'Click to expand';
    pre.onclick = () => pre.classList.toggle('clamp');
    q('.cd-perm-diff', el).before(pre);
  }
  if (row.diff && (row.diff.oldText || row.diff.newText)) q('.cd-perm-diff', el).appendChild(diffEl(row.diff, { summary: true }));
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
    <div class="cd-working" hidden>
      <span class="cw-sp"></span>
      <span>Working… <b class="cw-el">0s</b><span class="cw-tk-wrap" hidden> · <span class="cw-tk">0</span> tok</span></span>
      <span class="cw-esc">esc to interrupt</span>
    </div>
    <div class="cd-menu" hidden></div>
    <div class="cd-picker" hidden></div>
    <div class="cd-ask">
      <span class="m">❯</span>
      <textarea class="cd-input" rows="1" placeholder="Reply to this session…" title="⏎ sends · ⌥⏎ new line · Esc interrupts · shift⇥ cycles mode · ⌘↑/⌘↓ walk your turns"></textarea>
      <button class="cd-mic-btn" title="Dictate into this session"><span class="uni-i">${MIC_SVG}</span><span class="pix-i">${pixIcon('mic')}</span></button>
      <button class="cd-send-btn" title="Send" disabled><span class="uni-i">${SEND_SVG}</span><span class="pix-i">${pixIcon('send')}</span></button>
    </div>
    <div class="cd-status" hidden>
      <span class="cs-mk">▸▸</span>
      <button class="cs-mode" title="Click or shift⇥ to cycle"></button>
      <span class="cs-kb">(shift⇥ cycles)</span>
      <span class="cs-dot cs-mdot" hidden>·</span>
      <button class="cs-model" title="Model — click for the picker"></button>
      <span class="cs-dot cs-ctxdot" hidden>·</span>
      <span class="cs-ctx" hidden></span>
      <span class="cs-right">/ commands · esc interrupts</span>
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

  // Filled means armed; empty means outline and muted. The textarea grows
  // with its draft — one line at rest, capped near six, scrolling past that —
  // so arm() (called at every value change) also re-measures.
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
  };
  const arm = () => { sendBtn.disabled = !input.value.trim(); grow(); };
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    arm();
    hideMenu();
    closePicker();
    ctx.onSend(text);
  };
  sendBtn.onclick = submit;
  micBtn.onclick = (e) => { e.stopPropagation(); ctx.onMic(); };

  // ---- the picker: the terminal's own selection surface, kept ---------------
  // Numbered choices with descriptions, the current one marked, ↑↓ to move
  // (disabled rows are skipped), ⏎ confirms, esc goes back, digits 1-9 jump.
  // One surface serves model, mode and resume — anything that is a choice.
  const pickerEl = q('.cd-picker', el);
  let picker = null; // { items:[{label,desc,cls,disabled,current,value}], idx, header, blurb, footer, onPick(item, i) }

  function openPicker(spec) {
    hideMenu();
    const items = spec.items || [];
    let idx = items.findIndex((it) => it.current && !it.disabled);
    if (idx < 0) idx = items.findIndex((it) => !it.disabled);
    picker = { ...spec, items, idx: Math.max(0, idx) };
    paintPicker();
    input.focus();
  }
  function closePicker() { picker = null; pickerEl.hidden = true; pickerEl.innerHTML = ''; }
  function paintPicker() {
    if (!picker) return;
    pickerEl.innerHTML =
      (picker.header ? `<div class="cd-pk-h"><b>${esc(picker.header)}</b>${picker.blurb ? `<p>${esc(picker.blurb)}</p>` : ''}</div>` : '') +
      `<div class="cd-pk-list">` +
      picker.items.map((it, i) =>
        `<button class="cd-pk-i${i === picker.idx ? ' on' : ''}${it.disabled ? ' dis' : ''}" data-i="${i}">
          <span class="pk-n">${i + 1}.</span>
          <span class="pk-l ${it.cls || ''}">${esc(it.label)}${it.current ? ' <span class="pk-cur">✓ current</span>' : ''}</span>
          ${it.desc ? `<span class="pk-d">${esc(it.desc)}</span>` : ''}
        </button>`).join('') +
      `</div><div class="cd-pk-f">${esc(picker.footer || '↑↓ choose · ⏎ confirms · esc goes back · 1-9 jump')}</div>`;
    pickerEl.hidden = false;
    pickerEl.querySelectorAll('.cd-pk-i').forEach((b) => {
      b.onclick = () => { const i = Number(b.dataset.i); if (!picker.items[i].disabled) pickPicker(i); };
    });
  }
  function movePicker(d) {
    if (!picker || !picker.items.length) return;
    let i = picker.idx;
    for (let k = 0; k < picker.items.length; k++) {
      i = (i + d + picker.items.length) % picker.items.length;
      if (!picker.items[i].disabled) break;
    }
    picker.idx = i; paintPicker();
  }
  function pickPicker(i) {
    const p2 = picker;
    const it = p2 && p2.items[i ?? p2.idx];
    if (!it || it.disabled) return;
    closePicker();
    if (p2.onPick) p2.onPick(it, i ?? p2.idx);
  }

  // ---- the menus: `/` commands with the agent's own descriptions and
  // argument hints; `@` completes files from the folder the session runs in.
  // One mechanism, keyboard-first: ↑↓ choose, ⇥/enter complete, esc closes.
  let menuItems = [];
  let menuIdx = 0;
  let menuKind = null;

  function paintMenu() {
    menu.innerHTML = menuItems.map((it, i) =>
      `<button class="cd-menu-i${i === menuIdx ? ' on' : ''}" data-i="${i}">
        <span class="mi-n">${esc(it.label)}</span>
        ${it.desc ? `<span class="mi-d">${esc(it.desc)}</span>` : ''}
        ${it.hint ? `<span class="mi-h">${esc(it.hint)}</span>` : ''}
      </button>`).join('') +
      `<div class="cd-menu-f">↑↓ choose · ⇥ completes · esc closes</div>`;
    menu.hidden = false;
    for (const b of menu.querySelectorAll('.cd-menu-i')) {
      b.onclick = () => pickMenu(Number(b.dataset.i));
    }
  }
  function pickMenu(i) {
    const it = menuItems[i ?? menuIdx];
    if (!it) return;
    if (menuKind === 'slash') input.value = '/' + it.name + ' ';
    else if (menuKind === 'file') {
      const at = input.selectionStart;
      input.value = input.value.slice(0, at).replace(/@[^\s@]*$/, '@' + it.name + ' ') + input.value.slice(at);
    }
    input.focus(); arm(); hideMenu(); refreshMenu();
  }
  function moveMenu(d) {
    if (!menuItems.length) return;
    menuIdx = (menuIdx + d + menuItems.length) % menuItems.length;
    menu.querySelectorAll('.cd-menu-i').forEach((el2, i) => el2.classList.toggle('on', i === menuIdx));
  }
  function hideMenu() { menu.hidden = true; menuItems = []; menuKind = null; menuIdx = 0; }

  // Commands arrive as strings or {name, description, argumentHint, route} —
  // the richer shape wins where the channel publishes it. A command that runs
  // somewhere other than this channel says so in the hint slot, so the menu
  // never promises what the send cannot do.
  const ROUTE_HINTS = { 'native-model': 'opens the picker', 'native-mode': 'switches mode', terminal: 'terminal' };
  function normCmd(c) {
    if (typeof c === 'string') return { name: c, desc: '', hint: '' };
    return {
      name: String(c.name || ''), desc: String(c.description || ''),
      hint: String(c.argumentHint || c.hint || '') || ROUTE_HINTS[c.route] || '',
    };
  }

  async function refreshMenu() {
    const v = input.value;
    const at = input.selectionStart ?? v.length;
    const word = v.slice(0, at).split(/\s/).pop();

    if (v.startsWith('/') && !v.includes(' ')) {
      const all = ((ctx.commands && ctx.commands()) || []).map(normCmd).filter((c) => c.name);
      const want = v.slice(1).toLowerCase();
      const hits = all.filter((c) => c.name.toLowerCase().startsWith(want)).slice(0, 9);
      if (!hits.length) { hideMenu(); return; }
      menuKind = 'slash'; menuIdx = 0;
      menuItems = hits.map((c) => ({ name: c.name, label: '/' + c.name, desc: c.desc, hint: c.hint }));
      paintMenu();
      return;
    }

    if (word.startsWith('@') && ctx.listFiles) {
      const q2 = word.slice(1);
      const files = await ctx.listFiles(q2);
      if (input.value !== v) return; // typed past us while listing
      if (!files || !files.length) { hideMenu(); return; }
      menuKind = 'file'; menuIdx = 0;
      menuItems = files.slice(0, 9).map((f) => ({ name: f.rel, label: '@' + f.rel, desc: f.desc || '' }));
      paintMenu();
      return;
    }
    hideMenu();
  }

  input.addEventListener('input', () => { arm(); refreshMenu(); });
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      jumpTurn(e.key === 'ArrowUp' ? -1 : 1); e.preventDefault(); e.stopPropagation(); return;
    }
    // A choice on screen owns the keyboard first — exactly like the TUI.
    if (picker) {
      if (e.key === 'ArrowDown') { movePicker(1); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'ArrowUp') { movePicker(-1); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { pickPicker(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') { closePicker(); e.preventDefault(); e.stopPropagation(); return; }
      if (/^[1-9]$/.test(e.key) && !input.value) {
        const i = Number(e.key) - 1;
        if (picker.items[i] && !picker.items[i].disabled) { picker.idx = i; paintPicker(); }
        e.preventDefault(); e.stopPropagation(); return;
      }
    }
    if (!menu.hidden) {
      if (e.key === 'ArrowDown') { moveMenu(1); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'ArrowUp') { moveMenu(-1); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Tab') { pickMenu(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Enter') { pickMenu(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape') { hideMenu(); e.preventDefault(); e.stopPropagation(); return; }
    }
    // An open approval card takes ↑↓/⏎ when the input is empty — arrow to an
    // option first, so a stray Enter can never approve anything by itself.
    if (!input.value && permNav(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const act = composerKeyAction(e, {});
    if (act === 'send') { e.preventDefault(); submit(); }
    else if (act === 'newline') {
      // inserted by hand, not left to the browser: ⌥⏎ is not a native
      // newline in a textarea, and ⇧⏎'s default would skip grow()
      e.preventDefault();
      const at = input.selectionStart ?? input.value.length;
      input.setRangeText('\n', at, input.selectionEnd ?? at, 'end');
      arm();
    } else if (e.key === 'Escape') { ctx.onInterrupt(); e.preventDefault(); }
    e.stopPropagation();
  });

  // ---- keyboard for the option cards (approvals, agent questions) -----------
  function openPermRow() {
    const rows = [...list.querySelectorAll('.cd-perm-open')];
    return rows.length ? rows[rows.length - 1] : null;
  }
  function permNav(e) {
    const row = openPermRow();
    if (!row) return false;
    const btns = [...row.querySelectorAll('.cd-perm-btn')];
    if (!btns.length) return false;
    let idx = btns.findIndex((b) => b.classList.contains('kb'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      idx = idx < 0 ? (e.key === 'ArrowDown' ? 0 : btns.length - 1)
        : (idx + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle('kb', i === idx));
      row.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'Enter' && idx >= 0) { btns[idx].click(); return true; }
    return false;
  }

  // ⌘↑ / ⌘↓ walk the conversation one of your turns at a time.
  function jumpTurn(dir) {
    const users = [...list.querySelectorAll('.cd-user')];
    if (!users.length) return;
    const top = list.scrollTop;
    let target = null;
    if (dir < 0) target = [...users].reverse().find((u) => u.offsetTop < top - 4) || users[0];
    else target = users.find((u) => u.offsetTop > top + 4) || users.at(-1);
    list.scrollTo({ top: target.offsetTop - 6, behavior: 'smooth' });
  }

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
    const live = new Set(rows.map((r) => r.id));
    for (const [id, rowEl] of rowEls) {
      if (!live.has(id)) { rowEl.remove(); rowEls.delete(id); }
    }
    for (const row of rows) {
      const seen = rowEls.get(row.id);
      if (seen) { updateRow(ctx, seen, row); continue; }
      const rowEl = renderRow(ctx, row);
      rowEls.set(row.id, rowEl);
      list.appendChild(rowEl);
    }
    if (stick) scrollToEnd(false);
  }

  function setNote(text, urgent, action) {
    note.textContent = text || '';
    if (action && action.label) {
      const b = document.createElement('button');
      b.className = 'cd-note-btn';
      b.textContent = action.label;
      b.onclick = action.run;
      note.appendChild(b);
    }
    note.hidden = !text && !action;
    note.classList.toggle('urgent', !!urgent);
  }

  // The status line — the terminal's own bottom line, kept: one fixed-height
  // strip of text under the input. It never wraps, never crowds the typing.
  const statusEl = q('.cd-status', el);
  const modelChip = q('.cs-model', el);
  const modeChip = q('.cs-mode', el);
  // Both chips open the same picker surface the /commands use — one selection
  // language everywhere, exactly like the TUI's numbered lists.
  modelChip.onclick = () => { if (ctx.onModelMenu) ctx.onModelMenu(); };
  modeChip.onclick = () => { if (ctx.onModePick) ctx.onModePick(modeChip); else if (ctx.onMode) ctx.onMode(); };
  function setStatus(st) {
    const models = st && st.models;
    const hasModel = !!(models && models.options && models.options.length) || !!(st && st.model);
    const hasMode = !!(st && st.mode);
    statusEl.hidden = !hasModel && !hasMode;
    if (hasModel) {
      const cur = models && Array.isArray(models.options) && models.options.find((m) => m.value === models.current);
      modelChip.textContent = (cur && (cur.name || cur.value)) || shortModel(st.model || (models && models.current) || '');
      modelChip.hidden = false;
    } else {
      modelChip.hidden = true;
    }
    const mdot = q('.cs-mdot', el);
    if (mdot) mdot.hidden = modelChip.hidden;
    if (hasMode) {
      modeChip.textContent = modeLabel(st.mode);
      modeChip.hidden = false;
      modeChip.disabled = !st.canSwitchMode;
      modeChip.className = 'cs-mode ' + modeClass(st.mode);
      modeChip.classList.toggle('warn', /bypass|skip/i.test(st.mode));
    } else {
      modeChip.hidden = true;
    }
    const ctxLbl = q('.cs-ctx', el), ctxDot = q('.cs-ctxdot', el);
    const show = st && typeof st.ctxPct === 'number';
    ctxLbl.hidden = ctxDot.hidden = !show;
    if (show) ctxLbl.textContent = st.ctxPct + '% ctx';
  }
  // shift⇥ cycles the mode from the keyboard, exactly like the TUI
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (ctx.onMode) ctx.onMode(); }
  });

  // The working line — the TUI's spinner, kept: elapsed always, live tokens
  // when the channel pulses them, and the way out named.
  const workEl = q('.cd-working', el);
  let workTimer = null, workStart = 0;
  function setWorking(on, tokens) {
    if (on) {
      if (workEl.hidden) {
        workEl.hidden = false;
        workStart = Date.now();
        q('.cw-el', workEl).textContent = '0s';
        q('.cw-tk-wrap', workEl).hidden = true;
        workTimer = setInterval(() => {
          q('.cw-el', workEl).textContent = Math.round((Date.now() - workStart) / 1000) + 's';
        }, 500);
      }
      if (typeof tokens === 'number' && tokens > 0) {
        q('.cw-tk-wrap', workEl).hidden = false;
        q('.cw-tk', workEl).textContent = tokens.toLocaleString();
      }
    } else {
      workEl.hidden = true;
      if (workTimer) { clearInterval(workTimer); workTimer = null; }
    }
  }

  return {
    el, list, input,
    feed, setNote, scrollToEnd, setStatus, setWorking,
    openPicker, closePicker,
    isEmpty: () => !list.children.length,
    insertText: (t) => {
      input.focus();
      try { document.execCommand('insertText', false, t); } catch (_) { input.value += t; }
      arm();
    },
    // − / + reach the cards too: every card font is `calc(Npx * var(--cdz))`
    // in paper.css, so one scale factor moves the whole vocabulary together.
    // 12 is the terminal's design size; the floor is higher than the
    // terminal's because 10.5px meters scaled to 8px stop being text.
    setFontSize: (px) => {
      const z = px ? Math.min(1.5, Math.max(0.9, px / 12)) : 1;
      if (z === 1) el.style.removeProperty('--cdz');
      else el.style.setProperty('--cdz', String(z));
    },
  };
}
