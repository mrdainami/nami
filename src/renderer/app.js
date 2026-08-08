// Dainami CLI — the paper agent workbench (renderer, terminal-first).
// Every session is a real PTY (claude / shell / any harness), shown as a paper tile in a grid you
// can focus, reorder, and expand. Workspace is a live explorer + paper editor. Vanilla DOM; tiles
// (xterm + editors) are managed incrementally so live processes survive re-renders.

import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
import { fileKind, shellQuote, fileUrl } from './file-kinds.mjs';
import { parseDoc, getField, setField, serializeDoc } from './frontmatter.mjs';
import { resolveOpen } from './peek-core.mjs';
import { buildCreateSeed, buildImproveSeed } from './seed-text.mjs';

const api = window.dainami;

// ---- palette ---------------------------------------------------------------
const TINTS = ['#a9c0dc', '#a9c8a4', '#e3b0bd', '#ecc98d', '#dfa287', '#c0b3dc'];
let colorSeed = 3;
function nextTint() { colorSeed = (colorSeed + 1) % TINTS.length; return TINTS[colorSeed]; }

const XTERM_THEME = {
  // Transparent, but with the paper's RGB channels: xterm's minimumContrastRatio
  // measures against this color, so faint dark-theme TUI text gets re-inked for cream.
  background: 'rgba(253,249,236,0)', foreground: '#33302a', cursor: '#4a6b52', cursorAccent: '#fdf9ec',
  selectionBackground: 'rgba(120,145,180,0.35)',
  black: '#5a4b34', red: '#a8482f', green: '#4a7a4a', yellow: '#9a7420', blue: '#3f6088',
  magenta: '#8a5f8a', cyan: '#3f7d82', white: '#6f6553',
  brightBlack: '#8d8065', brightRed: '#b4503c', brightGreen: '#5f8f5f', brightYellow: '#a8792a',
  brightBlue: '#5a7fae', brightMagenta: '#a07aa0', brightCyan: '#5aa0a0', brightWhite: '#2f2b26',
};

// ---- launcher rows ---------------------------------------------------------
// Agents come from the detected registry (S.agents); only Terminal is static.
// Big rows are things that run right now; small cards are things you could add.
const EVERGREEN_ROWS = [
  { id: 'shell', name: 'Terminal', sub: 'a plain shell, ink on paper', kind: 'shell', tint: TINTS[5], code: '❯' },
];

// ---- state -----------------------------------------------------------------
const S = {
  project: null, recents: [], claudeExe: null, demo: false,
  panels: [], activeId: null, expandedId: null,
  railTab: 'sessions', overlay: null, toast: null, seq: 0,
  agents: null, agentsLoading: false,   // detected agent CLIs (null until first scan)
  tree: {}, expanded: new Set(),   // explorer: path -> children[], expanded dirs
  library: { items: [], edges: [], q: '', loaded: false, loading: false, collapsed: new Set(['plugins']) },
  services: { catalog: [], connected: [], loading: false },   // connect-a-service state
  railCollapsed: false,
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

// ---- OS file drops ---------------------------------------------------------
function isFileDrag(e) { return Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files'); }
function droppedPaths(e) {
  return Array.from((e.dataTransfer && e.dataTransfer.files) || [])
    .map((f) => api.droppedFilePath(f)).filter(Boolean);
}
function dropFilesOnPanel(p, paths) {
  if (p.kind === 'editor' || p.kind === 'viewer') { paths.forEach((f) => openFile(f, { pin: true })); return; }
  injectToSession(p, paths.map(shellQuote).join(' ') + ' ');
  toast('Dropped ' + (paths.length === 1 ? baseNameOf(paths[0]) : paths.length + ' files') + ' into ' + shorten(p.title, 24));
}

// ===========================================================================
//  Boot
// ===========================================================================
(async function boot() {
  buildShell();
  const b = await api.boot();
  S.demo = b.demo; S.claudeExe = b.claudeExe; S.recents = b.recentFolders || []; S.project = b.currentFolder || null; S.stt = b.stt;
  if (b.collapsed) S.railCollapsed = true;

  api.onAiEvent((ev) => {
    const p = S.panels.find((x) => x.id === ev.sessionId); if (!p) return;
    (p.log = p.log || []).push(ev);
    renderAiEvent(p, ev);
    if (ev.kind === 'result') { p.busy = false; refreshTileHead(p); }
    if (ev.kind === 'permission') setAttention(p);
  });
  api.onTermData(({ id, data }) => { const t = tileEls.get(id); if (t && t.term) t.term.write(data); });
  api.onTermExit(({ id, code }) => {
    const p = S.panels.find((x) => x.id === id); if (!p) return;
    p.exited = true; p.status = 'exited';
    const t = tileEls.get(id); if (t && t.term) t.term.write(`\r\n\x1b[38;2;141;128;101m[process exited · ${code}]\x1b[0m\r\n`);
    refreshTileHead(p); refreshRail(); renderHeader();
  });

  if (S.demo) seedDemo();
  refreshAgents();   // pre-detect so ⌘N is instant
  refreshServices(); // services group in the library + connect sheets
  renderAll();
  if (!S.demo && Array.isArray(b.panels) && b.panels.length) restorePanels(b.panels);
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
        <div class="rail" id="rail">
          <button class="rail-strip" id="rail-strip" title="Show sidebar">›</button>
          <div class="rail-tabs">
            <button class="rail-tab active" data-tab="sessions">Sessions</button>
            <button class="rail-tab" data-tab="workspace">Workspace</button>
            <button class="rail-tab" data-tab="library">Library</button>
            <button class="rail-collapse" id="rail-collapse" title="Hide sidebar">‹</button>
          </div>
          <div id="rail-content"></div>
        </div>
        <div class="main">
          <div class="grid" id="grid"></div>
          <div class="footer">
            <span>⌘N new session</span><span>⌘K agents</span><span>⌘O folder</span>
            <span>⌘W close pane</span><span>⌘S save</span><span class="path" id="footer-path"></span>
          </div>
        </div>
      </div>
      <div id="overlay-root"></div><div id="toast-root"></div>
    </div></div>`;

  els = {
    topbarCenter: q('#topbar-center'), liveBadge: q('#live-badge'), liveLabel: q('#live-label'),
    railContent: q('#rail-content'), grid: q('#grid'),
    footerPath: q('#footer-path'), overlayRoot: q('#overlay-root'), toastRoot: q('#toast-root'),
  };
  q('#btn-new').onclick = () => openLauncher();
  q('#btn-agents').onclick = () => openAgentPicker();
  document.querySelectorAll('.rail-tab').forEach((t) => { t.onclick = () => { S.railTab = t.dataset.tab; if (t.dataset.tab === 'library') loadLibrary(true); renderAll(); }; });
  q('#rail-collapse').onclick = () => { S.railCollapsed = true; applyChrome(); };
  q('#rail-strip').onclick = () => { S.railCollapsed = false; applyChrome(); };
  document.addEventListener('keydown', onGlobalKey);

  // OS file drops: never let Electron navigate away on a stray drop.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  // Dropping on empty canvas opens the file as a viewer/editor tile
  // (tile drops stopPropagation, so this only fires outside tiles).
  els.grid.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  els.grid.addEventListener('drop', (e) => {
    const paths = droppedPaths(e); if (!paths.length) return;
    e.preventDefault(); paths.forEach((f) => openFile(f, { pin: true }));
  });
  applyChrome();
}

function applyChrome() {
  const sheet = q('.sheet');
  sheet.classList.toggle('rail-collapsed', S.railCollapsed);
  // tiles need a re-fit when the grid width changes
  setTimeout(() => tileEls.forEach((t) => { if (t.fit) { try { t.fit.fit(); } catch (_) {} } }), 60);
}

function onGlobalKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); openLauncher(); return; }
  if (meta && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFolderDialog(); return; }
  if (meta && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openAgentPicker(); return; }
  if (meta && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); if (S.overlay && S.overlay.type === 'peek') requestClosePeek(); else if (S.activeId) closePanel(S.activeId); return; }
  if (meta && (e.key === 's' || e.key === 'S')) { const pk = S.overlay && S.overlay.type === 'peek' && S.overlay.panel; if (pk && pk.kind === 'editor') { e.preventDefault(); saveEditor(pk); return; } if (pk && pk.kind === 'card') { e.preventDefault(); saveCard(pk); return; } const p = S.panels.find((x) => x.id === S.activeId); if (p && p.kind === 'editor') { e.preventDefault(); saveEditor(p); } else if (p && p.kind === 'card') { e.preventDefault(); saveCard(p); } return; }
  if (e.key === 'Escape') { if (S.overlay && S.overlay.type === 'peek') { requestClosePeek(); } else if (S.overlay) { S.overlay = null; renderOverlay(); } else if (S.expandedId) { S.expandedId = null; renderGrid(); } }
}

// ===========================================================================
//  Render regions
// ===========================================================================
function renderAll() { renderHeader(); renderRail(); renderGrid(); renderFooter(); renderOverlay(); applyChrome(); }

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
  if (S.railTab === 'library') return refreshLibraryRail(c);
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
    row.onclick = () => { if (n.kind === 'dir') toggleDir(n.path); else openFile(n.path); };
    container.appendChild(row);
    if (n.kind === 'dir' && isOpen) renderTreeLevel(container, n.path, depth + 1);
  }
}
async function toggleDir(dir) {
  if (S.expanded.has(dir)) { S.expanded.delete(dir); refreshRail(); return; }
  if (!S.tree[dir]) S.tree[dir] = await api.listDir(dir);
  S.expanded.add(dir); refreshRail();
}

// ---- library rail (agents & skills across platforms) -----------------------
async function loadLibrary(force) {
  if (S.library.loading || (S.library.loaded && !force)) return;
  S.library.loading = true;
  try {
    const res = (await api.libraryScan({ projectPath: S.project && S.project.path })) || {};
    S.library.items = res.items || []; S.library.edges = res.edges || [];
  } catch (_) { S.library.items = []; S.library.edges = []; }
  S.library.loading = false; S.library.loaded = true;
  if (S.railTab === 'library') refreshRail();
}
async function refreshServices() {
  if (S.services.loading) return;
  S.services.loading = true;
  try {
    const res = await api.listServices({ projectPath: S.project && S.project.path });
    S.services.catalog = res.catalog || []; S.services.connected = res.connected || [];
  } catch (_) {}
  S.services.loading = false;
  if (S.railTab === 'library') refreshRail();
  if (S.overlay && S.overlay.type === 'connect') renderOverlay();
}
// The library reads like an inventory: what you have, grouped by what it is.
const LIB_TYPE_GROUPS = [
  { key: 'agents', label: 'Agents' },
  { key: 'skills', label: 'Skills' },
  { key: 'services', label: 'Services' },
  { key: 'plugins', label: 'Plugins · read-only' },
];
const TYPE_CHIP = { agent: { code: 'AG', tint: TINTS[4] }, skill: { code: 'SK', tint: TINTS[1] }, command: { code: 'CM', tint: TINTS[0] } };
function libGroupOf(i) { return i.scope === 'plugin' ? 'plugins' : (i.type === 'agent' ? 'agents' : 'skills'); }
function scopeTagText(scope) { return scope === 'project' ? 'this project' : 'your Mac'; }
function refreshLibraryRail(c) {
  if (!S.library.loaded) loadLibrary();
  const head = document.createElement('div'); head.className = 'rail-head';
  head.innerHTML = `<span class="title">Library</span><span class="action" id="lib-connect">＋ connect</span><span class="action" id="lib-new">＋ new</span>`;
  c.appendChild(head);
  q('#lib-new', head).onclick = () => openNewItem();
  q('#lib-connect', head).onclick = () => openConnect();
  const top = document.createElement('div'); top.className = 'lib-top';
  const search = document.createElement('input');
  search.className = 'lib-search'; search.placeholder = 'Filter the library…'; search.value = S.library.q;
  search.oninput = () => { S.library.q = search.value; refreshRail(); const s = q('.lib-search', c); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } };
  top.appendChild(search); c.appendChild(top);
  const list = document.createElement('div'); list.className = 'lib-list'; c.appendChild(list);
  if (!S.library.loaded) { const e = document.createElement('div'); e.className = 'rail-empty'; e.textContent = 'Scanning…'; list.appendChild(e); return; }
  const ql = S.library.q.trim().toLowerCase();
  const match = (i) => !ql || (i.name + ' ' + i.description + ' ' + i.slug).toLowerCase().includes(ql);
  let shown = 0;
  for (const g of LIB_TYPE_GROUPS) {
    const isSvc = g.key === 'services';
    const items = isSvc
      ? S.services.connected.filter((sv) => !ql || (sv.id + ' ' + sv.name).toLowerCase().includes(ql))
      : S.library.items.filter((i) => libGroupOf(i) === g.key && match(i));
    if (!items.length && !(isSvc && !ql)) continue; // the services group always offers connect when not filtering
    shown += items.length + (isSvc ? 1 : 0);
    const open = ql ? true : !S.library.collapsed.has(g.key); // filtering always reveals matches
    const lab = document.createElement('div'); lab.className = 'lib-group';
    lab.innerHTML = `<span class="lg-caret">${open ? '▾' : '▸'}</span><span>${esc(g.label)}</span><span class="lg-count">${items.length}</span>`;
    lab.onclick = () => {
      if (S.library.collapsed.has(g.key)) S.library.collapsed.delete(g.key); else S.library.collapsed.add(g.key);
      refreshRail();
    };
    list.appendChild(lab);
    if (!open) continue;
    if (isSvc) {
      for (const sv of items) {
        const cat = S.services.catalog.find((s) => s.id === sv.id);
        const row = document.createElement('div'); row.className = 'agent-row';
        row.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(sv.id)]}">${esc((cat && cat.code) || 'SV')}</span>
          <span class="col"><span class="name">${esc(sv.name)}</span>
          <span class="tools"><span class="ok">●</span> connected · ${esc(sv.platforms.join(' + '))}</span></span>
          <span class="scope-tag">${scopeTagText(sv.scopes.includes('project') ? 'project' : 'user')}</span>`;
        row.onclick = () => openServiceDetails(sv);
        list.appendChild(row);
      }
      const add = document.createElement('div'); add.className = 'agent-row';
      add.innerHTML = `<span class="code" style="background:${TINTS[2]}">⚡</span>
        <span class="col"><span class="name">connect a service</span><span class="tools">Notion, Slack, a folder…</span></span><span class="chev">›</span>`;
      add.onclick = () => openConnect();
      list.appendChild(add);
      continue;
    }
    for (const i of items) {
      const chip = TYPE_CHIP[i.type] || TYPE_CHIP.agent;
      const row = document.createElement('div'); row.className = 'agent-row';
      row.innerHTML = `<span class="code" style="background:${chip.tint}">${chip.code}</span>
        <span class="col"><span class="name">${esc(i.name)}</span><span class="tools">${esc(i.description || i.meta.tools || i.filePath)}</span></span>
        ${i.scope === 'plugin' ? '' : `<span class="scope-tag">${scopeTagText(i.scope)}</span>`}<span class="chev">›</span>`;
      row.onclick = () => openCard(i);
      list.appendChild(row);
    }
  }
  if (!shown) { const e = document.createElement('div'); e.className = 'rail-empty'; e.textContent = ql ? 'No match.' : 'Nothing here yet: ＋ new creates your first.'; list.appendChild(e); }
}
function renderFooter() { els.footerPath.textContent = S.project ? S.project.pathShort : (S.claudeExe ? 'claude ready' : 'no folder open'); }

// ===========================================================================
//  Grid of tiles
// ===========================================================================
function statusMeta(p) {
  if (p.kind === 'ai') return { label: p.busy ? 'thinking' : 'live', color: p.busy ? '#a8792a' : '#4a7a4a' };
  if (p.kind === 'card') return { label: p.dirty ? 'unsaved' : (p.item.readOnly ? 'read-only' : p.item.type), color: p.dirty ? '#a8792a' : '#8d8065' };
  if (p.kind === 'viewer') return { label: p.sub, color: '#8d8065' };
  if (p.kind === 'editor') return { label: p.dirty ? 'unsaved' : 'file', color: p.dirty ? '#a8792a' : '#8d8065' };
  if (p.exited) return { label: 'closed', color: '#8d8065' };
  if (p.attention) return { label: 'needs you', color: '#a8792a' };
  return { label: 'live', color: '#4a7a4a' };
}
function kindLabel(p) {
  if (p.kind === 'ai') return (p.aiConfig ? p.aiConfig.model : 'ai model') + ' · ' + shortHome(p.cwd);
  if (p.kind === 'card') return p.item.platform + ' ' + p.item.type + ' · ' + p.item.scope;
  if (p.kind === 'viewer') return 'viewer · ' + baseNameOf(p.filePath);
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
      <div><div class="big">Start a session</div><div class="hint">Press ⌘N (or the ＋ New session button) — Claude Code, any AI model, terminals & harnesses.</div></div></div>`;
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

const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v3"/></svg>`;
const CLIP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M8 12h8M8 16h6"/></svg>`;
function mountTile(p) {
  const root = document.createElement('div'); root.className = 'tile'; root.dataset.id = p.id;
  root.innerHTML = `<div class="tile-head" draggable="true">
      <span class="code" style="background:${p.tint}">${esc(p.code)}</span>
      <span class="col"><span class="t-title">${esc(p.title)}</span><span class="t-sub"></span></span>
      <span class="t-status"><span class="dot"></span><span class="lbl"></span></span>
      <button class="t-btn t-mic" title="Dictate into this session">${MIC_SVG}</button>
      <button class="t-btn t-paste" title="Paste dictation from Echo (clipboard)">${CLIP_SVG}</button>
      <button class="t-btn t-expand" title="Expand">⤢</button>
      <button class="t-btn t-close" title="Close">✕</button>
    </div><div class="tile-body"></div>`;
  const head = q('.tile-head', root), body = q('.tile-body', root);
  const rec = { root, head, body, term: null, fit: null, statusDot: q('.t-status .dot', head), ta: null, gutter: null };
  tileEls.set(p.id, rec);
  q('.t-mic', head).onclick = (e) => { e.stopPropagation(); toggleMic(p); };
  q('.t-paste', head).onclick = (e) => { e.stopPropagation(); pasteDictation(p); };
  q('.t-expand', head).onclick = (e) => { e.stopPropagation(); S.expandedId = S.expandedId === p.id ? null : p.id; renderGrid(); };
  q('.t-close', head).onclick = (e) => { e.stopPropagation(); closePanel(p.id); };
  head.addEventListener('mousedown', (e) => { if (!e.target.closest('.t-btn')) focusPanel(p.id, false); });
  // drag reorder
  head.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; root.classList.add('dragging'); });
  head.addEventListener('dragend', () => root.classList.remove('dragging'));
  root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add(isFileDrag(e) ? 'file-hint' : 'drop-hint'); });
  root.addEventListener('dragleave', () => root.classList.remove('drop-hint', 'file-hint'));
  root.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    root.classList.remove('drop-hint', 'file-hint');
    const paths = droppedPaths(e);
    if (paths.length) return dropFilesOnPanel(p, paths);
    reorderPanels(e.dataTransfer.getData('text/plain'), p.id);
  });

  if (p.kind === 'editor') mountEditor(p, rec); else if (p.kind === 'viewer') mountViewer(p, rec); else if (p.kind === 'card') mountCard(p, rec); else if (p.kind === 'ai') mountAi(p, rec); else mountTerminal(p, rec);
}

function refreshTileHead(p) {
  const t = tileEls.get(p.id);
  if (!t) {
    if (S.overlay && S.overlay.type === 'peek' && S.overlay.panel === p) {
      const el = q('.pk-title'); if (el) el.textContent = p.title + (p.dirty ? ' •' : '');
    }
    return;
  }
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
  const term = new Terminal({ fontFamily: "'Courier Prime','Courier New',monospace", fontSize: 13, lineHeight: 1.2, theme: XTERM_THEME, cursorBlink: true, allowTransparency: true, allowProposedApi: true, scrollback: 6000, minimumContrastRatio: 4.5 });
  const fit = new FitAddon(); term.loadAddon(fit); term.open(rec.body); rec.term = term; rec.fit = fit;
  requestAnimationFrame(() => { try { fit.fit(); } catch (_) {} startProcess(p, term.cols, term.rows); });
  term.onData((d) => { clearAttention(p); api.termWrite({ id: p.id, data: d }); });
  term.onResize(({ cols, rows }) => api.termResize({ id: p.id, cols, rows }));
  term.onBell(() => setAttention(p));
  registerPathLinks(term, p);
  const ro = new ResizeObserver(() => { try { fit.fit(); } catch (_) {} }); ro.observe(rec.body);
}

// Cmd/Ctrl-click a file path in the terminal → open it as an editor tile (or reveal a folder).
const PATH_RE = /(?:~|\.{0,2})?(?:\/[\w.@+-]+)+|(?:[\w@+-]+\/)+[\w.@+-]+|\b[\w@+-]+\.[A-Za-z][\w]{0,8}\b/g;
function registerPathLinks(term, p) {
  if (!term.registerLinkProvider) return;
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) return callback(undefined);
      const text = line.translateToString(true);
      const links = []; let m;
      PATH_RE.lastIndex = 0;
      while ((m = PATH_RE.exec(text)) !== null) {
        const tok = m[0];
        if (tok.length < 3 || (!tok.includes('/') && !tok.includes('.'))) continue;
        const startX = m.index + 1, endX = m.index + tok.length;
        links.push({
          text: tok,
          range: { start: { x: startX, y }, end: { x: endX, y } },
          activate: async (ev) => {
            if (!(ev.metaKey || ev.ctrlKey)) return;
            const st = await api.statPath({ token: tok, cwd: p.cwd });
            if (!st.exists) { toast('Not found: ' + tok); return; }
            if (st.isFile) openFile(st.abs); else api.revealFile(st.abs);
          },
        });
      }
      callback(links);
    },
  });
}
async function startProcess(p, cols, rows) {
  if (p.started) return; p.started = true;
  await api.termCreate({ id: p.id, cwd: p.cwd, cols, rows, kind: p.kind, command: p.command, program: p.program, args: p.args, seed: p.seed, cont: p.cont });
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

// ---- viewer tiles (image / video / audio / pdf / fallback) -----------------
function mountViewer(p, rec) {
  const wrap = document.createElement('div'); wrap.className = 'viewer viewer--' + p.sub;
  const url = fileUrl(p.filePath);
  const fallback = `<div class="vw-stage vw-stage--pad"><div class="vw-glyph">▣</div>
      <div class="vw-name">${esc(p.title)}</div>
      <div class="vw-note">${esc(p.note || "Can't preview this file here.")}</div>
      <button class="btn vw-reveal">Reveal in Finder</button></div>`;
  if (p.sub === 'image') wrap.innerHTML = `<div class="vw-stage"><img src="${esc(url)}" alt="${esc(p.title)}" /></div>`;
  else if (p.sub === 'video') wrap.innerHTML = `<div class="vw-stage vw-stage--dark"><video src="${esc(url)}" controls playsinline></video></div>`;
  else if (p.sub === 'audio') wrap.innerHTML = `<div class="vw-stage vw-stage--pad"><div class="vw-glyph">♪</div><div class="vw-name">${esc(p.title)}</div><audio src="${esc(url)}" controls></audio></div>`;
  else if (p.sub === 'pdf') wrap.innerHTML = `<iframe class="vw-pdf" src="${esc(url)}"></iframe>`;
  else wrap.innerHTML = fallback;
  wrap.insertAdjacentHTML('beforeend',
    `<div class="ed-bar"><span class="ed-path">${esc(shortHome(p.filePath))}</span><button class="btn vw-finder">Finder</button></div>`);
  rec.body.appendChild(wrap);
  wrap.querySelectorAll('.vw-reveal, .vw-finder').forEach((b) => { b.onclick = () => api.revealFile(p.filePath); });
  const media = wrap.querySelector('img, video, audio');
  if (media) media.addEventListener('error', () => {
    const stage = wrap.querySelector('.vw-stage, .vw-pdf');
    p.note = 'This format could not be decoded.';
    if (stage) stage.outerHTML = fallback;
    const b = wrap.querySelector('.vw-reveal'); if (b) b.onclick = () => api.revealFile(p.filePath);
  }, { once: true });
}

// ---- AI chat tiles (any OpenAI-compatible model) ---------------------------
function mountAi(p, rec) {
  const wrap = document.createElement('div'); wrap.className = 'ai-chat';
  wrap.innerHTML = `<div class="ai-log"></div>
    <div class="ai-inputrow"><span class="prompt-mark">❯</span>
      <textarea class="ai-input" rows="1" spellcheck="false" placeholder="Message ${esc(p.title)} — Enter sends"></textarea></div>`;
  rec.body.appendChild(wrap);
  rec.aiLog = q('.ai-log', wrap); rec.aiInput = q('.ai-input', wrap);
  p.log = p.log || [];
  const ready = (async () => {
    const cfg = p.aiConfig || (await api.aiConfigGet());
    if (!cfg || !cfg.model) { renderAiEvent(p, { kind: 'error', message: 'No model configured yet — type /model below, or ⌘N → “Any AI model”.' }); return false; }
    p.aiConfig = cfg; p.title = cfg.model;
    await api.aiStart({ id: p.id, cwd: p.cwd, config: cfg });
    refreshTileHead(p);
    return true;
  })();
  for (const ev of p.log) renderAiEvent(p, ev); // replay after a re-mount
  rec.aiInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const v = rec.aiInput.value.trim(); if (!v) return;
    if (!(await ready)) return;
    rec.aiInput.value = '';
    p.busy = true; refreshTileHead(p);
    api.aiSend({ id: p.id, text: v });
  });
  rec.aiInput.addEventListener('focus', () => { S.activeId = p.id; clearAttention(p); refreshRail(); });
}
function renderAiEvent(p, ev) {
  const rec = tileEls.get(p.id); if (!rec || !rec.aiLog) return;
  const log = rec.aiLog;
  const add = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; log.appendChild(d); return d; };
  if (ev.kind === 'user_echo') add('ai-user', '❯ ' + ev.text);
  else if (ev.kind === 'assistant') add('ai-msg', ev.text);
  else if (ev.kind === 'error') add('ai-err', ev.message);
  else if (ev.kind === 'tool') { const d = add('ai-step', '● ' + ev.label); d.dataset.tool = ev.toolId; }
  else if (ev.kind === 'tool_result') {
    const d = log.querySelector(`[data-tool="${CSS.escape(ev.toolId)}"]`);
    if (d) { d.classList.add(ev.isError ? 'err' : 'done'); d.textContent = (ev.isError ? '✗ ' : '✓ ') + d.textContent.slice(2); }
  } else if (ev.kind === 'permission') {
    const card = document.createElement('div'); card.className = 'ai-perm'; card.dataset.perm = ev.permissionId;
    card.innerHTML = `<div class="ap-title">Needs your OK</div><div class="ap-sum">${esc(ev.summary)}</div>
      <div class="ap-row"><button class="btn btn--go ap-allow">Allow</button><button class="btn ap-deny">Not now</button></div>`;
    const settle = (allow) => {
      api.aiPermission({ id: p.id, permissionId: ev.permissionId, allow });
      card.innerHTML = `<div class="ap-sum">${esc(ev.summary)}</div><div class="ap-done">${allow ? '✓ allowed' : '✗ denied'}</div>`;
      clearAttention(p);
    };
    q('.ap-allow', card).onclick = () => settle(true);
    q('.ap-deny', card).onclick = () => settle(false);
    log.appendChild(card);
  }
  log.scrollTop = log.scrollHeight;
}

// ---- card tiles (agent / skill editing: form + raw markdown) ---------------
const FIELD_MAP = {
  'claude:agent': [['name', 'Name'], ['description', 'Description'], ['tools', 'Tools'], ['model', 'Model']],
  'claude:skill': [['name', 'Name'], ['description', 'Description']],
  'opencode:agent': [['description', 'Description'], ['mode', 'Mode'], ['model', 'Model']],
  'opencode:command': [['description', 'Description'], ['agent', 'Agent'], ['model', 'Model']],
};
function connectionsOf(item) {
  const byId = new Map(S.library.items.map((i) => [i.id, i]));
  const out = S.library.edges.filter((e) => e.from === item.id).map((e) => byId.get(e.to)).filter(Boolean);
  const inn = S.library.edges.filter((e) => e.to === item.id).map((e) => byId.get(e.from)).filter(Boolean);
  return { out, inn };
}
async function openCard(item, opts) {
  await loadLibrary();
  const r = resolveOpen(S.panels, 'card', item.filePath);
  if (r.action === 'focus') { focusPanel(r.id); return; }
  const res = await api.rawFile(item.filePath);
  if (!res.ok) { toast(res.error || 'Could not open'); loadLibrary(true); return; }
  const doc = parseDoc(res.text);
  const chip = TYPE_CHIP[item.type] || TYPE_CHIP.agent;
  const p = {
    id: uid('p_'), kind: 'card', item, filePath: item.filePath, doc, raw: res.text,
    mode: doc.hasFrontmatter ? 'form' : 'raw', dirty: false, status: 'live',
    tint: chip.tint, code: chip.code, title: item.name, cwd: S.project && S.project.path,
  };
  if (doc.malformed) toast('Frontmatter looks malformed. Raw view only.');
  if (opts && opts.pin) {
    S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
    renderGrid(); renderRail(); renderHeader(); savePanels();
  } else openPeek(p);
}
function mountCard(p, rec) {
  const ro = p.item.readOnly;
  const wrap = document.createElement('div'); wrap.className = 'card-ed';
  const fields = FIELD_MAP[p.item.platform + ':' + p.item.type] || FIELD_MAP['claude:agent'];
  wrap.innerHTML = `
    <div class="card-tabs">
      <button class="card-tab" data-m="form">Form</button>
      <button class="card-tab" data-m="raw">Markdown</button>
      <span class="card-src">${esc(p.item.platform + ' ' + p.item.type + ' · ' + p.item.scope)}${ro ? ' · read-only' : ''}</span>
    </div>
    <div class="card-form">
      ${fields.map(([k, label]) => `<label class="card-lbl">${esc(label)}</label>
        <input class="card-in" data-f="${k}" ${ro ? 'disabled' : ''} />`).join('')}
      <label class="card-lbl">Instructions</label>
      <textarea class="card-body" spellcheck="false" ${ro ? 'disabled' : ''}></textarea>
    </div>
    <div class="card-raw"><textarea class="raw-area" spellcheck="false" ${ro ? 'readonly' : ''}></textarea></div>
    <div class="card-links"></div>
    <div class="ed-bar">
      <span class="ed-path">${esc(shortHome(p.filePath))}</span>
      ${p.item.type === 'agent' && p.item.platform === 'claude' ? '<button class="btn card-use">Use</button>' : ''}
      ${ro ? '<button class="btn btn--go card-dup">Duplicate to project</button>' : '<button class="btn btn--go card-save">Save ⌘S</button>'}
    </div>`;
  rec.body.appendChild(wrap);
  const formEl = q('.card-form', wrap), rawEl = q('.card-raw', wrap), rawTa = q('.raw-area', wrap), bodyTa = q('.card-body', wrap);
  const markDirty = () => { if (!p.dirty) { p.dirty = true; refreshTileHead(p); refreshRail(); } };

  const syncFormFromDoc = () => {
    formEl.querySelectorAll('.card-in').forEach((inp) => { inp.value = getField(p.doc, inp.dataset.f); });
    bodyTa.value = p.doc.body;
  };
  const applyMode = () => {
    const formMode = p.mode === 'form';
    formEl.style.display = formMode ? '' : 'none';
    rawEl.style.display = formMode ? 'none' : '';
    wrap.querySelectorAll('.card-tab').forEach((b) => b.classList.toggle('active', b.dataset.m === p.mode));
    if (formMode) syncFormFromDoc(); else rawTa.value = p.raw;
  };
  wrap.querySelectorAll('.card-tab').forEach((b) => {
    b.onclick = () => {
      const target = b.dataset.m;
      if (target === p.mode) return;
      if (target === 'raw') { p.raw = serializeDoc(p.doc); p.mode = 'raw'; applyMode(); return; }
      const doc = parseDoc(rawTa.value);
      if (doc.malformed) { toast('Fix the frontmatter fences (---) first — staying in raw view.'); return; }
      p.raw = rawTa.value; p.doc = doc; p.mode = 'form'; applyMode();
    };
  });
  formEl.querySelectorAll('.card-in').forEach((inp) => {
    inp.addEventListener('input', () => { setField(p.doc, inp.dataset.f, inp.value); markDirty(); });
  });
  bodyTa.addEventListener('input', () => { p.doc.body = bodyTa.value; markDirty(); });
  rawTa.addEventListener('input', () => { p.raw = rawTa.value; markDirty(); });
  [bodyTa, rawTa].forEach((ta) => ta.addEventListener('focus', () => { S.activeId = p.id; refreshRail(); }));

  // connections strip: what this references, what references it (from the library edges)
  const linksEl = q('.card-links', wrap);
  const { out, inn } = connectionsOf(p.item);
  if (out.length || inn.length) {
    const chip = (i) => `<button class="link-chip" data-id="${esc(i.id)}">${esc(i.slug)}</button>`;
    linksEl.innerHTML =
      (out.length ? `<span class="lk-lbl">references →</span>${out.map(chip).join('')}` : '') +
      (inn.length ? `<span class="lk-lbl">← referenced by</span>${inn.map(chip).join('')}` : '');
    linksEl.querySelectorAll('.link-chip').forEach((b) => {
      b.onclick = () => { const it = S.library.items.find((x) => x.id === b.dataset.id); if (it) openCard(it); };
    });
  } else linksEl.style.display = 'none';

  const useBtn = q('.card-use', wrap); if (useBtn) useBtn.onclick = () => useAgent(p.item);
  const saveBtn = q('.card-save', wrap); if (saveBtn) saveBtn.onclick = () => saveCard(p);
  const dupBtn = q('.card-dup', wrap);
  if (dupBtn) dupBtn.onclick = async () => {
    if (!S.project) { toast('Open a folder first — the copy lands in the project.'); return; }
    const res = await api.libraryDuplicate({ filePath: p.item.filePath, type: p.item.type, projectPath: S.project.path });
    if (!res.ok) { toast(res.error || 'Duplicate failed'); return; }
    toast('Copied into this project — opening your editable copy.');
    loadLibrary(true);
    openCard(res.item);
  };
  applyMode();
}
async function saveCard(p) {
  if (p.item.readOnly) return;
  if (p.mode === 'form') p.raw = serializeDoc(p.doc);
  const res = await api.saveFile({ file: p.filePath, text: p.raw });
  if (res && res.ok) {
    p.dirty = false;
    p.title = getField(p.doc, 'name') || p.item.slug;
    refreshTileHead(p); refreshRail(); toast('Saved ' + p.title);
    loadLibrary(true);
  } else toast('Save failed: ' + (res && res.error || '?'));
}

// ---- dictation (in-app mic + Echo clipboard) -------------------------------
let recording = null; // { panelId, recorder, stream }
function micBtn(p) { const t = tileEls.get(p.id); return t ? q('.t-mic', t.head) : null; }
function setMicState(p, state) {
  const b = micBtn(p); if (!b) return;
  b.classList.toggle('rec', state === 'recording');
  b.classList.toggle('busy', state === 'transcribing');
  if (state === 'recording') b.innerHTML = '<span class="rec-square"></span>';
  else if (state === 'transcribing') b.textContent = '…';
  else b.innerHTML = MIC_SVG;
  b.title = state === 'recording' ? 'Stop & transcribe' : state === 'transcribing' ? 'Transcribing…' : 'Dictate into this session';
}
async function toggleMic(p) {
  if (recording && recording.panelId === p.id) { stopMic(); return; }
  if (recording) stopMic();
  if (!S.stt) { toast('No transcription key — using clipboard. Dictate with Echo, then click the clip icon.'); return pasteDictation(p); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream); const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop());
      setMicState(p, 'transcribing');
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await api.transcribe({ bytes, mime: blob.type });
      setMicState(p, 'idle');
      if (res && res.ok && res.text) { injectToSession(p, res.text); toast('Dictated: ' + shorten(res.text, 40)); }
      else toast('Transcribe failed: ' + (res && res.error || 'no speech'));
    };
    rec.start(); recording = { panelId: p.id, recorder: rec, stream };
    setMicState(p, 'recording');
    toast('Recording… click the mic again to stop.');
  } catch (e) { toast('Mic error: ' + e.message); }
}
function stopMic() { if (recording) { try { recording.recorder.stop(); } catch (_) {} recording = null; } }
async function pasteDictation(p) {
  const text = await api.readClipboard();
  if (!text || !text.trim()) { toast('Clipboard is empty — dictate with Echo first.'); return; }
  injectToSession(p, text.trim()); toast('Pasted dictation into ' + shorten(p.title, 24));
}
function injectToSession(p, text) {
  if (!text) return;
  focusPanel(p.id, false);
  if (p.kind === 'editor') {
    const t = tileEls.get(p.id); if (!t || !t.ta) return;
    const ta = t.ta, s = ta.selectionStart;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    p.text = ta.value; p.dirty = true; refreshTileHead(p);
    ta.dispatchEvent(new Event('input'));
    return;
  }
  if (p.kind === 'ai') { p.busy = true; refreshTileHead(p); api.aiSend({ id: p.id, text }); return; }
  api.termWrite({ id: p.id, data: text });
}

// ===========================================================================
//  Panel lifecycle
// ===========================================================================
// ---- persistence: the layout survives restarts -----------------------------
let saveTimer = null;
function savePanels() {
  if (S.demo) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const panels = S.panels.map((p) => {
      if (p.kind === 'editor') return { kind: 'editor', filePath: p.filePath };
      if (p.kind === 'viewer') return { kind: 'viewer', filePath: p.filePath };
      if (p.kind === 'card') return { kind: 'card', item: p.item };
      return { kind: p.kind, title: p.title, code: p.code, tint: p.tint, cwd: p.cwd, command: p.command, program: p.program, args: p.args };
    });
    api.savePanels({ panels });
  }, 400);
}
async function restorePanels(snaps) {
  // open* unshift; walk the list backwards so the restored order matches
  for (const s of [...snaps].reverse()) {
    try {
      if (s.kind === 'editor') await openFile(s.filePath, { pin: true });
      else if (s.kind === 'viewer') await openFile(s.filePath, { pin: true });
      else if (s.kind === 'card' && s.item) await openCard(s.item, { pin: true });
      else if (s.kind) startPanel({ kind: s.kind, title: s.title, code: s.code, tint: s.tint, cwd: s.cwd, command: s.command, program: s.program, args: s.args, cont: s.kind === 'claude' });
    } catch (_) {}
  }
  S.activeId = S.panels[0] ? S.panels[0].id : null;
  renderAll();
}

function startPanel(opts) {
  const p = Object.assign({
    id: uid('p_'), kind: 'claude', tint: opts.tint || nextTint(), code: opts.code || code2(opts.title || 'SS'),
    title: opts.title || 'Session', cwd: opts.cwd || (S.project && S.project.path), status: 'live',
    attention: false, exited: false, started: false, command: opts.command, program: opts.program, args: opts.args, seed: opts.seed, cont: opts.cont,
  }, opts);
  S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
  renderGrid(); renderRail(); renderHeader(); savePanels();
  return p;
}
const VIEWER_CODES = { image: 'IM', video: 'VI', audio: 'AU', pdf: 'PD', other: 'FI' };
function viewerPanel(filePath, sub, note) {
  return { id: uid('p_'), kind: 'viewer', sub, note, tint: TINTS[hashIdx(filePath)], code: VIEWER_CODES[sub] || 'VW', title: baseNameOf(filePath), filePath, status: 'live', cwd: S.project && S.project.path };
}
// Build the right panel for any path: media/pdf as viewer, text as editor,
// unreadable/binary as an 'other' viewer card carrying the reason.
async function buildFilePanel(filePath) {
  const kind = fileKind(filePath);
  if (kind !== 'text') return viewerPanel(filePath, kind);
  const res = await api.rawFile(filePath);
  if (!res.ok) return viewerPanel(filePath, 'other', res.error || 'Could not open');
  return { id: uid('p_'), kind: 'editor', tint: TINTS[hashIdx(filePath)], code: 'ED', title: baseNameOf(filePath), filePath, text: res.text, dirty: false, status: 'live', cwd: S.project && S.project.path };
}
// Looking at a file floats it above the desk; only pinning (or an explicit
// drop onto the desk, or restore-on-boot) makes it a tile.
async function openFile(filePath, opts) {
  const r = resolveOpen(S.panels, 'file', filePath);
  if (r.action === 'focus') { focusPanel(r.id); return; }
  const p = await buildFilePanel(filePath);
  if (opts && opts.pin) {
    S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
    renderGrid(); renderRail(); renderHeader(); savePanels();
  } else openPeek(p);
}
function focusPanel(id, scroll = true) {
  S.activeId = id; renderRail();
  for (const [pid, t] of tileEls) t.root.classList.toggle('active', pid === id);
  const t = tileEls.get(id); if (t) { const p = S.panels.find((x) => x.id === id); clearAttention(p); if (scroll) t.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); if (t.term) t.term.focus(); else if (t.aiInput) t.aiInput.focus(); else if (t.ta) t.ta.focus(); }
}
function closePanel(id) {
  const p = S.panels.find((x) => x.id === id); if (!p) return;
  if ((p.kind === 'editor' || p.kind === 'card') && p.dirty && !confirm(`Discard unsaved changes to ${baseNameOf(p.filePath)}?`)) return;
  if (p.kind === 'ai') api.aiClose({ id });
  else if (p.kind !== 'editor' && p.kind !== 'viewer' && p.kind !== 'card') api.termKill({ id });
  const t = tileEls.get(id); if (t) { t.root.remove(); tileEls.delete(id); }
  S.panels = S.panels.filter((x) => x.id !== id);
  if (S.activeId === id) S.activeId = S.panels[0] ? S.panels[0].id : null;
  if (S.expandedId === id) S.expandedId = null;
  renderGrid(); renderRail(); renderHeader(); savePanels();
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
  renderGrid(); savePanels();
}

// ===========================================================================
//  Launcher
// ===========================================================================
async function ensureFolder() {
  if (S.project) return true;
  const info = await api.pickFolder(); if (!info) { toast('Open a folder to start a session.'); return false; }
  applyProject(info); return true;
}

async function refreshAgents() {
  if (S.agentsLoading) return;
  S.agentsLoading = true;
  try { S.agents = await api.detectAgents(); } catch (_) { S.agents = S.agents || []; }
  S.agentsLoading = false;
  const ot = S.overlay && S.overlay.type;
  if (['launcher', 'connect-form', 'connect-custom', 'newitem', 'improve-item'].includes(ot)) renderOverlay();
}
function openLauncher() { S.overlay = { type: 'launcher' }; renderOverlay(); refreshAgents(); }
function renderLauncher() {
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">＋</span><span style="font-weight:700">New session</span>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)">${S.project ? esc(S.project.name) : 'no folder'}</span></div>
    <div class="picker-list" id="lc-list"></div>`, { top: true });
  const list = q('#lc-list', modal);
  const ready = (S.agents || []).filter((a) => a.found);
  const missing = (S.agents || []).filter((a) => !a.found);

  if (!S.agents) {
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="col"><span class="desc">looking for agents on this Mac…</span></span>`;
    list.appendChild(row);
  }
  for (const a of ready) {
    const tint = TINTS[hashIdx(a.id)];
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="code" style="background:${tint}">${esc(code2(a.name))}</span>
      <span class="col"><span class="name">${esc(a.name)}</span>
      <span class="desc"><span class="ok">●</span> ready · ${esc(a.sub)}</span></span>`;
    row.onclick = async () => {
      closeOverlay(); if (!(await ensureFolder())) return;
      if (a.kind === 'claude') return startPanel({ kind: 'claude', title: 'Claude session', code: 'CC', tint });
      startPanel({ kind: 'run', title: a.name, code: code2(a.name), tint, command: a.bin });
    };
    list.appendChild(row);
  }
  for (const h of EVERGREEN_ROWS) {
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="code" style="background:${h.tint}">${esc(h.code)}</span>
      <span class="col"><span class="name">${esc(h.name)}</span><span class="desc">${esc(h.sub)}</span></span>`;
    row.onclick = async () => { closeOverlay(); if (!(await ensureFolder())) return; launchHarness(h); };
    list.appendChild(row);
  }
  // add section: every not-yet-installed agent from the curated registry
  if (missing.length) {
    const div = document.createElement('div'); div.className = 'picker-divider';
    div.textContent = 'add an agent to this Mac'; list.appendChild(div);
    const grid = document.createElement('div'); grid.className = 'add-grid'; list.appendChild(grid);
    for (const a of missing) {
      const card = document.createElement('div'); card.className = 'add-card'; card.tabIndex = 0;
      card.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.id)]}">${esc(code2(a.name))}</span>
        <span class="ac-name">${esc(a.name)}</span><span class="ac-desc">${esc(a.sub)}</span><span class="ac-go">set up →</span>`;
      card.onclick = () => { closeOverlay(); openAgentSetup(a); };
      grid.appendChild(card);
    }
  }
}
async function configureAiModel(existing) {
  const baseUrl = prompt('OpenAI-compatible base URL:', (existing && existing.baseUrl) || 'http://localhost:11434/v1');
  if (!baseUrl || !baseUrl.trim()) return null;
  const model = prompt('Model name (e.g. hermes3, llama3.1, qwen2.5-coder):', (existing && existing.model) || '');
  if (!model || !model.trim()) return null;
  const apiKey = prompt('API key (blank if the endpoint needs none):', (existing && existing.apiKey) || '') || '';
  const cfg = { baseUrl: baseUrl.trim().replace(/\/+$/, ''), model: model.trim(), apiKey: apiKey.trim() };
  await api.aiConfigSet(cfg);
  return cfg;
}
async function launchHarness(h) {
  return startPanel({ kind: 'shell', title: 'Terminal', code: '❯', tint: h.tint });
}
function openAgentSetup(agent) { S.overlay = { type: 'agent-setup', agent }; renderOverlay(); }
function renderAgentSetup() {
  const a = S.overlay.agent;
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[hashIdx(a.id)]}">${esc(code2(a.name))}</span>
      <span class="col"><span class="name">${esc(a.name)}</span><span class="desc">${esc(a.sub)}</span></span></div>
    <p class="setup-copy">${esc(a.name)} is not on this Mac yet. One command installs it, and I can run that
      for you in a terminal right here. The first time it starts, it will ask you to sign in, right in the tile.</p>
    <div class="setup-cmd">${esc(a.install)}</div>
    <div class="setup-actions">
      <button class="btn btn--go" id="su-run">Install it for me</button>
      <button class="btn" id="su-copy">Copy the command</button>
      <button class="btn" id="su-docs">Read the guide</button>
    </div>
    <p class="setup-note">Install it for me opens a terminal tile and runs the line above. Copy puts it on
      your clipboard. Read the guide opens the official ${esc(a.name)} page in your browser.</p>`);
  q('#su-run', modal).onclick = async () => {
    closeOverlay(); if (!(await ensureFolder())) return;
    startPanel({ kind: 'run', title: `install ${a.name}`, code: code2(a.name), tint: TINTS[hashIdx(a.id)], command: a.install });
    toast('When it finishes, press ⌘N. The button will be ready.');
  };
  q('#su-copy', modal).onclick = async () => { await api.copyText(a.install); toast('Copied.'); };
  q('#su-docs', modal).onclick = () => api.openUrl(a.docs);
}

// ---- agent picker (⌘K) — fed by the library scan ---------------------------
function pickerAgents() {
  return S.library.items.filter((i) => i.type === 'agent' && i.platform === 'claude' && (i.scope === 'project' || i.scope === 'user'));
}
function useAgent(a) {
  closeOverlay();
  startPanel({ kind: 'claude', title: a.name + ' session', code: code2(a.name), tint: TINTS[hashIdx(a.slug)], seed: `Use the ${a.slug} agent.` });
}
async function openAgentPicker() {
  await loadLibrary();
  S.overlay = { type: 'agents', query: '', hi: 0 }; renderOverlay();
}
function renderAgentPickerSheet() {
  const o = S.overlay; const agents = pickerAgents();
  const filtered = agents.filter((a) => (a.name + ' ' + (a.description || '')).toLowerCase().includes(o.query.toLowerCase()));
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">❯</span><input id="ap-input" placeholder="Start a session with which agent?" value="${esc(o.query)}" /></div><div class="picker-list" id="ap-list"></div>`, { top: true });
  const input = q('#ap-input', modal); setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.query = input.value; o.hi = 0; renderOverlay(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = filtered[o.hi]; if (a) { closeOverlay(); useAgent(a); } }
    if (e.key === 'ArrowDown') { o.hi = Math.min(filtered.length - 1, o.hi + 1); renderOverlay(); }
    if (e.key === 'ArrowUp') { o.hi = Math.max(0, o.hi - 1); renderOverlay(); }
  });
  const list = q('#ap-list', modal);
  if (!filtered.length) { list.innerHTML = `<div class="rail-empty" style="padding:14px">${agents.length ? 'No match.' : 'No Claude agents found — create one in the Library tab.'}</div>`; return; }
  filtered.forEach((a, i) => {
    const row = document.createElement('div'); row.className = 'picker-row' + (i === o.hi ? ' hilite' : '');
    row.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.slug)]}">${esc(code2(a.name))}</span><span class="col"><span class="name">${esc(a.name)}</span><span class="desc">${esc(a.description || a.meta.tools || '')}</span></span>`;
    row.onclick = () => { closeOverlay(); useAgent(a); };
    list.appendChild(row);
  });
}

// ---- new library item (＋ new) ----------------------------------------------
const NEW_KINDS = [
  { key: 'claude:agent', name: 'Claude agent', sub: 'a .claude/agents markdown agent', chip: TYPE_CHIP.agent },
  { key: 'claude:skill', name: 'Claude skill', sub: 'a .claude/skills folder with SKILL.md', chip: TYPE_CHIP.skill },
  { key: 'opencode:agent', name: 'OpenCode agent', sub: 'an .opencode/agent markdown agent', chip: TYPE_CHIP.agent },
];
function openNewItem() { S.overlay = { type: 'newitem', kindKey: 'claude:agent', scope: S.project ? 'project' : 'user', name: '', desc: '' }; renderOverlay(); if (!S.agents) refreshAgents(); }
function renderNewItemSheet() {
  const o = S.overlay;
  const worker = chosenAgent(o);
  const modal = overlay('picker-box', `
    <div class="picker-input"><span class="prompt-mark">＋</span><span style="font-weight:700">New agent or skill</span></div>
    <div class="picker-list" id="ni-kinds"></div>
    <div class="ni-row">
      <span class="card-lbl" style="margin:0">Scope</span>
      <button class="btn ni-scope" data-s="project" ${S.project ? '' : 'disabled'}>this project</button>
      <button class="btn ni-scope" data-s="user">your machine</button>
    </div>
    <div class="ni-row"><input id="ni-name" placeholder="name it (or leave blank, your agent will)…" value="${esc(o.name)}" /></div>
    <div class="ni-row"><input id="ni-desc" placeholder="what should it do? e.g. turns git history into release notes people read" value="${esc(o.desc)}" /></div>
    <div class="ni-agent" style="margin:2px 12px 8px">${worker
      ? `a new session with <select class="agent-pick" id="ni-agent-sel">${agentOptionsHtml(worker.id)}</select> creates it for you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="ni-row"><button class="btn btn--go" id="ni-create" ${worker ? '' : 'disabled'}>Create it for me</button>
      <span class="action" id="ni-blank">just give me an empty file</span></div>`, { top: true });
  const kinds = q('#ni-kinds', modal);
  const nameInput = q('#ni-name', modal), descInput = q('#ni-desc', modal);
  const keep = () => { o.name = nameInput.value; o.desc = descInput.value; };
  for (const k of NEW_KINDS) {
    const row = document.createElement('div'); row.className = 'picker-row' + (o.kindKey === k.key ? ' hilite' : '');
    row.innerHTML = `<span class="code" style="background:${k.chip.tint}">${k.chip.code}</span>
      <span class="col"><span class="name">${esc(k.name)}</span><span class="desc">${esc(k.sub)}</span></span>`;
    row.onclick = () => { keep(); o.kindKey = k.key; renderOverlay(); };
    kinds.appendChild(row);
  }
  modal.querySelectorAll('.ni-scope').forEach((b) => {
    b.classList.toggle('btn--go', b.dataset.s === o.scope);
    b.onclick = () => { keep(); o.scope = b.dataset.s; renderOverlay(); };
  });
  const agentSel = q('#ni-agent-sel', modal);
  if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
  setTimeout(() => descInput.focus(), 30);
  q('#ni-create', modal).onclick = () => {
    keep();
    const w = chosenAgent(o);
    if (!o.desc.trim()) { toast('Describe what it should do first.'); return; }
    if (!w) { toast('No agent is installed yet. Press ⌘N to add one first.'); return; }
    const [platform, type] = o.kindKey.split(':');
    const seed = buildCreateSeed({ type, platform, scope: o.scope, name: o.name, desc: o.desc, projectPath: S.project && S.project.path });
    closeOverlay();
    agentSession(w, { title: 'build: ' + (o.name.trim() || type), code: 'BD', seed });
    toast('Your agent is writing it. It appears in the Library when it lands.');
  };
  q('#ni-blank', modal).onclick = async () => {
    keep();
    if (!o.name.trim()) { toast('Give it a name first.'); return; }
    const [platform, type] = o.kindKey.split(':');
    const res = await api.libraryCreate({ projectPath: S.project && S.project.path, type, platform, scope: o.scope, name: o.name.trim() });
    if (!res.ok) { toast(res.error || 'Could not create'); return; }
    closeOverlay(); toast('Created ' + o.name.trim());
    S.railTab = 'library'; loadLibrary(true).then(() => renderRail());
    openCard(res.item);
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); descInput.focus(); } });
  descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q('#ni-create', modal).onclick(); } });
}

// ---- overlays --------------------------------------------------------------
function renderOverlay() {
  els.overlayRoot.innerHTML = ''; const o = S.overlay; if (!o) return;
  if (o.type === 'launcher') return renderLauncher();
  if (o.type === 'peek') return renderPeek();
  if (o.type === 'agent-setup') return renderAgentSetup();
  if (o.type === 'agents') return renderAgentPickerSheet();
  if (o.type === 'newitem') return renderNewItemSheet();
  if (o.type === 'connect') return renderConnectCatalog();
  if (o.type === 'connect-form') return renderConnectForm();
  if (o.type === 'connect-done') return renderConnectDone();
  if (o.type === 'connect-custom') return renderConnectCustom();
}
function closeOverlay() { S.overlay = null; renderOverlay(); }

// ---- peek: float a file or card above the desk without touching the tiles --
function openPeek(p) {
  const cur = S.overlay && S.overlay.type === 'peek' && S.overlay.panel;
  if (cur && (cur.kind === 'editor' || cur.kind === 'card') && cur.dirty
      && !confirm(`Discard unsaved changes to ${baseNameOf(cur.filePath)}?`)) return;
  S.overlay = { type: 'peek', panel: p }; renderOverlay();
}
function renderPeek() {
  const p = S.overlay.panel;
  const wrap = document.createElement('div'); wrap.className = 'overlay'; wrap.onclick = requestClosePeek;
  const box = document.createElement('div'); box.className = 'peek-box'; box.onclick = (e) => e.stopPropagation();
  box.innerHTML = `<div class="peek-head">
      <span class="code" style="background:${p.tint}">${esc(p.code)}</span>
      <span class="col"><span class="pk-title">${esc(p.title)}${p.dirty ? ' •' : ''}</span><span class="pk-sub">${esc(shortHome(p.filePath))}</span></span>
      <button class="btn btn--go pk-pin" title="Keep it open as a tile on the desk">Pin to desk</button>
      <button class="t-btn pk-x" title="Close">✕</button>
    </div><div class="peek-body"></div>`;
  wrap.appendChild(box); els.overlayRoot.appendChild(wrap);
  const rec = { body: q('.peek-body', box) };
  if (p.kind === 'editor') mountEditor(p, rec);
  else if (p.kind === 'card') mountCard(p, rec);
  else mountViewer(p, rec);
  q('.pk-pin', box).onclick = pinPeek;
  q('.pk-x', box).onclick = requestClosePeek;
}
function pinPeek() {
  const o = S.overlay; if (!o || o.type !== 'peek') return;
  const p = o.panel;
  S.overlay = null;
  S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
  renderOverlay(); renderGrid(); renderRail(); renderHeader(); savePanels();
}
function requestClosePeek() {
  const o = S.overlay; if (!o || o.type !== 'peek') { closeOverlay(); return; }
  const p = o.panel;
  if ((p.kind === 'editor' || p.kind === 'card') && p.dirty
      && !confirm(`Discard unsaved changes to ${baseNameOf(p.filePath)}?`)) return;
  closeOverlay();
}
// ---- connect a service ------------------------------------------------------
// Three small sheets: pick a card, paste one key, see it proven. Copy follows
// the approved mockup and never assumes which agent the user runs.
function openConnect() { S.overlay = { type: 'connect' }; renderOverlay(); refreshServices(); refreshAgents(); }
function renderConnectCatalog() {
  const cat = S.services.catalog;
  const connectedIds = new Set(S.services.connected.map((s) => s.id));
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">⚡</span>
    <span style="font-weight:700">What should your agents reach?</span>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)">pick one to start</span></div>
    ${cat.length ? '' : '<div class="rail-empty" style="padding:14px">Loading the catalog…</div>'}
    <div class="svc-grid">${cat.map((s) => `
      <div class="svc-card${connectedIds.has(s.id) ? ' connected' : ''}" data-id="${esc(s.id)}" tabindex="0">
        <span class="code" style="background:${TINTS[hashIdx(s.id)]}">${esc(s.code)}</span>
        <span class="sv-name">${esc(s.name)}</span>
        <span class="sv-desc">${esc(s.desc)}</span>
        ${s.id === 'kie' ? '<span class="sv-by">by Dainami</span>' : ''}
        <span class="sv-go">${connectedIds.has(s.id) ? '<span class="ok">●</span> connected' : 'connect →'}</span>
      </div>`).join('')}</div>
    <div class="svc-custom" id="svc-custom" tabindex="0">
      <span class="code" style="background:${TINTS[1]}">✳</span>
      <span class="col"><span class="sv-name">Something else? It gets built for you</span>
      <span class="sv-desc">say it in plain words, watch it happen</span></span>
      <span class="sv-go">build it →</span>
    </div>`);
  const clickOnEnter = (el) => { el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.onclick(); } }; };
  modal.querySelectorAll('.svc-card').forEach((el) => {
    el.onclick = () => {
      const svc = cat.find((s) => s.id === el.dataset.id);
      const already = S.services.connected.find((s) => s.id === svc.id);
      if (already) return openServiceDetails(already);
      openConnectForm(svc);
    };
    clickOnEnter(el);
  });
  q('#svc-custom', modal).onclick = () => openConnectCustom();
  clickOnEnter(q('#svc-custom', modal));
}
function openConnectForm(svc) { S.overlay = { type: 'connect-form', svc, scope: 'project', platforms: ['claude', 'opencode'], values: {} }; renderOverlay(); }
function renderConnectForm() {
  const o = S.overlay, svc = o.svc;
  const guided = svc.kind === 'guided';
  const folder = svc.kind === 'folder';
  const keyRows = (svc.keys || []).map((k) => `
    <input class="text-input sv-key" data-k="${esc(k.id)}" placeholder="${esc(k.placeholder)}" spellcheck="false" />
    ${svc.keyHelpUrl ? `<div class="sv-help" data-url="${esc(svc.keyHelpUrl)}">where do I find my key?</div>` : ''}`).join('');
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[hashIdx(svc.id)]}">${esc(svc.code)}</span>
      <span class="col"><span class="name">Connect ${esc(svc.name)}</span><span class="desc">${esc(svc.desc)}</span></span></div>
    ${guided
      ? `<p class="setup-copy">${esc(svc.guide)}</p><div class="ni-agent">${chosenAgent(o)
          ? `a new session with <select class="agent-pick" id="sv-agent">${agentOptionsHtml(o.workerId)}</select> walks you through it`
          : 'No agent is installed yet. Press ⌘N to add one first.'}</div>`
      : folder
        ? `<p class="setup-copy">Pick the one folder your agents may read and edit. Nothing outside it is reachable.</p><button class="btn" id="sv-pick-folder">Choose a folder…</button><div class="setup-note" id="sv-folder-note">${esc(o.values.folder ? shortHome(o.values.folder) : '')}</div>`
        : `<p class="setup-copy">${esc(svc.name)} gives you one key so your agents can get in. Paste it here. It stays on your Mac.</p>${keyRows}`}
    <details class="sv-fold"${o.foldOpen ? ' open' : ''}><summary>choices (fine as they are)</summary>
      <div class="sv-fold-body">
        <div class="sv-lab">works in</div>
        <div class="chip-row" id="sv-scope">
          <span class="pick-chip${o.scope === 'project' ? ' picked' : ''}" data-v="project">this project</span>
          <span class="pick-chip${o.scope === 'user' ? ' picked' : ''}" data-v="user">everywhere on this Mac</span></div>
        <div class="sv-lab">for</div>
        <div class="chip-row" id="sv-plat">
          <span class="pick-chip${o.platforms.includes('claude') ? ' picked' : ''}" data-v="claude">Claude Code</span>
          <span class="pick-chip${o.platforms.includes('opencode') ? ' picked' : ''}" data-v="opencode">OpenCode</span></div>
      </div></details>
    <div class="setup-actions">
      <button class="btn btn--go" id="sv-connect">${guided ? 'Set it up with my agent' : 'Connect'}</button>
      <button class="btn" id="sv-docs">Guide</button></div>`);
  // Re-renders rebuild the sheet, so typed keys are read into o.values before
  // every re-render and written back into the inputs after.
  const saveKeys = () => { modal.querySelectorAll('.sv-key').forEach((inp) => { o.values[inp.dataset.k] = inp.value.trim(); }); };
  modal.querySelectorAll('.sv-key').forEach((inp) => { inp.value = o.values[inp.dataset.k] || ''; });
  modal.querySelectorAll('.sv-help').forEach((el) => { el.onclick = () => api.openUrl(el.dataset.url); });
  const guidedSel = q('#sv-agent', modal);
  if (guidedSel) guidedSel.onchange = () => { o.workerId = guidedSel.value; };
  const fold = q('.sv-fold', modal); fold.ontoggle = () => { o.foldOpen = fold.open; };
  q('#sv-docs', modal).onclick = () => api.openUrl(svc.docs);
  q('#sv-scope', modal).querySelectorAll('.pick-chip').forEach((chip) => { chip.onclick = () => { saveKeys(); o.scope = chip.dataset.v; renderOverlay(); }; });
  q('#sv-plat', modal).querySelectorAll('.pick-chip').forEach((chip) => {
    chip.onclick = () => { saveKeys(); const v = chip.dataset.v; o.platforms = o.platforms.includes(v) ? o.platforms.filter((x) => x !== v) : [...o.platforms, v]; renderOverlay(); };
  });
  const pickBtn = q('#sv-pick-folder', modal);
  if (pickBtn) pickBtn.onclick = async () => { const info = await api.pickFolder(); if (info) { o.values.folder = info.path; q('#sv-folder-note', modal).textContent = info.pathShort; } };
  // Install kind (kie): two honest clicks. First click installs in a visible
  // terminal tile; reopening the sheet finds the build and offers Connect.
  const install = svc.kind === 'install';
  const installDirOf = () => '~/.nami/connectors/' + svc.docs.split('/').pop();
  if (install && o.installed === undefined) {
    q('#sv-connect', modal).textContent = 'Install first';
    api.statPath({ token: installDirOf() + '/dist/index.js' }).then((st) => {
      o.installed = !!(st && st.exists);
      const b = q('#sv-connect', modal);
      if (b && b.textContent !== 'Connecting…') b.textContent = o.installed ? 'Connect' : 'Install first';
    });
  } else if (install) {
    q('#sv-connect', modal).textContent = o.installed ? 'Connect' : 'Install first';
  }
  q('#sv-connect', modal).onclick = async () => {
    if (guided) return startGuidedSetup(svc, chosenAgent(o));
    if (install && !o.installed) {
      const dir = installDirOf();
      closeOverlay();
      startPanel({ kind: 'run', title: 'install ' + svc.name, code: svc.code,
        command: 'git clone ' + svc.docs + ' ' + dir + ' && cd ' + dir + ' && npm install && npm run build' });
      toast('When the install finishes, open Connect again: one more click.');
      return;
    }
    saveKeys();
    if (install) o.values.installDir = installDirOf();
    if (svc.keys.some((k) => !o.values[k.id]) || (folder && !o.values.folder)) { toast(folder ? 'Choose a folder first.' : 'Paste your key first.'); return; }
    if (!o.platforms.length) { toast('Tick at least one platform under choices.'); return; }
    q('#sv-connect', modal).textContent = 'Connecting…';
    const res = await api.connectService({ id: svc.id, values: o.values, scope: o.scope, platforms: o.platforms, projectPath: S.project && S.project.path });
    refreshServices(); loadLibrary(true);
    S.overlay = { type: 'connect-done', svc, result: res }; renderOverlay();
  };
}
function renderConnectDone() {
  const { svc, result } = S.overlay;
  const okLine = result.ok
    ? (result.checked ? `tested just now: ${esc(svc.name)} answers · ${result.tools} tools ready` : `written, but the test could not confirm it yet (${esc(result.checkError || 'no answer')})`)
    : `something went wrong: ${esc(result.error || 'unknown')}`;
  const extra = result.claudeUserScope && result.claudeUserScope !== 'written' ? `<div class="setup-note">${esc(result.claudeUserScope)}</div>` : '';
  const modal = overlay('setup-box', `
    <div class="sv-bigok"><div class="sv-bigok-t caveat">${result.ok ? esc(svc.name) + ' is connected!' : 'Not yet.'}</div>
      <div class="sv-bigok-s">${result.ok ? 'your agents can use it from the very next session' : 'nothing broke, and nothing was half-written'}</div></div>
    <div class="sv-okline"><span class="ok"${result.ok ? '' : ' style="color:var(--amber-ink)"'}>●</span> ${okLine}</div>
    <details class="sv-fold"><summary>curious what got written? peek here</summary>
      <div class="sv-fold-body"><div class="setup-note">${(result.files || []).map(esc).join(' · ') || 'nothing yet'}</div>${extra}</div></details>
    <div class="setup-actions">
      <button class="btn btn--go" id="sv-done">Done</button>
      <button class="btn" id="sv-more">Connect another</button></div>`);
  q('#sv-done', modal).onclick = closeOverlay;
  q('#sv-more', modal).onclick = openConnect;
}
function openServiceDetails(sv) {
  const cat = S.services.catalog.find((s) => s.id === sv.id);
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[hashIdx(sv.id)]}">${esc((cat && cat.code) || 'SV')}</span>
      <span class="col"><span class="name">${esc(sv.name)}</span>
      <span class="desc"><span class="ok">●</span> connected · ${esc(sv.platforms.join(' + '))} · ${esc(sv.scopes.map((s) => s === 'project' ? 'this project' : 'your Mac').join(', '))}</span></span></div>
    <div class="setup-actions">
      <button class="btn" id="sv-disc">Disconnect</button>
      <button class="btn btn--go" id="sv-ok">Done</button></div>`);
  q('#sv-ok', modal).onclick = closeOverlay;
  q('#sv-disc', modal).onclick = async () => {
    await api.disconnectService({ id: sv.id, projectPath: S.project && S.project.path });
    refreshServices(); closeOverlay(); toast(sv.name + ' disconnected.');
  };
}
// The factory is the user's own agent, whichever one they have installed.
function bestAgent() {
  const ready = (S.agents || []).filter((a) => a.found);
  return ready[0] || null; // registry order: claude, codex, opencode, gemini, hermes, kimi
}
// Session selector shared by every handoff sheet: the user picks which
// installed agent does the work; default is the first detected.
function agentOptionsHtml(selectedId) {
  const ready = (S.agents || []).filter((a) => a.found);
  return ready.map((a) => `<option value="${esc(a.id)}"${a.id === selectedId ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
}
function chosenAgent(o) {
  const ready = (S.agents || []).filter((a) => a.found);
  return ready.find((a) => a.id === (o && o.workerId)) || ready[0] || null;
}
function agentSession(worker, opts) {
  startPanel(Object.assign({ kind: worker.kind === 'claude' ? 'claude' : 'run',
    command: worker.kind === 'claude' ? undefined : worker.bin }, opts));
}
function openConnectCustom() { S.overlay = { type: 'connect-custom', text: '' }; renderOverlay(); if (!S.agents) refreshAgents(); }
function renderConnectCustom() {
  const o = S.overlay;
  const worker = chosenAgent(o);
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[1]}">✳</span>
      <span class="col"><span class="name">Built for you</span><span class="desc">describe it like you would to a person</span></span></div>
    <input class="text-input" id="svc-desc" placeholder="our internal wiki at wiki.acme.dev, read-only is fine" spellcheck="false" />
    <div class="ni-agent">${worker
      ? `a new session with <select class="agent-pick" id="svc-agent">${agentOptionsHtml(worker.id)}</select> builds it for you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="setup-actions" style="margin-top:12px"><button class="btn btn--go" id="svc-go" ${worker ? '' : 'disabled'}>Go</button></div>
    <p class="setup-note">Watch it work, talk to it if you want. The service appears under Library when it lands.</p>`);
  const agentSel = q('#svc-agent', modal);
  if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
  const input = q('#svc-desc', modal); input.value = o.text; setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.text = input.value; };
  q('#svc-go', modal).onclick = () => {
    const w = chosenAgent(o);
    if (!o.text.trim() || !w) return;
    closeOverlay();
    agentSession(w, { title: 'build: connector', code: 'BC', seed:
      `Build an MCP connector for this: ${o.text.trim()}. When it works, register it for this project by adding it to .mcp.json (and opencode.json if OpenCode is installed), then tell me what tools it exposes.` });
    toast('Your agent is on it. The service appears under Library when it lands.');
  };
}
function startGuidedSetup(svc, worker) {
  worker = worker || bestAgent();
  if (!worker) { toast('No agent is installed yet. Press ⌘N to add one first.'); return; }
  closeOverlay();
  agentSession(worker, { title: 'set up ' + svc.name, code: svc.code, seed:
    `Walk me through connecting ${svc.name} step by step (${svc.docs}). Do every step you can yourself, ask me only when a browser sign-in needs me, and when it works register it for this project.` });
  toast('Your agent will walk you through it, right in the tile.');
}
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
  S.library.loaded = false; S.library.items = [];
  S.recents = [{ path: info.path, pathShort: info.pathShort, name: info.name }, ...S.recents.filter((r) => r.path !== info.path)].slice(0, 8);
  S.tree[info.path] = info.tree && info.tree.length && info.tree[0].path ? info.tree : null;
  // load root level fresh for the explorer
  api.listDir(info.path).then((rows) => { S.tree[info.path] = rows; if (S.railTab === 'workspace') refreshRail(); });
  refreshServices();
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
