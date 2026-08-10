// Nami — the agent workbench, by Dainami (renderer, terminal-first).
// Every session is a real PTY (claude / shell / any harness), shown as a paper tile in a grid you
// can focus, reorder, and expand. Workspace is a live explorer + paper editor. Vanilla DOM; tiles
// (xterm + editors) are managed incrementally so live processes survive re-renders.

import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
import { WebglAddon } from './vendor/addon-webgl.mjs';
import { fileKind, shellQuote, fileUrl } from './file-kinds.mjs';
import { parseDoc, getField, setField, serializeDoc } from './frontmatter.mjs';
import { resolveOpen } from './peek-core.mjs';
import { buildCreateSeed, buildImproveSeed, targetDirFor } from './seed-text.mjs';
import { chipHtml, iconKeyFor, treeIcon, pixIcon } from './icons.mjs';
import { shortAge } from './rel-time.mjs';
import { isGenericTitle, feedNameDraft, adoptTitle, shouldPushName } from './session-name.mjs';
import { renderMarkdown, highlightMarkdown, isMarkdownPath, docHrefTarget } from './md.mjs';
import { scanLinks, urlTarget } from './term-links.mjs';

const api = window.dainami;

// ---- palette ---------------------------------------------------------------
// Colour answers exactly one question: what kind of thing is this? It is never
// derived from an id, so every service looks like a service and you only have
// to learn the palette once. The hues live in paper.css as [data-kind] rules:
// agent · skill · command · service · editor · viewer · shell · folder.
// A panel's kind → its chip kind. Anything that runs an agent reads as one.
function chipKindOf(panel) {
  if (!panel) return 'neutral';
  if (panel.chipKind) return panel.chipKind;
  switch (panel.kind) {
    case 'editor': return 'editor';
    case 'viewer': return 'viewer';
    case 'shell': return 'shell';
    case 'card': return 'agent';
    // every agent session is one kind — Claude, OpenCode, any other CLI — so the
    // desk, the rail and the new-session picker all show the same green
    default: return 'agent';
  }
}

const XTERM_THEME = {
  // Transparent, but with the paper's RGB channels: xterm's minimumContrastRatio
  // measures against this color, so faint dark-theme TUI text gets re-inked for cream.
  background: 'rgba(253,249,236,0)', foreground: '#2b2822', cursor: '#4a6b52', cursorAccent: '#fdf9ec',
  selectionBackground: 'rgba(201,169,78,0.38)',
  black: '#5a4b34', red: '#a8482f', green: '#4a7a4a', yellow: '#9a7420', blue: '#3f6088',
  magenta: '#8a5f8a', cyan: '#3f7d82', white: '#6f6553',
  brightBlack: '#8d8065', brightRed: '#b4503c', brightGreen: '#5f8f5f', brightYellow: '#a8792a',
  brightBlue: '#5a7fae', brightMagenta: '#a07aa0', brightCyan: '#5aa0a0', brightWhite: '#2f2b26',
};

// ---- themes (paper default · operator dark) --------------------------------
const THEME_KEY = 'dainami-theme';
const XTERM_THEME_OPERATOR = {
  // Transparent over the operator panel; minimumContrastRatio re-inks
  // cream-tuned TUI text for the dark ground.
  background: 'rgba(23,23,23,0)', foreground: '#e2e0dc', cursor: '#ef6461', cursorAccent: '#0d0d0d',
  selectionBackground: 'rgba(239,100,97,0.28)',
  black: '#3d3d3d', red: '#ef6461', green: '#5aa06e', yellow: '#d8a03d', blue: '#6ea8ff',
  magenta: '#c792ea', cyan: '#5ac8c8', white: '#a8a59f',
  brightBlack: '#7c7a74', brightRed: '#ff8b88', brightGreen: '#66c17e', brightYellow: '#e8b45a',
  brightBlue: '#8fbcff', brightMagenta: '#d7a9f0', brightCyan: '#7adcdc', brightWhite: '#f2f0ee',
};
// glass (light frost): ANSI deepened so every CLI stays readable on the light well
const XTERM_THEME_GLASS = {
  background: 'rgba(255,255,255,0)', foreground: '#34353d', cursor: '#ef6461', cursorAccent: '#ffffff',
  selectionBackground: 'rgba(239,100,97,0.22)',
  black: '#3c3d45', red: '#d6423e', green: '#2e7d4f', yellow: '#b07c10', blue: '#3763c9',
  magenta: '#a4499d', cyan: '#1f7f86', white: '#8b8c96',
  brightBlack: '#6a6b76', brightRed: '#e0524f', brightGreen: '#3f9b63', brightYellow: '#c98d1a',
  brightBlue: '#5b82d9', brightMagenta: '#bb64b3', brightCyan: '#2f989f', brightWhite: '#1d1d22',
};
// graphite (dark grey glass): the same slots brightened for the smoke well
const XTERM_THEME_GRAPHITE = {
  background: 'rgba(25,26,32,0)', foreground: '#dcdde6', cursor: '#ff8b88', cursorAccent: '#26272c',
  selectionBackground: 'rgba(239,100,97,0.3)',
  black: '#4a4b55', red: '#ff6b67', green: '#5fca8b', yellow: '#e8b33e', blue: '#6f9dff',
  magenta: '#d580cc', cyan: '#4fc2cc', white: '#a7a8b3',
  brightBlack: '#7c7d88', brightRed: '#ffa19e', brightGreen: '#7fdca3', brightYellow: '#f2c766',
  brightBlue: '#93b5ff', brightMagenta: '#e3a1dc', brightCyan: '#78d8d8', brightWhite: '#f0f0f6',
};
const STATUS_COLORS = {
  paper: { ok: '#4a7a4a', warn: '#a8792a', mut: '#8d8065' },
  operator: { ok: '#5aa06e', warn: '#ef6461', mut: '#7c7a74' },
  glass: { ok: '#2e7d4f', warn: '#b07c10', mut: '#8f9094' },
  graphite: { ok: '#63c68a', warn: '#e6c05c', mut: '#9a9ba6' },
};
const THEME_NAMES = ['paper', 'operator', 'glass', 'graphite'];
const GLASS_FAMILY = new Set(['glass', 'graphite']);
const XTERM_THEMES = { paper: XTERM_THEME, operator: XTERM_THEME_OPERATOR, glass: XTERM_THEME_GLASS, graphite: XTERM_THEME_GRAPHITE };
function currentTheme() {
  const t = document.body.dataset.theme;
  return THEME_NAMES.includes(t) ? t : 'paper';
}
function xtermTheme() { return XTERM_THEMES[currentTheme()]; }
function statusColors() { return STATUS_COLORS[currentTheme()]; }
// SF Mono in every theme's terminal, Courier Prime everywhere else.
//
// Courier Prime is a typewriter face: thin strokes, low x-height, wide letters.
// It is what makes Nami's chrome look hand-made and it is the worst thing about
// reading a dense terminal — an agent's output is small, dense, and rarely
// re-read carefully, which is the opposite of what that face is for. The glass
// themes already made this trade; the rest now follow.
//
// The UI keeps Courier Prime, so the desk still reads as paper. Only the
// terminals change.
function termFontFamily() {
  return "'SF Mono', ui-monospace, Menlo, monospace";
}
function applyThemeAttrs(name) {
  if (name !== 'paper' && THEME_NAMES.includes(name)) document.body.dataset.theme = name;
  else delete document.body.dataset.theme;
  // data-glass scopes the shared liquid-glass system CSS + the tilt engine
  if (GLASS_FAMILY.has(name)) document.body.setAttribute('data-glass', '');
  else document.body.removeAttribute('data-glass');
}
function setTheme(name, persistIt = true) {
  applyThemeAttrs(name);
  try { localStorage.setItem(THEME_KEY, name); } catch (_) {}
  if (persistIt && api.themeSet) api.themeSet(name);
  tileEls.forEach((t) => {
    if (!t.term) return;
    t.term.options.theme = xtermTheme();
    t.term.options.fontFamily = termFontFamily();
    t.term.options.fontSize = termFontSize();
    t.term.options.letterSpacing = termLetterSpacing();
    safeFit(t);
  });
  if (els.grid) renderAll();
}
// apply the saved theme before first paint (localStorage mirrors settings.json)
try { applyThemeAttrs(localStorage.getItem(THEME_KEY)); } catch (_) {}

// ---- launcher rows ---------------------------------------------------------
// Agents come from the detected registry (S.agents); only Terminal is static.
// Big rows are things that run right now; small cards are things you could add.
const EVERGREEN_ROWS = [
  { id: 'shell', name: 'Terminal', sub: 'a plain shell, ink on paper', kind: 'shell', chipKind: 'shell', code: '❯' },
];

// ---- state -----------------------------------------------------------------
const S = {
  project: null, recents: [], claudeExe: null, demo: false,
  panels: [], activeId: null, expandedId: null,
  railTab: 'sessions', overlay: null, toast: null, seq: 0, winId: 0,
  agents: null, agentsLoading: false,   // detected agent CLIs (null until first scan)
  agentStatus: {},                      // id → { signedIn, label, rows, source }, filled lazily
  tree: {}, expanded: new Set(),   // explorer: path -> children[], expanded dirs
  treeAll: localStorage.getItem('dainami-tree-all') === '1',  // show ignored files too
  library: { items: [], edges: [], q: '', loaded: false, loading: false, collapsed: new Set(['plugins']) },
  services: { catalog: [], connected: [], loading: false },   // connect-a-service state
  railCollapsed: false,
};

let els = {};
const tileEls = new Map(); // panelId -> { root, head, body, term, fit, statusDot, ta, gutter }

// w<winId> makes the name unique across every open window: main keys its session
// maps by whatever id we invent here, and on its own S.seq restarts at 1 in each
// window. See the boot handler in main.js. Ids are opaque everywhere (nothing
// parses one, none is written to state.json), so the prefix is free.
function uid(p) { S.seq += 1; return `w${S.winId}_${p}${S.seq}`; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function shorten(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function code2(str) {
  const w = String(str || '').replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return (String(str || '?').replace(/[^a-zA-Z]/g, '').slice(0, 2) || 'SS').toUpperCase();
}
function baseNameOf(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '(file)'; }
function shortHome(p) { return String(p || '').replace(/^\/Users\/[^/]+/, '~'); }
function q(sel, root) { return (root || document).querySelector(sel); }
// A panel's chip: brand glyph when the session maps to a known brand, else its code.
function panelChip(p) {
  const key = p.kind === 'claude' ? 'claude'
    : iconKeyFor(p.title);
  return chipHtml({ key, code: p.code, kind: chipKindOf(p) });
}

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
  S.winId = b.winId || 0;
  S.demo = b.demo; S.claudeExe = b.claudeExe; S.recents = b.recentFolders || []; S.project = b.currentFolder || null;
  setSttInfo(b.sttInfo);
  if (b.collapsed) S.railCollapsed = true;
  if (b.themeArg) setTheme(b.themeArg, false); // --theme= override (screenshots)

  // One window opening a folder reorders the list for every window; without this
  // the other windows' popovers keep showing a stale order until they reboot.
  // Either the check already ran before this window existed (boot carries it),
  // or it lands later while the window is open.
  if (b.update) offerUpdate(b.update);
  api.onUpdateAvailable(offerUpdate);

  api.onRecentsChanged((rows) => {
    S.recents = rows || [];
    if (q('.projects-pop')) { q('.projects-pop').remove(); toggleProjectsPop(); }
  });

  api.onTermData(({ id, data }) => { const t = tileEls.get(id); if (t && t.term) t.term.write(data); });
  api.onTermExit(({ id, code, note }) => {
    const p = S.panels.find((x) => x.id === id); if (!p) return;
    p.exited = true; p.status = 'exited';
    // main writes the note, because only it knows whether Nami ended this
    // session or the process did. `code` stays in the payload for older paths.
    const said = note || `exited · ${code}`;
    const t = tileEls.get(id); if (t && t.term) t.term.write(`\r\n\x1b[38;2;141;128;101m[${said}]\x1b[0m\r\n`);
    // A panel can care that its command finished — an agent sign-out re-reads
    // who is signed in, so the details sheet is never stale.
    if (p.onExit) { try { p.onExit(code); } catch (_) {} }
    refreshTileHead(p); refreshRail(); renderHeader();
  });

  // Claude names its own conversation a few turns in, and re-names it as the
  // work moves on. That name is what `claude --resume` will show tomorrow, so
  // the rail shows it too — unless you named the tile yourself.
  api.onSessionTitle(({ id, title }) => {
    const p = S.panels.find((x) => x.id === id); if (!p) return;
    applyTitle(p, title, 'agent');
  });

  // /resume inside a tile lands claude in a different conversation than the one
  // nami pinned at spawn. Storing the id it actually moved to is what makes the
  // tile come back as that conversation next launch instead of an empty one.
  api.onSessionSid(({ id, sid }) => {
    const p = S.panels.find((x) => x.id === id); if (!p || !sid || p.sid === sid) return;
    p.sid = sid;
    savePanels();
  });

  if (S.demo) seedDemo();
  refreshAgents();   // pre-detect so ⌘N is instant
  refreshServices(); // services group in the library + connect sheets
  renderAll();
  if (!S.demo && Array.isArray(b.panels) && b.panels.length) restorePanels(b.panels);
  if (b.scene) showScene(b.scene);
})();

// --scene= puts one surface on screen at boot so `npm run shot` can capture it in both
// themes. Screenshot plumbing only; nothing in the app calls this.
function showScene(name) {
  const [what, step] = String(name).split(':');
  if (what === 'settings') return openSettings(step || 'voice');
  // agent surfaces need the detect pass to have landed, and the sheet also
  // needs that agent's identity, so both wait rather than shooting "checking…"
  if (what === 'launcher' || what === 'agent' || what === 'agent-remove') {
    return refreshAgents().then(async () => {
      if (what === 'launcher') return openLauncher();
      const a = (S.agents || []).find((x) => x.id === step) || (S.agents || []).find((x) => x.found);
      if (!a) return openLauncher();
      await refreshAgentStatus(a.id);
      return what === 'agent' ? openAgentSheet(a) : openAgentRemove(a);
    });
  }
  if (what === 'projects') return toggleProjectsPop();
  // The update card only appears when a newer release exists, which is exactly
  // the state you cannot arrange on demand — so the scene fakes the payload.
  if (what === 'update') {
    localStorage.removeItem(SKIPPED_UPDATE);
    return offerUpdate({ version: step || '0.2.0', url: 'https://example.test/Nami.dmg' });
  }
  // rename:tile / rename:rail — the in-place name editor, which you can only
  // otherwise reach by double-clicking a live session
  if (what === 'rename') {
    const p = S.panels.find((x) => isSessionPanel(x));
    if (!p) return;
    const t = tileEls.get(p.id);
    return beginRename(p, step === 'rail' ? q('.rail-list .nav-card .goal') : t && q('.t-title', t.head));
  }
  if (what === 'theme') return toggleThemePop();
  if (what === 'workspace') {
    // the tree needs a folder; fall back to the most recent one if none is open
    const ready = S.project ? Promise.resolve() : (S.recents[0] ? openFolder(S.recents[0].path) : Promise.resolve());
    return ready.then(() => { S.railTab = 'workspace'; renderRail(); });
  }
  S.railTab = 'library';
  loadLibrary(true).then(() => {
    renderRail();
    if (what === 'library') return;
    if (what === 'mcp') return openConnect();
    if (what !== 'agent' && what !== 'skill') return;
    openCreate(what);
    if (step) { S.overlay.step = Number(step) || 1; renderOverlay(); }
  });
}

// ===========================================================================
//  Static shell
// ===========================================================================
function buildShell() {
  document.getElementById('root').innerHTML = `
    <div class="desk"><div class="sheet">
      <div class="topbar">
        <div class="brand">
          <span class="brand-mark">
            <svg class="nami-mascot" viewBox="474 285 1084 1400" aria-hidden="true">
              <defs>
                <!-- glass themes fill the body with this dot lattice (same grid
                     language as the Doto type); other themes never reference it -->
                <pattern id="nami-dot-lattice" width="140" height="140" patternUnits="userSpaceOnUse">
                  <circle cx="70" cy="70" r="52" fill="var(--nami-fill)"/>
                </pattern>
              </defs>
              <g class="nami-body" transform="translate(0.000000,2048.000000) scale(1.000000,-1.000000)" fill="var(--nami-fill)">
              <path d="M962 1762 c-201 -12 -357 -148 -373 -324 -12 -132 86 -235 207 -219
              86 12 143 93 112 160 -16 34 -52 45 -65 19 -10 -20 -40 -17 -51 6 -20 38 18
              94 74 111 70 20 128 -11 162 -88 12 -30 28 -41 62 -45 98 -11 126 -123 50
              -199 -64 -64 -174 -70 -329 -20 -79 26 -119 31 -167 19 -105 -24 -166 -131
              -170 -294 -3 -188 77 -322 226 -375 18 -7 50 -16 55 -16 3 0 3 -1 0 -14 -4
              -15 -5 -46 -2 -59 11 -41 41 -61 90 -60 58 2 89 43 81 107 l-1 6 18 0 c10 -1
              47 -1 82 -1 56 0 63 0 63 -1 -2 -5 -3 -25 -2 -36 5 -50 33 -74 87 -74 64 0 95
              41 84 110 -2 12 -4 10 16 13 172 29 265 149 285 369 2 19 2 110 0 135 -28 397
              -212 695 -469 757 -41 10 -90 15 -125 13z m383 -1005 c0 -8 -1 -2 -1 13 0 14
              1 20 1 13 0 -7 0 -19 0 -26z m-117 2 c0 -6 -1 -2 -1 11 0 12 1 17 1 11 0 -6 0
              -16 0 -22z"/>
              </g>
              <g transform="translate(0.000000,2048.000000) scale(1.000000,-1.000000)" fill="var(--nami-foam)">
              </g>
              <g transform="translate(0.000000,2048.000000) scale(1.000000,-1.000000)" fill="var(--nami-eye)">
              <path d="M723 830 c-27 -3 -34 -14 -35 -55 -1 -59 8 -67 65 -66 47 1 55 14 51
              77 -2 37 -13 45 -59 45 -9 0 -19 -1 -22 -1z M1263 830 c-28 -3 -35 -15 -35
              -60 0 -54 9 -62 65 -61 34 1 45 8 50 29 2 11 1 63 -2 70 -8 20 -34 27 -78 22z"/>
              </g>
            </svg>
            <span class="brand-name">Nami</span>
          </span>
          <span class="brand-sub">AI agent workbench</span>
        </div>
        <div class="topbar-center" id="topbar-center"></div>
        <div class="topbar-right">
          <div class="live-badge" id="live-badge" style="display:none"><span class="dot"></span><span id="live-label"></span></div>
          <div class="theme-zone" id="theme-zone"><button class="btn" id="btn-theme" title="Theme"><span class="uni-i">◐</span><span class="pix-i">${pixIcon('theme')}</span></button></div>
          <button class="btn btn-set" id="btn-settings" title="Settings ⌘,"><span class="uni-i">⚙</span><span class="pix-i">${pixIcon('settings')}</span></button>
          <button class="btn" id="btn-agents">Agents<span class="kb"> ⌘K</span></button>
          <button class="btn btn--go" id="btn-new"><span class="uni-i">＋ </span><span class="pix-i">${pixIcon('plus')}</span>New<span class="kb2"> session</span><span class="kb"> ⌘N</span></button>
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
          <div id="update-root"></div>
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
    updateRoot: q('#update-root'),
  };
  q('#btn-new').onclick = () => openLauncher();
  q('#btn-agents').onclick = () => openAgentPicker();
  q('#btn-theme').onclick = (e) => { e.stopPropagation(); toggleThemePop(); };
  q('#btn-settings').onclick = () => openSettings();
  document.querySelectorAll('.rail-tab').forEach((t) => { t.onclick = () => { S.railTab = t.dataset.tab; if (t.dataset.tab === 'library') loadLibrary(true); renderRail(); }; });
  q('#rail-collapse').onclick = () => { S.railCollapsed = true; applyChrome(); };
  q('#rail-strip').onclick = () => { S.railCollapsed = false; applyChrome(); };
  document.addEventListener('keydown', onGlobalKey);
  initGlassTilt();

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

// ---- glass 3D tilt ----------------------------------------------------------
// In the glass themes, panes tilt toward the cursor: pointer position feeds the
// --rx/--ry vars that theme-glass.css puts into each pane's transform. One
// delegated listener, rAF-throttled; other themes pay nothing (early return),
// and stale vars are inert because only [data-glass] transforms read them.
function initGlassTilt() {
  let pane = null, raf = 0, lastEvent = null;
  const reset = (el) => { if (el) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); } };
  document.addEventListener('pointermove', (e) => {
    if (!document.body.hasAttribute('data-glass')) { if (pane) { reset(pane); pane = null; } return; }
    let hit = e.target instanceof Element ? e.target.closest('.tile, .card, .nav-card') : null;
    // terminal tiles lift on hover but never rotate: a tilting xterm canvas is
    // both the most expensive surface to re-render and the one that reads wobbly
    if (hit && hit.querySelector('.term-body')) hit = null;
    if (hit !== pane) { reset(pane); pane = hit; }
    if (!pane) return;
    lastEvent = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!pane || !lastEvent) return;
      const r = pane.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // small panes get the playful tilt; big work surfaces stay subtle
      const mx = pane.classList.contains('nav-card') ? 5 : 3;
      const my = pane.classList.contains('nav-card') ? 7 : 4;
      const x = (lastEvent.clientX - r.left) / r.width;
      const y = (lastEvent.clientY - r.top) / r.height;
      pane.style.setProperty('--rx', ((0.5 - y) * mx).toFixed(2) + 'deg');
      pane.style.setProperty('--ry', ((x - 0.5) * my).toFixed(2) + 'deg');
    });
  });
  document.addEventListener('pointerleave', () => { reset(pane); pane = null; });
}

function applyChrome() {
  const sheet = q('.sheet');
  sheet.classList.toggle('rail-collapsed', S.railCollapsed);
  // tiles need a re-fit when the grid width changes
  setTimeout(() => tileEls.forEach((t) => safeFit(t)), 60);
}

function onGlobalKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.shiftKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); api.newWindow(); return; }
  if (meta && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); openLauncher(); return; }
  if (meta && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFolderDialog(); return; }
  if (meta && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openAgentPicker(); return; }
  if (meta && e.key === ',') { e.preventDefault(); openSettings(); return; }
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
    ? `<span class="folder-glyph">${treeIcon('', 'dir', true)}</span><span class="name">${esc(p.name)}</span><span class="path">${esc(p.pathShort)}</span><span class="caret">▼</span>`
    : `<span class="folder-glyph">${treeIcon('', 'dir', false)}</span><span class="name">Open a folder</span><span class="caret">▼</span>`;
  chip.onclick = (e) => { e.stopPropagation(); toggleProjectsPop(); };
  els.topbarCenter.appendChild(chip);
  const live = S.panels.filter((x) => x.status === 'live' && x.kind !== 'editor').length;
  const attn = S.panels.filter((x) => x.attention).length;
  if (live > 0) { els.liveBadge.style.display = ''; els.liveLabel.textContent = attn ? `${attn} needs you` : `${live} live`; els.liveBadge.classList.toggle('attn', attn > 0); }
  else els.liveBadge.style.display = 'none';
}
function projectRowHtml(r) {
  if (r.missing) {
    return `<button class="project-row dead" data-path="${esc(r.path)}" title="${esc(r.path)}">
      <span class="folder-glyph">${treeIcon('', 'dir', false)}</span>
      <span class="col"><span class="name">${esc(r.name)}</span><span class="summary">moved or deleted — locate…</span></span>
      <span class="mark row-forget" title="Remove from Recents">✕</span></button>`;
  }
  return `<button class="project-row" data-path="${esc(r.path)}" title="${esc(r.path)}">
    <span class="mark row-pin${r.pinned ? ' on' : ''}" title="${r.pinned ? 'Unpin' : 'Pin to the top'}">${r.pinned ? '●' : '○'}</span>
    <span class="folder-glyph">${treeIcon('', 'dir', false)}</span>
    <span class="col"><span class="name">${esc(r.name)}</span><span class="summary">${esc(r.pathShort)}</span></span>
    <span class="row-age">${esc(shortAge(r.at))}</span>
    <span class="mark row-newwin" title="Open in a new window">⧉</span>
    <span class="mark row-forget" title="Remove from Recents">✕</span></button>`;
}

function toggleProjectsPop() {
  const ex = q('.projects-pop'); if (ex) { ex.remove(); return; }
  const pop = document.createElement('div'); pop.className = 'projects-pop';
  // Pinned folders are the ones you live in, so they get their own group above
  // the churn — a stray peek at ~/Downloads can never push them down.
  const all = S.recents || [];
  const pinned = all.filter((r) => r.pinned);
  const rest = all.filter((r) => !r.pinned);
  const group = (label, rows) => rows.length ? `<div class="pop-label">${label}</div>${rows.map(projectRowHtml).join('')}` : '';
  const body = pinned.length
    ? group('Pinned', pinned) + group('Recent', rest)
    : group('Recent folders', rest);
  pop.innerHTML = `${body || '<div class="rail-empty">No recent folders yet.</div>'}
    <button class="project-open-other" id="open-other"><span class="plus">＋</span><span>Open another folder…</span><span class="kbd">⌘O</span></button>
    <button class="project-open-other" id="open-newwin"><span class="plus">⧉</span><span>New window</span><span class="kbd">⇧⌘N</span></button>`;
  // fixed + measured + parked on body, not absolute-in-topbar: the topbar clips
  // its descendants (overflow backstop for ⌘+ zoom), and renderHeader() rebuilds
  // topbar-center's innerHTML, which would silently eat the pop.
  const anchor = els.topbarCenter.getBoundingClientRect();
  pop.style.left = (anchor.left + anchor.width / 2) + 'px';
  pop.style.top = (anchor.top + 46) + 'px';
  document.body.appendChild(pop);
  const reopen = () => { const p = q('.projects-pop'); if (p) p.remove(); toggleProjectsPop(); };
  pop.querySelectorAll('.project-row').forEach((row) => {
    const path = row.dataset.path;
    const dead = row.classList.contains('dead');
    // A dead row offers the only useful thing left: point at where it went.
    row.onclick = async () => { pop.remove(); if (dead) openFolderDialog(); else await openFolder(path); };
    const pin = q('.row-pin', row);
    if (pin) pin.onclick = async (e) => {
      e.stopPropagation();
      S.recents = await api.recentsPin(path, !row.querySelector('.row-pin').classList.contains('on'));
      reopen();
    };
    const win = q('.row-newwin', row);
    if (win) win.onclick = (e) => { e.stopPropagation(); pop.remove(); api.newWindow(path); };
    q('.row-forget', row).onclick = async (e) => {
      e.stopPropagation();
      S.recents = await api.recentsRemove(path);
      reopen();
    };
  });
  q('#open-other', pop).onclick = () => { pop.remove(); openFolderDialog(); };
  q('#open-newwin', pop).onclick = () => { pop.remove(); api.newWindow(); };
  // The reopen path rebuilds the pop inside a click, so arm the dismiss listener
  // on the next tick or it fires on the very click that opened this one.
  setTimeout(() => document.addEventListener('click', function off() { pop.remove(); document.removeEventListener('click', off); }, { once: true }), 0);
}

// ---- theme popover (◐ in the topbar) ---------------------------------------
const THEME_OPTIONS = [
  { id: 'paper', name: 'paper', desc: 'cream desk' },
  { id: 'operator', name: 'operator', desc: 'dark ops' },
  { id: 'glass', name: 'glass', desc: 'liquid glass' },
  { id: 'graphite', name: 'graphite', desc: 'dark glass' },
];
function toggleThemePop() {
  const zone = q('#theme-zone');
  const ex = q('.theme-pop'); if (ex) { ex.remove(); return; }
  const pop = document.createElement('div'); pop.className = 'theme-pop';
  pop.innerHTML = `<div class="pop-label">Appearance</div>` + THEME_OPTIONS.map((t) =>
    `<button class="theme-opt${currentTheme() === t.id ? ' picked' : ''}" data-theme-id="${t.id}">
      <span class="theme-dot"></span><span class="theme-name">${t.name}</span><span class="theme-desc">${t.desc}</span></button>`).join('');
  pop.onclick = (e) => e.stopPropagation();
  // fixed + measured + parked on body — same clipping story as the projects pop
  const anchor = zone.getBoundingClientRect();
  pop.style.right = (window.innerWidth - anchor.right) + 'px';
  pop.style.top = (anchor.bottom + 8) + 'px';
  document.body.appendChild(pop);
  pop.querySelectorAll('.theme-opt').forEach((b) => {
    b.onclick = () => {
      setTheme(b.dataset.themeId);
      pop.querySelectorAll('.theme-opt').forEach((o) => o.classList.toggle('picked', o.dataset.themeId === b.dataset.themeId));
    };
  });
  setTimeout(() => document.addEventListener('click', function off() { pop.remove(); document.removeEventListener('click', off); }, { once: true }), 0);
}

function renderRail() { document.querySelectorAll('.rail-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === S.railTab)); refreshRail(); }
// Rebuilds wipe the tab's scroller, so its position is saved and put back.
const RAIL_SCROLLER = { sessions: '.rail-list', workspace: '.tree', library: '.lib-list' };
const railScroll = {};
function refreshRail() {
  const c = els.railContent;
  const sel = RAIL_SCROLLER[S.railTab];
  const prev = q(sel, c); if (prev) railScroll[S.railTab] = prev.scrollTop;
  c.innerHTML = '';
  if (S.railTab === 'sessions') refreshSessionsRail(c);
  else if (S.railTab === 'library') refreshLibraryRail(c);
  else refreshWorkspaceRail(c);
  const next = q(sel, c); if (next && railScroll[S.railTab]) next.scrollTop = railScroll[S.railTab];
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
    row.innerHTML = `${panelChip(p)}
      <span class="col"><span class="goal" title="${esc(p.title)} — double-click to rename">${esc(shorten(p.title, 30))}</span><span class="sid">${esc(kindLabel(p))}</span></span>
      <span class="status" style="color:${m.color}">${p.attention ? '● ' : ''}${esc(m.label)}</span>`;
    row.onclick = () => focusPanel(p.id);
    q('.goal', row).addEventListener('dblclick', (e) => { e.stopPropagation(); beginRename(p, q('.goal', row)); });
    list.appendChild(row);
  }
  c.appendChild(list);
}
function refreshWorkspaceRail(c) {
  const p = S.project;
  const wrap = document.createElement('div'); wrap.className = 'tree';
  if (!p) { wrap.innerHTML = '<div class="rail-empty">Open a folder (⌘O) to browse and edit files.</div>'; c.appendChild(wrap); return; }
  const head = document.createElement('div'); head.className = 'tree-path';
  const pathSpan = document.createElement('span'); pathSpan.className = 'path'; pathSpan.textContent = p.pathShort;
  const toggle = document.createElement('span'); toggle.className = 'action';
  toggle.textContent = S.treeAll ? 'essentials' : 'show all';
  toggle.title = S.treeAll ? 'Hide build output, dotfiles and node_modules' : 'Show every file, including hidden and ignored ones';
  toggle.onclick = () => {
    S.treeAll = !S.treeAll;
    localStorage.setItem('dainami-tree-all', S.treeAll ? '1' : '0');
    S.tree = {};
    api.listDir(p.path, S.treeAll).then((rows) => { S.tree[p.path] = rows; refreshRail(); });
  };
  head.appendChild(pathSpan); head.appendChild(toggle); wrap.appendChild(head);
  head.oncontextmenu = (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: 'Reveal in Finder', run: () => api.revealFile(p.path) },
      { label: 'New file…', run: () => openFsName('file', p.path) },
      { label: 'New folder…', run: () => openFsName('folder', p.path) },
    ]);
  };
  // first look at this folder (e.g. right after boot): fetch the root level once
  if (!S.tree[p.path]) api.listDir(p.path, S.treeAll).then((rows) => { S.tree[p.path] = rows; if (S.railTab === 'workspace') refreshRail(); });
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
    row.innerHTML = `<span class="tw">${glyph}</span><span class="icon">${treeIcon(n.name, n.kind, isOpen)}</span>
      <span class="name" style="font-weight:${n.kind === 'dir' ? 700 : 400}">${esc(n.name)}</span><span class="meta">${esc(n.meta)}</span>`;
    row.onclick = () => { if (n.kind === 'dir') toggleDir(n.path); else openFile(n.path); };
    row.oncontextmenu = (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, treeMenu(n, dir)); };
    container.appendChild(row);
    if (n.kind === 'dir' && isOpen) renderTreeLevel(container, n.path, depth + 1);
  }
}
async function toggleDir(dir) {
  if (S.expanded.has(dir)) { S.expanded.delete(dir); refreshRail(); return; }
  if (!S.tree[dir]) S.tree[dir] = await api.listDir(dir, S.treeAll);
  S.expanded.add(dir); refreshRail();
}

// ---- workspace context menu ------------------------------------------------
function showMenu(x, y, items) {
  hideMenu();
  const m = document.createElement('div'); m.className = 'ctx-menu'; m.id = 'ctx-menu';
  for (const it of items) {
    if (it === '-') { const hr = document.createElement('div'); hr.className = 'ctx-sep'; m.appendChild(hr); continue; }
    const row = document.createElement('div'); row.className = 'ctx-item' + (it.danger ? ' danger' : '');
    row.textContent = it.label;
    row.onclick = (e) => { e.stopPropagation(); hideMenu(); it.run(); };
    m.appendChild(row);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  setTimeout(() => {
    window.addEventListener('click', hideMenu, { once: true });
    window.addEventListener('contextmenu', hideMenu, { once: true });
    window.addEventListener('keydown', escHideMenu);
  }, 0);
}
function escHideMenu(e) { if (e.key === 'Escape') hideMenu(); }
function hideMenu() { const m = document.getElementById('ctx-menu'); if (m) m.remove(); window.removeEventListener('keydown', escHideMenu); }
async function refreshTreeDir(dir) {
  S.tree[dir] = await api.listDir(dir, S.treeAll);
  if (S.railTab === 'workspace') refreshRail();
}
function treeMenu(n, parentDir) {
  const root = S.project.path;
  const items = [{ label: 'Reveal in Finder', run: () => api.revealFile(n.path) }];
  if (n.kind === 'dir') {
    items.push({ label: 'New file…', run: () => openFsName('file', n.path) });
    items.push({ label: 'New folder…', run: () => openFsName('folder', n.path) });
  }
  items.push({ label: 'Move to…', run: async () => {
    const dest = await api.chooseFolder(); if (!dest) return;
    const res = await api.fsMove({ root, src: n.path, destDir: dest });
    if (!res.ok) { toast(res.error); return; }
    S.expanded.delete(n.path);
    await refreshTreeDir(parentDir); await refreshTreeDir(dest);
    toast('Moved ' + n.name + '.');
  } });
  items.push('-');
  // Direct to Trash: right-click plus a click below a separator is deliberate,
  // and the Trash is recoverable. The library card's Delete keeps its armed
  // second click because it sits next to Save.
  items.push({ label: 'Move to Trash', danger: true, run: async () => {
    const res = await api.fsTrash({ root, path: n.path });
    if (!res.ok) { toast(res.error); return; }
    S.expanded.delete(n.path);
    refreshTreeDir(parentDir);
    toast('Moved to Trash.');
  } });
  return items;
}
function openFsName(mode, dir) { S.overlay = { type: 'fs-name', mode, dir, name: '' }; renderOverlay(); }
function renderFsName() {
  const o = S.overlay;
  const modal = overlay('picker-box', `
    <div class="picker-input"><span class="prompt-mark">＋</span>
      <span style="font-weight:700">New ${o.mode === 'file' ? 'file' : 'folder'}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--muted)">${esc(shortHome(o.dir))}</span></div>
    <div class="ni-row"><input id="fs-name" placeholder="${o.mode === 'file' ? 'notes.md' : 'a name'}" spellcheck="false" />
      <button class="btn btn--go" id="fs-go">Create</button></div>`, { top: true });
  const input = q('#fs-name', modal); input.value = o.name; setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.name = input.value; };
  const go = async () => {
    const name = input.value.trim();
    if (!name) { toast('Give it a name first.'); return; }
    const root = S.project.path;
    const res = o.mode === 'file'
      ? await api.fsNewFile({ root, dir: o.dir, name })
      : await api.fsNewFolder({ root, dir: o.dir, name });
    if (!res.ok) { toast(res.error || 'Could not create'); return; }
    closeOverlay();
    if (o.dir !== root) S.expanded.add(o.dir);
    await refreshTreeDir(o.dir);
    if (o.mode === 'file') openFile(res.path, { pin: true });
    toast('Created ' + name);
  };
  q('#fs-go', modal).onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
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
const TYPE_CHIP = { agent: { code: 'AG', kind: 'agent' }, skill: { code: 'SK', kind: 'skill' }, command: { code: 'CM', kind: 'command' } };
// The three things you can make, sitting under the Library title where they read as buttons.
// Agent and Skill open the create wizard; MCP opens the service catalog that already exists.
const LIB_MAKE = [
  // subs stay one short word — the cards are ~80px wide and anything longer wraps
  { key: 'agent', icon: 'agent', code: 'AG', kind: 'agent', name: 'Agent', sub: 'build', title: 'Create an agent' },
  { key: 'skill', icon: 'skill', code: 'SK', kind: 'skill', name: 'Skill', sub: 'teach', title: 'Create a skill' },
  { key: 'mcp', icon: 'mcp', code: 'MC', kind: 'service', name: 'MCP', sub: 'connect', title: 'Connect a service over MCP' },
];
function libGroupOf(i) { return i.scope === 'plugin' ? 'plugins' : (i.type === 'agent' ? 'agents' : 'skills'); }
// Short on purpose: the tag sits beside the item's name in a 282px rail, and
// the name is what you are actually scanning for. Longer wording lives on the
// detail sheets, where there is room for it.
function scopeTagText(scope) { return scope === 'project' ? 'project' : 'your Mac'; }
function refreshLibraryRail(c) {
  if (!S.library.loaded) loadLibrary();
  const head = document.createElement('div'); head.className = 'rail-head';
  head.innerHTML = `<span class="title">Library</span>`;
  c.appendChild(head);
  const make = document.createElement('div'); make.className = 'lib-new-grid';
  make.innerHTML = LIB_MAKE.map((m) => `<div class="add-card lib-new" data-make="${esc(m.key)}" tabindex="0" role="button" title="${esc(m.title)}">
      ${chipHtml({ key: m.icon, code: m.code, kind: m.kind })}
      <span class="ac-name">${esc(m.name)}</span><span class="ac-desc">${esc(m.sub)}</span></div>`).join('');
  c.appendChild(make);
  make.querySelectorAll('.lib-new').forEach((el) => {
    const go = () => (el.dataset.make === 'mcp' ? openConnect() : openCreate(el.dataset.make));
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
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
        row.innerHTML = `${chipHtml({ key: iconKeyFor(sv.id) || 'mcp', code: (cat && cat.code) || 'SV', kind: 'service' })}
          <span class="col"><span class="name">${esc(sv.name)}</span>
          <span class="tools"><span class="ok">●</span> connected · ${esc(sv.platforms.join(' + '))}</span></span>
          <span class="scope-tag">${scopeTagText(sv.scopes.includes('project') ? 'project' : 'user')}</span>`;
        row.onclick = () => openServiceDetails(sv);
        list.appendChild(row);
      }
      const add = document.createElement('div'); add.className = 'agent-row';
      add.innerHTML = `<span class="code" data-kind="service">⚡</span>
        <span class="col"><span class="name">connect a service</span><span class="tools">Notion, Slack, a folder…</span></span><span class="chev">›</span>`;
      add.onclick = () => openConnect();
      list.appendChild(add);
      continue;
    }
    for (const i of items) {
      const chip = TYPE_CHIP[i.type] || TYPE_CHIP.agent;
      const row = document.createElement('div'); row.className = 'agent-row';
      row.innerHTML = `${chipHtml({ key: i.type, code: chip.code, kind: chip.kind })}
        <span class="col"><span class="name">${esc(i.name)}</span><span class="tools">${esc(i.description || i.meta.tools || i.filePath)}</span></span>
        ${i.scope === 'plugin' ? '' : `<span class="scope-tag">${scopeTagText(i.scope)}</span>`}<span class="chev">›</span>`;
      row.onclick = () => openCard(i);
      list.appendChild(row);
    }
  }
  if (!shown) { const e = document.createElement('div'); e.className = 'rail-empty'; e.textContent = ql ? 'No match.' : 'Nothing here yet — the buttons above make your first.'; list.appendChild(e); }
}
function renderFooter() { els.footerPath.textContent = S.project ? S.project.pathShort : (S.claudeExe ? 'claude ready' : 'no folder open'); }

// ===========================================================================
//  Grid of tiles
// ===========================================================================
function statusMeta(p) {
  const c = statusColors();
  if (p.kind === 'card') return { label: p.dirty ? 'unsaved' : (p.item.readOnly ? 'read-only' : p.item.type), color: p.dirty ? c.warn : c.mut };
  if (p.kind === 'viewer') return { label: p.sub, color: c.mut };
  if (p.kind === 'editor') return { label: p.dirty ? 'unsaved' : 'file', color: p.dirty ? c.warn : c.mut };
  if (p.exited) return { label: 'closed', color: c.mut };
  if (p.attention) return { label: 'needs you', color: c.warn };
  return { label: 'live', color: c.ok };
}
function kindLabel(p) {
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
    // With no folder the desk asks for one instead of offering an action that
    // would have to stop and ask anyway.
    els.grid.innerHTML = S.project
      ? `<div class="lane-empty"><div class="polaroid">nothing open</div>
      <div><div class="big">Start a session</div><div class="hint">Press ⌘N (or the ＋ New session button) — Claude Code, terminals &amp; harnesses.</div></div></div>`
      : `<div class="lane-empty"><div class="polaroid">no folder</div>
      <div><div class="big">Open a folder to start working</div>
      <div class="hint">Every session runs inside a folder — that is what keeps it resumable.</div>
      <button class="btn btn--go lane-cta" id="lane-open">＋ Open a folder<span class="kb"> ⌘O</span></button></div></div>`;
    const cta = q('#lane-open', els.grid); if (cta) cta.onclick = openFolderDialog;
    return;
  }
  if (q('.lane-empty', els.grid)) els.grid.innerHTML = '';
  for (const [id, t] of tileEls) { if (!S.panels.find((p) => p.id === id)) { if (t.disposeRo) t.disposeRo(); t.root.remove(); tileEls.delete(id); } }
  els.grid.classList.toggle('has-focus', !!S.expandedId);
  // Moving a node takes the keyboard with it: insertBefore below re-parents the
  // tile, and the browser drops focus from whatever was inside it — for a
  // session tile that is xterm's hidden textarea. Expanding a tile goes straight
  // through here without focusPanel(), so nothing put the keyboard back and the
  // terminal silently stopped accepting input until the tile was clicked again.
  // Remember who had it, and give it back once the moves are done.
  const focused = document.activeElement;
  const focusedTile = focused && focused.closest ? focused.closest('.tile') : null;
  const refocusId = focusedTile ? focusedTile.dataset.id : null;
  // Moving a DOM node restarts its CSS animation, so settled tiles stay put.
  let cursor = els.grid.firstElementChild;
  for (const p of S.panels) {
    if (!tileEls.has(p.id)) mountTile(p);
    const t = tileEls.get(p.id);
    t.root.classList.toggle('focused', p.id === S.expandedId);
    t.root.classList.toggle('active', p.id === S.activeId);
    if (t.root === cursor) cursor = cursor.nextElementSibling;
    else els.grid.insertBefore(t.root, cursor);
    refreshTileHead(p);
    if (t.fit) requestAnimationFrame(() => safeFit(t));
  }
  // Only if the move actually cost us the keyboard — never steal it from a
  // rename box, the rail, or an overlay that opened during the render.
  const now = document.activeElement;
  if (refocusId && !(now && now.closest && now.closest('.tile'))) {
    const t = tileEls.get(refocusId);
    if (t) { if (t.term) t.term.focus(); else if (t.ta) t.ta.focus(); }
  }
}

const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v3"/></svg>`;
// terminal text size: one shared preference, defaulting smaller in the glass
// themes because SF Mono renders larger than Courier Prime at equal px
const TERM_FONT_KEY = 'dainami-term-fontsize';
function termFontSize() {
  const saved = Number(localStorage.getItem(TERM_FONT_KEY));
  if (saved >= 10 && saved <= 18) return saved;
  // Whole pixels, every theme: SF Mono at a fractional size yields a fractional
  // cell width, xterm then computes more columns than it can paint, and every
  // line loses its tail off the right edge. This was a glass-only rule while
  // glass was the only theme on SF Mono.
  return 12;
}
// Zero, every theme. Tracking inherits into xterm's hidden measuring element,
// which then reports a cell narrower than the font actually paints — same
// right-edge clipping as a fractional size. Courier Prime wanted 0.2; SF Mono
// does not need it.
function termLetterSpacing() { return 0; }

// Paint the terminal on the GPU instead of building a DOM node per character.
// Sharper glyph edges, and the difference is largest exactly when it matters —
// an agent dumping hundreds of lines at once.
//
// Must be called after term.open(): the addon needs a canvas in the document.
// If the GPU context is lost (a display change, sleep, or a driver reset) the
// addon cannot recover, so it is disposed and xterm falls back to the DOM
// renderer on its own. Losing sharpness is fine; a blank terminal is not, and
// that is what leaving a dead addon attached would give.
function useGpu(term) {
  let addon;
  try { addon = new WebglAddon(); } catch (_) { return; }
  try {
    addon.onContextLoss(() => { try { addon.dispose(); } catch (_) {} });
    term.loadAddon(addon);
  } catch (_) {
    // no WebGL on this machine — the DOM renderer is already in place
    try { addon.dispose(); } catch (_) {}
  }
}
function bumpTermFont(dir) {
  const next = Math.min(18, Math.max(10, termFontSize() + dir));
  try { localStorage.setItem(TERM_FONT_KEY, String(next)); } catch (_) {}
  tileEls.forEach((r) => { if (r.term) { r.term.options.fontSize = next; safeFit(r); } });
  toast('Terminal text · ' + next + 'px');
}
function mountTile(p) {
  const root = document.createElement('div'); root.className = 'tile enter'; root.dataset.id = p.id;
  root.addEventListener('animationend', (e) => { if (e.target === root) root.classList.remove('enter'); });
  setTimeout(() => root.classList.remove('enter'), 600); // occluded windows throttle animations — drop it regardless
  root.innerHTML = `<div class="tile-head" draggable="true">
      ${panelChip(p)}
      <span class="col"><span class="t-title">${esc(p.title)}</span><span class="t-sub"></span></span>
      <span class="t-status"><span class="dot"></span><span class="lbl"></span></span>
      <button class="t-btn t-mic" title="Dictate into this session">${MIC_SVG}</button>
      ${['card', 'viewer', 'editor'].includes(p.kind) ? '' : `
      <button class="t-btn t-zoom-out" title="Smaller terminal text"><span class="uni-i">−</span><span class="pix-i">${pixIcon('minus')}</span></button>
      <button class="t-btn t-zoom-in" title="Bigger terminal text"><span class="uni-i">＋</span><span class="pix-i">${pixIcon('plus')}</span></button>`}
      <button class="t-btn t-expand" title="Expand"><span class="uni-i">⤢</span><span class="pix-i">${pixIcon('expand')}</span></button>
      <button class="t-btn t-close" title="Close"><span class="uni-i">✕</span><span class="pix-i">${pixIcon('close')}</span></button>
    </div><div class="tile-body"></div>`;
  const head = q('.tile-head', root), body = q('.tile-body', root);
  const rec = { root, head, body, term: null, fit: null, statusDot: q('.t-status .dot', head), ta: null, gutter: null };
  tileEls.set(p.id, rec);
  q('.t-mic', head).onclick = (e) => { e.stopPropagation(); toggleMic(p); };
  const zi = q('.t-zoom-in', head), zo = q('.t-zoom-out', head);
  if (zi) zi.onclick = (e) => { e.stopPropagation(); bumpTermFont(+1); };
  if (zo) zo.onclick = (e) => { e.stopPropagation(); bumpTermFont(-1); };
  q('.t-title', head).addEventListener('dblclick', (e) => { e.stopPropagation(); beginRename(p, q('.t-title', head)); });
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

  if (p.kind === 'editor') mountEditor(p, rec); else if (p.kind === 'viewer') mountViewer(p, rec); else if (p.kind === 'card') mountCard(p, rec); else mountTerminal(p, rec);
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
  const titleEl = q('.t-title', t.head);
  if (!titleEl.querySelector('input')) { // mid-rename: leave the input alone
    titleEl.textContent = p.title + (p.kind === 'editor' && p.dirty ? ' •' : '');
    titleEl.title = p.title + ' — double-click to rename';
  }
  q('.t-sub', t.head).textContent = kindLabel(p);
  q('.t-status .lbl', t.head).textContent = m.label;
  t.statusDot.style.background = m.color;
  t.root.classList.toggle('attention', !!p.attention);
  t.root.classList.toggle('exited', !!p.exited);
}

// ---- terminal tiles --------------------------------------------------------

function safeFit(rec) {
  if (!rec || !rec.term || !rec.fit) return;
  try { rec.fit.fit(); } catch (_) { return; }
  try {
    const body = rec.body, term = rec.term;
    const screen = body.querySelector('.xterm-screen'); if (!screen) return;
    const cs = getComputedStyle(body);
    const limit = body.getBoundingClientRect().right
      - parseFloat(cs.borderRightWidth || '0') - parseFloat(cs.paddingRight || '0');
    const sr = screen.getBoundingClientRect();
    const overflow = sr.right - limit;
    if (overflow > 0 && term.cols > 20) {
      const cell = sr.width / term.cols;
      term.resize(term.cols - Math.ceil(overflow / cell), term.rows);
    }
  } catch (_) {}
}

function mountTerminal(p, rec) {
  const term = new Terminal({
    fontFamily: termFontFamily(), fontSize: termFontSize(), letterSpacing: termLetterSpacing(),
    // 1.45 rather than 1.35: an agent writes paragraphs, not log lines, and at
    // 1.35 a long answer reads as one block of grey.
    lineHeight: 1.45,
    theme: xtermTheme(), cursorBlink: true, allowTransparency: true, allowProposedApi: true,
    scrollback: 6000,
    // Bold is the one weight distinction the stream actually carries — Claude
    // uses it for headings and emphasis — so let it be properly bold, and let
    // bold text take the bright half of the palette.
    fontWeight: 400, fontWeightBold: 700, drawBoldTextInBrightColors: true,
    minimumContrastRatio: 6,
    linkHandler: oscLinkHandler(p),
  });
  const fit = new FitAddon(); term.loadAddon(fit); rec.body.classList.add('term-body'); term.open(rec.body); rec.term = term; rec.fit = fit;
  useGpu(term);
  if (S.demo) (window.__terms = window.__terms || []).push(term);
  requestAnimationFrame(() => { safeFit(rec); startProcess(p, term.cols, term.rows); });
  term.onData((d) => { clearAttention(p); if (p.autoName) feedSessionName(p, d); api.termWrite({ id: p.id, data: d }); });
  term.onResize(({ cols, rows }) => api.termResize({ id: p.id, cols, rows }));
  term.onBell(() => setAttention(p));
  registerTerminalLinks(term, p);
  // Debounced: a resize drag would otherwise fire a pty resize per frame, and
  // every one of those reflows the scrollback (mid-word wraps, sliced borders).
  let refitTimer = null;
  const ro = new ResizeObserver(() => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => safeFit(rec), 90);
  });
  ro.observe(rec.body);
  rec.disposeRo = () => { clearTimeout(refitTimer); ro.disconnect(); };
}

// ---- terminal links --------------------------------------------------------
// Cmd/Ctrl-click anything an agent prints: a URL opens in your browser, a file
// opens as an editor tile right here, a folder reveals in Finder. Hold Alt and
// a file reveals in Finder instead of opening.
//
// Nothing dead is ever offered: a path is stat'd before it underlines, so the
// only things that light up are things that actually open.
const LINK_STAT_TTL = 10000;
const linkStats = new Map(); // `${cwd}\0${token}` -> { at, st }
async function statLink(token, cwd) {
  const key = `${cwd || ''}\u0000${token}`;
  const hit = linkStats.get(key);
  if (hit && Date.now() - hit.at < LINK_STAT_TTL) return hit.st;
  const st = await api.statPath({ token, cwd });
  if (linkStats.size > 400) linkStats.clear();
  linkStats.set(key, { at: Date.now(), st });
  return st;
}

// A path long enough to wrap is still one path. Walk the whole wrapped run and
// keep a cell address per character, so the underline lands on the right cells
// even when the line holds wide glyphs (a wide char is one string char but two
// columns, and its second cell reports width 0).
function wrappedRow(term, y) {
  const buf = term.buffer.active;
  let top = y - 1;
  while (top > 0) { const l = buf.getLine(top); if (l && l.isWrapped) top--; else break; }
  let bottom = top;
  while (bottom + 1 < buf.length) { const l = buf.getLine(bottom + 1); if (l && l.isWrapped) bottom++; else break; }
  let text = ''; const at = [];
  for (let row = top; row <= bottom; row++) {
    const line = buf.getLine(row); if (!line) continue;
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      const ch = cell.getChars() || ' ';
      for (let i = 0; i < ch.length; i++) at.push({ x: x + 1, y: row + 1 });
      text += ch;
    }
  }
  return { text, at };
}

function openTermLink(link, st, ev) {
  if (link.kind === 'url') { api.openUrl(urlTarget(link.text)); return; }
  if (st && st.isFile && !(ev && ev.altKey)) openFile(st.abs);
  else if (st) api.revealFile(st.abs);
}

function registerTerminalLinks(term, p) {
  if (!term.registerLinkProvider) return;
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const { text, at } = wrappedRow(term, y);
      const found = text ? scanLinks(text) : [];
      if (!found.length) { callback(undefined); return; }
      Promise.all(found.map(async (link) => {
        if (link.kind === 'url') return { link, st: null };
        const st = await statLink(link.text, p.cwd);
        return st && st.exists ? { link, st } : null;
      })).then((rows) => {
        const links = [];
        for (const row of rows) {
          if (!row) continue;
          const start = at[row.link.start], end = at[row.link.end - 1];
          if (!start || !end) continue;
          links.push({
            text: row.link.text,
            range: { start, end },
            // Without this xterm decorates nothing: a path that opens on
            // ⌘-click looked exactly like a path that does not, and the only
            // way to find out was to try. Now the cursor and the underline say
            // so before you commit to the click.
            decorations: { pointerCursor: true, underline: true },
            activate: (ev) => { if (ev.metaKey || ev.ctrlKey) openTermLink(row.link, row.st, ev); },
          });
        }
        callback(links.length ? links : undefined);
      }).catch(() => callback(undefined));
    },
  });
}

// OSC 8 hyperlinks (a CLI marking its own text as a link) come through xterm's
// own provider. Claiming the handler matters: xterm's default pops a blocking
// confirm() and a bare window.open, which in Electron is a dead-end window.
function oscLinkHandler(p) {
  return {
    activate: async (ev, uri) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      if (/^https?:\/\//i.test(uri)) { api.openUrl(uri); return; }
      if (!/^file:\/\//i.test(uri)) return;
      let abs = uri.replace(/^file:\/\/(localhost)?/i, '');
      try { abs = decodeURIComponent(abs); } catch (_) {}
      const st = await api.statPath({ token: abs, cwd: p.cwd });
      if (!st.exists) { toast('Not found: ' + abs); return; }
      openTermLink({ kind: 'path', text: abs }, st, ev);
    },
  };
}
async function startProcess(p, cols, rows) {
  if (p.started) return; p.started = true;
  // A name nami chose deliberately rides down into claude, so the conversation
  // reads the same from every other surface that lists it.
  const name = shouldPushName(p.titleSource) ? p.title : null;
  await api.termCreate({ id: p.id, cwd: p.cwd, cols, rows, kind: p.kind, command: p.command, program: p.program, args: p.args, seed: p.seed, cont: p.cont, sid: p.sid, name });
}
function setAttention(p) { if (p.id === S.activeId) return; p.attention = true; refreshTileHead(p); refreshRail(); renderHeader(); }
function clearAttention(p) { if (!p.attention) return; p.attention = false; refreshTileHead(p); refreshRail(); renderHeader(); }

// ---- links inside a rendered doc -------------------------------------------
// The same three destinations as a terminal link — browser, here, Finder —
// plus headings, which stay inside the doc. An href the resolver does not
// recognise does nothing at all: rendered markdown never drives navigation.
function headingSlug(s) {
  return String(s || '').trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}
async function openDocLink(href, p, read) {
  const t = docHrefTarget(href, p.filePath);
  if (t.kind === 'url') { api.openUrl(t.target); return; }
  if (t.kind === 'anchor') {
    const want = t.target.toLowerCase();
    const head = Array.from(read.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .find((h) => headingSlug(h.textContent) === want);
    if (head) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (t.kind !== 'path') return;
  const st = await api.statPath({ token: t.target, cwd: p.cwd });
  if (!st.exists) { toast('Not found: ' + shortHome(t.target)); return; }
  if (st.isFile) openFile(st.abs); else api.revealFile(st.abs);
}

// ---- editor tiles ----------------------------------------------------------
function mountEditor(p, rec) {
  // Markdown opens rendered; everything else has nothing to render, so it opens
  // straight in the editor and never shows the Read tab.
  const md = isMarkdownPath(p.filePath);
  if (!md) p.edMode = 'edit';
  else if (p.edMode !== 'edit') p.edMode = 'read';

  const wrap = document.createElement('div'); wrap.className = 'editor';
  wrap.innerHTML = `${md ? `<div class="ed-tabs card-tabs">
      <button class="card-tab ed-tab" data-m="read">Read</button>
      <button class="card-tab ed-tab" data-m="edit">Edit</button></div>` : ''}
    <div class="ed-read md-read"></div>
    <div class="ed-pane"><div class="ed-gutter"></div>
      <div class="ed-stack"><pre class="ed-hl" aria-hidden="true"></pre><textarea class="ed-area" spellcheck="false"></textarea></div></div>
    <div class="ed-bar"><span class="ed-path">${esc(shortHome(p.filePath))}</span><button class="btn ed-finder">Finder</button><button class="btn btn--go ed-save">Save ⌘S</button></div>`;
  wrap.classList.toggle('editor--md', md);
  rec.body.appendChild(wrap);

  const ta = q('.ed-area', wrap), gutter = q('.ed-gutter', wrap);
  const hl = q('.ed-hl', wrap), read = q('.ed-read', wrap);
  rec.ta = ta; rec.gutter = gutter;
  ta.value = p.text || '';
  // A link in a rendered doc is a link: plain click, no modifier. The terminal
  // needs Cmd because a click there belongs to whatever is running; a document
  // has no competing meaning for it.
  read.addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;
    ev.preventDefault();
    openDocLink(a.getAttribute('href'), p, read);
  });

  const sync = () => {
    const lines = ta.value.split('\n').length;
    gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
    gutter.scrollTop = ta.scrollTop;
    // the underlay only ever mirrors the textarea, so it can't drift
    hl.innerHTML = md ? highlightMarkdown(ta.value) : '';
    hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft;
  };
  const applyMode = () => {
    wrap.dataset.mode = p.edMode;
    if (p.edMode === 'read') read.innerHTML = renderMarkdown(p.text || '');
    wrap.querySelectorAll('.ed-tab').forEach((b) => b.classList.toggle('active', b.dataset.m === p.edMode));
    if (p.edMode === 'edit') sync();
  };

  ta.addEventListener('input', () => { p.text = ta.value; if (!p.dirty) { p.dirty = true; refreshTileHead(p); refreshRail(); } sync(); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveEditor(p); }
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2; p.text = ta.value; sync(); }
  });
  ta.addEventListener('focus', () => { S.activeId = p.id; refreshRail(); });
  wrap.querySelectorAll('.ed-tab').forEach((b) => {
    b.onclick = () => { p.edMode = b.dataset.m; applyMode(); if (p.edMode === 'edit') ta.focus(); };
  });
  const edPath = q('.ed-path', wrap);
  if (edPath) { edPath.title = 'Reveal in Finder'; edPath.onclick = () => api.revealFile(p.filePath); }
  q('.ed-finder', wrap).onclick = () => api.revealFile(p.filePath);
  q('.ed-save', wrap).onclick = () => saveEditor(p);
  sync(); applyMode();
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
  wrap.querySelectorAll('.vw-reveal, .vw-finder, .ed-path').forEach((b) => { b.onclick = () => api.revealFile(p.filePath); if (b.classList.contains('ed-path')) b.title = 'Reveal in Finder'; });
  const media = wrap.querySelector('img, video, audio');
  if (media) media.addEventListener('error', () => {
    const stage = wrap.querySelector('.vw-stage, .vw-pdf');
    p.note = 'This format could not be decoded.';
    if (stage) stage.outerHTML = fallback;
    const b = wrap.querySelector('.vw-reveal'); if (b) b.onclick = () => api.revealFile(p.filePath);
  }, { once: true });
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
    chipKind: chip.kind, code: chip.code, title: item.name, cwd: S.project && S.project.path,
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
      <button class="btn card-finder">Finder</button>
      ${p.item.type === 'agent' && p.item.platform === 'claude' ? '<button class="btn card-use">Use</button>' : ''}
      ${ro ? '<button class="btn btn--go card-dup">Duplicate to project</button>'
           : '<button class="btn card-del">Delete</button><button class="btn card-improve">Improve with my agent</button><button class="btn btn--go card-save">Save ⌘S</button>'}
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

  const cardPath = q('.ed-path', wrap);
  if (cardPath) { cardPath.title = 'Reveal in Finder'; cardPath.onclick = () => api.revealFile(p.filePath); }
  const cardFinder = q('.card-finder', wrap);
  if (cardFinder) cardFinder.onclick = () => api.revealFile(p.filePath);
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
  const impBtn = q('.card-improve', wrap);
  if (impBtn) impBtn.onclick = () => {
    if (p.dirty) { toast('Save the card first so your agent sees your latest.'); return; }
    openImproveItem(p.item);
  };
  const delBtn = q('.card-del', wrap);
  if (delBtn) delBtn.onclick = async () => {
    if (!delBtn.dataset.armed) { delBtn.dataset.armed = '1'; delBtn.textContent = 'Really move to Trash?'; delBtn.classList.add('armed'); return; }
    const res = await api.libraryDelete({ filePath: p.item.filePath, projectPath: S.project && S.project.path });
    if (!res.ok) { toast(res.error || 'Could not delete'); return; }
    if (S.panels.includes(p)) closePanel(p.id); else closeOverlay();
    loadLibrary(true); toast('Moved to Trash.');
  };
  // clicking or tabbing anywhere else stands the armed Delete back down
  if (delBtn) delBtn.onblur = () => {
    if (!delBtn.dataset.armed) return;
    delete delBtn.dataset.armed; delBtn.textContent = 'Delete'; delBtn.classList.remove('armed');
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

// ---- dictation (in-app mic + clipboard paste) ------------------------------
// Which engine transcribes is main's business (see stt.js). The renderer only
// records, decodes to the 16 kHz mono float every engine can read, and asks.
let recording = null; // { panelId, recorder, stream }

// S.sttInfo mirrors stt.status(): { active, chosen, ready, providers[] }.
function setSttInfo(info) {
  S.sttInfo = info || { active: null, chosen: null, ready: false, providers: [] };
  S.stt = !!S.sttInfo.ready;
  return S.sttInfo;
}
async function refreshSttInfo() { return setSttInfo(await api.sttStatus()); }
function sttProvider(id) { return (S.sttInfo && S.sttInfo.providers || []).find((p) => p.id === id) || null; }

// Only Chromium can decode Opus-in-WebM, so the samples have to be made here.
// Returns null when decoding fails — cloud providers can still use the raw blob.
async function decodePcm(blob) {
  try {
    const ctx = new AudioContext({ sampleRate: 16000 });
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
      // downmix, scaled by 1/√2 per channel so a centred voice keeps its level
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      const out = new Float32Array(l.length), k = Math.SQRT1_2;
      for (let i = 0; i < l.length; i++) out[i] = k * (l[i] + r[i]);
      return out;
    } finally { ctx.close(); }
  } catch (_) { return null; }
}

// One recording → text. Sends both shapes: decoded samples for the on-device
// engine, the original webm so cloud providers upload ~8 KB/s instead of a WAV.
async function transcribeBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pcm = await decodePcm(blob);
  return api.transcribe({ pcm, sampleRate: 16000, bytes, mime: blob.type || 'audio/webm' });
}
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
  // nothing set up: send them somewhere they can fix it, rather than a dead end
  if (!S.stt) { toast('Pick how Nami should hear you.'); return openSettings('voice'); }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream); const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop());
      setMicState(p, 'transcribing');
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const res = await transcribeBlob(blob);
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
  if (!text || !text.trim()) { toast('Clipboard is empty — dictate in your dictation app first.'); return; }
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
  if (p.autoName) feedSessionName(p, text);
  api.termWrite({ id: p.id, data: text });
}
// Rename in place: the label becomes an input sitting exactly where it was, so
// the tile never reflows. Enter keeps it, Escape and an empty name abandon it.
// A name you set by hand outranks everything, including claude's own, and rides
// down into claude on the next spawn so both sides read the same.
function beginRename(p, el) {
  if (!el || el.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'name-edit';
  input.value = p.title;
  input.setAttribute('aria-label', 'Rename session');
  el.textContent = '';
  el.appendChild(input);
  input.focus(); input.select();
  let done = false;
  const finish = (keep) => {
    if (done) return; done = true;
    const next = input.value.trim();
    if (keep && next && next !== p.title) applyTitle(p, next, 'user');
    else { refreshTileHead(p); refreshRail(); }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.addEventListener('mousedown', (e) => e.stopPropagation());
}

// Every rename in the app goes through here, so precedence is decided in one
// place: your own name sticks, claude's name upgrades a guess, a guess only
// ever fills an unnamed tile. Returns whether the label actually moved.
function applyTitle(p, title, source) {
  const win = adoptTitle({ title: p.title, source: p.titleSource }, { title, source });
  if (!win) return false;
  p.title = win.title; p.titleSource = win.source;
  if (source !== 'prompt') { p.autoName = false; p._nameDraft = ''; }
  refreshTileHead(p); refreshRail(); savePanels();
  return true;
}
// Keystrokes stream into a name draft until Enter commits one (session-name.mjs
// decides); the committed prompt names the tile straight away, so the rail is
// useful from the first turn — claude's own name replaces it a minute later.
function feedSessionName(p, data) {
  const r = feedNameDraft(p._nameDraft, data);
  p._nameDraft = r.draft;
  if (!r.name) return;
  p.autoName = false; p._nameDraft = '';
  applyTitle(p, r.name, 'prompt');
}

// ===========================================================================
//  Panel lifecycle
// ===========================================================================
// ---- persistence: the layout survives restarts -----------------------------
let saveTimer = null;
function panelSnapshot() {
  return S.panels.map((p) => {
    if (p.kind === 'editor') return { kind: 'editor', filePath: p.filePath };
    if (p.kind === 'viewer') return { kind: 'viewer', filePath: p.filePath };
    if (p.kind === 'card') return { kind: 'card', item: p.item };
    return { kind: p.kind, title: p.title, titleSource: p.titleSource, code: p.code, chipKind: p.chipKind, cwd: p.cwd, command: p.command, program: p.program, args: p.args, sid: p.sid };
  });
}
function savePanels() {
  if (S.demo) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.savePanels({ panels: panelSnapshot(), folder: S.project ? S.project.path : null });
  }, 400);
}
// Write the desk now, under a folder named by the caller. A folder switch can't
// use savePanels(): it reads S.project, which is about to point somewhere else.
function flushPanels(folder) {
  if (S.demo) return Promise.resolve();
  clearTimeout(saveTimer);
  return api.savePanels({ panels: panelSnapshot(), folder: folder || null });
}
async function restorePanels(snaps) {
  // Each claude panel resumes its own conversation by saved sid. Snapshots from
  // before sids existed can't be told apart, so only the newest of them may use
  // --continue (which always means "the most recent conversation in this cwd") —
  // giving it to all of them is exactly the everything-becomes-one-session bug.
  const newestLegacy = snaps.find((s) => s.kind === 'claude' && !s.sid);
  // open* unshift; walk the list backwards so the restored order matches
  for (const s of [...snaps].reverse()) {
    try {
      if (s.kind === 'editor') await openFile(s.filePath, { pin: true });
      else if (s.kind === 'viewer') await openFile(s.filePath, { pin: true });
      else if (s.kind === 'card' && s.item) await openCard(s.item, { pin: true });
      else if (s.kind === 'ai') continue; // retired session kind — nothing to bring back
      else if (s.kind) startPanel({ kind: s.kind, title: s.title, titleSource: s.titleSource, code: s.code, chipKind: s.chipKind, cwd: s.cwd, command: s.command, program: s.program, args: s.args, sid: s.sid, cont: s.kind === 'claude' && (!!s.sid || s === newestLegacy) });
    } catch (_) {}
  }
  S.activeId = S.panels[0] ? S.panels[0].id : null;
  renderAll();
}

function startPanel(opts) {
  // Every session belongs to a folder. Without one the pty falls back to the
  // home directory (main.js term:create), which gives the agent the run of ~ and
  // files its transcript under a project slug no folder can ever resume from.
  // The launcher asks for a folder first; this is the backstop for every other
  // caller.
  const cwd = opts.cwd || (S.project && S.project.path);
  if (!cwd && !['editor', 'viewer', 'card'].includes(opts.kind || 'claude')) {
    toast('Open a folder first — sessions run inside one.');
    return null;
  }
  const p = Object.assign({
    id: uid('p_'), kind: 'claude', chipKind: opts.chipKind, code: opts.code || code2(opts.title || 'SS'),
    title: opts.title || 'Session', cwd, status: 'live',
    attention: false, exited: false, started: false, command: opts.command, program: opts.program, args: opts.args, seed: opts.seed, cont: opts.cont,
  }, opts);
  // A session born with a generic name ("Claude session") takes its name from
  // the first real prompt the user submits, then from claude itself. Only a
  // flow says 'flow' outright (agentSession) — everything else lands on the
  // weak sources, so a name nami merely guessed is never pushed into claude,
  // and a snapshot saved before any of this existed stays upgradable.
  if (!['editor', 'viewer', 'card'].includes(p.kind) && isGenericTitle(p.title)) {
    p.autoName = true;
    p.titleSource = p.titleSource || 'generic';
  } else p.titleSource = p.titleSource || 'prompt';
  // Every claude panel owns a conversation id from birth (--session-id), so a
  // restore can bring back that conversation with --resume instead of --continue.
  // A cont-without-sid panel is the legacy --continue migration — minting an id
  // there would turn --continue into --resume <nothing> and break it.
  if (p.kind === 'claude' && !p.sid && !p.cont) p.sid = crypto.randomUUID();
  p.cwd = cwd; // an explicit `cwd: undefined` in opts must not beat the fallback
  S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
  renderGrid(); renderRail(); renderHeader(); savePanels();
  return p;
}
const VIEWER_CODES = { image: 'IM', video: 'VI', audio: 'AU', pdf: 'PD', other: 'FI' };
function viewerPanel(filePath, sub, note) {
  return { id: uid('p_'), kind: 'viewer', sub, note, chipKind: 'viewer', code: VIEWER_CODES[sub] || 'VW', title: baseNameOf(filePath), filePath, status: 'live', cwd: S.project && S.project.path };
}
// Build the right panel for any path: media/pdf as viewer, text as editor,
// unreadable/binary as an 'other' viewer card carrying the reason.
async function buildFilePanel(filePath) {
  const kind = fileKind(filePath);
  if (kind !== 'text') return viewerPanel(filePath, kind);
  const res = await api.rawFile(filePath);
  if (!res.ok) return viewerPanel(filePath, 'other', res.error || 'Could not open');
  return { id: uid('p_'), kind: 'editor', chipKind: 'editor', code: 'ED', title: baseNameOf(filePath), filePath, text: res.text, dirty: false, status: 'live', cwd: S.project && S.project.path };
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
  else if (p.kind !== 'editor' && p.kind !== 'viewer' && p.kind !== 'card') api.termKill({ id });
  const t = tileEls.get(id); if (t) { if (t.disposeRo) t.disposeRo(); t.root.remove(); tileEls.delete(id); }
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
  await switchToFolder(info); return true;
}

// Callers await this, so a scan already in flight must hand back the SAME
// promise rather than an instantly-resolved undefined — otherwise the second
// caller runs before S.agents exists and sees no agents at all.
let agentsInflight = null;
function refreshAgents() {
  if (agentsInflight) return agentsInflight;
  S.agentsLoading = true;
  agentsInflight = agentsScan().finally(() => { agentsInflight = null; S.agentsLoading = false; });
  return agentsInflight;
}
async function agentsScan() {
  try { S.agents = await api.detectAgents(); } catch (_) { S.agents = S.agents || []; }
  repaintAgentOverlays();
  // Identity is read after the list paints, one agent at a time in parallel:
  // a slow CLI delays only its own second line, never the whole sheet.
  for (const a of (S.agents || [])) if (a.found) refreshAgentStatus(a.id);
}
function repaintAgentOverlays() {
  const ot = S.overlay && S.overlay.type;
  if (['launcher', 'agent-setup', 'agent-remove', 'connect-form', 'connect-custom', 'create', 'improve-item'].includes(ot)) renderOverlay();
}
async function refreshAgentStatus(id) {
  try { S.agentStatus[id] = await api.agentStatus(id); } catch (_) { S.agentStatus[id] = null; }
  repaintAgentOverlays();
}
// One agent's second line. Identity when we have it, the registry blurb until
// then — the row never says less than it does today.
function statusLineFor(a) {
  const st = S.agentStatus[a.id];
  if (!st || st.signedIn === null) return { dot: 'ok', text: a.sub };
  if (st.signedIn === false) return { dot: 'warn', text: 'signed out' };
  return { dot: 'ok', text: st.label || a.sub };
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
    const row = document.createElement('div'); row.className = 'picker-row';
    const st = statusLineFor(a);
    const manageable = !!a.lifecycle;
    row.innerHTML = `${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">${esc(a.name)}</span>
      <span class="desc"><span class="ok${st.dot === 'warn' ? ' ok--warn' : ''}">●</span> ready · ${esc(st.text)}</span></span>
      ${manageable ? '<span class="chev" title="Manage this agent">›</span>' : ''}`;
    row.onclick = async (e) => {
      // The chevron manages the agent; anywhere else on the row still launches.
      if (manageable && e.target.closest('.chev')) { openAgentSheet(a); return; }
      closeOverlay(); if (!(await ensureFolder())) return;
      if (a.kind === 'claude') return startPanel({ kind: 'claude', title: 'Claude session', code: 'CC' });
      startPanel({ kind: 'run', title: a.name, code: code2(a.name), command: a.bin });
    };
    list.appendChild(row);
  }
  for (const h of EVERGREEN_ROWS) {
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="code" data-kind="${esc(h.chipKind || 'shell')}">${esc(h.code)}</span>
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
      card.innerHTML = `${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
        <span class="ac-name">${esc(a.name)}</span><span class="ac-desc">${esc(a.sub)}</span><span class="ac-go">set up →</span>`;
      card.onclick = () => { closeOverlay(); openAgentSetup(a); };
      grid.appendChild(card);
    }
  }
}
async function launchHarness(h) {
  return startPanel({ kind: 'shell', title: 'Terminal', code: '❯', chipKind: 'shell' });
}
function openAgentSetup(agent) { S.overlay = { type: 'agent-setup', agent }; renderOverlay(); }
// Same sheet, two faces. Not installed → the install command, exactly as before.
// Installed → who it runs as, and everything you can do about that.
function openAgentSheet(agent) { S.overlay = { type: 'agent-setup', agent }; renderOverlay(); refreshAgentStatus(agent.id); }
function renderAgentSetup() {
  const a = S.overlay.agent;
  return a.found ? renderAgentInstalled(a) : renderAgentInstall(a);
}

// Every lifecycle action is the CLI's own command, run in the tile that already
// runs installs. When it exits we re-read status, so the sheet is never stale.
function runAgentCommand(agent, command, title) {
  closeOverlay();
  startPanel({
    kind: 'run', title, code: code2(agent.name), command,
    onExit: () => { refreshAgents(); },
  });
}

// On this Mac — who it runs as, and everything you can do about that.
function renderAgentInstalled(a) {
  const lc = a.lifecycle || {};
  const st = S.agentStatus[a.id] || null;
  const line = st && st.signedIn === true ? esc(st.label)
    : st && st.signedIn === false ? 'signed out'
    : 'checking…';
  const rows = (st && st.rows) || [];
  const scan = rows.map((r) =>
    `<div class="scan-row"><span class="mark">✓</span><span class="label2">${esc(r.k)}</span><span class="value">${esc(r.v)}</span></div>`).join('');
  // A button only exists when the registry has a real command behind it, so an
  // unverified CLI shows identity and nothing that could fail.
  const btn = (id, label, on) => on ? `<button class="btn" id="${id}">${esc(label)}</button>` : '';

  const modal = overlay('setup-box', `
    <div class="setup-head"><button class="t-btn su-back" title="Back to new session">←</button>
      ${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">${esc(a.name)}</span>
      <span class="desc"><span class="ok${st && st.signedIn === false ? ' ok--warn' : ''}">●</span> ${line}</span></span></div>

    <div class="scan-box ag-scan">
      <div class="label">this Mac${st && st.source ? `<span class="scan-src">${esc(st.source)}</span>` : ''}</div>
      ${scan}
      <div class="scan-row"><span class="mark">✓</span><span class="label2">Program</span><span class="value">${esc(a.pathShort || a.path || 'installed')}</span></div>
    </div>

    <div class="setup-actions">
      ${btn('ag-switch', lc.switchLabel || 'Switch account', lc.switchCmd || (lc.login && lc.logout))}
      ${btn('ag-out', 'Sign out', lc.logout && (!st || st.signedIn !== false))}
      ${btn('ag-in', 'Sign in', lc.login && st && st.signedIn === false)}
      ${btn('ag-setup', 'Run setup again', lc.setup)}
      ${btn('ag-health', "Check it's healthy", lc.health)}
    </div>
    <div class="ag-links">
      ${a.configFile ? '<span class="action" id="ag-config">Open its settings file</span>' : ''}
      ${lc.accountUrl ? '<span class="action" id="ag-account">Manage account online</span>' : ''}
      <span class="action" id="ag-docs">Read the guide</span>
    </div>
    <div class="ag-danger">
      <button class="btn btn--ghost" id="ag-remove">Remove from this Mac</button>
      <span class="why">Asks first, and names every file it would delete.</span>
    </div>`);

  q('.su-back', modal).onclick = () => openLauncher();
  const on = (id, fn) => { const el = q('#' + id, modal); if (el) el.onclick = fn; };
  on('ag-switch', () => runAgentCommand(a, lc.switchCmd || `${lc.logout} && ${lc.login}`, `${a.name} · sign in`));
  on('ag-out', () => runAgentCommand(a, lc.logout, `${a.name} · sign out`));
  on('ag-in', () => runAgentCommand(a, lc.login, `${a.name} · sign in`));
  on('ag-setup', () => runAgentCommand(a, lc.setup, `${a.name} · setup`));
  on('ag-health', () => runAgentCommand(a, lc.health, `${a.name} · check`));
  on('ag-config', () => { closeOverlay(); openFile(a.configFile, { pin: true }); });
  on('ag-account', () => api.openUrl(lc.accountUrl));
  on('ag-docs', () => api.openUrl(a.docs));
  on('ag-remove', () => openAgentRemove(a));
}

// The only action here that destroys anything, so it is the only one that stops
// and asks — and it names the real paths before it touches them.
function openAgentRemove(agent) {
  S.overlay = { type: 'agent-remove', agent, plan: null, busy: false };
  renderOverlay();
  api.agentRemovalPlan(agent.id, agent.path).then((plan) => {
    if (S.overlay && S.overlay.type === 'agent-remove') { S.overlay.plan = plan; renderOverlay(); }
  });
}
function renderAgentRemove() {
  const o = S.overlay; const a = o.agent; const plan = o.plan;
  const body = !plan ? '<p class="setup-copy">Working out what this would delete…</p>'
    : plan.mode === 'none'
      ? `<p class="setup-copy">${esc(plan.reason)}</p>`
      : `<div class="warn-box">
           <div class="wb-head">This ${plan.mode === 'uninstall' ? 'runs' : 'deletes, on this Mac'}:</div>
           <ul>${(plan.describe || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
         </div>
         <p class="setup-copy">Your projects and files are untouched. You can install ${esc(a.name)} again later,
           but you would sign in from scratch.</p>`;

  const modal = overlay('setup-box', `
    <div class="setup-head">${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">Remove ${esc(a.name)}?</span>
      <span class="desc">this cannot be undone</span></span></div>
    ${body}
    <div class="setup-actions">
      ${plan && plan.mode !== 'none' ? `<button class="btn btn--red" id="ar-go"${o.busy ? ' disabled' : ''}>${o.busy ? 'Removing…' : 'Yes, remove it'}</button>` : ''}
      <button class="btn" id="ar-keep">${plan && plan.mode === 'none' ? 'Close' : 'Keep it'}</button>
    </div>`);

  q('#ar-keep', modal).onclick = () => openAgentSheet(a);
  const go = q('#ar-go', modal);
  if (go) go.onclick = async () => {
    if (plan.mode === 'uninstall') return runAgentCommand(a, plan.command, `remove ${a.name}`);
    o.busy = true; renderOverlay();
    const res = await api.agentRemove(a.id, a.path);
    o.busy = false;
    if (res.ok) { closeOverlay(); refreshAgents(); toast(`${a.name} removed.`); }
    else { renderOverlay(); toast(res.error || `Could not remove ${a.name}.`); }
  };
}

// Not on this Mac yet — unchanged from before this feature.
function renderAgentInstall(a) {
  const modal = overlay('setup-box', `
    <div class="setup-head"><button class="t-btn su-back" title="Back to new session">←</button>
      ${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
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
  q('.su-back', modal).onclick = () => openLauncher();
  q('#su-run', modal).onclick = async () => {
    closeOverlay(); if (!(await ensureFolder())) return;
    startPanel({ kind: 'run', title: `install ${a.name}`, code: code2(a.name), command: a.install, onExit: () => refreshAgents() });
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
  startPanel({ kind: 'claude', title: a.name + ' session', code: code2(a.name), seed: `Use the ${a.slug} agent.` });
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
    row.innerHTML = `<span class="code" data-kind="agent">${esc(code2(a.name))}</span><span class="col"><span class="name">${esc(a.name)}</span><span class="desc">${esc(a.description || a.meta.tools || '')}</span></span>`;
    row.onclick = () => { closeOverlay(); useAgent(a); };
    list.appendChild(row);
  });
}

// ---- create an agent or a skill (Library ＋ buttons) ------------------------
// Three steps, one decision each: where it lives, whose it is, what it is. Same overlay type
// throughout, so the sheet holds its place and does not replay its entrance between steps.
// State lives on S.overlay and the sheet is rebuilt on every change, so inputs must be
// flushed into it before any re-render — same discipline as the connect flow.
const CREATE_PLATFORMS = [
  { id: 'claude', name: 'Claude Code', code: 'CC' },
  { id: 'opencode', name: 'OpenCode', code: 'OC' },
];
// OpenCode has no skills format; agents exist on both.
function createSupported(kind, platform) { return kind === 'agent' || platform === 'claude'; }
// The bare folder shape for a platform, derived from the one path table in seed-text.mjs.
function relDirFor(kind, platform) {
  return String(targetDirFor({ type: kind, platform, scope: 'project', projectPath: '' }) || '').replace(/^\.\//, '');
}
function createCount(kind, platform) {
  const n = S.library.items.filter((i) => i.type === kind && i.platform === platform && i.scope !== 'plugin').length;
  return n ? `${n} here already` : 'nothing here yet';
}
function openCreate(kind) {
  S.overlay = { type: 'create', kind, step: 1, platform: 'claude',
    scope: S.project ? 'project' : 'user', name: '', desc: '' };
  renderOverlay(); if (!S.agents) refreshAgents();
}
function createHeadHtml(o) {
  return `<div class="picker-input"><span class="prompt-mark">＋</span>
    <span style="font-weight:700">New ${esc(o.kind)}</span>
    <span class="ni-step">Step ${o.step} of 3</span></div>`;
}
// One card per choice, on the .add-card idiom so both themes and the chip recolor come free.
function createChoiceHtml({ id, name, sub, path, on, off, chip }) {
  return `<div class="add-card ni-choice${on ? ' on' : ''}${off ? ' off' : ''}" data-c="${esc(id)}"${off ? '' : ' tabindex="0" role="button"'}>
    ${chip ? chipHtml(chip) : ''}
    <span class="ac-name">${esc(name)}</span>
    <span class="ac-desc">${esc(sub)}</span>
    <span class="ac-go">${esc(path)}</span></div>`;
}
function wireCreateChoices(modal, pick) {
  modal.querySelectorAll('.ni-choice').forEach((el) => {
    if (el.classList.contains('off')) return;
    const go = () => pick(el.dataset.c);
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}
function createBack(modal, o) {
  const b = q('.ni-back', modal);
  if (b) b.onclick = () => { o.step -= 1; o.focused = false; renderOverlay(); };
}
function renderCreateSheet() {
  const o = S.overlay;
  if (o.step === 1) return renderCreateStep1(o);
  if (o.step === 2) return renderCreateStep2(o);
  return renderCreateStep3(o);
}
function renderCreateStep1(o) {
  const cards = CREATE_PLATFORMS.map((p) => {
    const ok = createSupported(o.kind, p.id);
    return createChoiceHtml({
      id: p.id, name: p.name, on: ok && o.platform === p.id, off: !ok,
      sub: ok ? createCount(o.kind, p.id) : `has no ${o.kind}s yet`,
      path: ok ? relDirFor(o.kind, p.id) : '—',
      chip: { key: iconKeyFor(p.id), code: p.code, kind: 'agent' },
    });
  }).join('');
  const modal = overlay('picker-box', `${createHeadHtml(o)}
    <div class="ni-ask">Where does it live?</div>
    <div class="ni-choices">${cards}</div>`, { top: true });
  wireCreateChoices(modal, (id) => { o.platform = id; o.step = 2; renderOverlay(); });
}
function renderCreateStep2(o) {
  const cards = [
    { id: 'project', name: 'This project', sub: S.project ? S.project.name + ' only' : 'open a folder first', off: !S.project },
    { id: 'user', name: 'Your machine', sub: 'every project you open', off: false },
  ].map((s) => createChoiceHtml({
    id: s.id, name: s.name, sub: s.sub, off: s.off, on: !s.off && o.scope === s.id,
    path: s.off ? '—' : shortHome(targetDirFor({ type: o.kind, platform: o.platform, scope: s.id, projectPath: S.project && S.project.path })),
  })).join('');
  const modal = overlay('picker-box', `${createHeadHtml(o)}
    <button class="ni-back">‹ back</button>
    <div class="ni-ask">Whose is it?</div>
    <div class="ni-choices">${cards}</div>`, { top: true });
  createBack(modal, o);
  wireCreateChoices(modal, (id) => { o.scope = id; o.step = 3; renderOverlay(); });
}
function renderCreateStep3(o) {
  const worker = chosenAgent(o);
  // the path already says which platform and whose it is — repeating them just wraps the line
  const dir = shortHome(targetDirFor({ type: o.kind, platform: o.platform, scope: o.scope, projectPath: S.project && S.project.path }));
  const modal = overlay('picker-box', `${createHeadHtml(o)}
    <button class="ni-back">‹ back</button>
    <div class="ni-ask">What is it?</div>
    <div class="ni-row"><span class="lbl">Name</span>
      <input id="ni-name" placeholder="leave it blank and your agent names it" value="${esc(o.name)}" /></div>
    <div class="ni-row"><span class="lbl">What</span>
      <input id="ni-desc" placeholder="e.g. keeps the README honest after a batch of features lands" value="${esc(o.desc)}" /></div>
    <div class="ni-where">it lands in <b>${esc(dir)}</b></div>
    <div class="ni-agent" style="margin:10px 18px 0">${worker
      ? `a new session with <select class="agent-pick" id="ni-agent-sel">${agentOptionsHtml(worker.id)}</select> builds it with you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="ni-row ni-actions"><button class="btn btn--go" id="ni-create" ${worker ? '' : 'disabled'}>Build it with my agent</button>
      <span class="action" id="ni-blank" role="button" tabindex="0">write it myself</span></div>`, { top: true });
  createBack(modal, o);
  const nameInput = q('#ni-name', modal), descInput = q('#ni-desc', modal);
  const keep = () => { o.name = nameInput.value; o.desc = descInput.value; };
  // agent detection can land mid-typing and re-render this sheet; keeping o in sync on every
  // keystroke means a rebuild never eats what was typed.
  nameInput.oninput = keep; descInput.oninput = keep;
  const agentSel = q('#ni-agent-sel', modal);
  if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
  if (!o.focused) { o.focused = true; setTimeout(() => descInput.focus(), 30); }
  q('#ni-create', modal).onclick = () => {
    keep();
    const w = chosenAgent(o);
    if (!o.desc.trim()) { toast('Describe what it should do first.'); return; }
    if (!w) { toast('No agent is installed yet. Press ⌘N to add one first.'); return; }
    const seed = buildCreateSeed({ type: o.kind, platform: o.platform, scope: o.scope, name: o.name, desc: o.desc, projectPath: S.project && S.project.path });
    closeOverlay();
    agentSession(w, { title: 'build: ' + (o.name.trim() || o.kind), code: 'BD', seed });
    toast('Your agent has a few questions first — check the new tile.');
  };
  const blankLink = q('#ni-blank', modal);
  blankLink.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); blankLink.onclick(); } });
  blankLink.onclick = async () => {
    keep();
    if (!o.name.trim()) { toast('Give it a name first.'); return; }
    const res = await api.libraryCreate({ projectPath: S.project && S.project.path, type: o.kind, platform: o.platform, scope: o.scope, name: o.name.trim() });
    if (!res.ok) { toast(res.error || 'Could not create'); return; }
    closeOverlay(); toast('Created ' + o.name.trim());
    S.railTab = 'library'; loadLibrary(true).then(() => renderRail());
    openCard(res.item);
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); descInput.focus(); } });
  descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q('#ni-create', modal).onclick(); } });
}

// ---- improve an existing library item with the user's own agent ------------
function openImproveItem(item) { S.overlay = { type: 'improve-item', item, text: '' }; renderOverlay(); if (!S.agents) refreshAgents(); }
function renderImproveItem() {
  const o = S.overlay, item = o.item;
  const worker = chosenAgent(o);
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" data-kind="${esc((TYPE_CHIP[item.type] || TYPE_CHIP.agent).kind)}">${esc(code2(item.name))}</span>
      <span class="col"><span class="name">Improve ${esc(item.name)}</span><span class="desc">${esc(item.platform + ' ' + item.type)}</span></span></div>
    <input class="text-input" id="imp-ask" placeholder="what should change? e.g. give it a real description and sharper instructions" spellcheck="false" />
    <div class="ni-agent">${worker
      ? `a new session with <select class="agent-pick" id="imp-agent">${agentOptionsHtml(worker.id)}</select> edits it for you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="setup-actions" style="margin-top:12px"><button class="btn btn--go" id="imp-go" ${worker ? '' : 'disabled'}>Go</button></div>`);
  const input = q('#imp-ask', modal); input.value = o.text; setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.text = input.value; };
  const agentSel = q('#imp-agent', modal);
  if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
  const go = () => {
    const w = chosenAgent(o);
    if (!o.text.trim() || !w) { if (!o.text.trim()) toast('Say what should change first.'); return; }
    closeOverlay();
    agentSession(w, { title: 'improve: ' + item.slug, code: 'IM', seed:
      buildImproveSeed({ platform: item.platform, type: item.type, filePath: item.filePath, ask: o.text }) });
    toast('Your agent is on it. Reopen the card when it finishes.');
  };
  q('#imp-go', modal).onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

// ---- overlays --------------------------------------------------------------
let lastOverlayType = null; // same-type re-renders skip the entrance animation
function renderOverlay() {
  els.overlayRoot.innerHTML = ''; const o = S.overlay;
  overlayStill = !!o && o.type === lastOverlayType;
  lastOverlayType = o ? o.type : null;
  if (!o) return;
  if (o.type === 'launcher') return renderLauncher();
  if (o.type === 'peek') return renderPeek();
  if (o.type === 'agent-setup') return renderAgentSetup();
  if (o.type === 'agent-remove') return renderAgentRemove();
  if (o.type === 'agents') return renderAgentPickerSheet();
  if (o.type === 'create') return renderCreateSheet();
  if (o.type === 'connect') return renderConnectCatalog();
  if (o.type === 'connect-form') return renderConnectForm();
  if (o.type === 'connect-done') return renderConnectDone();
  if (o.type === 'connect-custom') return renderConnectCustom();
  if (o.type === 'improve-item') return renderImproveItem();
  if (o.type === 'fs-name') return renderFsName();
  if (o.type === 'switch-folder') return renderSwitchChoice();
  if (o.type === 'settings') return renderSettings();
}
function closeOverlay() { S.overlay = null; renderOverlay(); }

// ===========================================================================
//  Settings — the one place the app explains how it behaves
// ===========================================================================
const SET_SECTIONS = [
  { id: 'voice', name: 'Voice', lead: 'how Nami hears you' },
  { id: 'look', name: 'Look', lead: 'how Nami looks on this desk' },
  { id: 'keys', name: 'Keys', lead: 'keys every session can use' },
];
function openSettings(section) {
  S.overlay = { type: 'settings', section: section || 'voice', draft: {}, test: null };
  renderOverlay();
  // both are cheap and let the sheet paint immediately with what we already know
  refreshSttInfo().then(() => { if (isSettingsOpen()) renderOverlay(); });
  api.settingsGet().then((s) => { if (isSettingsOpen()) { S.overlay.saved = s; renderOverlay(); } });
}
function isSettingsOpen() { return !!S.overlay && S.overlay.type === 'settings'; }

function renderSettings() {
  const o = S.overlay;
  const sec = SET_SECTIONS.find((s) => s.id === o.section) || SET_SECTIONS[0];
  const modal = overlay('modal modal--settings', `
    <div class="modal-head"><span class="col">
      <span class="title">Settings</span>
      <span class="sub">${esc(sec.lead)}</span></span></div>
    <div class="modal-body"><div class="set-wrap">
      <div class="set-nav">${SET_SECTIONS.map((s) =>
        `<button class="rail-tab${s.id === sec.id ? ' active' : ''}" data-sec="${s.id}">${esc(s.name)}</button>`).join('')}</div>
      <div class="set-pane" id="set-pane">${
        sec.id === 'voice' ? voicePaneHtml() : sec.id === 'look' ? lookPaneHtml() : keysPaneHtml()}</div>
    </div></div>
    <div class="modal-foot">${sec.id === 'voice' ? voiceFootHtml() : '<span class="note">Saved on this Mac only, nothing syncs.</span>'}
      <button class="btn btn--go" id="set-done">Done</button></div>`);

  modal.querySelectorAll('.set-nav .rail-tab').forEach((b) => {
    b.onclick = () => { keepDraft(modal); o.section = b.dataset.sec; renderOverlay(); };
  });
  q('#set-done', modal).onclick = async () => { await saveVoiceDraft(modal); closeOverlay(); };
  if (sec.id === 'voice') wireVoicePane(modal);
  if (sec.id === 'look') wireLookPane(modal);
  if (sec.id === 'keys') wireKeysPane(modal);
}

// ---- Voice -----------------------------------------------------------------
function voiceRows() {
  return ((S.sttInfo && S.sttInfo.providers) || []).slice();
}
// No explicit choice yet means the app is running on whatever resolved first;
// show that as picked so the sheet never looks like nothing is selected.
function pickedVoiceId() {
  const o = S.overlay, info = S.sttInfo || {};
  const want = (o && o.pick) || info.chosen || info.active || 'local';
  // a retired choice (old 'custom' / 'clipboard' settings) falls back gracefully
  return voiceRows().some((p) => p.id === want) ? want : (info.active || 'local');
}

function voicePaneHtml() {
  const o = S.overlay, picked = pickedVoiceId();
  const rows = voiceRows().map((p) => {
    const on = p.id === picked;
    return `<div class="set-opt-wrap">
      <button class="theme-opt set-opt${on ? ' picked' : ''}" data-p="${esc(p.id)}">
        <span class="theme-dot"></span>
        <span class="set-opt-col"><span class="theme-name">${esc(p.label)}</span>
          <span class="set-opt-desc">${esc(p.blurb || '')}</span></span>
        <span class="set-flag ${p.ready ? 'ok' : 'wait'}">${esc(voiceFlag(p))}</span>
      </button>
      ${on ? voiceRowBodyHtml(p) : ''}</div>`;
  }).join('');
  // no heading here — the sheet's subtitle already says what this pane is
  return rows;
}
// The proof lives in the footer so it is on screen whatever the list is doing.
function voiceFootHtml() {
  const o = S.overlay, active = voiceRows().find((p) => p.id === pickedVoiceId());
  return `<button class="btn" id="set-mic" ${active && active.ready ? '' : 'disabled'}>◉ Test the mic</button>
    <span class="set-result" id="set-result">${esc(o.test || 'say something and Nami will type it back')}</span>`;
}
function voiceFlag(p) {
  if (p.ready) return 'ready';
  if (p.downloadBytes) return mb(p.downloadBytes) + ' to download';
  return p.reason || 'not set up';
}
function mb(bytes) { return Math.round(bytes / 1e6) + ' MB'; }

// The picked row is the only one that opens: a pointer to the Keys tab when the
// key is missing, or a download button. Keys are typed in exactly one place —
// the Keys tab — so a ready provider shows nothing extra at all.
function voiceRowBodyHtml(p) {
  if (p.needsKey && !p.ready) {
    return `<div class="set-opt-body"><div class="setup-note">needs your ${esc(p.keyEnv)} —
        <span class="sv-help go-keys" data-keyenv="${esc(p.keyEnv)}">add it in Keys</span></div>
      ${p.keyHelpUrl ? `<div class="sv-help" data-url="${esc(p.keyHelpUrl)}">where do I find my key?</div>` : ''}</div>`;
  }
  if (p.id === 'local' && !p.ready && p.downloadBytes) {
    return `<div class="set-opt-body">
      <button class="btn" id="set-dl">Download the model (${esc(mb(p.downloadBytes))})</button>
      <div class="setup-note" id="set-dl-note">One time. After this, dictation works with no network and no account.</div></div>`;
  }
  return '';
}

// Inputs are read back before any re-render, because the sheet is rebuilt whole.
function keepDraft(modal) {
  const o = S.overlay; if (!o || o.type !== 'settings') return;
  modal.querySelectorAll('.set-key').forEach((inp) => { o.draft[inp.dataset.k] = inp.value.trim(); });
}
async function saveVoiceDraft(modal) {
  const o = S.overlay; if (!o) return;
  keepDraft(modal);
  const patch = {};
  for (const [k, v] of Object.entries(o.draft)) patch[k] = v === '' ? null : v;
  if (o.pick) patch.sttProvider = o.pick;
  if (!Object.keys(patch).length) return;
  const res = await api.settingsSet(patch);
  if (res && res.ok) { setSttInfo(res.sttInfo); o.draft = {}; }
  else toast('Could not save: ' + (res && res.error || '?'));
}

function wireVoicePane(modal) {
  const o = S.overlay;
  modal.querySelectorAll('.set-opt').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.p === pickedVoiceId()) return;
      keepDraft(modal); o.pick = b.dataset.p; o.test = null;
      await saveVoiceDraft(modal);
      renderOverlay();
    };
  });
  modal.querySelectorAll('.sv-help[data-url]').forEach((el) => { el.onclick = () => api.openUrl(el.dataset.url); });
  // "add it in Keys" jumps to the Keys tab with that key's row already open
  modal.querySelectorAll('.go-keys').forEach((el) => {
    el.onclick = () => {
      o.section = 'keys'; o.editKey = el.dataset.keyenv; renderOverlay();
      const i = q('#key-edit-val'); if (i) i.focus();
    };
  });
  const dl = q('#set-dl', modal);
  if (dl) dl.onclick = async () => {
    dl.disabled = true; dl.textContent = 'Downloading…';
    const off = api.onSttProgress((ev) => {
      const note = q('#set-dl-note', modal);
      if (note && ev && ev.total) note.textContent = `${mb(ev.loaded || 0)} of ${mb(ev.total)}…`;
    });
    const res = await api.sttPrepare();
    off();
    await refreshSttInfo();
    if (!res || !res.ok) toast('Download failed: ' + (res && res.error || '?'));
    if (isSettingsOpen()) renderOverlay();
  };
  const mic = q('#set-mic', modal);
  if (mic) mic.onclick = () => toggleSettingsMic(modal);
}

// Record here in the sheet and show the words. It is the whole proof that voice
// works, without having to open a session first.
let settingsRec = null;
function toggleSettingsMic(modal) {
  const o = S.overlay, btn = q('#set-mic', modal), out = q('#set-result', modal);
  if (settingsRec) { try { settingsRec.stop(); } catch (_) {} return; }
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const rec = new MediaRecorder(stream), chunks = [];
    settingsRec = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      settingsRec = null;
      stream.getTracks().forEach((t) => t.stop());
      if (btn) { btn.textContent = '◉ Test the mic'; btn.classList.remove('rec'); }
      if (out) out.textContent = 'transcribing…';
      const res = await transcribeBlob(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      o.test = res && res.ok ? (res.text || '(silence)') : 'failed — ' + (res && res.error || '?');
      if (isSettingsOpen()) renderOverlay();
    };
    rec.start();
    if (btn) { btn.textContent = '■ Stop'; btn.classList.add('rec'); }
    if (out) out.textContent = 'listening — say something, then stop.';
    // a forgotten recording shouldn't run forever
    setTimeout(() => { if (settingsRec === rec) { try { rec.stop(); } catch (_) {} } }, 15000);
  }).catch((e) => { o.test = 'Mic error: ' + e.message; renderOverlay(); });
}

// ---- Look ------------------------------------------------------------------
function lookPaneHtml() {
  return `<div class="field-label">appearance</div>` + THEME_OPTIONS.map((t) =>
    `<button class="theme-opt set-opt${currentTheme() === t.id ? ' picked' : ''}" data-theme-id="${t.id}">
      <span class="theme-dot"></span>
      <span class="set-opt-col"><span class="theme-name">${esc(t.name)}</span>
        <span class="set-opt-desc">${esc(t.desc)}</span></span></button>`).join('');
}
function wireLookPane(modal) {
  modal.querySelectorAll('[data-theme-id]').forEach((b) => {
    b.onclick = () => { setTheme(b.dataset.themeId); renderOverlay(); };
  });
}

// ---- Models ----------------------------------------------------------------
// ---- Keys — named secrets every session inherits ---------------------------
// One obvious place to paste API keys. Each saved key is exported into the
// environment of every session Nami spawns (shell env still wins), and the
// Voice providers read the same store — never a second place to paste.
// Agent CLIs (Claude Code, OpenCode…) carry their own logins — no API key here.
// These are the keys Nami itself can use, plus whatever the user adds for scripts.
const SUGGESTED_KEYS = [
  { name: 'OPENAI_API_KEY', hint: 'backs Voice · OpenAI Whisper' },
  { name: 'ELEVENLABS_API_KEY', hint: 'backs Voice · ElevenLabs Scribe' },
];
function keyRowHtml({ name, value, sub, actions }) {
  return `<div class="key-row" data-key="${esc(name)}">
    <span class="k-name" title="${esc(name)}">${esc(name)}</span>
    <span class="k-val${sub ? ' k-sub' : ''}">${esc(value)}</span>
    ${actions.map((a) => `<button class="k-act" data-act="${a}">${a}</button>`).join('')}</div>`;
}
// Edit mode keeps the row: the current (masked) value stays visible above the
// input, and cancel / Escape put everything back exactly as it was.
function keyEditRowHtml(name, current) {
  return `<div class="key-row" data-key="${esc(name)}"><span class="k-name">${esc(name)}</span>
    <span class="k-val${current ? '' : ' k-sub'}">${esc(current || 'not set yet')}</span>
    <input class="text-input k-input" id="key-edit-val" type="password" placeholder="paste the ${current ? 'new ' : ''}secret…" spellcheck="false" />
    <button class="k-act k-save" data-act="save">save</button>
    <button class="k-act" data-act="cancel">cancel</button></div>`;
}
function keysPaneHtml() {
  const o = S.overlay;
  if (!o.keys) return '<p class="setup-copy">Looking for your keys…</p>';
  const stored = o.keys.stored, have = new Set(stored.map((k) => k.name));
  const rows = [];
  for (const k of stored) {
    if (o.editKey === k.name) {
      rows.push(keyEditRowHtml(k.name, k.masked));
    } else if (o.reveal && o.reveal.name === k.name) {
      rows.push(keyRowHtml({ name: k.name, value: o.reveal.value, actions: ['hide', 'edit', 'remove'] }));
    } else {
      rows.push(keyRowHtml({ name: k.name, value: k.masked, actions: ['show', 'edit', 'remove'] }));
    }
  }
  for (const s of SUGGESTED_KEYS) {
    if (have.has(s.name)) continue;
    if (o.editKey === s.name) rows.push(keyEditRowHtml(s.name, ''));
    else rows.push(keyRowHtml({ name: s.name, value: 'not set — ' + s.hint, sub: true, actions: ['add'] }));
  }
  return `<p class="setup-copy">Paste a key once and it lands in the environment of every session Nami
    starts — agents, terminals, harnesses. Voice reads the same keys.</p>
    ${rows.join('')}
    <div class="key-row key-row--new">
      <input class="text-input k-input k-name-input" id="key-new-name" placeholder="MY_SERVICE_KEY" spellcheck="false" />
      <input class="text-input k-input" id="key-new-val" type="password" placeholder="paste the secret…" spellcheck="false" />
      <button class="k-act k-save" id="key-new-save">save</button></div>
    <div class="key-note">saved in <span class="k-open" id="key-note-open">settings.json</span> — click to see the file</div>`;
}
function refreshKeys() {
  return api.keysGet().then((res) => {
    if (isSettingsOpen()) { S.overlay.keys = res; renderOverlay(); }
  });
}
function wireKeysPane(modal) {
  const o = S.overlay;
  if (o.keys === undefined) { o.keys = null; refreshKeys(); }
  const saveKey = async (name, input) => {
    const v = input.value.trim();
    if (!v) { toast('Paste the secret first.'); return; }
    const res = await api.keysSet(name, v);
    if (!res.ok) { toast(res.error || 'Could not save it.'); return; }
    o.editKey = null; o.reveal = null;
    toast(`${name} saved — every new session gets it.`);
    refreshKeys(); refreshSttInfo(); // Voice's ready flags read the same store
  };
  modal.querySelectorAll('.key-row .k-act').forEach((b) => {
    const name = b.closest('.key-row').dataset.key;
    const act = b.dataset.act;
    b.onclick = async () => {
      if (act === 'add' || act === 'edit') { o.editKey = name; o.reveal = null; renderOverlay(); const i = q('#key-edit-val'); if (i) i.focus(); }
      else if (act === 'save') saveKey(name, q('#key-edit-val', modal));
      else if (act === 'cancel') { o.editKey = null; renderOverlay(); }
      else if (act === 'show') { const r = await api.keysReveal(name); o.reveal = { name, value: r.value }; renderOverlay(); }
      else if (act === 'hide') { o.reveal = null; renderOverlay(); }
      else if (act === 'remove') { o.reveal = null; await api.keysDelete(name); toast(`${name} removed.`); refreshKeys(); refreshSttInfo(); }
    };
  });
  const editInput = q('#key-edit-val', modal);
  if (editInput) editInput.onkeydown = (e) => {
    if (e.key === 'Enter') saveKey(o.editKey, editInput);
    if (e.key === 'Escape') { e.stopPropagation(); o.editKey = null; renderOverlay(); }
  };
  const noteOpen = q('#key-note-open', modal);
  if (noteOpen) noteOpen.onclick = () => api.settingsReveal();
  const newSave = q('#key-new-save', modal);
  if (newSave) {
    const doNew = () => {
      const name = q('#key-new-name', modal).value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!name) { toast('Name it like AN_ENV_VAR first.'); return; }
      saveKey(name, q('#key-new-val', modal));
    };
    newSave.onclick = doNew;
    q('#key-new-val', modal).onkeydown = (e) => { if (e.key === 'Enter') doNew(); };
  }
}

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
      ${panelChip(p)}
      <span class="col"><span class="pk-title">${esc(p.title)}${p.dirty ? ' •' : ''}</span><span class="pk-sub">${esc(shortHome(p.filePath))}</span></span>
      <button class="btn btn--go pk-pin" title="Keep it open as a tile on the desk">Pin to desk</button>
      <button class="t-btn pk-x" title="Close"><span class="uni-i">✕</span><span class="pix-i">${pixIcon('close')}</span></button>
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
        <span class="code" data-kind="service">${esc(s.code)}</span>
        <span class="sv-name">${esc(s.name)}</span>
        <span class="sv-desc">${esc(s.desc)}</span>
        ${s.id === 'kie' ? '<span class="sv-by">by Dainami</span>' : ''}
        <span class="sv-go">${connectedIds.has(s.id) ? '<span class="ok">●</span> connected' : 'connect →'}</span>
      </div>`).join('')}</div>
    <div class="svc-custom" id="svc-custom" tabindex="0">
      <span class="code" data-kind="service">✳</span>
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
    <div class="setup-head"><span class="code" data-kind="service">${esc(svc.code)}</span>
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
    <div class="setup-head"><span class="code" data-kind="service">${esc((cat && cat.code) || 'SV')}</span>
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
  // A flow names its session for a reason ("build: dark mode") — that name
  // outranks the ones guessed later, and rides down into claude itself.
  startPanel(Object.assign({ kind: worker.kind === 'claude' ? 'claude' : 'run',
    titleSource: 'flow',
    command: worker.kind === 'claude' ? undefined : worker.bin }, opts));
}
function openConnectCustom() { S.overlay = { type: 'connect-custom', text: '' }; renderOverlay(); if (!S.agents) refreshAgents(); }
function renderConnectCustom() {
  const o = S.overlay;
  const worker = chosenAgent(o);
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" data-kind="service">✳</span>
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
let overlayStill = false;
function overlay(cls, inner, opts) {
  const wrap = document.createElement('div'); wrap.className = 'overlay' + (opts && opts.top ? ' overlay--top' : ''); wrap.onclick = closeOverlay;
  const modal = document.createElement('div'); modal.className = cls; modal.onclick = (e) => e.stopPropagation(); modal.innerHTML = inner;
  if (overlayStill) modal.style.animation = 'none';
  const x = document.createElement('button'); x.className = 't-btn ov-x'; x.title = 'Close'; x.innerHTML = `<span class="uni-i">✕</span><span class="pix-i">${pixIcon('close')}</span>`; x.onclick = closeOverlay;
  modal.appendChild(x);
  wrap.appendChild(modal); els.overlayRoot.appendChild(wrap); return modal;
}

// ---- folders ---------------------------------------------------------------
async function openFolderDialog() { const info = await api.pickFolder(); if (info) await switchToFolder(info); }
async function openFolder(path) {
  // Read it, don't adopt it — switchToFolder may still route this folder to a
  // new window, and a switch that never happens must leave Recents untouched.
  const info = await api.openFolder(path, false);
  if (!info) return;
  if (info.missing) { toast('That folder has moved or been deleted.'); return; }
  await switchToFolder(info);
}
// This window is now that folder's window: main bumps Recents and records the
// folder for restore. Called only once a switch is actually going through.
function adoptFolder(info) { return api.openFolder(info.path); }

// A window is one folder, so changing the folder has to change the desk with
// it. Without this the tiles from the folder you left stay on screen under the
// new name, keep running in the old cwd, and the next savePanels() writes them
// over the incoming folder's remembered desk.
async function switchToFolder(info) {
  if (!info) return;
  if (S.project && S.project.path === info.path) { await adoptFolder(info); applyProject(info); return; }
  // Nothing on the desk yet — nothing to preserve, so this is just an open.
  if (!S.project && !S.panels.length) { await adoptFolder(info); applyProject(info); await restoreDeskFor(info.path); return; }
  // Live work is never torn down to make room. Offer it a window of its own
  // instead — the same ⧉ the popover already has, just asked for at the right
  // moment.
  const live = S.panels.filter((p) => isSessionPanel(p) && p.status === 'live' && !p.exited);
  if (live.length) { openSwitchChoice(info, live); return; }
  await swapDesk(info);
}

function isSessionPanel(p) { return p && !['editor', 'viewer', 'card'].includes(p.kind); }

// Save → clear → restore, in that order. The save has to name the *outgoing*
// folder explicitly: savePanels() reads S.project, which is about to change.
async function swapDesk(info) {
  const from = S.project ? S.project.path : null;
  clearTimeout(saveTimer); // a pending debounce would land under the new folder
  await flushPanels(from);
  clearDesk();
  await adoptFolder(info);
  applyProject(info);
  await restoreDeskFor(info.path);
}

// Tear the desk down without the confirm prompts closePanel() runs — the caller
// has already established there is nothing live and nothing unsaved to lose.
function clearDesk() {
  for (const p of S.panels) if (isSessionPanel(p)) api.termKill({ id: p.id });
  for (const [, t] of tileEls) { if (t.disposeRo) t.disposeRo(); t.root.remove(); }
  tileEls.clear();
  S.panels = []; S.activeId = null; S.expandedId = null;
}

async function restoreDeskFor(folder) {
  let snaps = [];
  try { snaps = await api.loadPanels(folder); } catch (_) { snaps = []; }
  if (Array.isArray(snaps) && snaps.length) await restorePanels(snaps);
  else renderAll();
}

// The launcher's sheet, reused: two exits, neither of which destroys anything.
function openSwitchChoice(info, live) {
  S.overlay = { type: 'switch-folder', info, live };
  renderOverlay();
}
function renderSwitchChoice() {
  const { info, live } = S.overlay;
  const rows = live.slice(0, 4).map((p) => `<div class="sw-live"><span class="mark">✳</span><span>${esc(p.title)}</span></div>`).join('');
  const more = live.length > 4 ? `<div class="sw-live"><span class="mark"> </span><span>and ${live.length - 4} more</span></div>` : '';
  const modal = overlay('switch-box', `
    <div class="modal-head"><div class="title">${esc(S.project ? S.project.name : 'This folder')} still has work running</div></div>
    <div class="sw-body">${live.length === 1 ? 'A session is' : live.length + ' sessions are'} live on this desk. Opening
      ${esc(info.name)} here would leave ${live.length === 1 ? 'it' : 'them'} running with no window to watch from.</div>
    <div class="sw-list">${rows}${more}</div>
    <div class="sw-acts">
      <button class="btn btn--go" id="sw-win">⧉ Open ${esc(info.name)} in a new window</button>
      <button class="btn" id="sw-stay">Stay here</button>
    </div>
    <div class="sw-hint">${esc(info.name)} opens with its own desk. Nothing here is touched.</div>`);
  q('#sw-win', modal).onclick = () => { closeOverlay(); api.newWindow(info.path); };
  q('#sw-stay', modal).onclick = closeOverlay;
  q('#sw-win', modal).focus();
}

function applyProject(info) {
  S.project = info; S.tree = {}; S.expanded = new Set();
  S.library.loaded = false; S.library.items = [];
  S.recents = [{ path: info.path, pathShort: info.pathShort, name: info.name, at: Date.now(), pinned: !!(S.recents.find((r) => r.path === info.path) || {}).pinned },
    ...S.recents.filter((r) => r.path !== info.path)];
  S.tree[info.path] = info.tree && info.tree.length && info.tree[0].path ? info.tree : null;
  // load root level fresh for the explorer
  api.listDir(info.path, S.treeAll).then((rows) => { S.tree[info.path] = rows; if (S.railTab === 'workspace') refreshRail(); });
  refreshServices();
  renderAll();
}

// ---- toast -----------------------------------------------------------------
let toastTimer = null;
function toast(msg) { els.toastRoot.innerHTML = `<div class="toast"><span class="dot"></span><span class="msg">${esc(msg)}</span></div>`; clearTimeout(toastTimer); toastTimer = setTimeout(() => { els.toastRoot.innerHTML = ''; }, 2200); }

// ===========================================================================
//  Update bar
// ===========================================================================
// A card in the corner, never a modal. Someone mid-sentence with an agent does
// not want the app in front of them, and an update is the least urgent thing
// Nami has to say — so it waits, and "Not now" means not this version, ever.

const SKIPPED_UPDATE = 'nami-skipped-update';

function offerUpdate(info) {
  if (!info || !info.version || !els.updateRoot) return;
  // Dismissing is per version, and it sticks. Re-asking every six hours for
  // something already refused is how an update prompt becomes wallpaper.
  if (localStorage.getItem(SKIPPED_UPDATE) === info.version) return;

  els.updateRoot.innerHTML = `<div class="update-note">
    <span class="un-dot"></span>
    <span class="un-msg">Nami ${esc(info.version)} is out</span>
    <button class="un-act" id="uc-get">download</button>
    <span class="un-sep">·</span>
    <button class="un-act un-quiet" id="uc-later">not now</button>
  </div>`;

  const close = () => { els.updateRoot.innerHTML = ''; };
  q('#uc-get', els.updateRoot).onclick = async () => {
    await api.openUpdate(info.url);
    close();
  };
  q('#uc-later', els.updateRoot).onclick = () => {
    localStorage.setItem(SKIPPED_UPDATE, info.version);
    close();
  };
}

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
  const c = { id: uid('p_'), kind: 'shell', chipKind: 'agent', code: 'CC', title: 'Claude session', cwd: '/Users/calvin/work/atlas', status: 'live', started: true, attention: true, _demoText: true };
  const e = { id: uid('p_'), kind: 'editor', chipKind: 'editor', code: 'ED', title: 'passkey.ts', filePath: '/Users/calvin/work/atlas/src/auth/passkey.ts', dirty: true, status: 'live',
    text: `import { verifyRegistration } from './webauthn'\n\nexport async function register(user: User) {\n  const options = await createOptions(user)\n  const cred = await navigator.credentials.create({ publicKey: options })\n  return verifyRegistration(cred)\n}\n` };
  S.panels = [c, e]; S.activeId = c.id;
  // paint a paper "claude" banner into the demo terminal after mount
  setTimeout(() => { const t = tileEls.get(c.id); if (t && t.term) t.term.write('\x1b[38;2;168;121;42m✻ Welcome to Claude Code\x1b[0m\r\n\r\n  \x1b[38;2;74;107;82m❯\x1b[0m Compare our pricing with the top 20 competitors\r\n\r\n  \x1b[38;2;74;122;74m✓\x1b[0m Read pricing.csv (187 rows)\r\n  \x1b[38;2;74;122;74m✓\x1b[0m Lined up 20 competitor sites\r\n  \x1b[38;2;168;121;42m●\x1b[0m Building your spreadsheet…\r\n\r\n  \x1b[38;2;141;128;101mType / for commands · esc to interrupt\x1b[0m\r\n'); }, 500);
}
