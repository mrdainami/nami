// Dainami CLI — the paper agent workbench (renderer, terminal-first).
// Every session is a real PTY (claude / shell / any harness), shown as a paper tile in a grid you
// can focus, reorder, and expand. Workspace is a live explorer + paper editor. Vanilla DOM; tiles
// (xterm + editors) are managed incrementally so live processes survive re-renders.

import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';

const api = window.dainami;

// ---- palette ---------------------------------------------------------------
const TINTS = ['#a9c0dc', '#a9c8a4', '#e3b0bd', '#ecc98d', '#dfa287', '#c0b3dc'];
let colorSeed = 3;
function nextTint() { colorSeed = (colorSeed + 1) % TINTS.length; return TINTS[colorSeed]; }

const XTERM_THEME = {
  background: 'rgba(0,0,0,0)', foreground: '#33302a', cursor: '#4a6b52', cursorAccent: '#fdf9ec',
  selectionBackground: 'rgba(120,145,180,0.35)',
  black: '#5a4b34', red: '#a8482f', green: '#4a7a4a', yellow: '#9a7420', blue: '#3f6088',
  magenta: '#8a5f8a', cyan: '#3f7d82', white: '#6f6553',
  brightBlack: '#8d8065', brightRed: '#b4503c', brightGreen: '#5f8f5f', brightYellow: '#a8792a',
  brightBlue: '#5a7fae', brightMagenta: '#a07aa0', brightCyan: '#5aa0a0', brightWhite: '#2f2b26',
};

// ---- harness profiles (extensible: Claude today, Hermes/others later) ------
const HARNESSES = [
  { id: 'claude', name: 'Claude Code', sub: 'your subscription · slash commands work', kind: 'claude', tint: TINTS[4], code: 'CC' },
  { id: 'shell', name: 'Terminal', sub: 'a plain shell, ink on paper', kind: 'shell', tint: TINTS[5], code: '❯' },
  { id: 'custom', name: 'Custom command…', sub: 'run any harness or program', kind: 'custom', tint: TINTS[0], code: '+' },
];

// ---- state -----------------------------------------------------------------
const S = {
  project: null, recents: [], claudeExe: null, demo: false,
  panels: [], activeId: null, expandedId: null,
  railTab: 'sessions', overlay: null, toast: null, seq: 0,
  tree: {}, expanded: new Set(),   // explorer: path -> children[], expanded dirs
};

let els = {};
const tileEls = new Map(); // panelId -> { root, head, body, term, fit, statusDot, ta, gutter }

function uid(p) { S.seq += 1; return `${p}${S.seq}`; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function shorten(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function code2(str) {
  const w = String(str || '').replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return (String(str || '?').replace(/[^a-zA-Z]/g, '').slice(0, 2) || 'SS').toUpperCase();
}
function hashIdx(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % TINTS.length; }
function baseNameOf(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '(file)'; }
function shortHome(p) { return String(p || '').replace(/^\/Users\/[^/]+/, '~'); }
function q(sel, root) { return (root || document).querySelector(sel); }

// ===========================================================================
//  Boot
// ===========================================================================
(async function boot() {
  buildShell();
  const b = await api.boot();
  S.demo = b.demo; S.claudeExe = b.claudeExe; S.recents = b.recentFolders || []; S.project = b.currentFolder || null;

  api.onTermData(({ id, data }) => { const t = tileEls.get(id); if (t && t.term) t.term.write(data); });
  api.onTermExit(({ id, code }) => {
    const p = S.panels.find((x) => x.id === id); if (!p) return;
    p.exited = true; p.status = 'exited';
    const t = tileEls.get(id); if (t && t.term) t.term.write(`\r\n\x1b[38;2;141;128;101m[process exited · ${code}]\x1b[0m\r\n`);
    refreshTileHead(p); refreshRail(); renderHeader();
  });

  if (S.demo) seedDemo();
  renderAll();
})();

// ===========================================================================
//  Static shell
// ===========================================================================
function buildShell() {
  document.getElementById('root').innerHTML = `
    <div class="desk"><div class="sheet">
      <div class="tape tape--left"></div><div class="tape tape--right"></div>
      <div class="topbar">
        <div class="brand"><span class="brand-name">Dainami CLI</span><span class="brand-sub">workbench</span></div>
        <div class="topbar-center" id="topbar-center"></div>
        <div class="topbar-right">
          <div class="live-badge" id="live-badge" style="display:none"><span class="dot"></span><span id="live-label"></span></div>
          <button class="btn" id="btn-agents">Agents ⌘K</button>
          <button class="btn btn--go" id="btn-new">＋ New session ⌘N</button>
        </div>
      </div>
      <div class="split">
        <div class="rail">
          <div class="rail-tabs">
            <button class="rail-tab active" data-tab="sessions">Sessions</button>
            <button class="rail-tab" data-tab="workspace">Workspace</button>
          </div>
          <div id="rail-content" style="flex:1;min-height:0;display:flex;flex-direction:column;"></div>
          <div id="agents-panel" class="agents-panel"></div>
        </div>
        <div class="main">
          <div class="grid" id="grid"></div>
          <div class="cmdbar">
            <div class="cmdbar-box" id="cmdbar-box"><span class="prompt-mark">❯</span>
              <input id="cmd-input" placeholder="Start a Claude session (type a first message) · /term · /run <cmd> · /open" />
              <button class="btn btn--go cmd-run" id="cmd-run">Start ⌘⏎</button></div>
            <div class="cmd-preview" id="cmd-preview"></div>
          </div>
          <div class="footer">
            <span>⌘N new</span><span>⌘K agents</span><span>⌘O folder</span><span>⌘⏎ start</span>
            <span>⌘W close pane</span><span>⌘S save</span><span class="path" id="footer-path"></span>
          </div>
        </div>
      </div>
      <div id="overlay-root"></div><div id="toast-root"></div>
    </div></div>`;

  els = {
    topbarCenter: q('#topbar-center'), liveBadge: q('#live-badge'), liveLabel: q('#live-label'),
    railContent: q('#rail-content'), agentsPanel: q('#agents-panel'), grid: q('#grid'),
    cmdInput: q('#cmd-input'), cmdPreview: q('#cmd-preview'), cmdbarBox: q('#cmdbar-box'),
    footerPath: q('#footer-path'), overlayRoot: q('#overlay-root'), toastRoot: q('#toast-root'),
  };
  q('#btn-new').onclick = () => openLauncher();
  q('#btn-agents').onclick = () => openAgentPicker();
  q('#cmd-run').onclick = () => runDraft();
  els.cmdInput.addEventListener('input', (e) => { S.draft = e.target.value; refreshCmdPreview(); });
  els.cmdInput.addEventListener('focus', () => els.cmdbarBox.classList.add('focused'));
  els.cmdInput.addEventListener('blur', () => els.cmdbarBox.classList.remove('focused'));
  els.cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runDraft(); } });
  document.querySelectorAll('.rail-tab').forEach((t) => { t.onclick = () => { S.railTab = t.dataset.tab; renderAll(); }; });
  document.addEventListener('keydown', onGlobalKey);
}

function onGlobalKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key === 'Enter') { e.preventDefault(); runDraft(); return; }
  if (meta && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); openLauncher(); return; }
  if (meta && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFolderDialog(); return; }
  if (meta && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openAgentPicker(); return; }
  if (meta && (e.key === 'w' || e.key === 'W')) { if (S.activeId) { e.preventDefault(); closePanel(S.activeId); } return; }
  if (meta && (e.key === 's' || e.key === 'S')) { const p = S.panels.find((x) => x.id === S.activeId); if (p && p.kind === 'editor') { e.preventDefault(); saveEditor(p); } return; }
  if (e.key === 'Escape') { if (S.overlay) { S.overlay = null; renderOverlay(); } else if (S.expandedId) { S.expandedId = null; renderGrid(); } }
}

// ===========================================================================
//  Render regions
// ===========================================================================
function renderAll() { renderHeader(); renderRail(); renderAgentsPanel(); renderGrid(); renderFooter(); renderOverlay(); refreshCmdPreview(); }

function renderHeader() {
  const p = S.project; els.topbarCenter.innerHTML = '';
  const chip = document.createElement('div'); chip.className = 'project-chip';
  chip.innerHTML = p
    ? `<span class="swatch" style="background:${TINTS[0]}"></span><span class="name">${esc(p.name)}</span><span class="path">${esc(p.pathShort)}</span><span class="caret">▼</span>`
    : `<span class="swatch" style="background:${TINTS[3]}"></span><span class="name">Open a folder</span><span class="caret">▼</span>`;
  chip.onclick = (e) => { e.stopPropagation(); toggleProjectsPop(); };
  els.topbarCenter.appendChild(chip);
  const live = S.panels.filter((x) => x.status === 'live' && x.kind !== 'editor').length;
  const attn = S.panels.filter((x) => x.attention).length;
  if (live > 0) { els.liveBadge.style.display = ''; els.liveLabel.textContent = attn ? `${attn} needs you` : `${live} live`; els.liveBadge.classList.toggle('attn', attn > 0); }
  else els.liveBadge.style.display = 'none';
}
function toggleProjectsPop() {
  const ex = q('.projects-pop', els.topbarCenter); if (ex) { ex.remove(); return; }
  const pop = document.createElement('div'); pop.className = 'projects-pop';
  const rows = (S.recents || []).map((r) => `<button class="project-row" data-path="${esc(r.path)}">
    <span class="swatch" style="background:${TINTS[hashIdx(r.path)]}"></span>
    <span class="col"><span class="name">${esc(r.name)}</span><span class="summary">${esc(r.pathShort)}</span></span><span class="mark">›</span></button>`).join('');
  pop.innerHTML = `<div class="pop-label">Recent folders</div>${rows || '<div class="rail-empty">No recent folders yet.</div>'}
    <button class="project-open-other" id="open-other"><span class="plus">＋</span><span>Open another folder…</span><span class="kbd">⌘O</span></button>`;
  els.topbarCenter.appendChild(pop);
  pop.querySelectorAll('.project-row').forEach((r) => { r.onclick = async () => { pop.remove(); await openFolder(r.dataset.path); }; });
  q('#open-other', pop).onclick = () => { pop.remove(); openFolderDialog(); };
  setTimeout(() => document.addEventListener('click', function off() { pop.remove(); document.removeEventListener('click', off); }, { once: true }), 0);
}

function renderRail() { document.querySelectorAll('.rail-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === S.railTab)); refreshRail(); }
function refreshRail() {
  const c = els.railContent; c.innerHTML = '';
  if (S.railTab === 'sessions') return refreshSessionsRail(c);
  return refreshWorkspaceRail(c);
}
function refreshSessionsRail(c) {
  const head = document.createElement('div'); head.className = 'rail-head';
  head.innerHTML = `<span class="title">Sessions</span>${S.panels.length ? '<span class="action" id="clear-all">close finished</span>' : ''}`;
  c.appendChild(head);
  const cl = q('#clear-all', head); if (cl) cl.onclick = closeFinished;
  if (!S.panels.length) { const e = document.createElement('div'); e.className = 'rail-empty'; e.textContent = 'No sessions yet. Press ⌘N, or type a message below.'; c.appendChild(e); return; }
  const list = document.createElement('div'); list.className = 'rail-list';
  for (const p of S.panels) {
    const m = statusMeta(p);
    const row = document.createElement('div');
    row.className = 'nav-card' + (p.id === S.activeId ? ' active' : '') + (p.attention ? ' attn' : '');
    row.innerHTML = `<span class="code" style="background:${p.tint}">${esc(p.code)}</span>
      <span class="col"><span class="goal">${esc(shorten(p.title, 30))}</span><span class="sid">${esc(kindLabel(p))}</span></span>
      <span class="status" style="color:${m.color}">${p.attention ? '● ' : ''}${esc(m.label)}</span>`;
    row.onclick = () => focusPanel(p.id);
    list.appendChild(row);
  }
  c.appendChild(list);
}
function refreshWorkspaceRail(c) {
  const p = S.project;
  const wrap = document.createElement('div'); wrap.className = 'tree';
  if (!p) { wrap.innerHTML = '<div class="rail-empty">Open a folder (⌘O) to browse and edit files.</div>'; c.appendChild(wrap); return; }
  const head = document.createElement('div'); head.className = 'tree-path'; head.textContent = p.pathShort; wrap.appendChild(head);
  renderTreeLevel(wrap, p.path, 0);
  c.appendChild(wrap);
}
function renderTreeLevel(container, dir, depth) {
  const children = S.tree[dir];
  if (!children) return;
  for (const n of children) {
    const row = document.createElement('div'); row.className = 'tree-row';
    row.style.paddingLeft = (6 + depth * 13) + 'px';
    const isOpen = S.expanded.has(n.path);
    const glyph = n.kind === 'dir' ? (isOpen ? '▾' : '▸') : '';
    row.innerHTML = `<span class="tw">${glyph}</span><span class="icon" style="background:${n.kind === 'dir' ? '#e8dfc7' : '#f0e7d0'}"></span>
      <span class="name" style="font-weight:${n.kind === 'dir' ? 700 : 400}">${esc(n.name)}</span><span class="meta">${esc(n.meta)}</span>`;
    row.onclick = () => { if (n.kind === 'dir') toggleDir(n.path); else openEditor(n.path); };
    container.appendChild(row);
    if (n.kind === 'dir' && isOpen) renderTreeLevel(container, n.path, depth + 1);
  }
}
async function toggleDir(dir) {
  if (S.expanded.has(dir)) { S.expanded.delete(dir); refreshRail(); return; }
  if (!S.tree[dir]) S.tree[dir] = await api.listDir(dir);
  S.expanded.add(dir); refreshRail();
}

function renderAgentsPanel() {
  const p = S.project; const el = els.agentsPanel; const agents = (p && p.agents) || [];
  el.innerHTML = `<div class="head"><span class="title">Agents on file</span><span class="count">${agents.length}</span></div>
    <div class="from">${p ? 'read from ' + esc(p.pathShort) + '/.claude' : 'open a folder to read .claude'}</div>
    <div class="list" id="agents-list"></div>`;
  const list = q('#agents-list', el);
  if (!agents.length) { list.innerHTML = `<div class="rail-empty" style="padding:2px 0">No agents found${p ? '' : ' yet'}.</div>`; return; }
  for (const a of agents) {
    const row = document.createElement('div'); row.className = 'agent-row';
    row.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.slug)]}">${esc(code2(a.name))}</span>
      <span class="col"><span class="name">${esc(a.name)}</span><span class="tools">${esc(a.tools || a.desc || '')}</span></span><span class="chev">›</span>`;
    row.onclick = () => startPanel({ kind: 'claude', title: a.name + ' session', code: code2(a.name), tint: TINTS[hashIdx(a.slug)], seed: `Use the ${a.slug} agent.` });
    list.appendChild(row);
  }
}
function renderFooter() { els.footerPath.textContent = S.project ? S.project.pathShort : (S.claudeExe ? 'claude ready' : 'no folder open'); }

// ===========================================================================
//  Grid of tiles
// ===========================================================================
function statusMeta(p) {
  if (p.kind === 'editor') return { label: p.dirty ? 'unsaved' : 'file', color: p.dirty ? '#a8792a' : '#8d8065' };
  if (p.exited) return { label: 'closed', color: '#8d8065' };
  if (p.attention) return { label: 'needs you', color: '#a8792a' };
  return { label: 'live', color: '#4a7a4a' };
}
function kindLabel(p) {
  if (p.kind === 'editor') return 'editor · ' + baseNameOf(p.filePath);
  if (p.kind === 'claude') return 'claude · ' + shortHome(p.cwd);
  if (p.kind === 'shell') return 'terminal · ' + shortHome(p.cwd);
  if (p.kind === 'harness') return (p.program ? baseNameOf(p.program) : 'harness') + ' · ' + shortHome(p.cwd);
  return 'run · ' + shortHome(p.cwd);
}

function renderGrid() {
  if (!S.panels.length) {
    tileEls.forEach((t) => t.root.remove()); tileEls.clear();
    els.grid.classList.remove('has-focus');
    els.grid.innerHTML = `<div class="lane-empty"><div class="polaroid">nothing open</div>
      <div><div class="big">Start a session</div><div class="hint">Type a message below and press Enter — it opens a real Claude session, right here. ⌘N for terminals & harnesses.</div></div></div>`;
    return;
  }
  if (q('.lane-empty', els.grid)) els.grid.innerHTML = '';
  for (const [id, t] of tileEls) { if (!S.panels.find((p) => p.id === id)) { t.root.remove(); tileEls.delete(id); } }
  els.grid.classList.toggle('has-focus', !!S.expandedId);
  for (const p of S.panels) {
    if (!tileEls.has(p.id)) mountTile(p);
    const t = tileEls.get(p.id);
    t.root.classList.toggle('focused', p.id === S.expandedId);
    t.root.classList.toggle('active', p.id === S.activeId);
    els.grid.appendChild(t.root);
    refreshTileHead(p);
    if (t.fit) requestAnimationFrame(() => { try { t.fit.fit(); } catch (_) {} });
  }
}

function mountTile(p) {
  const root = document.createElement('div'); root.className = 'tile'; root.dataset.id = p.id;
  root.innerHTML = `<div class="tile-head" draggable="true">
      <span class="code" style="background:${p.tint}">${esc(p.code)}</span>
      <span class="col"><span class="t-title">${esc(p.title)}</span><span class="t-sub"></span></span>
      <span class="t-status"><span class="dot"></span><span class="lbl"></span></span>
      <button class="t-btn t-expand" title="Expand">⤢</button>
      <button class="t-btn t-close" title="Close">✕</button>
    </div><div class="tile-body"></div>`;
  const head = q('.tile-head', root), body = q('.tile-body', root);
  const rec = { root, head, body, term: null, fit: null, statusDot: q('.t-status .dot', head), ta: null, gutter: null };
  tileEls.set(p.id, rec);
  q('.t-expand', head).onclick = (e) => { e.stopPropagation(); S.expandedId = S.expandedId === p.id ? null : p.id; renderGrid(); };
  q('.t-close', head).onclick = (e) => { e.stopPropagation(); closePanel(p.id); };
  head.addEventListener('mousedown', (e) => { if (!e.target.closest('.t-btn')) focusPanel(p.id, false); });
  // drag reorder
  head.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; root.classList.add('dragging'); });
  head.addEventListener('dragend', () => root.classList.remove('dragging'));
  root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drop-hint'); });
  root.addEventListener('dragleave', () => root.classList.remove('drop-hint'));
  root.addEventListener('drop', (e) => { e.preventDefault(); root.classList.remove('drop-hint'); reorderPanels(e.dataTransfer.getData('text/plain'), p.id); });

  if (p.kind === 'editor') mountEditor(p, rec); else mountTerminal(p, rec);
}

function refreshTileHead(p) {
  const t = tileEls.get(p.id); if (!t) return;
  const m = statusMeta(p);
  q('.t-title', t.head).textContent = p.title + (p.kind === 'editor' && p.dirty ? ' •' : '');
  q('.t-sub', t.head).textContent = kindLabel(p);
  q('.t-status .lbl', t.head).textContent = m.label;
  t.statusDot.style.background = m.color;
  t.root.classList.toggle('attention', !!p.attention);
  t.root.classList.toggle('exited', !!p.exited);
}

// ---- terminal tiles --------------------------------------------------------
function mountTerminal(p, rec) {
  const term = new Terminal({ fontFamily: "'Courier Prime','Courier New',monospace", fontSize: 13, lineHeight: 1.2, theme: XTERM_THEME, cursorBlink: true, allowTransparency: true, scrollback: 6000 });
  const fit = new FitAddon(); term.loadAddon(fit); term.open(rec.body); rec.term = term; rec.fit = fit;
  requestAnimationFrame(() => { try { fit.fit(); } catch (_) {} startProcess(p, term.cols, term.rows); });
  term.onData((d) => { clearAttention(p); api.termWrite({ id: p.id, data: d }); });
  term.onResize(({ cols, rows }) => api.termResize({ id: p.id, cols, rows }));
  term.onBell(() => setAttention(p));
  const ro = new ResizeObserver(() => { try { fit.fit(); } catch (_) {} }); ro.observe(rec.body);
}
async function startProcess(p, cols, rows) {
  if (p.started) return; p.started = true;
  await api.termCreate({ id: p.id, cwd: p.cwd, cols, rows, kind: p.kind, command: p.command, program: p.program, args: p.args, seed: p.seed });
}
function setAttention(p) { if (p.id === S.activeId) return; p.attention = true; refreshTileHead(p); refreshRail(); renderHeader(); }
function clearAttention(p) { if (!p.attention) return; p.attention = false; refreshTileHead(p); refreshRail(); renderHeader(); }

// ---- editor tiles ----------------------------------------------------------
function mountEditor(p, rec) {
  const wrap = document.createElement('div'); wrap.className = 'editor';
  wrap.innerHTML = `<div class="ed-gutter"></div><textarea class="ed-area" spellcheck="false"></textarea>
    <div class="ed-bar"><span class="ed-path">${esc(shortHome(p.filePath))}</span><button class="btn btn--go ed-save">Save ⌘S</button></div>`;
  rec.body.appendChild(wrap);
  const ta = q('.ed-area', wrap), gutter = q('.ed-gutter', wrap);
  rec.ta = ta; rec.gutter = gutter;
  ta.value = p.text || '';
  const sync = () => { const lines = ta.value.split('\n').length; gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join(''); gutter.scrollTop = ta.scrollTop; };
  ta.addEventListener('input', () => { p.text = ta.value; if (!p.dirty) { p.dirty = true; refreshTileHead(p); refreshRail(); } sync(); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveEditor(p); }
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2; p.text = ta.value; sync(); }
  });
  ta.addEventListener('focus', () => { S.activeId = p.id; refreshRail(); });
  q('.ed-save', wrap).onclick = () => saveEditor(p);
  sync();
}
async function saveEditor(p) {
  const res = await api.saveFile({ file: p.filePath, text: p.text });
  if (res && res.ok) { p.dirty = false; refreshTileHead(p); refreshRail(); toast('Saved ' + baseNameOf(p.filePath)); }
  else toast('Save failed: ' + (res && res.error || '?'));
}

// ===========================================================================
//  Panel lifecycle
// ===========================================================================
function startPanel(opts) {
  const p = Object.assign({
    id: uid('p_'), kind: 'claude', tint: opts.tint || nextTint(), code: opts.code || code2(opts.title || 'SS'),
    title: opts.title || 'Session', cwd: opts.cwd || (S.project && S.project.path), status: 'live',
    attention: false, exited: false, started: false, command: opts.command, program: opts.program, args: opts.args, seed: opts.seed,
  }, opts);
  S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
  renderGrid(); renderRail(); renderHeader(); refreshCmdPreview();
  return p;
}
async function openEditor(filePath) {
  const existing = S.panels.find((p) => p.kind === 'editor' && p.filePath === filePath);
  if (existing) { focusPanel(existing.id); return; }
  const res = await api.rawFile(filePath);
  if (!res.ok) { toast(res.error || 'Could not open'); return; }
  const p = { id: uid('p_'), kind: 'editor', tint: TINTS[hashIdx(filePath)], code: 'ED', title: baseNameOf(filePath), filePath, text: res.text, dirty: false, status: 'live', cwd: S.project && S.project.path };
  S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
  renderGrid(); renderRail(); renderHeader();
}
function focusPanel(id, scroll = true) {
  S.activeId = id; renderRail();
  for (const [pid, t] of tileEls) t.root.classList.toggle('active', pid === id);
  const t = tileEls.get(id); if (t) { const p = S.panels.find((x) => x.id === id); clearAttention(p); if (scroll) t.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); if (t.term) t.term.focus(); else if (t.ta) t.ta.focus(); }
  refreshCmdPreview();
}
function closePanel(id) {
  const p = S.panels.find((x) => x.id === id); if (!p) return;
  if (p.kind === 'editor' && p.dirty && !confirm(`Discard unsaved changes to ${baseNameOf(p.filePath)}?`)) return;
  if (p.kind !== 'editor') api.termKill({ id });
  const t = tileEls.get(id); if (t) { t.root.remove(); tileEls.delete(id); }
  S.panels = S.panels.filter((x) => x.id !== id);
  if (S.activeId === id) S.activeId = S.panels[0] ? S.panels[0].id : null;
  if (S.expandedId === id) S.expandedId = null;
  renderGrid(); renderRail(); renderHeader();
}
function closeFinished() {
  const gone = S.panels.filter((p) => p.exited || (p.kind === 'editor' && !p.dirty && false));
  for (const p of gone) closePanel(p.id);
  if (!gone.length) toast('Nothing finished to close.');
}
function reorderPanels(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const from = S.panels.findIndex((p) => p.id === fromId), to = S.panels.findIndex((p) => p.id === toId);
  if (from < 0 || to < 0) return;
  const [m] = S.panels.splice(from, 1); S.panels.splice(to, 0, m);
  renderGrid();
}

// ===========================================================================
//  Command bar + launcher
// ===========================================================================
async function runDraft() {
  const v = (els.cmdInput.value || '').trim(); if (!v) { openLauncher(); return; }
  els.cmdInput.value = ''; S.draft = ''; refreshCmdPreview();
  if (v.startsWith('/')) {
    const [cmd, ...rest] = v.slice(1).split(' '); const arg = rest.join(' ').trim();
    if (cmd === 'term') return startPanel({ kind: 'shell', title: 'Terminal', code: '❯', tint: TINTS[5] });
    if (cmd === 'run') return arg ? startPanel({ kind: 'run', title: shorten(arg, 24), code: 'RN', command: arg }) : toast('usage: /run <command>');
    if (cmd === 'open') return openFolderDialog();
    if (cmd === 'agents') return openAgentPicker();
    if (cmd === 'new') return openLauncher();
    if (cmd === 'help') return toast('type a message → Claude · /term · /run <cmd> · /open · /agents');
    return toast('Unknown command: /' + cmd);
  }
  if (!(await ensureFolder())) return;
  startPanel({ kind: 'claude', title: shorten(v, 30), code: 'CC', tint: TINTS[4], seed: v });
}
async function ensureFolder() {
  if (S.project) return true;
  const info = await api.pickFolder(); if (!info) { toast('Open a folder to start a session.'); return false; }
  applyProject(info); return true;
}
function refreshCmdPreview() {
  const v = (S.draft || '').trim();
  if (v.startsWith('/')) { els.cmdPreview.textContent = 'command'; return; }
  els.cmdPreview.textContent = S.project ? `→ new Claude session in ${S.project.name} · ⌘N for terminals & harnesses` : '→ Enter picks a folder, then opens a Claude session';
}

function openLauncher() { S.overlay = { type: 'launcher' }; renderOverlay(); els.cmdInput.blur(); }
function renderLauncher() {
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">＋</span><span style="font-weight:700">New session</span>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)">${S.project ? esc(S.project.name) : 'no folder'}</span></div>
    <div class="picker-list" id="lc-list"></div>`, { top: true });
  const list = q('#lc-list', modal);
  for (const h of HARNESSES) {
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="code" style="background:${h.tint}">${esc(h.code)}</span>
      <span class="col"><span class="name">${esc(h.name)}</span><span class="desc">${esc(h.sub)}</span></span>`;
    row.onclick = async () => { closeOverlay(); if (!(await ensureFolder())) return; launchHarness(h); };
    list.appendChild(row);
  }
}
async function launchHarness(h) {
  if (h.kind === 'custom') {
    const cmd = prompt('Command to run (e.g. hermes, npm run dev, python x.py):');
    if (!cmd || !cmd.trim()) return;
    return startPanel({ kind: 'run', title: shorten(cmd.trim(), 24), code: code2(cmd), command: cmd.trim() });
  }
  if (h.kind === 'claude') return startPanel({ kind: 'claude', title: 'Claude session', code: 'CC', tint: h.tint });
  return startPanel({ kind: 'shell', title: 'Terminal', code: '❯', tint: h.tint });
}

// ---- agent picker (⌘K) -----------------------------------------------------
function openAgentPicker() { S.overlay = { type: 'agents', query: '', hi: 0 }; renderOverlay(); }
function renderAgentPickerSheet() {
  const o = S.overlay; const agents = (S.project && S.project.agents) || [];
  const filtered = agents.filter((a) => (a.name + ' ' + (a.desc || '')).toLowerCase().includes(o.query.toLowerCase()));
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">❯</span><input id="ap-input" placeholder="Start a session with which agent?" value="${esc(o.query)}" /></div><div class="picker-list" id="ap-list"></div>`, { top: true });
  const input = q('#ap-input', modal); setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.query = input.value; o.hi = 0; renderOverlay(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = filtered[o.hi]; if (a) { closeOverlay(); startPanel({ kind: 'claude', title: a.name + ' session', code: code2(a.name), tint: TINTS[hashIdx(a.slug)], seed: `Use the ${a.slug} agent.` }); } }
    if (e.key === 'ArrowDown') { o.hi = Math.min(filtered.length - 1, o.hi + 1); renderOverlay(); }
    if (e.key === 'ArrowUp') { o.hi = Math.max(0, o.hi - 1); renderOverlay(); }
  });
  const list = q('#ap-list', modal);
  if (!filtered.length) { list.innerHTML = `<div class="rail-empty" style="padding:14px">${agents.length ? 'No match.' : 'No agents in this folder.'}</div>`; return; }
  filtered.forEach((a, i) => {
    const row = document.createElement('div'); row.className = 'picker-row' + (i === o.hi ? ' hilite' : '');
    row.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.slug)]}">${esc(code2(a.name))}</span><span class="col"><span class="name">${esc(a.name)}</span><span class="desc">${esc(a.desc || a.tools || '')}</span></span>`;
    row.onclick = () => { closeOverlay(); startPanel({ kind: 'claude', title: a.name + ' session', code: code2(a.name), tint: TINTS[hashIdx(a.slug)], seed: `Use the ${a.slug} agent.` }); };
    list.appendChild(row);
  });
}

// ---- overlays --------------------------------------------------------------
function renderOverlay() {
  els.overlayRoot.innerHTML = ''; const o = S.overlay; if (!o) return;
  if (o.type === 'launcher') return renderLauncher();
  if (o.type === 'agents') return renderAgentPickerSheet();
}
function closeOverlay() { S.overlay = null; renderOverlay(); }
function overlay(cls, inner, opts) {
  const wrap = document.createElement('div'); wrap.className = 'overlay' + (opts && opts.top ? ' overlay--top' : ''); wrap.onclick = closeOverlay;
  const modal = document.createElement('div'); modal.className = cls; modal.onclick = (e) => e.stopPropagation(); modal.innerHTML = inner;
  wrap.appendChild(modal); els.overlayRoot.appendChild(wrap); return modal;
}

// ---- folders ---------------------------------------------------------------
async function openFolderDialog() { const info = await api.pickFolder(); if (info) applyProject(info); }
async function openFolder(path) { const info = await api.openFolder(path); if (info) applyProject(info); }
function applyProject(info) {
  S.project = info; S.tree = {}; S.expanded = new Set();
  S.recents = [{ path: info.path, pathShort: info.pathShort, name: info.name }, ...S.recents.filter((r) => r.path !== info.path)].slice(0, 8);
  S.tree[info.path] = info.tree && info.tree.length && info.tree[0].path ? info.tree : null;
  // load root level fresh for the explorer
  api.listDir(info.path).then((rows) => { S.tree[info.path] = rows; if (S.railTab === 'workspace') refreshRail(); });
  renderAll();
}

// ---- toast -----------------------------------------------------------------
let toastTimer = null;
function toast(msg) { els.toastRoot.innerHTML = `<div class="toast"><span class="dot"></span><span class="msg">${esc(msg)}</span></div>`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { els.toastRoot.innerHTML = ''; }, 2200); }

// ===========================================================================
//  Demo seed (screenshot / preview)
// ===========================================================================
function seedDemo() {
  S.project = { path: '/Users/calvin/work/atlas', pathShort: '~/work/atlas', name: 'Atlas', hasClaude: true, tree: [], agents: [
    { slug: 'collector', name: 'collector', desc: 'Pulls structured data off pages', tools: 'browser · files · shell' },
    { slug: 'engineer', name: 'engineer', desc: 'Edits the repo, runs tests, opens a PR', tools: 'claude code · git' },
    { slug: 'researcher', name: 'researcher', desc: 'Reads the web and writes a brief', tools: 'web · sources' },
  ], skills: [] };
  S.recents = [{ path: '/Users/calvin/work/atlas', pathShort: '~/work/atlas', name: 'Atlas' }];
  // A claude tile + an editor tile so the paper grid reads clearly.
  const c = { id: uid('p_'), kind: 'shell', tint: TINTS[4], code: 'CC', title: 'Claude session', cwd: '/Users/calvin/work/atlas', status: 'live', started: true, attention: true, _demoText: true };
  const e = { id: uid('p_'), kind: 'editor', tint: TINTS[1], code: 'ED', title: 'passkey.ts', filePath: '/Users/calvin/work/atlas/src/auth/passkey.ts', dirty: true, status: 'live',
    text: `import { verifyRegistration } from './webauthn'\n\nexport async function register(user: User) {\n  const options = await createOptions(user)\n  const cred = await navigator.credentials.create({ publicKey: options })\n  return verifyRegistration(cred)\n}\n` };
  S.panels = [c, e]; S.activeId = c.id;
  // paint a paper "claude" banner into the demo terminal after mount
  setTimeout(() => { const t = tileEls.get(c.id); if (t && t.term) t.term.write('\x1b[38;2;168;121;42m✻ Welcome to Claude Code\x1b[0m\r\n\r\n  \x1b[38;2;74;107;82m❯\x1b[0m Compare our pricing with the top 20 competitors\r\n\r\n  \x1b[38;2;74;122;74m✓\x1b[0m Read pricing.csv (187 rows)\r\n  \x1b[38;2;74;122;74m✓\x1b[0m Lined up 20 competitor sites\r\n  \x1b[38;2;168;121;42m●\x1b[0m Building your spreadsheet…\r\n\r\n  \x1b[38;2;141;128;101mType / for commands · esc to interrupt\x1b[0m\r\n'); }, 500);
}
