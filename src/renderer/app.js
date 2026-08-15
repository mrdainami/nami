// Nami — the agent workbench, by Dainami (renderer, terminal-first).
// Every session is a real PTY (claude / shell / any harness), shown as a paper tile in a grid you
// can focus, reorder, and expand. Workspace is a live explorer + paper editor. Vanilla DOM; tiles
// (xterm + editors) are managed incrementally so live processes survive re-renders.

import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';
import { fileKind, shellQuote, fileUrl, docUrl, tailPath, pathRef } from './file-kinds.mjs';
import { parseDoc, getField, setField, serializeDoc, editsAsFrontmatter } from './frontmatter.mjs';
import { resolveOpen } from './peek-core.mjs';
import { buildCreateSeed, buildImproveSeed, targetDirFor } from './seed-text.mjs';
import { chipHtml, iconKeyFor, iconSvg, treeIcon, pixIcon } from './icons.mjs';
import { resolveTool, originLine, sortKey, isMaster, reachOf } from './agent-reach.mjs';
import { agentLaunch } from './agent-launch.mjs';
import { shortAge } from './rel-time.mjs';
import { isGenericTitle, feedNameDraft, adoptTitle, shouldPushName } from './session-name.mjs';
import { renderMarkdown, highlightMarkdown, isMarkdownPath, docHrefTarget } from './md.mjs';
import { scanLinks, urlTarget } from './term-links.mjs';
import { termMenuItems } from './term-menu.mjs';
import { runBounds, leadingIndent } from './term-wrap.mjs';
import { buildRows, sceneEvents } from './session-cards.mjs';
import { buildCards, modeLabel, modeClass } from './cards-dom.mjs';
import { commandsFor, routeCommand } from './agent-commands.mjs';

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
// What a new install opens on, and the answer whenever nothing valid has been
// chosen. Kept in step with DEFAULT_THEME in src/main/settings.js, which paints
// the window before this file has loaded — the two disagreeing is a visible
// flash of the wrong colour on every launch.
const DEFAULT_THEME = 'glass';
function currentTheme() {
  const t = document.body.dataset.theme;
  return THEME_NAMES.includes(t) ? t : DEFAULT_THEME;
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
// Before first paint, and before boot data arrives. An install that has never
// chosen a theme gets the default rather than the base stylesheet, which is
// what "paper is the absence of an attribute" would otherwise hand it.
try { applyThemeAttrs(localStorage.getItem(THEME_KEY) || DEFAULT_THEME); } catch (_) { applyThemeAttrs(DEFAULT_THEME); }

// ---- launcher rows ---------------------------------------------------------
// Agents come from the detected registry (S.agents); only Terminal is static.
// Big rows are things that run right now; small cards are things you could add.
const EVERGREEN_ROWS = [
  { id: 'shell', name: 'Terminal', sub: 'a plain shell, ink on paper', kind: 'shell', chipKind: 'shell', code: '❯' },
];

// ---- state -----------------------------------------------------------------
const S = {
  project: null, recents: [], demo: false,
  panels: [], activeId: null, expandedId: null,
  railTab: 'sessions', overlay: null, toast: null, seq: 0, winId: 0,
  version: '', updatedAt: null,        // shown in Settings → About, filled at boot
  agents: null, agentsLoading: false,   // detected agent CLIs (null until first scan)
  justAdded: null,                      // agent installed this run — flagged in the launcher
  agentStatus: {},                      // id → { signedIn, label, rows, source }, filled lazily
  tree: {}, expanded: new Set(),   // explorer: path -> children[], expanded dirs
  treeSel: null,                   // selected row, for the ＋ target and Enter-to-rename
  treeEdit: null,                  // { path } while a rename input is open
  treeDrag: null,                  // path being dragged, for the descendant guard
  treeFresh: new Set(),            // rows that just landed, briefly marked
  treeAll: localStorage.getItem('dainami-tree-all') === '1',  // show ignored files too
  // Your project's skills are what you came for; other tools' folders and broken
  // links start folded, or 139 borrowed rows sit between you and everything else.
  library: { items: [], edges: [], q: '', loaded: false, loading: false, collapsed: new Set(['plugins', 'skills-mac', 'skills-broken']) },
  pointer: null, pointerLoading: false,
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
// The format a file is in, for a tab that should not call TOML "Markdown".
function formatLabel(p) {
  const m = baseNameOf(p).match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toUpperCase() : 'Raw';
}
function shortHome(p) { return String(p || '').replace(/^\/Users\/[^/]+/, '~'); }
function q(sel, root) { return (root || document).querySelector(sel); }
// A panel's chip: brand glyph when the session maps to a known brand, else its code.
function panelChip(p) {
  const key = p.kind === 'claude' ? 'claude'
    : iconKeyFor(p.title);
  return chipHtml({ key, code: p.code, kind: chipKindOf(p) });
}

// ---- OS file drops ---------------------------------------------------------
function isFileDrag(e) { return dragTypes(e).includes('Files'); }
// A row dragged out of the Workspace tree. It carries its path in a private type
// as well as in text/plain, because text/plain already means "panel id" to the
// tile reorder — one channel, two meanings, and the tile could only guess. The
// payload itself is unreadable until the drop fires (browsers hide getData
// during dragover), so in flight this is all there is to go on, exactly as with
// isFileDrag above.
//
// Whether the row is a folder rides as a second *type* rather than as data, for
// exactly that reason: the canvas has to refuse a folder while you are still
// holding it, and a hidden payload cannot answer that.
const PATH_TYPE = 'application/x-nami-path';
const DIR_TYPE = 'application/x-nami-dir';
function dragTypes(e) { return Array.from((e.dataTransfer && e.dataTransfer.types) || []); }
function isPathDrag(e) { return dragTypes(e).includes(PATH_TYPE); }
function isDirDrag(e) { return dragTypes(e).includes(DIR_TYPE); }
function draggedPath(e) { try { return e.dataTransfer.getData(PATH_TYPE) || ''; } catch (_) { return ''; } }
function droppedPaths(e) {
  return Array.from((e.dataTransfer && e.dataTransfer.files) || [])
    .map((f) => api.droppedFilePath(f)).filter(Boolean);
}
function dropFilesOnPanel(p, paths) {
  if (p.kind === 'editor' || p.kind === 'viewer') { paths.forEach((f) => openFile(f, { pin: true })); return; }
  injectToSession(p, paths.map(shellQuote).join(' ') + ' ');
  toast('Dropped ' + (paths.length === 1 ? baseNameOf(paths[0]) : paths.length + ' files') + ' into ' + shorten(p.title, 24));
}
// A workspace path dropped on a session. The file does not move and nothing is
// copied — the session is handed a reference to where it already lives.
//
// S.treeDrag is cleared here rather than left to the row's own dragend, because
// both of the paths below rebuild the rail synchronously — injectToSession
// focuses the panel, which calls renderRail, which empties the container the
// dragged row lives in. The row is gone before dragend would reach it. Every
// tree drop on master ended in wireDrop.ondrop, which nulls this itself; these
// two are the first that do not, and a stale S.treeDrag is not inert — the next
// no-files drag onto a tree row would move a file you are not holding.
function dropPathOnPanel(p, path, isDir) {
  S.treeDrag = null;
  if (p.kind === 'editor' || p.kind === 'viewer') { if (!isDir) openFile(path, { pin: true }); return; }
  injectToSession(p, pathRef(path, S.project && S.project.path, isDir));
  toast('Added ' + baseNameOf(path) + ' to ' + shorten(p.title, 24));
}

// ===========================================================================
//  Boot
// ===========================================================================
(async function boot() {
  buildShell();
  const b = await api.boot();
  S.winId = b.winId || 0;
  S.version = b.version || ''; S.updatedAt = b.updatedAt || null;
  // The wordmark's caption. Rendered empty by buildShell and filled here, so
  // the lockup is never laid out twice — the stack is sized by Nami above it,
  // and a build that somehow reports no version simply shows nothing.
  if (S.version) { const bv = q('#brand-ver'); if (bv) bv.textContent = 'v' + S.version; }
  S.demo = b.demo; S.recents = b.recentFolders || []; S.project = b.currentFolder || null;
  setSttInfo(b.sttInfo);
  if (b.collapsed) S.railCollapsed = true;
  if (b.themeArg) setTheme(b.themeArg, false); // --theme= override (screenshots)

  // One window opening a folder reorders the list for every window; without this
  // the other windows' popovers keep showing a stale order until they reboot.
  // Either the check already ran before this window existed (boot carries it),
  // or it lands later while the window is open.
  if (b.update) offerUpdate(b.update, b.updater);
  api.onUpdateAvailable(offerUpdate);
  api.onUpdateProgress((ev) => paintUpdate('downloading', ev));
  api.onUpdateReady((ev) => paintUpdate('ready', ev));
  api.onUpdateFailed(() => paintUpdate('failed', {}));

  api.onRecentsChanged((rows) => {
    S.recents = rows || [];
    if (q('.projects-pop')) { q('.projects-pop').remove(); toggleProjectsPop(); }
  });

  api.onTermData(({ id, data }) => {
    const t = tileEls.get(id); if (t && t.term) t.term.write(data);
    // when a byte last moved — the auto-takeover's "is the terminal mid-task"
    const p = S.panels.find((x) => x.id === id); if (p) p.lastPtyData = Date.now();
  });

  // The same session, read out of the transcript it is already writing. Only
  // arrives for tiles that asked (cardsWatch), and `reset` means the
  // conversation underneath changed — /resume, or /clear rewriting the file.
  api.onSessionEvents(({ id, events, reset }) => {
    const p = S.panels.find((x) => x.id === id); if (!p) return;
    if (p.agentLive) return; // the drive channel owns this tile's events
    if (reset) p.cardEvents = [];
    if (events && events.length) p.cardEvents = (p.cardEvents || []).concat(events);
    feedCards(p, !!reset);
  });

  // Drive mode: one event at a time from the live adapter, already in the
  // vocabulary. init and status shape the tile; everything else is a row.
  api.onAgentEvent((ev) => {
    const p = S.panels.find((x) => x.id === ev.tileId); if (!p) return;
    if (ev.kind === 'init') {
      p.agentCaps = ev.capability || null;
      p.agentInit = true;
      // A partial re-announcement (a mode switch, a commands update) must
      // never clobber what an earlier, fuller init already delivered.
      if (ev.commands && ev.commands.length) p.agentCommands = ev.commands;
      else p.agentCommands = p.agentCommands || [];
      // The adapter resumed (or minted) a conversation; keep the id the next
      // entry will resume — claude's rides p.sid (same rule as /resume in the
      // terminal), an ACP agent's rides its own field.
      if (ev.agentSessionId) {
        if (cardAgentFor(p) === 'claude' && p.sid !== ev.agentSessionId) { p.sid = ev.agentSessionId; savePanels(); }
        else if (cardAgentFor(p) !== 'claude' && p.acpSid !== ev.agentSessionId) { p.acpSid = ev.agentSessionId; savePanels(); }
      }
      // What the composer shows and the intro card says. init can fire again
      // (a commands update, a mode switch) — the status merges, the intro
      // updates in place under its stable id.
      p.agentStatus = Object.assign(p.agentStatus || {}, {
        name: ev.agentName || (p.agentStatus && p.agentStatus.name),
        version: ev.version || (p.agentStatus && p.agentStatus.version),
        model: ev.model || (p.agentStatus && p.agentStatus.model),
        mode: ev.mode || (p.agentStatus && p.agentStatus.mode),
        models: ev.models || (p.agentStatus && p.agentStatus.models),
        modes: ev.modes || (p.agentStatus && p.agentStatus.modes), // availability, per mode
        ctxPct: (p.agentStatus && p.agentStatus.ctxPct),
      });
      const introId = 'intro:' + p.id;
      const intro = {
        kind: 'intro', id: introId,
        name: p.agentStatus.name, version: p.agentStatus.version,
        model: p.agentStatus.model, mode: p.agentStatus.mode,
        cwd: p.cwd, channel: p.agentCaps && p.agentCaps.channel,
        // the channel's own caveat, said on the welcome where it belongs
        // ('headless: approvals run by its own config', …)
        note: (p.agentCaps && p.agentCaps.note) || '',
      };
      const at = (p.cardEvents || []).findIndex((e) => e && e.id === introId);
      if (at >= 0) p.cardEvents[at] = intro;
      else p.cardEvents = (p.cardEvents || []).concat(intro);
      scheduleFeed(p);
      const rec = tileEls.get(p.id);
      if (rec && rec.cardsUi) {
        rec.cardsUi.setStatus({ ...p.agentStatus, canSwitchMode: availableModes(p).some((m) => m.available) });
        refreshCardNote(p, rec); // clears the connecting note the moment the channel is real
      }
      refreshChannelBadge(p, rec);
      return;
    }
    if (ev.kind === 'status') {
      const was = p.agentBusy;
      p.agentBusy = ev.state === 'running';
      const rec = tileEls.get(p.id);
      if (rec && rec.cardsUi) rec.cardsUi.setWorking(p.agentBusy, ev.tokens);
      if (rec) refreshCardNote(p, rec);
      // a queued message goes when the channel frees up
      if (was && !p.agentBusy && p.sendQueue && p.sendQueue.length) {
        const next = p.sendQueue.shift();
        const qrow = (p.cardEvents || []).findIndex((e2) => e2 && e2.kind === 'note' && e2.queued);
        if (qrow >= 0) { p.cardEvents.splice(qrow, 1); scheduleFeed(p); }
        setTimeout(() => { if (p.agentLive) api.agentSend({ id: p.id, text: next }); }, 60);
      }
      return;
    }
    p.cardEvents = (p.cardEvents || []).concat(ev);
    p.lastEventAt = Date.now();
    if (ev.kind === 'turn_end' && typeof ev.ctxPct === 'number') {
      p.agentStatus = Object.assign(p.agentStatus || {}, { ctxPct: ev.ctxPct });
      const rec = tileEls.get(p.id);
      if (rec && rec.cardsUi) rec.cardsUi.setStatus({ ...p.agentStatus, canSwitchMode: availableModes(p).some((m) => m.available) });
    }
    scheduleFeed(p);
    if (ev.kind === 'permission') setAttention(p);
  });
  // A one-shot command Nami ran on the user's behalf has landed. The shell is
  // still alive and still theirs — this is the command reporting, not the tile
  // ending. See src/main/run-done.js for how the shell says so.
  api.onTermCommandDone(({ id, code }) => {
    const p = S.panels.find((x) => x.id === id); if (!p) return;
    runCommandFinished(p, code);
  });

  api.onTermExit(({ id, code, note }) => {
    const p = S.panels.find((x) => x.id === id); if (!p) return;
    // A deliberate runtime swap (Term → Cards) is not an ending: the same
    // conversation is about to continue over the drive channel.
    if (p.viewSwitching) { p.viewSwitching = false; return; }
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

  api.onMenuCommand((cmd) => runMenuCommand(cmd));

  if (S.demo) seedDemo();
  refreshAgents();   // pre-detect so ⌘N is instant
  refreshServices(); // services group in the library + connect sheets
  renderAll();
  if (!S.demo && Array.isArray(b.panels) && b.panels.length) restorePanels(b.panels);
  // Nothing auto-starts: an empty desk lands on the session page, where the
  // agent and the surface are chosen. Scenes keep the desk to themselves.
  else if (!S.demo && !b.scene && S.project) openLauncher();
  if (b.scene) showScene(b.scene);
  armStarAsk();
})();

// --scene= puts one surface on screen at boot so `npm run shot` can capture it in both
// themes. Screenshot plumbing only; nothing in the app calls this.
function showScene(name) {
  const [what, ...rest] = String(name).split(':');
  const step = rest.join(':'); // a step can be a path, and paths carry colons' worth of slashes
  if (what === 'settings') return openSettings(step || 'voice');
  // open:<abs path> — pin any file as a tile, which is how a new viewer kind
  // gets screenshotted without a folder open and a tree to click through.
  if (what === 'open' && step) return openFile(step, { pin: true });
  // The folder-first card asks where a session should run when no folder is
  // open. :empty shoots the first-run face (no recents on file).
  if (what === 'folder-first') {
    if (step === 'empty') S.recents = [];
    S.project = null;
    S.overlay = { type: 'folder-first', run: () => {}, who: 'Claude' };
    return renderOverlay();
  }
  // The ⌘K picker, and the same picker with one agent's tool list open.
  //   --scene=agents  ·  agents:<slug>
  // Both wait on the detect pass: without it the rows cannot name a tool.
  if (what === 'agents') {
    return refreshAgents().then(async () => {
      await openAgentPicker();
      if (!step) return;
      const item = pickerAgents().find((a) => a.slug === step);
      if (item) await openToolList(item);
    });
  }
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
  // An install that has just finished — the one state you cannot arrange on
  // demand without actually installing something. The tile is static (no pty),
  // but finishAgentInstall is the real one: it re-scans and decides from what
  // it finds, so the shot shows what a user would see and not a mock of it.
  //   --scene=install:ok  ·  install:failed  ·  install:launcher
  if (what === 'install') {
    return refreshAgents().then(async () => {
      if (step === 'launcher') {
        const found = (S.agents || []).find((x) => x.found);
        S.justAdded = found && found.id;
        return openLauncher();
      }
      const fail = step === 'failed';
      // ok needs an agent this Mac really has, so the scan can confirm it.
      // failed is driven by the exit code, which is what actually decides —
      // a machine with every agent already installed (this one, as it turns
      // out) has no missing agent to borrow for the shot.
      const a = (S.agents || []).find((x) => x.found) || (S.agents || [])[0];
      if (!a) return undefined;
      const p = startPanel({
        kind: 'run', title: `install ${a.name}`, code: code2(a.name), command: a.install,
        oneShot: true, agentId: a.id, sceneStatic: true,
      });
      if (!p) return undefined;
      await new Promise((r) => requestAnimationFrame(r));
      const t = tileEls.get(p.id);
      if (t && t.term) {
        t.term.write(`\x1b[38;5;246m$ ${a.install}\x1b[0m\r\n`);
        t.term.write('  resolving host…\r\n  downloading  ████████  100%\r\n');
        t.term.write(fail ? '\x1b[38;5;174mcurl: (6) Could not resolve host\x1b[0m\r\n'
          : `\x1b[38;5;114m  ✓ ${a.bin} installed\x1b[0m\r\n`);
      }
      return runCommandFinished(p, fail ? 6 : 0);
    });
  }
  if (what === 'projects') return toggleProjectsPop();
  // newfile / newfolder — the create box. It had no scene, so every screenshot
  // of this app was taken without it, and its header shipped wrapped across two
  // lines under a three-line path before anyone saw it.
  if (what === 'newfile' || what === 'newfolder') {
    const ready = S.project ? Promise.resolve() : (S.recents[0] ? openFolder(S.recents[0].path) : Promise.resolve());
    return ready.then(() => {
      S.railTab = 'workspace'; renderRail();
      // step lets a shot aim at a deep folder, which is the case that broke it
      const dir = step || (S.project && S.project.path) || '~';
      openFsName(what === 'newfile' ? 'file' : 'folder', dir);
    });
  }
  // The update card only appears when a newer release exists, which is exactly
  // the state you cannot arrange on demand — so the scene fakes the payload.
  // A download in flight and one waiting for a quit are two more states nobody
  // can arrange on demand, and they are the two the user stares at longest.
  //   --scene=update  ·  update:downloading  ·  update:ready  ·  update:confirm
  if (what === 'update') {
    localStorage.removeItem(SKIPPED_UPDATE);
    const staged = step === 'downloading' || step === 'ready' || step === 'confirm';
    offerUpdate({ version: staged ? '0.2.0' : (step || '0.2.0'), url: 'https://example.test/Nami.dmg' });
    if (staged) paintUpdate(step, { percent: 58, version: '0.2.0', live: 3 });
    return undefined;
  }
  // Same problem as the update card: the star ask is gated on five launches and
  // a 90-second wait, which is not a state anyone can arrange for a screenshot.
  if (what === 'star') {
    localStorage.removeItem(STAR_ASKED);
    return paintStarAsk();
  }
  // rename:tile / rename:rail — the in-place name editor, which you can only
  // otherwise reach by double-clicking a live session
  if (what === 'rename') {
    const p = S.panels.find((x) => isSessionPanel(x));
    if (!p) return;
    const t = tileEls.get(p.id);
    return beginRename(p, step === 'rail' ? q('.rail-list .nav-card .goal') : t && q('.t-title', t.head));
  }
  if (what === 'cards') {
    // A card view from a fixture: every row shape on one screen, no process,
    // no network — the closest thing to a renderer test this repo can have.
    //   cards          the conversation, small tile
    //   cards:full     the same, tile focused (bodies breathe)
    //   cards:welcome  the card-born welcome alone
    //   cards:menu     the slash menu open over content
    //   cards:mode     the mode menu open (bypass disabled, as settings can)
    //   cards:bridge   the ⌄ head menu open over content
    const p = startPanel({ kind: 'claude', title: 'Agent cards', code: 'AC', sid: 'ses_scene', sceneStatic: true, cwd: (S.project && S.project.path) || '/tmp' });
    if (!p) return;
    p.view = 'cards';
    p.agentLive = true; // the fixture drives nothing, but live-only controls must be photographable
    p.agentCaps = { channel: 'agent sdk' };
    p.agentStatus = {
      name: 'Claude Code', model: 'claude-opus-5', mode: 'default', ctxPct: 62,
      modes: [
        { id: 'default', available: true }, { id: 'acceptEdits', available: true },
        { id: 'plan', available: true }, { id: 'auto', available: true },
        { id: 'dontAsk', available: true },
        { id: 'bypassPermissions', available: false, reason: 'disabled in ~/.claude/settings.json' },
      ],
      models: {
        current: 'claude-opus-5',
        options: [
          { value: 'default', name: 'Default (recommended)', desc: 'Opus 5 · best for everyday, complex tasks' },
          { value: 'claude-opus-5', name: 'Opus (1M context)', desc: 'Opus 5 with 1M context · long-running work' },
          { value: 'claude-fable-5', name: 'Fable', desc: 'Fable 5 · most capable, hardest tasks' },
        ],
      },
    };
    p.agentCommands = [
      { name: 'model', description: 'Switch the model for this session', argumentHint: 'model name' },
      { name: 'review-pr', description: 'Review a pull request with severity labels', argumentHint: 'PR number' },
      { name: 'resume', description: 'Pick a past conversation to continue' },
      { name: 'rewind', description: 'Walk back to an earlier turn' },
      { name: 'compact', description: 'Compress the context, keep the thread' },
    ];
    p.cardEvents = step === 'welcome'
      ? [sceneEvents().find((e) => e.kind === 'intro') || sceneEvents()[0]]
      : sceneEvents();
    if (step === 'welcome') {
      p.cardEvents = [{ kind: 'intro', id: 'w0', name: 'Claude Code', version: '3.1.8', model: 'claude-opus-5', mode: 'default', cwd: '~/work/atlas' }];
    }
    const rec = tileEls.get(p.id);
    if (rec) {
      applyView(p, rec);
      feedCards(p, true);
      if (rec.cardsUi) {
        rec.cardsUi.setStatus({ ...p.agentStatus, canSwitchMode: true });
        if (step === 'menu') {
          rec.cardsUi.input.value = '/re';
          rec.cardsUi.input.dispatchEvent(new Event('input'));
        }
        if (step === 'mode') openModeMenu(p);
        if (step === 'model') openModelControl(p);
        if (step === 'bridge') { const b = q('.t-bridge', rec.head); if (b) openBridgeMenu(p, b); }
        if (step === 'full') { S.expandedId = p.id; renderGrid(); }
      }
    }
    return;
  }
  if (what === 'theme') return toggleThemePop();
  if (what === 'workspace') {
    // the tree needs a folder; fall back to the most recent one if none is open
    const ready = S.project ? Promise.resolve() : (S.recents[0] ? openFolder(S.recents[0].path) : Promise.resolve());
    return ready.then(() => { S.railTab = 'workspace'; renderRail(); });
  }
  S.railTab = 'library';
  // library:<abs path> / mcp:<abs path> — open that folder first, so shots can
  // show project-scoped state (coverage pills need a project's masters).
  const withFolder = step && step.startsWith('/') && (what === 'library' || what === 'mcp') ? openFolder(step) : Promise.resolve();
  withFolder.then(() => loadLibrary(true)).then(() => {
    renderRail();
    if (what === 'library') return;
    if (what === 'mcp') return step === 'own' ? openConnectOwn() : openConnect();
    // create:agent / create:skill — the one-screen sheet ("agent" alone is the
    // agent identity sheet above, so the create scene needs its own name)
    if (what === 'create') return openCreate(step === 'agent' ? 'agent' : 'skill');
    if (what !== 'agent' && what !== 'skill') return;
    openCreate(what); // one screen for both — the step argument died with the steps
  });
}

// ===========================================================================
//  The menu bar, from this side
// ===========================================================================
// Every Nami item in the application menu arrives here as a string. The rule
// this file keeps is that a menu item never has its own implementation: it
// calls the same function the keyboard or the button already called, so there
// is one behaviour per command and the menu only adds a label to it.
//
// Which is also why ⌘W is in here at all. A menu accelerator outranks a
// renderer keydown, so the moment File carries ⌘W the keydown below stops
// firing for it. Routing it to closeActive() is what keeps the key meaning
// close *pane* instead of Close Window, which is what the conventional menu
// item would have made it.
function runMenuCommand(cmd) {
  const [what, ...rest] = String(cmd || '').split(':');
  const arg = rest.join(':'); // an argument can be a path, and paths carry colons' worth of slashes
  if (what === 'about') return openSettings('about');
  if (what === 'settings') return openSettings(arg || 'voice');
  if (what === 'update-check') {
    openSettings('about');
    // The pane's own button, pressed. Checking has one implementation and it
    // lives in wireAboutPane, including the part where asking by hand
    // un-dismisses a version that was waved away.
    const act = q('#ab-act');
    if (act) act.click();
    return undefined;
  }
  if (what === 'new-session') return openLauncher();
  if (what === 'open-folder') return openFolderDialog();
  if (what === 'open-recent') return arg ? openFolder(arg) : undefined;
  if (what === 'new-file' || what === 'new-folder') {
    if (!S.project) { toast('Open a folder first.'); return openFolderDialog(); }
    S.railTab = 'workspace'; renderRail();
    return openFsName(what === 'new-file' ? 'file' : 'folder', S.project.path);
  }
  if (what === 'save') { if (!saveActive()) toast('Nothing here to save.'); return undefined; }
  if (what === 'reveal') {
    const p = activeFilePanel();
    if (!p) { toast('Open a file first.'); return undefined; }
    return api.revealFile(p.filePath);
  }
  if (what === 'close-pane') return closeActive();
  if (what === 'dictate') {
    const p = S.panels.find((x) => x.id === S.activeId);
    if (!p) { toast('Start a session first.'); return undefined; }
    return toggleMic(p);
  }
  if (what === 'rail') {
    if (arg === 'toggle') { S.railCollapsed = !S.railCollapsed; return applyChrome(); }
    S.railTab = arg;
    if (arg === 'library') loadLibrary(true);
    return renderRail();
  }
  if (what === 'theme') return setTheme(arg);
  if (what === 'agents') return openAgentPicker();
  return undefined;
}

// Both of these were written inline in onGlobalKey. They are functions now
// because the menu has to run the same code, and a second copy of "what does
// ⌘W mean" is exactly how the two would drift apart.
function closeActive() {
  if (S.overlay && S.overlay.type === 'peek') requestClosePeek();
  else if (S.activeId) closePanel(S.activeId);
}
// Returns whether it saved anything, because the keydown only swallows ⌘S when
// there was something to save.
function saveActive() {
  const pk = S.overlay && S.overlay.type === 'peek' && S.overlay.panel;
  if (pk && pk.kind === 'editor') { saveEditor(pk); return true; }
  if (pk && pk.kind === 'card') { saveCard(pk); return true; }
  const p = S.panels.find((x) => x.id === S.activeId);
  if (p && p.kind === 'editor') { saveEditor(p); return true; }
  if (p && p.kind === 'card') { saveCard(p); return true; }
  return false;
}
// A peek wins over the tile behind it, same as saving does: it is what you are
// looking at.
function activeFilePanel() {
  const pk = S.overlay && S.overlay.type === 'peek' && S.overlay.panel;
  if (pk && pk.filePath) return pk;
  const p = S.panels.find((x) => x.id === S.activeId);
  return p && p.filePath ? p : null;
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
            <span class="brand-stack">
              <span class="brand-name">Nami</span>
              <span class="brand-ver" id="brand-ver"></span>
            </span>
          </span>
          <span class="brand-sub">AI agent workbench</span>
        </div>
        <div class="topbar-center" id="topbar-center"></div>
        <div class="topbar-right">
          <div class="live-badge" id="live-badge" style="display:none"><span class="dot"></span><span id="live-label"></span></div>
          <button class="btn btn-help" id="btn-help" title="Quick start"><span class="uni-i">?</span><span class="pix-i">${pixIcon('help')}</span></button>
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
  q('#btn-help').onclick = () => openQuickStart();
  q('#btn-theme').onclick = (e) => { e.stopPropagation(); toggleThemePop(); };
  q('#btn-settings').onclick = () => openSettings();
  document.querySelectorAll('.rail-tab').forEach((t) => { t.onclick = () => { S.railTab = t.dataset.tab; if (t.dataset.tab === 'library') loadLibrary(true); renderRail(); }; });
  q('#rail-collapse').onclick = () => { S.railCollapsed = true; applyChrome(); };
  q('#rail-strip').onclick = () => { S.railCollapsed = false; applyChrome(); };
  document.addEventListener('keydown', onGlobalKey);
  initGlassTilt();

  // A folder changed on disk — usually because a session just wrote to it.
  if (api.onDirChanged) api.onDirChanged(({ dir }) => onDirChanged(dir));
  // Safety net for what the watchers cannot catch: network volumes, anything
  // past the 64-watcher cap, FSEvents gaps. Costs one pass at the exact moment
  // you have come back to look at it.
  window.addEventListener('focus', () => {
    if (!S.project || S.treeEdit) return;
    for (const dir of [S.project.path, ...S.expanded]) if (dir in S.tree) onDirChanged(dir);
  });

  // OS file drops: never let Electron navigate away on a stray drop.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  // Dropping on empty canvas opens the file as a viewer/editor tile
  // (tile drops stopPropagation, so this only fires outside tiles).
  // A folder is refused here rather than accepted and ignored: there is no
  // folder viewer tile, so the cursor should never promise one.
  //
  // The refusal has to be said out loud — `dropEffect = 'none'` — and cannot be
  // left to withholding preventDefault. The window listener directly above sits
  // further up the same bubble path and prevents the default on every dragover
  // in the document, so by the time the event is done the drop is allowed no
  // matter what this handler declines to do. Staying silent would leave the
  // browser showing the copy it infers from effectAllowed, over a drop that
  // then does nothing — the exact thing this whole change exists to delete.
  els.grid.addEventListener('dragover', (e) => {
    if (isPathDrag(e)) {
      if (isDirDrag(e)) { e.dataTransfer.dropEffect = 'none'; return; }
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return;
    }
    if (isFileDrag(e)) e.preventDefault();
  });
  els.grid.addEventListener('drop', (e) => {
    if (isPathDrag(e)) {
      if (isDirDrag(e)) return;
      const path = draggedPath(e); if (!path) return;
      S.treeDrag = null; // openFile renders the rail out from under the row — see dropPathOnPanel
      e.preventDefault(); openFile(path, { pin: true }); return;
    }
    const paths = droppedPaths(e); if (!paths.length) return;
    e.preventDefault(); paths.forEach((f) => openFile(f, { pin: true }));
  });
  applyChrome();
}

// ---- glass 3D tilt ----------------------------------------------------------
// In the glass themes, the rail's session cards tilt toward the cursor: pointer
// position feeds the --rx/--ry vars that theme-glass.css puts into their
// transform. One delegated listener, rAF-throttled; other themes pay nothing
// (early return), and stale vars are inert because only [data-glass] transforms
// read them.
//
// Desk tiles are deliberately excluded. They were the loudest thing on screen —
// a document sliding under your hand while you are trying to read it — and a
// terminal could never tilt anyway: a 3D transform makes Chromium rasterize its
// text to a texture, which the hover lift's translateZ then stretches. A card
// 200px wide can carry that movement; a work surface cannot. Tiles keep every
// other hover cue, so they still answer the cursor without moving.
function initGlassTilt() {
  let pane = null, raf = 0, lastEvent = null;
  const reset = (el) => { if (el) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); } };
  document.addEventListener('pointermove', (e) => {
    if (!document.body.hasAttribute('data-glass')) { if (pane) { reset(pane); pane = null; } return; }
    const hit = e.target instanceof Element ? e.target.closest('.nav-card') : null;
    if (hit !== pane) { reset(pane); pane = hit; }
    if (!pane) return;
    lastEvent = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!pane || !lastEvent) return;
      const r = pane.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (lastEvent.clientX - r.left) / r.width;
      const y = (lastEvent.clientY - r.top) / r.height;
      pane.style.setProperty('--rx', ((0.5 - y) * 5).toFixed(2) + 'deg');
      pane.style.setProperty('--ry', ((x - 0.5) * 7).toFixed(2) + 'deg');
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
  // Enter renames the selected row and ⌘⌫ trashes it, the way Finder does —
  // but only when the rail is what you are looking at and nothing else has the
  // keyboard. ⌘⌫ and not a bare ⌫ is the whole point: Delete on its own is one
  // mis-keystroke away from destroying something while you meant to rename it.
  // A peek does not disqualify the rail. Clicking a file both selects the row
  // and opens its preview — that is one gesture here — and the peek never takes
  // focus, so the selection is still what the keyboard is aimed at. Same as
  // Quick Look: space previews, ⌘⌫ still trashes. Any other overlay is a real
  // modal and does own the keyboard. The activeElement test stays either way:
  // click into the peek's editor and ⌘⌫ is a text operation again.
  const peeking = S.overlay && S.overlay.type === 'peek';
  const inTree = S.railTab === 'workspace' && S.treeSel && !S.treeEdit
    && !/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '');
  // Rename needs the rail actually in front of you — starting an edit hidden
  // behind a preview would put your typing somewhere you cannot see it.
  if (e.key === 'Enter' && !meta && inTree && !S.overlay) { e.preventDefault(); beginTreeRename(S.treeSel); return; }
  if (meta && (e.key === 'Backspace' || e.key === 'Delete') && inTree && (!S.overlay || peeking)) {
    e.preventDefault(); trashTreeItem(S.treeSel, dirName(S.treeSel)); return;
  }
  if (meta && e.shiftKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); api.newWindow(); return; }
  if (meta && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); openLauncher(); return; }
  if (meta && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFolderDialog(); return; }
  if (meta && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openAgentPicker(); return; }
  if (meta && e.key === ',') { e.preventDefault(); openSettings(); return; }
  // ⌘W and ⌘S are also menu items now, and a menu accelerator fires instead of
  // this handler rather than as well as it. Both paths call the same function,
  // so which one the keystroke takes cannot change what it does.
  if (meta && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); closeActive(); return; }
  if (meta && (e.key === 's' || e.key === 'S')) { if (saveActive()) e.preventDefault(); return; }
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
  // An errand whose command has landed is not a live session — its shell is
  // still open, but nothing is running in it and counting it makes the badge
  // say two sessions are working when one of them is a finished install.
  const live = S.panels.filter((x) => x.status === 'live' && x.kind !== 'editor'
    && !(x.oneShot && x.commandDone)).length;
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
  // Creating a file has always worked — it was just right-click-only, which for
  // most people means it did not exist. Same menu the header's context menu
  // opens, on something you can see. Both glyphs, because glass and graphite
  // swap every chrome mark for its pixel twin.
  const plus = document.createElement('span');
  plus.className = 'tree-new'; plus.title = 'New file or folder';
  plus.setAttribute('role', 'button'); plus.tabIndex = 0;
  plus.innerHTML = `<span class="uni-i">＋</span><span class="pix-i">${pixIcon('plus')}</span>`;
  const openNewMenu = (x, y) => showMenu(x, y, [
    { label: 'New file…', run: () => openFsName('file', newTargetDir()) },
    { label: 'New folder…', run: () => openFsName('folder', newTargetDir()) },
  ]);
  plus.onclick = (e) => { e.stopPropagation(); const r = plus.getBoundingClientRect(); openNewMenu(r.left, r.bottom + 4); };
  plus.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); const r = plus.getBoundingClientRect(); openNewMenu(r.left, r.bottom + 4);
  };
  head.appendChild(pathSpan); head.appendChild(plus); head.appendChild(toggle); wrap.appendChild(head);
  head.oncontextmenu = (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: 'Reveal in Finder', run: () => api.revealFile(p.path) },
      { label: 'New file…', run: () => openFsName('file', p.path) },
      { label: 'New folder…', run: () => openFsName('folder', p.path) },
    ]);
  };
  // the header stands for the root, so a drag can be dropped on it to move
  // something back up out of a folder
  wireDrop(head, () => p.path);
  // first look at this folder (e.g. right after boot): fetch the root level once
  if (!S.tree[p.path]) api.listDir(p.path, S.treeAll).then((rows) => { S.tree[p.path] = rows; if (S.railTab === 'workspace') refreshRail(); });
  renderTreeLevel(wrap, p.path, 0);
  c.appendChild(wrap);
  syncDirWatch();
}

// Where the ＋ creates: the folder you have selected, the folder of the file you
// have selected, or the root.
function newTargetDir() {
  const root = S.project.path;
  const sel = S.treeSel;
  if (!sel) return root;
  for (const [dir, rows] of Object.entries(S.tree)) {
    for (const n of rows || []) if (n.path === sel) return n.kind === 'dir' ? n.path : dir;
  }
  return root;
}
function renderTreeLevel(container, dir, depth) {
  const children = S.tree[dir];
  if (!children) return;
  for (const n of children) {
    const row = document.createElement('div'); row.className = 'tree-row';
    if (n.path === S.treeSel) row.classList.add('sel');
    if (S.treeFresh.has(n.path)) row.classList.add('landed');
    row.style.paddingLeft = (6 + depth * 13) + 'px';
    row.dataset.path = n.path; row.dataset.kind = n.kind; row.dataset.dir = dir;
    const isOpen = S.expanded.has(n.path);
    const glyph = n.kind === 'dir' ? (isOpen ? '▾' : '▸') : '';
    if (S.treeEdit && S.treeEdit.path === n.path) { renderRenameRow(row, n, dir, glyph, isOpen); container.appendChild(row); continue; }
    row.draggable = true;
    row.innerHTML = `<span class="tw">${glyph}</span><span class="icon">${treeIcon(n.name, n.kind, isOpen)}</span>
      <span class="name" style="font-weight:${n.kind === 'dir' ? 700 : 400}">${esc(n.name)}</span><span class="meta">${esc(n.meta)}</span>`;
    row.onclick = () => { S.treeSel = n.path; if (n.kind === 'dir') toggleDir(n.path); else { openFile(n.path); refreshRail(); } };
    row.oncontextmenu = (e) => { e.preventDefault(); S.treeSel = n.path; showMenu(e.clientX, e.clientY, treeMenu(n, dir)); };
    row.ondragstart = (e) => {
      S.treeDrag = n.path;
      row.classList.add('dragging');
      // copyMove, not move. This is not about the cursor picture: a dropEffect
      // outside effectAllowed is not merely ignored, it cancels the drop
      // outright (Blink drag_controller: operation becomes kNone). With 'move'
      // alone, the tile asking for 'copy' below would have killed its own drop.
      // Folder targets are unaffected — wireDrop names dropEffect = 'move'
      // itself, which is still a member.
      e.dataTransfer.effectAllowed = 'copyMove';
      try {
        e.dataTransfer.setData('text/plain', n.path);
        e.dataTransfer.setData(PATH_TYPE, n.path);
        if (n.kind === 'dir') e.dataTransfer.setData(DIR_TYPE, n.path);
      } catch (_) {}
    };
    row.ondragend = () => { S.treeDrag = null; row.classList.remove('dragging'); clearDropMarks(); };
    // A file row stands for the folder that holds it — the same near-miss
    // forgiveness Finder gives you.
    wireDrop(row, () => (n.kind === 'dir' ? n.path : dir));
    container.appendChild(row);
    if (n.kind === 'dir' && isOpen) renderTreeLevel(container, n.path, depth + 1);
  }
}
async function toggleDir(dir) {
  if (S.expanded.has(dir)) { S.expanded.delete(dir); refreshRail(); return; }
  if (!S.tree[dir]) S.tree[dir] = await api.listDir(dir, S.treeAll);
  S.expanded.add(dir); refreshRail();
}

// ---- rename in place --------------------------------------------------------
function beginTreeRename(path) { S.treeEdit = { path }; refreshRail(); }
function renderRenameRow(row, n, dir, glyph, isOpen) {
  row.classList.add('editing');
  row.innerHTML = `<span class="tw">${glyph}</span><span class="icon">${treeIcon(n.name, n.kind, isOpen)}</span>`;
  const input = document.createElement('input');
  input.className = 'tree-rename'; input.value = n.name; input.spellcheck = false;
  row.appendChild(input);
  let done = false;
  const finish = async () => {
    if (done) return; done = true;
    const name = input.value.trim();
    S.treeEdit = null;
    if (!name || name === n.name) { refreshRail(); return; }
    const res = await api.fsRename({ root: S.project.path, src: n.path, name });
    if (!res.ok) { toast(res.error || 'Could not rename'); refreshRail(); return; }
    // the expanded set is keyed on paths, so a renamed folder has to carry its
    // open state across or it silently collapses under you
    if (S.expanded.has(n.path)) { S.expanded.delete(n.path); S.expanded.add(res.path); }
    delete S.tree[n.path];
    S.treeSel = res.path;
    await refreshTreeDir(dir);
  };
  setTimeout(() => {
    input.focus();
    const dot = n.name.lastIndexOf('.');
    // Finder's rule: select the stem, leave the extension out of it
    if (n.kind === 'file' && dot > 0) input.setSelectionRange(0, dot); else input.select();
  }, 20);
  input.onblur = finish;
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { e.preventDefault(); done = true; S.treeEdit = null; refreshRail(); }
  };
}

// ---- drag: move within the tree, import from outside it ---------------------
function clearDropMarks() { document.querySelectorAll('.tree-row.drop-into, .tree-path.drop-into').forEach((el) => el.classList.remove('drop-into')); }
let dropHoverTimer = null, dropHoverPath = null;
function cancelHoverExpand() { if (dropHoverTimer) clearTimeout(dropHoverTimer); dropHoverTimer = null; dropHoverPath = null; }

function wireDrop(el, destFn) {
  el.ondragover = (e) => {
    const dest = destFn();
    // refuse a folder into itself or below itself before the cursor suggests it
    if (S.treeDrag && isUnder(S.treeDrag, dest)) { clearDropMarks(); cancelHoverExpand(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = S.treeDrag ? 'move' : 'copy';
    clearDropMarks(); el.classList.add('drop-into');
    // hold over a closed folder and it opens, so you can drag somewhere you
    // have not looked yet
    if (el.dataset && el.dataset.kind === 'dir' && !S.expanded.has(dest)) {
      if (dropHoverPath !== dest) {
        cancelHoverExpand(); dropHoverPath = dest;
        dropHoverTimer = setTimeout(() => { toggleDir(dest); }, 600);
      }
    } else cancelHoverExpand();
  };
  el.ondragleave = () => { el.classList.remove('drop-into'); cancelHoverExpand(); };
  el.ondrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    clearDropMarks(); cancelHoverExpand();
    const dest = destFn();
    const root = S.project.path;
    const files = e.dataTransfer.files;
    if (files && files.length) {
      // from Finder. droppedFilePath, never File.path — removed in Electron 32.
      const srcPaths = [...files].map((f) => api.droppedFilePath(f)).filter(Boolean);
      if (!srcPaths.length) { toast('Could not read what was dropped.'); return; }
      const res = await api.fsImport({ root, destDir: dest, srcPaths });
      if (!res.ok) { toast(res.error || 'Could not copy that in'); return; }
      S.expanded.add(dest);
      markFresh(res.paths);
      await refreshTreeDir(dest);
      toast(res.paths.length === 1 ? 'Copied in ' + baseName(res.paths[0]) + '.' : 'Copied in ' + res.paths.length + ' items.');
      return;
    }
    const src = S.treeDrag; S.treeDrag = null;
    if (!src) return;
    const srcDir = dirName(src);
    if (srcDir === dest) return;
    const res = await api.fsMove({ root, src, destDir: dest });
    if (!res.ok) { toast(res.error); return; }
    S.expanded.delete(src); delete S.tree[src];
    S.expanded.add(dest); S.treeSel = res.path;
    markFresh([res.path]);
    await refreshTreeDir(srcDir); await refreshTreeDir(dest);
    toast('Moved ' + baseName(src) + '.');
  };
}
function dirName(p) { const i = String(p).lastIndexOf('/'); return i > 0 ? p.slice(0, i) : p; }
function baseName(p) { return String(p).slice(String(p).lastIndexOf('/') + 1); }
// Same rule as isDescendant in fs-actions.js. Duplicated rather than shared
// because the renderer cannot require a CommonJS main module — and this copy is
// only ever cosmetic, shaping the drop cursor. The guard that counts is in main.
function isUnder(parent, child) {
  return child === parent || String(child).startsWith(parent + '/');
}
// A brief green on rows that just appeared, so a watcher-driven change is
// something you notice rather than something you have to diff by eye.
function markFresh(paths) {
  for (const p of paths || []) S.treeFresh.add(p);
  clearTimeout(markFresh.t);
  markFresh.t = setTimeout(() => { S.treeFresh.clear(); if (S.railTab === 'workspace') refreshRail(); }, 2400);
}

// ---- workspace context menu ------------------------------------------------
function showMenu(x, y, items) {
  hideMenu();
  const m = document.createElement('div'); m.className = 'ctx-menu'; m.id = 'ctx-menu';
  for (const it of items) {
    if (it === '-') { const hr = document.createElement('div'); hr.className = 'ctx-sep'; m.appendChild(hr); continue; }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.off ? ' off' : '');
    row.textContent = it.label;
    // The menu is where people look for a shortcut they don't know yet, so the
    // ones that exist say so here rather than staying folklore.
    if (it.kb) { const k = document.createElement('span'); k.className = 'ctx-kb'; k.textContent = it.kb; row.appendChild(k); }
    // An inert row is there to answer "why can't I open this?" — it says the
    // reason in the shortcut column and does nothing when clicked. Removing it
    // instead would leave the question unanswered.
    if (it.off) row.onclick = (e) => e.stopPropagation();
    else row.onclick = (e) => { e.stopPropagation(); hideMenu(); it.run(e); };
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
// Every listener showMenu armed has to come back off, not just the keydown one.
// `once` only fires-and-removes when the event actually arrives, so dismissing a
// menu with Escape or a click left the *contextmenu* listener armed — and it
// then bubbled into the next right-click and tore that menu down as it opened.
// The menu opened once per session and Duplicate, Copy path and Move to Trash
// were unreachable after it. Present since 0.1.2.
function hideMenu() {
  const m = document.getElementById('ctx-menu'); if (m) m.remove();
  window.removeEventListener('keydown', escHideMenu);
  window.removeEventListener('click', hideMenu);
  window.removeEventListener('contextmenu', hideMenu);
}
async function refreshTreeDir(dir) {
  S.tree[dir] = await api.listDir(dir, S.treeAll);
  if (S.railTab === 'workspace') refreshRail();
}

// ---- keeping the tree honest ------------------------------------------------
// The renderer declares the whole visible set — root plus every expanded folder
// — and main diffs it. Full set, not deltas: see src/main/dir-watch.js.
function syncDirWatch() {
  if (!api.dirWatch) return;
  const p = S.project;
  if (!p) { api.dirWatch([]); return; }
  const paths = [p.path, ...[...S.expanded].filter((d) => S.tree[d])];
  api.dirWatch(paths).catch(() => {});
}

// One directory changed on disk. Re-list just that one; if it has gone, forget
// it and re-list its parent instead.
async function onDirChanged(dir) {
  if (!S.project) return;
  if (!(dir in S.tree)) return;          // not visible — nothing to correct
  if (S.treeEdit && dirName(S.treeEdit.path) === dir) return;  // mid-rename; the commit re-lists
  const before = new Set((S.tree[dir] || []).map((n) => n.path));
  const rows = await api.listDir(dir, S.treeAll);
  if (rows == null) {
    delete S.tree[dir]; S.expanded.delete(dir);
    if (dir !== S.project.path) await refreshTreeDir(dirName(dir));
    return;
  }
  S.tree[dir] = rows;
  const fresh = rows.map((n) => n.path).filter((p) => !before.has(p));
  if (fresh.length) markFresh(fresh);
  if (S.railTab === 'workspace') refreshRail();
}
function treeMenu(n, parentDir) {
  const root = S.project.path;
  const items = [{ label: 'Reveal in Finder', run: () => api.revealFile(n.path) }];
  if (n.kind === 'dir') {
    items.push({ label: 'New file…', run: () => openFsName('file', n.path) });
    items.push({ label: 'New folder…', run: () => openFsName('folder', n.path) });
  }
  // "Move to…" is gone: it opened a native picker that would happily let you
  // choose a folder outside the root, and then movePath refused it — offering a
  // destination you are not allowed to use. Dragging the row does this now.
  items.push({ label: 'Rename…', kb: '⏎', run: () => beginTreeRename(n.path) });
  items.push({ label: 'Duplicate', run: async () => {
    const res = await api.fsDuplicate({ root, src: n.path });
    if (!res.ok) { toast(res.error || 'Could not duplicate'); return; }
    markFresh([res.path]);
    await refreshTreeDir(parentDir);
    toast('Duplicated to ' + baseName(res.path) + '.');
  } });
  items.push({ label: 'Copy path', run: async () => {
    try { await navigator.clipboard.writeText(n.path); toast('Path copied.'); }
    catch (_) { toast('Could not copy that.'); }
  } });
  items.push('-');
  // Direct to Trash: right-click plus a click below a separator is deliberate,
  // and the Trash is recoverable. The library card's Delete keeps its armed
  // second click because it sits next to Save.
  items.push({ label: 'Move to Trash', danger: true, kb: '⌘⌫', run: () => trashTreeItem(n.path, parentDir) });
  return items;
}

// Shared by the menu row and ⌘⌫, so the keyboard route cannot drift from the
// one the menu advertises.
async function trashTreeItem(path, parentDir) {
  const res = await api.fsTrash({ root: S.project.path, path });
  if (!res.ok) { toast(res.error); return; }
  S.expanded.delete(path); delete S.tree[path];
  if (S.treeSel === path) S.treeSel = null;
  // Previewing the thing you just trashed is a window onto a file that is no
  // longer there — close it rather than leave a stale page up.
  if (S.overlay && S.overlay.type === 'peek' && S.overlay.panel && S.overlay.panel.filePath === path) closeOverlay();
  await refreshTreeDir(parentDir);
  toast('Moved ' + baseName(path) + ' to Trash.');
}
function openFsName(mode, dir) { S.overlay = { type: 'fs-name', mode, dir, name: '' }; renderOverlay(); }
function renderFsName() {
  const o = S.overlay;
  // Its own header, not .picker-input: that row belongs to the launcher and the
  // agent picker too, and it has no nowrap on the label and no truncation on the
  // trailing span — so a deep path wrapped the title onto two lines and then ran
  // to three of its own, leaving the destination as the biggest thing in a box
  // whose actual job is a name and a button.
  const full = shortHome(o.dir);
  const modal = overlay('picker-box', `
    <div class="fs-head"><span class="prompt-mark">＋</span>
      <span class="fs-title">New ${o.mode === 'file' ? 'file' : 'folder'}</span>
      <span class="fs-where" title="${esc(full)}">${esc(tailPath(full))}</span></div>
    <div class="fs-row"><input id="fs-name" placeholder="${o.mode === 'file' ? 'notes.md' : 'a name'}" spellcheck="false" />
      <button class="btn btn--go" id="fs-go">Create</button></div>
    <div class="fs-hint">${o.mode === 'file'
      ? 'Any extension. It lands empty and opens in the editor.'
      : 'The folder is created and opened in the tree.'}</div>`, { top: true });
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
  refreshPointer(true);   // read-only; it never writes a file on its own
}
async function refreshServices() {
  if (S.services.loading) return;
  S.services.loading = true;
  // Coverage is computed against installed agents, so the detect pass has to
  // land first — refreshAgents dedupes in-flight calls, this never re-scans.
  if (!S.agents) { try { await refreshAgents(); } catch (_) {} }
  try {
    const res = await api.listServices({ projectPath: S.project && S.project.path, agentIds: installedAgentIds() });
    S.services.catalog = res.catalog || []; S.services.connected = res.connected || [];
    S.services.coverage = res.coverage || null;
  } catch (_) {}
  S.services.loading = false;
  if (S.railTab === 'library') refreshRail();
  if (S.overlay && S.overlay.type === 'connect') renderOverlay();
}
// The library reads like an inventory: what you have, grouped by what it is —
// and for skills, by where they live, because that is what you scan for. Whether
// a session started here can actually run one is a different question, answered
// per row by the availability tag.
const LIB_TYPE_GROUPS = [
  { key: 'agents', label: 'Agents' },
  { key: 'skills', label: 'Skills · this project' },
  { key: 'skills-mac', label: 'Skills · elsewhere on your Mac' },
  { key: 'skills-broken', label: 'Skills · broken links', shy: true },
  { key: 'commands', label: 'Commands' },
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
// A command is not a skill. Filing everything that wasn't an agent under Skills
// is why that count was never trustworthy — and a pointer status hangs off it now.
function libGroupOf(i) {
  if (i.scope === 'plugin') return 'plugins';
  if (i.type !== 'skill') return i.type + 's';
  if (i.broken) return 'skills-broken';
  return i.scope === 'project' ? 'skills' : 'skills-mac';
}

// What a row is allowed to claim. Only two things make a skill runnable from
// here: this project's pointer names it, or the agent that owns the folder reads
// it natively. Everything else is a file on disk that happens to be a skill, and
// saying so is what stops "Use here" from looking pointless.
function availabilityTag(i) {
  if (i.broken) return { text: 'broken', tone: 'bad', title: 'Its files are gone — this is a link to nothing. ' + (i.linkTarget || '') };
  if (i.availability === 'project') {
    // "runs here" would be a lie while no agent has been told it exists, so the
    // tag carries that rather than a second warning line under the description.
    const st = S.pointer;
    if (st && (st.unlisted || []).includes(i.slug)) {
      // short on purpose: the tag sits beside the name in a 282px rail, and a
      // long one pushes the name into an ellipsis, which is the thing you scan for
      return { text: 'unlisted', tone: 'warn', title: 'It is in this project, but no agent has been told about it yet. Tell them, below.' };
    }
    return { text: 'runs here', tone: 'ok', title: 'Announced in AGENTS.md — a session started in this project can use it.' };
  }
  if (i.availability === 'agent') {
    const a = (S.agents || []).find((x) => x.id === i.ownerAgent);
    const who = (a && a.name) || i.ownerAgent;
    return { text: who + ' only', tone: 'mute', title: `${who} reads this folder itself. Nami's sessions here won't see it unless you copy it in.` };
  }
  return { text: 'not wired', tone: 'mute', title: 'It sits in a shared folder that no agent reads. Copy it here to use it.' };
}
// Short on purpose: the tag sits beside the item's name in a 282px rail, and
// the name is what you are actually scanning for. Longer wording lives on the
// detail sheets, where there is room for it.
function scopeTagText(scope) { return scope === 'project' ? 'project' : 'your Mac'; }

// ---- pointer status: silent when healthy -----------------------------------
// If every skill is announced there is nothing to say, and a line that always
// says the same thing is noise. So this surfaces only the exception: a skill no
// agent has been told about, usually one that arrived with a git pull.
async function refreshPointer(force) {
  const dir = S.project && S.project.path;
  if (!dir) { S.pointer = null; return; }
  if (S.pointerLoading && !force) return;
  S.pointerLoading = true;
  try { S.pointer = await api.pointerStatus({ dir, agentIds: installedAgentIds() }); }
  catch (_) { S.pointer = null; }
  S.pointerLoading = false;
  if (S.railTab === 'library') refreshRail();
}
function installedAgentIds() { return (S.agents || []).filter((a) => a.found).map((a) => a.id); }
function agentNameOf(id) { const a = (S.agents || []).find((x) => x.id === id); return a ? a.name : id; }
// A `## Skills` heading the user wrote themselves. Nami appends below it rather
// than taking it over — their wording is usually better than anything generated
// from frontmatter, and rewriting prose we didn't author is not a trade worth
// making. But two Skills sections in one file is worth mentioning once.
const FOREIGN_DISMISSED = 'nami-foreign-skills-dismissed';
function appendForeignNote(list) {
  const st = S.pointer;
  const dir = S.project && S.project.path;
  if (!st || !st.foreignSection || !dir) return;
  let done = [];
  try { done = JSON.parse(localStorage.getItem(FOREIGN_DISMISSED) || '[]'); } catch (_) { done = []; }
  if (done.includes(dir)) return;
  const note = document.createElement('div');
  note.className = 'ptr-note';
  note.innerHTML = `<span class="pn-msg">AGENTS.md also has a Skills section you wrote. Nami left it alone and put its own list below — tidy up whenever you like.</span>
    <button class="pn-x" title="Got it">✕</button>`;
  list.appendChild(note);
  q('.pn-x', note).onclick = (e) => {
    e.stopPropagation();
    try { localStorage.setItem(FOREIGN_DISMISSED, JSON.stringify(done.concat([dir]))); } catch (_) {}
    refreshRail();
  };
}
function appendPointerBar(list) {
  appendForeignNote(list);
  const st = S.pointer;
  if (!st || st.inSync) return;
  const bits = [];
  if ((st.unlisted || []).length) bits.push(`${st.unlisted.length} not announced to any agent`);
  if ((st.stale || []).length) bits.push(`${st.stale.length} still listed after being deleted`);
  if ((st.missingFiles || []).length) bits.push(`${st.missingFiles.join(' + ')} missing`);
  const bar = document.createElement('div');
  bar.className = 'ptr-bar';
  bar.innerHTML = `<span class="pb-msg">⚠ ${esc(st.error ? st.error : bits.join(' · '))}</span>
    ${st.error ? '' : '<button class="btn pb-go">Tell them</button>'}`;
  list.appendChild(bar);
  const go = q('.pb-go', bar);
  if (go) go.onclick = async (e) => { e.stopPropagation(); await writePointers(go); };
}
// The one write the Library can make, and it names its files first.
async function writePointers(btn) {
  const dir = S.project && S.project.path;
  if (!dir) { toast('Open a folder first.'); return; }
  const agentIds = installedAgentIds();
  if (btn) { btn.disabled = true; btn.textContent = 'Telling…'; }
  const res = await api.pointerWrite({ dir, agentIds });
  if (!res || !res.ok) { toast((res && res.error) || 'Could not write the pointer files'); if (btn) { btn.disabled = false; btn.textContent = 'Tell them'; } return; }
  const n = (res.written || []).length;
  toast(n ? `Updated ${res.written.join(', ')} — every installed agent knows now.` : 'Already up to date.');
  await refreshPointer(true);
  loadLibrary(true);
}
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
    // Each group owns a section so its sticky header can only travel inside its
    // own rows — siblings sharing one scroller all pin at top:0 and pile up.
    const sect = document.createElement('div'); sect.className = 'lib-sect'; list.appendChild(sect);
    const lab = document.createElement('div'); lab.className = 'lib-group';
    lab.innerHTML = `<span class="lg-caret">${open ? '▾' : '▸'}</span><span>${esc(g.label)}</span><span class="lg-count">${items.length}</span>`;
    lab.onclick = () => {
      if (S.library.collapsed.has(g.key)) S.library.collapsed.delete(g.key); else S.library.collapsed.add(g.key);
      refreshRail();
    };
    sect.appendChild(lab);
    if (!open) continue;
    if (isSvc) {
      for (const sv of items) {
        const cat = S.services.catalog.find((s) => s.id === sv.id);
        const row = document.createElement('div'); row.className = 'agent-row';
        // Coverage answers the only question that matters: who can use this?
        // Healthy says "everywhere" and shuts up; drift names who is missing.
        const cov = S.services.coverage && S.services.coverage[sv.id];
        // Hermes is excluded from the amber: Nami can't deliver to it (its
        // config is hand-owned), so a button promising to fix it would lie.
        const missing = cov ? cov.missing.filter((id) => id !== 'hermes') : [];
        const covLine = !cov
          ? `<span class="ok">●</span> connected · ${esc(sv.platforms.join(' + '))}`
          : missing.length
            ? `<span class="ok" style="color:var(--amber-ink)">●</span> ${esc(missing.map(agentNameOf).join(', '))} can’t see it`
            : '<span class="ok">●</span> connected · everywhere';
        row.innerHTML = `${chipHtml({ key: iconKeyFor(sv.id) || 'mcp', code: (cat && cat.code) || 'SV', kind: 'service' })}
          <span class="col"><span class="name">${esc(sv.name)}</span>
          <span class="tools">${covLine}</span></span>
          ${cov && missing.length ? '<button class="btn sv-tell">tell them</button>' : `<span class="scope-tag">${scopeTagText(sv.scopes.includes('project') ? 'project' : 'user')}</span>`}`;
        row.onclick = () => openServiceDetails(sv);
        const tell = row.querySelector('.sv-tell');
        if (tell) tell.onclick = async (e) => {
          e.stopPropagation();
          tell.disabled = true; tell.textContent = 'telling…';
          await api.deliverServices({ projectPath: S.project && S.project.path, agentIds: installedAgentIds() });
          refreshServices();
        };
        sect.appendChild(row);
      }
      const add = document.createElement('div'); add.className = 'agent-row';
      add.innerHTML = `<span class="code" data-kind="service">⚡</span>
        <span class="col"><span class="name">connect a service</span><span class="tools">Notion, Slack, a folder…</span></span><span class="chev">›</span>`;
      add.onclick = () => openConnect();
      sect.appendChild(add);
      continue;
    }
    for (const i of items) {
      const chip = TYPE_CHIP[i.type] || TYPE_CHIP.agent;
      const row = document.createElement('div'); row.className = 'agent-row';
      // One vocabulary: skills say what they can do, masters say "everywhere",
      // and a hand-made platform agent says honestly whose it is.
      const tag = i.type === 'skill' && i.scope !== 'plugin'
        ? (() => { const a = availabilityTag(i); return `<span class="scope-tag" data-tone="${a.tone}" title="${esc(a.title)}">${esc(a.text)}</span>`; })()
        : i.type === 'agent' && i.platform === 'project'
          ? '<span class="scope-tag" data-tone="ok" title="The master in agents/ — Nami keeps a copy fresh for every installed tool.">everywhere</span>'
        : i.type === 'agent' && i.scope !== 'plugin' && ['claude', 'opencode', 'gemini', 'kimi'].includes(i.platform)
          ? `<span class="scope-tag" title="Lives in this tool's own folder — open the card to make it everyone's.">only ${esc(agentNameOf(i.platform))}</span>`
        : (i.scope === 'plugin' ? '' : `<span class="scope-tag">${scopeTagText(i.scope)}</span>`);
      row.innerHTML = `${chipHtml({ key: i.type, code: chip.code, kind: chip.kind })}
        <span class="col"><span class="name">${esc(i.name)}</span><span class="tools">${esc(i.description || i.meta.tools || i.filePath)}</span></span>
        ${tag}<span class="chev">›</span>`;
      row.onclick = () => openCard(i);
      sect.appendChild(row);
    }
    if (g.key === 'skills') appendPointerBar(sect);
  }
  if (!shown) { const e = document.createElement('div'); e.className = 'rail-empty'; e.textContent = ql ? 'No match.' : 'Nothing here yet — the buttons above make your first.'; list.appendChild(e); }
}
// With no folder there is exactly one thing worth saying, and it is the thing
// the screen is asking you to fix. This used to announce "claude ready" when the
// Claude CLI happened to be installed — from when the app only ran that one
// agent. It named a single agent on the first screen a new user sees, and said
// it on a screen where no agent can start: every action here needs a folder.
function renderFooter() { els.footerPath.textContent = S.project ? S.project.pathShort : 'no folder open'; }

// ===========================================================================
//  Grid of tiles
// ===========================================================================
function statusMeta(p) {
  const c = statusColors();
  if (p.kind === 'card') return { label: p.dirty ? 'unsaved' : (p.item.readOnly ? 'read-only' : p.item.type), color: p.dirty ? c.warn : c.mut };
  if (p.kind === 'viewer') return { label: p.sub, color: c.mut };
  if (p.kind === 'editor') return { label: p.dirty ? 'unsaved' : 'file', color: p.dirty ? c.warn : c.mut };
  if (p.exited) return { label: 'closed', color: c.mut };
  // A one-shot says how its command went, not just that a shell is alive: the
  // whole reason the tile exists is the command, and "live" while sitting at a
  // finished prompt is the thing that read as a dead end.
  // installOk is set once the scan has confirmed it, because the exit code of
  // an install cannot (see finishAgentInstall). A tile still waiting on that
  // answer says 'finished', which is the only thing known for certain.
  if (p.oneShot && p.commandDone) {
    if (p.installOk === true) return { label: 'installed', color: c.ok };
    if (p.installOk === false) return { label: 'did not install', color: c.warn };
    return { label: 'finished', color: c.mut };
  }
  if (p.oneShot) return { label: 'running', color: c.warn };
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

// The no-folder desk: the first screen anyone ever sees, and until now a wall
// for the exact person the app is for. It asked for a folder and offered one
// button to go and find one — fine if you already work in projects, useless if
// you have never made a folder for a piece of work in your life. So it offers
// to make one.
//
// Which button is green depends on whether this is a first run. With Recents
// empty there is nothing to open, so making one is the only sensible next move
// and it takes the emphasis. Once anything is in Recents they swap: from then
// on, opening something that already exists is the common case, and a person
// with folders does not want to be nudged into making another.
function emptyDeskHtml() {
  const first = !S.recents.length;
  const make = `<button class="btn ${first ? 'btn--go ' : ''}lane-cta" id="lane-make">＋ Make me a folder</button>`;
  const open = first
    ? `<button class="btn lane-cta" id="lane-open">Choose an existing one<span class="kb"> ⌘O</span></button>`
    : `<button class="btn btn--go lane-cta" id="lane-open">＋ Open a folder<span class="kb"> ⌘O</span></button>`;
  return `<div class="lane-empty"><div class="polaroid">no folder</div>
      <div><div class="big">Open a folder to start working</div>
      <div class="hint">Every session runs inside a folder. That is what keeps it resumable.</div>
      <div class="lane-ctas">${first ? make + open : open + make}</div>
      <button class="lane-tour" id="lane-tour">New to Nami? Start here</button></div></div>`;
}

// Hands off to the save panel in main, then through the ordinary switch path —
// a folder Nami made is not a special kind of folder once it exists.
async function makeFolderDialog() {
  const info = await api.makeFolder();
  if (!info) return;
  if (info.error) { toast('Could not make that folder — ' + info.error); return; }
  await switchToFolder(info);
  toast(`Made ${info.name}. Open “Start here” for what to do next.`);
}

function renderGrid() {
  if (!S.panels.length) {
    tileEls.forEach((t) => t.root.remove()); tileEls.clear();
    els.grid.classList.remove('has-focus');
    // Two empty desks, one shape: a heading, a line of why, and the button that
    // does the thing. The folder-open one used to be the exception — it told you
    // to press a key and offered nothing to click, which is the one state in the
    // app where the next step was homework. Its hint also still named Claude Code
    // alone, from when that was the only session Nami could start.
    els.grid.innerHTML = S.project
      ? `<div class="lane-empty"><div class="polaroid">nothing open</div>
      <div><div class="big">Start a session</div>
      <div class="hint">Agents, terminals and harnesses. They all run in this folder.</div>
      <button class="btn btn--go lane-cta" id="lane-new">＋ New session<span class="kb"> ⌘N</span></button></div></div>`
      : emptyDeskHtml();
    const make = q('#lane-make', els.grid); if (make) make.onclick = makeFolderDialog;
    const tour = q('#lane-tour', els.grid); if (tour) tour.onclick = openQuickStart;
    const cta = q('#lane-open', els.grid); if (cta) cta.onclick = openFolderDialog;
    const start = q('#lane-new', els.grid); if (start) start.onclick = () => openLauncher();
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

// The terminal draws with the DOM renderer, not the GPU one. The WebGL addon
// is sharper and much faster on a wall of output, but it repaints by damage and
// leaves the undamaged canvas alone — so anything it fails to mark dirty stays
// on screen. In practice that was a block of stale pixels lying across live
// text, and Claude's welcome banner surviving five redraws stacked on itself.
// Same command, same build, the addon the only difference.
//
// It is a real gain when it works, and worth trying again: what made it fire so
// often was the column count being wrong, which resized the terminal ten times
// in the first tenth of a second. That is fixed now (see .term-body in
// paper.css). The vendored addon stays in ./vendor for that attempt.
function bumpTermFont(dir) {
  const next = Math.min(18, Math.max(10, termFontSize() + dir));
  try { localStorage.setItem(TERM_FONT_KEY, String(next)); } catch (_) {}
  tileEls.forEach((r) => {
    if (r.term) { r.term.options.fontSize = next; safeFit(r); }
    if (r.cardsUi) r.cardsUi.setFontSize(next); // cards read at the same size the terminal does
  });
  toast('Text size · ' + next + 'px'); // one dial for both surfaces — cards scale with it too
}
function mountTile(p) {
  const root = document.createElement('div'); root.className = 'tile enter'; root.dataset.id = p.id;
  root.addEventListener('animationend', (e) => { if (e.target === root) root.classList.remove('enter'); });
  setTimeout(() => root.classList.remove('enter'), 600); // occluded windows throttle animations — drop it regardless
  root.innerHTML = `<div class="tile-head" draggable="true">
      ${panelChip(p)}
      <span class="col"><span class="t-title">${esc(p.title)}</span><span class="t-sub"></span></span>
      <span class="t-status"><span class="dot"></span><span class="lbl"></span></span>
      ${canShowCards(p) ? `<span class="t-channel" hidden></span>
      <span class="t-surface" aria-label="Surface"></span>
      <button class="t-btn t-bridge" title="Open in the other surface / settings"><span class="uni-i">⌄</span><span class="pix-i">${pixIcon('chevron')}</span></button>` : ''}
      <button class="t-btn t-mic" title="Dictate into this session">${MIC_SVG}</button>
      ${['card', 'viewer', 'editor'].includes(p.kind) ? '' : `
      <button class="t-btn t-zoom-out" title="Smaller terminal text"><span class="uni-i">−</span><span class="pix-i">${pixIcon('minus')}</span></button>
      <button class="t-btn t-zoom-in" title="Bigger terminal text"><span class="uni-i">＋</span><span class="pix-i">${pixIcon('plus')}</span></button>`}
      <button class="t-btn t-expand" title="Expand"><span class="uni-i">⤢</span><span class="pix-i">${pixIcon('expand')}</span></button>
      <button class="t-btn t-close" title="Close"><span class="uni-i">✕</span><span class="pix-i">${pixIcon('close')}</span></button>
    </div><div class="tile-body"></div>`;
  const head = q('.tile-head', root), body = q('.tile-body', root);
  const rec = { root, head, body, term: null, fit: null, statusDot: q('.t-status .dot', head), ta: null, gutter: null, cardsUi: null };
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
  root.addEventListener('dragover', (e) => {
    e.preventDefault(); e.stopPropagation();
    // Stopped for the same reason the drop below is: every tile is a direct
    // child of els.grid, whose own dragover refuses a folder. Without this the
    // tile names its effect and the grid immediately overwrites it — a folder
    // dropped on a session would light up copy, turn no-drop, and never arrive.
    //
    // A workspace path reads as a file arriving, not as a tile being reordered,
    // and it says copy: the row you are holding stays exactly where it lives.
    // Except on an editor or a viewer, which take a file to open and have
    // nothing to do with a folder — refused in the cursor, not silently on drop.
    if (isPathDrag(e)) {
      if (isDirDrag(e) && (p.kind === 'editor' || p.kind === 'viewer')) { e.dataTransfer.dropEffect = 'none'; return; }
      e.dataTransfer.dropEffect = 'copy'; root.classList.add('file-hint'); return;
    }
    root.classList.add(isFileDrag(e) ? 'file-hint' : 'drop-hint');
  });
  root.addEventListener('dragleave', () => root.classList.remove('drop-hint', 'file-hint'));
  root.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    root.classList.remove('drop-hint', 'file-hint');
    const paths = droppedPaths(e);
    if (paths.length) return dropFilesOnPanel(p, paths);
    // Before the reorder fallback: text/plain holds a path here, not a panel id,
    // and reorderPanels would look for a panel called /Users/... and find none.
    if (isPathDrag(e)) {
      const path = draggedPath(e);
      if (path) return dropPathOnPanel(p, path, isDirDrag(e));
    }
    reorderPanels(e.dataTransfer.getData('text/plain'), p.id);
  });

  const bridge = q('.t-bridge', head);
  if (bridge) bridge.onclick = (e) => { e.stopPropagation(); openBridgeMenu(p, bridge); };

  if (p.kind === 'editor') mountEditor(p, rec); else if (p.kind === 'viewer') mountViewer(p, rec); else if (p.kind === 'card') mountCard(p, rec); else mountTerminal(p, rec);
  if (canShowCards(p)) { mountCards(p, rec); applyView(p, rec); }
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
  if (t.cardsUi) refreshCardNote(p, t);
}

// ---- terminal tiles --------------------------------------------------------

function safeFit(rec) {
  if (!rec || !rec.term || !rec.fit) return;
  // A hidden terminal measures zero. addon-fit would round that up to its
  // minimum and resize the pty to a couple of columns — and claude reflows to
  // whatever it is told, so the session would come back from the card view
  // wrapped one word per line.
  if (!rec.body.clientWidth || !rec.body.clientHeight) return;
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
  if (S.demo) (window.__terms = window.__terms || []).push(term);
  requestAnimationFrame(() => {
    safeFit(rec);
    if (p.sceneStatic) return; // a fixture tile draws, it never runs
    // A tile restored in Cards goes straight to the drive channel — spawning
    // the pty first would put two runtimes on one conversation.
    if (canShowCards(p) && cardView(p) === 'cards') enterCards(p);
    else startProcess(p, term.cols, term.rows);
  });
  term.onData((d) => { clearAttention(p); if (p.autoName) feedSessionName(p, d); api.termWrite({ id: p.id, data: d }); });
  term.onResize(({ cols, rows }) => api.termResize({ id: p.id, cols, rows }));
  term.onBell(() => setAttention(p));
  registerTerminalLinks(term, p);
  wireTerminalMenu(p, rec);
  // Debounced: a resize drag would otherwise fire a pty resize per frame, and
  // every one of those reflows the scrollback (mid-word wraps, sliced borders).
  let refitTimer = null;
  const ro = new ResizeObserver(() => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => safeFit(rec), 90);
  });
  ro.observe(rec.body);
  // a closed tile must not leave the link it was hovering behind in the map
  rec.disposeRo = () => { clearTimeout(refitTimer); ro.disconnect(); hoveredLink.delete(p.id); };
}

// ---- terminal links --------------------------------------------------------
// Cmd/Ctrl-click anything an agent prints: a URL opens in your browser, a file
// opens as an editor tile right here, a folder reveals in Finder. Hold Alt and
// a file reveals in Finder instead of opening.
//
// Nothing dead is ever offered: a path is stat'd before it underlines, so the
// only things that light up are things that actually open.
const LINK_STAT_TTL = 10000;
const linkStats = new Map(); // `${id}\0${cwd}\0${token}` -> { at, st }
// The session id is part of the key, not decoration: two tiles opened on the
// same folder can be sitting in different directories, and a cache keyed on
// the frozen cwd alone would hand one tile's answer to the other.
async function statLink(token, cwd, id) {
  const key = `${id || ''}\u0000${cwd || ''}\u0000${token}`;
  const hit = linkStats.get(key);
  if (hit && Date.now() - hit.at < LINK_STAT_TTL) return hit.st;
  const st = await api.statPath({ token, cwd, id });
  if (linkStats.size > 400) linkStats.clear();
  linkStats.set(key, { at: Date.now(), st });
  return st;
}

// A path long enough to wrap is still one path. Walk the whole wrapped run and
// keep a cell address per character, so the underline lands on the right cells
// even when the line holds wide glyphs (a wide char is one string char but two
// columns, and its second cell reports width 0).
// A hard wrap is not a wrap: a program that measured the width itself and
// printed its own newline leaves isWrapped false on both rows, nothing joins
// them, and scanLinks matches the head of a severed URL as a whole one. The
// walk goes both ways so hovering either fragment finds the other; see
// term-wrap.mjs for why the guards are as narrow as they are.
function wrappedRow(term, y) {
  const buf = term.buffer.active;
  const cols = term.cols;
  const { top, bottom, hard } = runBounds(buf, y, cols);
  let text = ''; const at = [];
  for (let row = top; row <= bottom; row++) {
    const line = buf.getLine(row); if (!line) continue;
    // A joined row's hanging indent is not part of the token, and emitting it
    // would put a space in the middle of the URL the scanner is about to read.
    const from = hard.has(row) ? leadingIndent(line, cols) : 0;
    for (let x = from; x < term.cols; x++) {
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

// What the pointer is over, per tile, so the right-click menu knows what was
// right-clicked. xterm already does the hit-testing to fire hover/leave;
// recomputing a cell from mouse coordinates would be a second implementation of
// it, free to disagree with the one drawing the underline.
const hoveredLink = new Map();   // panel id -> { link, st }

function registerTerminalLinks(term, p) {
  if (!term.registerLinkProvider) return;
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const { text, at } = wrappedRow(term, y);
      const found = text ? scanLinks(text) : [];
      if (!found.length) { callback(undefined); return; }
      Promise.all(found.map(async (link) => {
        if (link.kind === 'url') return { link, st: null };
        const st = await statLink(link.text, p.cwd, p.id);
        // A missed stat is handed over rather than dropped. Undecorated and
        // inert, it looks and behaves exactly as it does now — but xterm knows
        // it is there, which is what gives it a right-click. Copying does not
        // need the file to exist, and gating the menu on the stat would hide it
        // in the one case it exists for.
        return { link, st: st && st.exists ? st : null };
      })).then((rows) => {
        const links = [];
        for (const row of rows) {
          if (!row) continue;
          const start = at[row.link.start], end = at[row.link.end - 1];
          if (!start || !end) continue;
          const live = row.link.kind === 'url' || !!row.st;
          links.push({
            text: row.link.text,
            range: { start, end },
            // Without this xterm decorates nothing: a path that opens on
            // ⌘-click looked exactly like a path that does not, and the only
            // way to find out was to try. Now the cursor and the underline say
            // so before you commit to the click. Dead paths stay bare — the
            // underline has to keep meaning "this opens".
            decorations: live ? { pointerCursor: true, underline: true } : { pointerCursor: false, underline: false },
            activate: (ev) => { if (live && (ev.metaKey || ev.ctrlKey)) openTermLink(row.link, row.st, ev); },
            hover: () => hoveredLink.set(p.id, { link: row.link, st: row.st, live }),
            // Only clear if this link is still the one recorded. Moving from
            // one link straight onto the next fires the new hover before the
            // old leave, and an unconditional delete would throw away the link
            // the pointer is actually on.
            leave: () => {
              const cur = hoveredLink.get(p.id);
              if (cur && cur.link === row.link) hoveredLink.delete(p.id);
            },
          });
        }
        callback(links.length ? links : undefined);
      }).catch(() => callback(undefined));
    },
  });
}

// Right-click a link in a session. Away from one this does nothing and the
// terminal keeps whatever behaviour it had — this is a link menu, not a
// terminal menu, and copying arbitrary text is what selection is for.
function wireTerminalMenu(p, rec) {
  rec.body.addEventListener('contextmenu', (e) => {
    const hit = hoveredLink.get(p.id);
    if (!hit) return;
    e.preventDefault();
    const items = termMenuItems({ kind: hit.link.kind, text: hit.link.text, st: hit.st }).map((it) => {
      if (it === '-' || it.off) return it;
      if (it.copy != null) return { ...it, run: () => copyLinkText(it.copy) };
      // Reveal is the alt route openTermLink already understands; naming it
      // here keeps the menu and the modifier on one implementation.
      return { ...it, run: () => openTermLink(hit.link, hit.st, { altKey: it.label === 'Reveal in Finder' }) };
    });
    showMenu(e.clientX, e.clientY, items);
  });
}

async function copyLinkText(text) {
  try { await api.copyText(text); toast('Copied ' + shorten(text, 44) + '.'); }
  catch (_) { toast('Could not copy that.'); }
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
      const st = await api.statPath({ token: abs, cwd: p.cwd, id: p.id });
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
  await api.termCreate({ id: p.id, cwd: p.cwd, cols, rows, kind: p.kind, command: p.command, program: p.program, args: p.args, seed: p.seed, cont: p.cont, sid: p.sid, name, watchDone: !!p.watchDone });
}
function setAttention(p) { if (p.id === S.activeId) return; p.attention = true; refreshTileHead(p); refreshRail(); renderHeader(); }
function clearAttention(p) { if (!p.attention) return; p.attention = false; refreshTileHead(p); refreshRail(); renderHeader(); }

// ---- the card view ---------------------------------------------------------
// A second view on the very same conversation — but a different runtime. Term
// runs the agent's own TUI in a pty; Cards drives the same conversation over
// the agent's structured channel (the Agent SDK, for claude), so approvals can
// be answered in place and the composer sends real turns. Switching stops one
// runtime and resumes the same conversation in the other by its session id.
// Two runtimes never overlap on one tile.
//
// When the drive channel is missing (no claude binary), Cards falls back to
// watching the transcript the pty writes — read-only, and the note says so.
//
// Only claude sessions, and only ones with a conversation id: that id is what
// both runtimes resume. A legacy --continue tile has none and stays Term-only.
const CARD_EVENT_CAP = 900;

// Which adapter can drive this tile's agent, or null. A claude tile needs its
// conversation id; an ACP agent tile is one whose command is exactly the bin.
function cardAgentFor(p) {
  // an errand tile is never a conversation, fixture or not
  if (p && p.sceneStatic) return p.oneShot ? null : 'claude'; // the fixture tile draws as claude
  if (!p || S.demo) return null;
  if (p.kind === 'claude') return p.sid ? 'claude' : null;
  if (p.kind === 'run') {
    const c = String(p.command || '').trim();
    if (['opencode', 'hermes', 'codex', 'kimi', 'agy'].includes(c)) return c;
    // A bare agent-looking binary we have no adapter for still gets the
    // switch — its card explains, honestly, why it stays a terminal.
    if (/^[a-z][\w.-]*$/i.test(c)) return 'unknown:' + c;
  }
  return null;
}
function canShowCards(p) { return !!cardAgentFor(p); }

const KNOWN_AGENT_NAMES = { claude: 'Claude Code', opencode: 'OpenCode', hermes: 'Hermes', codex: 'Codex', kimi: 'Kimi Code', agy: 'Antigravity' };

// The welcome a card can synthesize before (or without) a channel: the
// registry already knows who this is and where. Watch mode gets this too —
// a watched card used to open onto nothing at all.
function cardIntro(p, agent, extra) {
  const reg = (S.agents || []).find((a) => (agent === 'claude' ? a.id === 'claude' : a.bin === agent));
  return Object.assign({
    kind: 'intro', id: 'intro:' + p.id,
    name: (reg && reg.name) || KNOWN_AGENT_NAMES[agent] || agent, cwd: p.cwd,
  }, extra || {});
}
function cardView(p) { return p.view === 'cards' ? 'cards' : 'term'; }

// The agent's own resume handle, for reopening this conversation in its TUI.
// Only handles that were verified on this Mac; anything else starts fresh and
// the menu says so.
function terminalResumeSpec(p) {
  const agent = cardAgentFor(p);
  if (agent === 'claude') return { kind: 'claude', sid: p.sid, cont: !!p.sid, resumes: true };
  if (agent === 'codex' && p.acpSid) return { kind: 'run', command: `codex resume ${p.acpSid}`, resumes: true };
  if (agent === 'kimi' && p.acpSid) return { kind: 'run', command: `kimi -r ${p.acpSid}`, resumes: true };
  if (agent === 'agy' && p.acpSid) return { kind: 'run', command: `agy --conversation ${p.acpSid}`, resumes: true };
  return { kind: 'run', command: p.command, resumes: false };
}

// A new tile takes over this conversation on the other surface; this one
// closes. Chosen from the ⌄ menu — never sprung by a view toggle.
function moveToSurface(p, surface) {
  const spec = terminalResumeSpec(p);
  const opts = {
    title: p.title, titleSource: p.titleSource, code: p.code, chipKind: p.chipKind,
    cwd: p.cwd, view: surface, acpSid: p.acpSid,
  };
  if (spec.kind === 'claude') Object.assign(opts, { kind: 'claude', sid: p.sid, cont: spec.cont });
  else Object.assign(opts, { kind: 'run', command: surface === 'term' ? spec.command : p.command });
  closePanel(p.id);
  startPanel(opts);
}

function openBridgeMenu(p, anchor) {
  const agent = cardAgentFor(p);
  const inCards = cardView(p) === 'cards';
  const spec = terminalResumeSpec(p);
  const items = [];
  if (inCards) {
    items.push({
      label: 'Open in a new Terminal session',
      desc: spec.resumes ? 'same conversation — this card view closes' : 'starts its own conversation — this card view closes',
      run: () => moveToSurface(p, 'term'),
    });
  } else {
    if (agent === 'claude') {
      items.push({
        label: 'Watch as cards here',
        desc: 'live filter — the terminal keeps running',
        run: () => setView(p, 'cards'),
      });
      items.push({
        label: 'Move to a Cards session',
        desc: 'same conversation, driven — this terminal closes',
        run: () => moveToSurface(p, 'cards'),
      });
    } else {
      items.push({
        label: 'Start a Cards session',
        desc: 'its own conversation — this terminal stays',
        run: () => startPanel({ kind: 'run', title: p.title, code: p.code, chipKind: p.chipKind, cwd: p.cwd, command: p.command, view: 'cards' }),
      });
    }
  }
  if (inCards && agent === 'claude' && p.cardMode === 'watch') {
    items.push({ label: 'Back to Term', desc: 'the terminal was never touched', run: () => setView(p, 'term') });
  }
  items.push({ label: 'Rename this session', desc: '', run: () => { const t = tileEls.get(p.id); if (t) beginRename(p, q('.t-title', t.head)); } });
  const reg = (S.agents || []).find((a) => a.bin === p.command || (agent === 'claude' && a.id === 'claude'));
  if (reg) items.push({ label: 'Agent settings', desc: reg.name, run: () => openAgentSheet(reg) });
  showHeadMenu(anchor, items);
}

// One tiny popover for tile-head menus. Closes on pick, escape, or any
// click elsewhere.
function showHeadMenu(anchor, items) {
  closeHeadMenu();
  const menu = document.createElement('div');
  menu.className = 'head-menu';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'hm-item';
    if (it.disabled) b.disabled = true;
    b.innerHTML = `<span class="hm-l${it.labelCls ? ' ' + it.labelCls : ''}">${esc(it.label)}${it.mark ? ' <span class="hm-mark">✓</span>' : ''}</span>${it.desc ? `<span class="hm-d">${esc(it.desc)}</span>` : ''}`;
    b.onclick = (e) => { e.stopPropagation(); if (it.disabled) return; closeHeadMenu(); it.run(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  // Below the anchor by default; above it when the bottom of the window is
  // closer than the menu is tall (the mode chip lives on the card's floor).
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  menu.style.top = top + 'px';
  menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + 'px';
  const away = (e) => { if (!menu.contains(e.target)) closeHeadMenu(); };
  const key = (e) => { if (e.key === 'Escape') closeHeadMenu(); };
  setTimeout(() => { document.addEventListener('mousedown', away, { once: true }); document.addEventListener('keydown', key, { once: true }); }, 0);
  menu._cleanup = () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
}
function closeHeadMenu() {
  const m = document.querySelector('.head-menu');
  if (m) { if (m._cleanup) m._cleanup(); m.remove(); }
}

function setView(p, view) {
  const next = view === 'cards' ? 'cards' : 'term';
  if (cardView(p) === next) return;
  p.view = next;
  const rec = tileEls.get(p.id);
  if (rec) applyView(p, rec);
  savePanels();
  if (next === 'cards') enterCards(p); else exitCards(p);
}

// Which pane is showing. Runtime changes live in enterCards/exitCards; this
// only dresses the tile, so mountTile can call it before anything runs.
function applyView(p, rec) {
  const view = cardView(p);
  const on = view === 'cards';
  if (rec.cardsUi) rec.cardsUi.el.style.display = on ? 'flex' : 'none';
  rec.body.style.display = on ? 'none' : '';
  rec.root.classList.toggle('cards-on', on);
  const surf = q('.t-surface', rec.head);
  if (surf) {
    surf.className = 't-surface' + (on ? ' cards' : ' term');
    surf.textContent = on ? 'CARDS' : 'TERM';
  }
  if (on) { feedCards(p, true); if (rec.cardsUi) rec.cardsUi.scrollToEnd(true); refreshCardNote(p, rec); }
  else requestAnimationFrame(() => safeFit(rec));
  refreshChannelBadge(p, rec);
}

// The channel badge, once, in the head: 'agent sdk · driving', turning amber
// only when it explains a limitation (watching, one-shot, terminal-only).
// It used to repeat on every turn_end row — session state misfiled as turn
// state — so it moved up here.
function refreshChannelBadge(p, rec) {
  rec = rec || tileEls.get(p.id);
  const elb = rec && q('.t-channel', rec.head);
  if (!elb) return;
  const c = p.agentCaps && p.agentCaps.channel;
  const text = !c ? '' : (p.cardMode === 'watch' ? `${c} · watching` : (c === 'one-shot' ? 'one-shot' : `${c} · driving`));
  const show = cardView(p) === 'cards' && !!text;
  elb.hidden = !show;
  elb.textContent = show ? text : '';
  elb.classList.toggle('warn', show && /one-shot|terminal|watching/.test(text));
}

// Into Cards: the backlog first (what the conversation already holds, read
// once from the transcript), then the runtime swap — pty out, adapter in,
// resuming the same conversation id. If the drive channel refuses, the pty
// comes back and the card watches the transcript instead.
async function enterCards(p) {
  const rec = tileEls.get(p.id); if (!rec) return;
  const agent = cardAgentFor(p);
  if (!agent) return;
  if (agent.startsWith('unknown:')) {
    // Terminal only, and the card says which three doors it tried. The pty
    // stays live underneath; the composer types into it.
    const bin = agent.slice(8);
    p.agentLive = false; p.cardMode = 'watch';
    p.agentCaps = { channel: 'terminal only', note: '' };
    p.cardFallback = `${bin} offers none of the three channels cards can read — an ACP endpoint, a JSON stream mode, or a transcript on disk — so this session stays a terminal. The composer still types into it.`;
    refreshCardNote(p, rec);
    return;
  }

  // The one rule that keeps switching free: a running terminal is never
  // killed by a view change. Cards ATTACH to it — and only DRIVE when the
  // tile has no terminal (opened in Cards, restored in Cards, or it died).
  // Taking over is a button, a deliberate act, never a side effect.
  if (p.started && !p.exited) {
    if (agent === 'claude') {
      p.cardMode = 'watch';
      p.agentLive = false;
      p.agentCaps = { channel: 'transcript' };
      p.cardFallback = '';
      p.cardEvents = [];
      const back = await api.cardsBacklog({ cwd: p.cwd, sid: p.sid });
      if (cardView(p) !== 'cards') return;
      // The watched card introduces itself too — it used to open onto a
      // bare transcript, or nothing at all on a fresh conversation.
      p.cardEvents = [cardIntro(p, agent), ...((back && back.events) || [])];
      feedCards(p, true);
      if (rec.cardsUi) rec.cardsUi.scrollToEnd(true);
      api.cardsWatch({ id: p.id, on: true });
    } else {
      // A live TUI with no readable side-channel: the card says so, and
      // offers the takeover instead of springing it.
      p.cardMode = 'watch';
      p.agentLive = false;
      p.agentCaps = { channel: 'terminal' };
      p.cardFallback = 'This agent\'s terminal has no readable side-channel. Take over to drive it as cards — the terminal conversation ends, a card conversation starts.';
      // Rows from an earlier drive stay; only a truly empty card introduces
      // itself, so watching never opens onto nothing.
      if (!(p.cardEvents || []).length) { p.cardEvents = [cardIntro(p, agent)]; feedCards(p, true); }
      refreshCardNote(p, rec);
    }
    return;
  }
  await driveCards(p);
}

// The drive path: the card owns the tile. Kills any leftover pty first —
// two runtimes never overlap on one conversation.
async function driveCards(p) {
  const rec = tileEls.get(p.id); if (!rec) return;
  const agent = cardAgentFor(p);
  if (!agent || agent.startsWith('unknown:')) return;
  p.cardMode = 'drive';
  p.agentInit = false;
  // The welcome does not wait for the channel to boot: the registry already
  // knows who this is and where. init replaces this card with the enriched
  // one (version, model, mode) the moment it arrives — and it rides ahead of
  // whatever backlog the conversation already holds.
  // No mode on the welcome: the chip appears when the channel says what it
  // has — a guessed mode was the drift this sweep removed.
  const intro = cardIntro(p, agent, {});
  p.agentStatus = Object.assign(p.agentStatus || {}, { name: intro.name, mode: intro.mode || undefined });
  if (rec.cardsUi) rec.cardsUi.setStatus({ ...p.agentStatus, canSwitchMode: availableModes(p).some((m) => m.available) });
  p.cardEvents = [intro];
  if (agent === 'claude') {
    const back = await api.cardsBacklog({ cwd: p.cwd, sid: p.sid });
    if (cardView(p) !== 'cards') return;
    p.cardEvents = [intro, ...((back && back.events) || [])];
  }
  // What ⌘K said on the way in — which copy was written, whose file won —
  // belongs to this launch and is put back after the rebuild above. Once, and
  // then forgotten: clearing or resuming the conversation starts a different
  // one, and re-stamping "delivered just now" onto it would be a lie.
  if (p.launchNotes && p.launchNotes.length) {
    p.cardEvents = p.cardEvents.concat(p.launchNotes);
    p.launchNotes = null;
  }
  p.connecting = true;
  feedCards(p, true);
  if (rec.cardsUi) rec.cardsUi.scrollToEnd(true);

  // A connect that never resolves must not hang a silent card (hermes'
  // ACP resume did exactly that): after 10s the note turns urgent and
  // offers the way out. init clears it through refreshCardNote.
  setTimeout(() => {
    if (cardView(p) !== 'cards') return;
    if (!p.connecting && (!p.agentLive || p.agentInit)) return;
    const rec3 = tileEls.get(p.id);
    if (rec3 && rec3.cardsUi) rec3.cardsUi.setNote(
      'Still connecting — this agent may not support resuming over its card channel.',
      true, { label: 'Open in Term', run: () => setView(p, 'term') });
  }, 10000);

  if (p.started && !p.exited) {
    p.viewSwitching = true;
    await api.termKill({ id: p.id });
    p.started = false;
  }
  const sid = agent === 'claude' ? p.sid : (p.acpSid || null);
  const res = await api.agentStart({ id: p.id, agent, cwd: p.cwd, sid });
  p.connecting = false;
  if (cardView(p) !== 'cards') { if (res && res.ok) api.agentStop({ id: p.id }); return; }
  p.agentLive = !!(res && res.ok);
  p.cardFallback = '';
  // Anything typed while the channel was booting goes now, oldest first.
  if (p.agentLive && p.sendQueue && p.sendQueue.length) {
    const queued = p.sendQueue.splice(0);
    p.cardEvents = (p.cardEvents || []).filter((e) => !(e && e.kind === 'note' && e.queued));
    scheduleFeed(p);
    for (const t of queued) api.agentSend({ id: p.id, text: t });
  }
  if (!p.agentLive && agent === 'claude') {
    // Read-only fallback: restart the pty (hidden under the card) and tail
    // the transcript it writes.
    p.cardMode = 'watch';
    p.agentCaps = { channel: 'transcript' };
    p.cardFallback = 'Read-only: driving needs the claude CLI. The terminal still runs underneath.';
    p.started = false; p.exited = false;
    if (rec.term) startProcess(p, rec.term.cols, rec.term.rows).then(() => api.cardsWatch({ id: p.id, on: true }));
  } else if (!p.agentLive) {
    // The adapter said why (error + note rows). Bring the terminal back so
    // the tile is never a dead end.
    p.cardMode = 'watch';
    p.started = false; p.exited = false;
    if (rec.term) startProcess(p, rec.term.cols, rec.term.rows);
  }
  refreshCardNote(p, rec);
}

// Back to Term. A watching card never touched the pty, so there is nothing
// to do but show it. A driving card stops its runtime and the pty resumes
// the same conversation — the one deliberate restart left.
async function exitCards(p) {
  const rec = tileEls.get(p.id); if (!rec) return;
  api.cardsWatch({ id: p.id, on: false });
  if (p.cardMode === 'watch' && p.started && !p.exited) {
    p.cardMode = 'off';
    requestAnimationFrame(() => safeFit(rec));
    return;
  }
  if (p.agentLive) { p.agentLive = false; await api.agentStop({ id: p.id }); }
  p.cardMode = 'off';
  p.agentInit = false;
  p.exited = false; p.status = 'live'; p.started = false;
  if (rec.term) {
    try { rec.term.reset(); } catch (_) {}
    requestAnimationFrame(() => { safeFit(rec); startProcess(p, rec.term.cols, rec.term.rows); });
  }
  refreshTileHead(p); refreshRail();
}

// The welcome's model row, the footer chip and /model all land here. Three
// honest shapes: '/model <name>' sets it outright (on the one-shot channels
// the choice rides the next turn's flags); bare '/model' opens the numbered
// picker over the options the channel reported; with neither, the toast
// says how.
function openModelControl(p, value) {
  if (value) { api.agentConfig({ id: p.id, configId: 'model', value }); return; }
  const rec = tileEls.get(p.id);
  const models = p.agentStatus && p.agentStatus.models;
  if (rec && rec.cardsUi && models && Array.isArray(models.options) && models.options.length) {
    rec.cardsUi.openPicker({
      header: 'Select model',
      blurb: 'applies from the next turn',
      footer: 'Press ⏎ to confirm or esc to go back · 1-9 jump',
      items: models.options.map((o) => ({
        label: o.name || o.value, desc: o.desc || '',
        current: o.value === models.current, value: o.value,
      })),
      onPick: (it) => api.agentConfig({ id: p.id, configId: 'model', value: it.value }),
    });
    return;
  }
  toast('Type /model <name> — it applies from the next turn on this channel.');
}

// Every `/` the composer sends gets an answer. Native commands open the
// card's own control, terminal-only ones say so and offer a terminal, and in
// watch mode nothing is ever typed into the hidden pty — the CLI's popup
// would open in a display:none terminal, which is how "/model does nothing"
// was born. Returns true when the command was handled here.
function handleSlashCommand(p, text) {
  if (!String(text || '').startsWith('/')) return false;
  const agent = cardAgentFor(p);
  if (!agent || String(agent).startsWith('unknown:')) return false;
  const rec = tileEls.get(p.id);
  if (!p.agentLive && p.cardMode === 'watch') {
    // Acting in the card IS the consent: the takeover happens by itself and
    // then the command runs. Only a mid-task terminal earns a question.
    takeoverThen(p, () => handleSlashCommand(p, text));
    return true;
  }
  const r = routeCommand(agent, p.agentCommands, text);
  if (!r) return false;
  if (r.route === 'native-model') { openModelControl(p, r.arg); return true; }
  if (r.route === 'native-mode') { openModeMenu(p); return true; }
  if (r.route === 'native-clear') { clearConversation(p); return true; }
  if (r.route === 'native-resume') { openResumePicker(p); return true; }
  if (r.route === 'terminal') {
    const spec = terminalResumeSpec(p);
    // claude's spec has no run command (its kind is 'claude'); build one so
    // the button works there too — the run tile resolves the binary itself
    const command = spec.command || (agent === 'claude' && p.sid ? `claude --resume ${p.sid}` : null);
    p.cardEvents = (p.cardEvents || []).concat({
      kind: 'note', id: 'cmdnote:' + Date.now(),
      text: `/${r.name} belongs to the agent's own terminal — this channel can't run it.`,
      action: command ? { label: 'Open in Terminal', command } : null,
    });
    scheduleFeed(p);
    return true;
  }
  return false; // 'send': the channel executes it as text
}

// The mode options are exactly what the agent reported it can enter
// (init.modes, availability included). No fallback table: before the channel
// speaks there is no chip, and a channel that reports nothing has none.
function availableModes(p) {
  return (p.agentStatus && Array.isArray(p.agentStatus.modes) && p.agentStatus.modes) || [];
}

// shift⇥: the blind cycle, kept — but only through modes that exist here.
// ---- auto-takeover: acting in a watching card IS the consent ---------------
// A conversation can only be run by one program at a time. Flipping a live
// terminal to Cards attaches read-only; the moment the user ACTS in the card
// (types, or runs a / command) the card takes the conversation over by itself
// and then performs the action. The one surviving question is the honest one:
// whether to cut a turn the terminal is mid-way through.
function terminalBusy(p) {
  return p.started && !p.exited && Date.now() - (p.lastPtyData || 0) < 2500;
}

function takeoverThen(p, after) {
  const rec = tileEls.get(p.id);
  const claude = cardAgentFor(p) === 'claude';
  const go = async () => {
    p.cardFallback = '';
    p.cardEvents = (p.cardEvents || []).concat({
      kind: 'note', id: 'takeover:' + Date.now(),
      text: claude
        ? 'took over — the terminal handed this conversation to the card'
        : 'took over — the terminal session ends; the card continues from here',
    });
    scheduleFeed(p);
    await driveCards(p);
    if (after) after();
  };
  if (terminalBusy(p) && rec && rec.cardsUi) {
    rec.cardsUi.openPicker({
      header: 'The terminal is mid-task',
      items: [
        { label: 'Wait for this turn', desc: 'takes over the moment the terminal settles', cls: 'm-accept' },
        { label: 'Take over now ⚠', desc: 'interrupts the turn the terminal is running', cls: 'm-bypass' },
      ],
      onPick: (_it, i) => {
        if (i === 1) { go(); return; }
        const t = setInterval(() => {
          if (cardView(p) !== 'cards' || p.agentLive) { clearInterval(t); return; }
          if (!terminalBusy(p)) { clearInterval(t); go(); }
        }, 500);
      },
    });
    return;
  }
  go();
}

// /clear and /new: a conversation op, not a setting. The tile stays, the
// conversation ends — new id, fresh welcome, same folder. Claude keeps a
// pinned id (both runtimes resume by it); the others mint theirs on first
// contact, so their handle just drops.
async function clearConversation(p) {
  if (p.agentLive) { p.agentLive = false; await api.agentStop({ id: p.id }); }
  if (cardAgentFor(p) === 'claude') p.sid = crypto.randomUUID();
  p.acpSid = null;
  p.agentStatus = null; p.agentCommands = [];
  p.cardEvents = [];
  savePanels();
  await driveCards(p);
}

// /resume: pick a past conversation from the agent's own store and point
// this tile at it — on the same numbered picker every other choice uses.
// An agent whose store can't be read says so instead of an empty sheet.
async function openResumePicker(p) {
  const agent = cardAgentFor(p);
  const rec = tileEls.get(p.id);
  if (!rec || !rec.cardsUi) return;
  const res = await api.agentConversations({ agent, cwd: p.cwd });
  const convos = (res && res.conversations) || [];
  const cur = agent === 'claude' ? p.sid : p.acpSid;
  const items = convos.filter((c) => c.id !== cur).slice(0, 9).map((c) => ({
    label: c.title || c.id.slice(0, 8),
    desc: [c.age, c.preview].filter(Boolean).join(' · '),
    value: c.id,
  }));
  if (!items.length && res && res.note) items.push({ label: 'No past conversations found', desc: res.note, disabled: true });
  items.push({ label: '＋ Start fresh', desc: 'new conversation, same folder', cls: 'm-accept', value: '' });
  rec.cardsUi.openPicker({
    header: 'Resume — this folder\'s past conversations',
    blurb: res && res.note ? res.note : '',
    footer: 'Press ⏎ to confirm or esc to go back',
    items,
    onPick: (it) => { if (it.value) resumeConversation(p, it.value); else clearConversation(p); },
  });
}

async function resumeConversation(p, id) {
  if (p.agentLive) { p.agentLive = false; await api.agentStop({ id: p.id }); }
  if (cardAgentFor(p) === 'claude') p.sid = id; else p.acpSid = id;
  p.agentStatus = null; p.agentCommands = [];
  p.cardEvents = [];
  savePanels();
  await driveCards(p); // claude's drive path reloads the backlog for the new id
}

function cycleMode(p) {
  if (!p.agentLive) return;
  const ids = availableModes(p).filter((m) => m.available).map((m) => m.id);
  if (!ids.length) return;
  const cur = (p.agentStatus && p.agentStatus.mode) || ids[0];
  const next = ids[(ids.indexOf(cur) + 1) % ids.length];
  api.agentConfig({ id: p.id, configId: 'mode', value: next });
}

// The chip's click: every mode listed on the picker surface, each in its own
// colour, the current one marked — and an unavailable one shown disabled with
// the reason, which beats offering a switch that silently fails.
function openModeMenu(p) {
  if (!p.agentLive) return;
  const rec = tileEls.get(p.id);
  const modes = availableModes(p);
  if (!rec || !rec.cardsUi) return;
  // an agent with no switchable modes says so — a silent return reads as
  // "the command is broken", and this sweep has proven that repeatedly
  if (!modes.length) { toast('This agent has no switchable modes on its card channel.'); return; }
  const cur = p.agentStatus && p.agentStatus.mode;
  rec.cardsUi.openPicker({
    header: 'Permission mode',
    blurb: 'reported by the agent — what it cannot enter is greyed with the reason',
    items: modes.map((m) => ({
      label: modeLabel(m.id), cls: modeClass(m.id),
      current: m.id === cur, disabled: !m.available,
      // an available mode may carry the agent's own description (ACP does);
      // an unavailable one always explains itself
      desc: m.available ? (m.desc || '') : (m.reason || 'not available here'),
      value: m.id,
    })),
    onPick: (it) => api.agentConfig({ id: p.id, configId: 'mode', value: it.value }),
  });
}

function mountCards(p, rec) {
  const ui = buildCards({
    onSend: (text) => {
      clearAttention(p);
      if (p.autoName) feedSessionName(p, text + '\n');
      if (handleSlashCommand(p, text)) return;
      if (p.agentLive) {
        // One-shot channels take one task at a time: typed mid-run, the
        // message queues visibly and sends when the turn ends. Claude's
        // stream accepts input any time — straight through.
        const oneShot = p.agentCaps && p.agentCaps.channel === 'one-shot';
        if (oneShot && p.agentBusy) {
          p.sendQueue = p.sendQueue || [];
          p.sendQueue.push(text);
          p.cardEvents = (p.cardEvents || []).concat({
            kind: 'note', id: 'queued:' + Date.now(), queued: true,
            text: `queued — "${text.length > 44 ? text.slice(0, 43) + '…' : text}" · sends when this turn ends`,
          });
          scheduleFeed(p);
          return;
        }
        api.agentSend({ id: p.id, text });
        return;
      }
      // Still connecting: the input works, the message queues visibly and
      // sends the moment the channel is up — never into a dead pty.
      if (p.cardMode === 'drive') {
        p.sendQueue = p.sendQueue || [];
        p.sendQueue.push(text);
        p.cardEvents = (p.cardEvents || []).concat({
          kind: 'note', id: 'queued:' + Date.now(), queued: true,
          text: `queued — "${text.length > 44 ? text.slice(0, 43) + '…' : text}" · sends when connected`,
        });
        scheduleFeed(p);
        return;
      }
      // Watching a known agent: typing IS the takeover — the card claims the
      // conversation and the message goes over the drive channel.
      const agent = cardAgentFor(p);
      if (p.cardMode === 'watch' && agent && !String(agent).startsWith('unknown:')) {
        takeoverThen(p, () => { if (p.agentLive) api.agentSend({ id: p.id, text }); });
        return;
      }
      // Terminal-only tile: the pty underneath still holds the keyboard.
      api.termWrite({ id: p.id, data: text });
      setTimeout(() => api.termWrite({ id: p.id, data: '\r' }), 160);
    },
    onPermission: (permissionId, optionId) => {
      clearAttention(p);
      api.agentPermission({ id: p.id, permissionId, optionId });
    },
    onInterrupt: () => { if (p.agentLive) api.agentInterrupt({ id: p.id }); },
    onMic: () => toggleMic(p),
    onOpenPath: async (token, ev) => {
      const st = await api.statPath({ token, cwd: p.cwd, id: p.id });
      if (!st.exists) { toast('Not found: ' + token); return; }
      openTermLink({ kind: 'path', text: token }, st, ev);
    },
    onOpenUrl: (url) => api.openUrl(url),
    onModel: (value) => api.agentConfig({ id: p.id, configId: 'model', value }),
    // `@` completion: the folder this session runs in, one level at a time —
    // type a slash to descend. Real directory listings, nothing indexed ahead.
    listFiles: async (query) => {
      const slash = query.lastIndexOf('/');
      const dirRel = slash >= 0 ? query.slice(0, slash) : '';
      const base = (slash >= 0 ? query.slice(slash + 1) : query).toLowerCase();
      const dir = dirRel ? p.cwd + '/' + dirRel : p.cwd;
      let entries = [];
      try { entries = await api.listDir(dir) || []; } catch (_) { return []; }
      return entries
        .filter((e2) => e2.name.toLowerCase().startsWith(base))
        .map((e2) => ({
          rel: (dirRel ? dirRel + '/' : '') + e2.name + (e2.kind === 'dir' ? '/' : ''),
          desc: e2.meta || '',
        }));
    },
    onModelMenu: () => openModelControl(p),
    onMode: () => cycleMode(p),
    onModePick: (anchor) => openModeMenu(p, anchor),
    onRunCommand: (command) => startPanel({ kind: 'run', title: command, code: code2(command), cwd: p.cwd, command }),
    // The channel's own list when it published one, the curated static table
    // otherwise — so the `/` menu works on every agent, watch mode included.
    commands: () => commandsFor(cardAgentFor(p), p.agentCommands),
  });
  rec.root.appendChild(ui.el);
  rec.cardsUi = ui;
  ui.setFontSize(termFontSize());
}

function refreshCardNote(p, rec) {
  if (!rec || !rec.cardsUi) return;
  refreshChannelBadge(p, rec);
  let text = '', urgent = false;
  // The runtime swap takes a moment on a long conversation — say so rather
  // than sitting silent while the SDK boots and resumes.
  let action = null;
  if (p.connecting) text = 'Connecting — resuming this conversation…';
  else if (p.exited && !p.agentLive) text = 'This session has ended.';
  else if (p.attention && !p.agentLive) { text = 'This session is waiting on you — answer it in Term.'; urgent = true; }
  else if (p.cardFallback) text = p.cardFallback;
  else if (p.cardMode === 'watch' && cardAgentFor(p) === 'claude') {
    text = 'Watching the terminal\'s conversation. Approvals live in Term — or take over to drive from here.';
  }
  if (p.cardMode === 'watch' && !p.connecting && !p.exited && cardAgentFor(p) && !String(cardAgentFor(p)).startsWith('unknown:')) {
    action = { label: 'Take over', run: () => { p.cardFallback = ''; driveCards(p); } };
  }
  rec.cardsUi.setNote(text, urgent, action);
}

// Streaming floods batch here: however many events land in one frame, the
// DOM is touched once, on the next animation frame. OpenCode sent fourteen
// chunks for one sentence and Hermes twenty-seven thought chunks; per-chunk
// rendering stutters, per-frame rendering does not.
const feedPending = new Set();
function scheduleFeed(p) {
  if (feedPending.has(p.id)) return;
  feedPending.add(p.id);
  requestAnimationFrame(() => {
    feedPending.delete(p.id);
    try { feedCards(p, false); } catch (_) {} // a bad row costs the row, never the tile
  });
}

// An adapter that goes quiet still owes the card a shape: after a minute of
// silence mid-turn the note says so, instead of a spinner that never resolves.
setInterval(() => {
  for (const p of S.panels) {
    if (!p.agentBusy || cardView(p) !== 'cards') continue;
    if (p.lastEventAt && Date.now() - p.lastEventAt > 60000) {
      const rec = tileEls.get(p.id);
      if (rec && rec.cardsUi) rec.cardsUi.setNote('No response for a minute — Esc stops the turn, Term shows the raw channel.', false);
    }
  }
}, 15000);

// Everything accumulated so far, reconciled into the list. A full rebuild is
// reserved for a reset — it would otherwise close every expanded row and
// throw away the scroll position.
function feedCards(p, full) {
  const rec = tileEls.get(p.id);
  if (!rec || !rec.cardsUi || cardView(p) !== 'cards') return;
  if (p.cardEvents && p.cardEvents.length > CARD_EVENT_CAP) {
    p.cardEvents = p.cardEvents.slice(-CARD_EVENT_CAP);
    full = true;
  }
  rec.cardsUi.feed(buildRows(p.cardEvents || []), full);
  refreshCardNote(p, rec);
}

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
  const st = await api.statPath({ token: t.target, cwd: p.cwd, id: p.id });
  if (!st.exists) { toast('Not found: ' + shortHome(t.target)); return; }
  if (st.isFile) openFile(st.abs); else api.revealFile(st.abs);
}

// ---- editor tiles ----------------------------------------------------------
function mountEditor(p, rec) {
  // Markdown and html open rendered; everything else has nothing to render, so
  // it opens straight in the editor and never shows the Read tab.
  const md = isMarkdownPath(p.filePath);
  const html = fileKind(p.filePath) === 'html';
  const rendered = md || html;
  if (!rendered) p.edMode = 'edit';
  else if (p.edMode !== 'edit') p.edMode = 'read';

  const wrap = document.createElement('div'); wrap.className = 'editor';
  wrap.innerHTML = `${rendered ? `<div class="ed-tabs card-tabs">
      <button class="card-tab ed-tab" data-m="read">Read</button>
      <button class="card-tab ed-tab" data-m="edit">Edit</button></div>` : ''}
    <div class="ed-read md-read"></div>
    <div class="ed-pane"><div class="ed-gutter"></div>
      <div class="ed-stack"><pre class="ed-hl" aria-hidden="true"></pre><textarea class="ed-area" spellcheck="false"></textarea></div></div>
    <div class="ed-bar"><span class="ed-path">${esc(shortHome(p.filePath))}</span><button class="btn ed-finder">Finder</button><button class="btn btn--go ed-save">Save ⌘S</button></div>`;
  wrap.classList.toggle('editor--md', md);
  wrap.classList.toggle('editor--html', html);
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
    if (p.edMode === 'read') {
      if (html) {
        // The page renders from the buffer, not the file, so Edit → Read shows
        // unsaved changes — the same live round trip markdown has. Sandboxed
        // exactly like the standalone viewer: scripts run, but the page has an
        // opaque origin and cannot reach Nami. The injected <base> makes the
        // page's own relative images and stylesheets resolve beside the file;
        // the parser hoists it into <head> wherever the document starts.
        read.innerHTML = '';
        const f = document.createElement('iframe');
        f.className = 'ed-html';
        if (p.dirty) {
          // Mid-edit the file on disk is stale, so the page is rendered from the
          // buffer in an opaque sandbox — the change shows live, its relative
          // images do not (an opaque origin cannot fetch file://), and they
          // return the moment you save. allow-scripts only; no same-origin,
          // because a srcdoc page shares Nami's file:// origin and the flag
          // would let it read the app.
          f.setAttribute('sandbox', 'allow-scripts');
          const text = p.text || '';
          const dir = 'file://' + String(p.filePath).split('/').slice(0, -1).map(encodeURIComponent).join('/') + '/';
          f.srcdoc = /<base[\s>]/i.test(text) ? text : `<base href="${dir}">` + text;
        } else {
          // Saved → served from nami-doc://, its own origin. Relative images
          // load, and allow-same-origin is safe: "same origin" is the page's
          // nami-doc origin, cross-origin to Nami, so it still cannot reach the
          // app (proved by the hostile-page test). connect-src 'none' in the
          // served CSP stops it sending anything it read anywhere.
          f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
          f.src = docUrl(p.filePath);
        }
        read.appendChild(f);
      } else read.innerHTML = renderMarkdown(p.text || '');
    }
    wrap.querySelectorAll('.ed-tab').forEach((b) => b.classList.toggle('active', b.dataset.m === p.edMode));
    if (p.edMode === 'edit') sync();
  };

  ta.addEventListener('input', () => { p.text = ta.value; if (!p.dirty) { p.dirty = true; refreshTileHead(p); refreshRail(); } sync(); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveEditor(p); }
    // insertText, not an assignment to ta.value: assigning replaces the field's
    // contents outside the browser's editing pipeline and throws the undo stack
    // away with them, so one Tab cost you the whole history — Cmd+Z afterwards
    // did nothing at all. Editing through the pipeline fires input, and the
    // handler above does the p.text/dirty/sync work that used to be repeated here.
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
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
  // Served from nami-doc://, the page's own origin — relative images load and
  // allow-same-origin is safe because that origin is cross-origin to Nami (see
  // the Read tab in mountEditor for the full reasoning). html routes to the
  // editor now, so this branch is a fallback; it uses the same safe path.
  else if (p.sub === 'html') wrap.innerHTML = `<iframe class="vw-pdf vw-html" sandbox="allow-scripts allow-same-origin" src="${esc(docUrl(p.filePath))}"></iframe>`;
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
// Agents differ per platform, so they are keyed by both. A skill is keyed by type
// alone: its frontmatter is the same wherever the folder lives, and keying it by
// platform meant a skill from Cursor or the project's own folder fell through to
// the agent shape and offered Tools and Model — fields a SKILL.md has no use for,
// which the form would then write into the file.
const FIELD_MAP = {
  skill: [['name', 'Name'], ['description', 'Description']],
  // the master: the superset every dialect is a subset of
  'project:agent': [['name', 'Name'], ['description', 'Description'], ['tools', 'Tools'], ['model', 'Model'], ['mode', 'Mode']],
  'claude:agent': [['name', 'Name'], ['description', 'Description'], ['tools', 'Tools'], ['model', 'Model']],
  'opencode:agent': [['description', 'Description'], ['mode', 'Mode'], ['model', 'Model']],
  'opencode:command': [['description', 'Description'], ['agent', 'Agent'], ['model', 'Model']],
};
function connectionsOf(item) {
  const byId = new Map(S.library.items.map((i) => [i.id, i]));
  const out = S.library.edges.filter((e) => e.from === item.id).map((e) => byId.get(e.to)).filter(Boolean);
  const inn = S.library.edges.filter((e) => e.to === item.id).map((e) => byId.get(e.from)).filter(Boolean);
  return { out, inn };
}
// A skill that lives somewhere else is worth showing, but showing it is only
// half a feature: this is the action that makes it usable here. Nothing offers
// it for a skill already in the project, or one whose files have gone.
function useHereLabel(item) {
  if (item.broken) return '';
  if (item.type === 'skill') return item.scope === 'project' ? '' : 'Use here';
  return item.readOnly ? 'Duplicate to project' : '';
}
// A hand-made platform agent can be lifted into the drawer; a master already
// is everyone's, and read-only plugin agents are somebody else's to lift.
function canAdopt(item) {
  return item.type === 'agent' && !item.readOnly && !item.broken && !!S.project
    && ['claude', 'opencode', 'gemini', 'antigravity', 'kimi'].includes(item.platform);
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
    // The invariant is 'only markdown edits as frontmatter', and it must not
    // rest on a .toml never happening to start with ---.
    mode: doc.hasFrontmatter && editsAsFrontmatter(item.filePath) ? 'form' : 'raw', dirty: false, status: 'live',
    chipKind: chip.kind, code: chip.code, title: item.name, cwd: S.project && S.project.path,
  };
  if (doc.malformed) toast('Frontmatter looks malformed. Raw view only.');
  if (opts && opts.pin) {
    S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
    renderGrid(); renderRail(); renderHeader(); savePanels();
  } else openPeek(p);
}
function mountCard(p, rec) {
  // A broken link has no file behind it, so its inputs are disabled for the same
  // reason a plugin's are: there is nothing here that saving could write to.
  const ro = p.item.readOnly || p.item.broken;
  const wrap = document.createElement('div'); wrap.className = 'card-ed';
  const fields = FIELD_MAP[p.item.type] || FIELD_MAP[p.item.platform + ':' + p.item.type] || FIELD_MAP['claude:agent'];
  // The form is a frontmatter editor, and only markdown has frontmatter. Codex
  // agents are TOML: offered the form, it would find no fence, fall through to
  // Claude's field list, and the first keystroke would make setField *create*
  // frontmatter — writing a YAML block onto somebody's hand-written TOML and
  // leaving a file Codex can no longer parse. No form, and the raw tab is
  // named for what it actually holds.
  const asMarkdown = editsAsFrontmatter(p.filePath);
  wrap.innerHTML = `
    <div class="card-tabs">
      ${asMarkdown ? '<button class="card-tab" data-m="form">Form</button>' : ''}
      <button class="card-tab" data-m="raw">${asMarkdown ? 'Markdown' : esc(formatLabel(p.filePath))}</button>
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
      ${canAdopt(p.item) ? '<button class="btn btn--go card-adopt">Make it everyone’s</button>' : ''}
      ${useHereLabel(p.item) ? `<button class="btn btn--go card-dup">${esc(useHereLabel(p.item))}</button>` : ''}
      ${p.item.broken ? '<button class="btn btn--go card-del">Remove this dead link</button>'
        : ro ? ''
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
      if (!asMarkdown) return;   // there is no form for a file with no frontmatter to edit
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
  const useBtn = q('.card-use', wrap);
  // Same resolution the picker uses, so Use and ⌘K never disagree about
  // which tool an agent runs on.
  if (useBtn) useBtn.onclick = () => {
    const tool = rowTool(p.item);
    if (!tool) { toast('Nothing installed can run ' + p.item.slug + '.'); return; }
    launchAgent(p.item, tool);
  };
  const adoptBtn = q('.card-adopt', wrap);
  if (adoptBtn) adoptBtn.onclick = async () => {
    if (p.dirty) { toast('Save the card first — the master is lifted from the file.'); return; }
    adoptBtn.disabled = true; adoptBtn.textContent = 'Lifting…';
    const res = await api.adoptAgent({ filePath: p.item.filePath, platform: p.item.platform, projectPath: S.project.path, agentIds: installedAgentIds() });
    if (!res.ok) { toast(res.error || 'Could not lift it'); adoptBtn.disabled = false; adoptBtn.textContent = 'Make it everyone’s'; return; }
    if (S.panels.includes(p)) closePanel(p.id); else closeOverlay();
    await loadLibrary(true);
    const master = S.library.items.find((i) => i.filePath === res.masterPath);
    toast('Now everyone’s — the master lives in agents/.');
    if (master) openCard(master);
  };
  const saveBtn = q('.card-save', wrap); if (saveBtn) saveBtn.onclick = () => saveCard(p);
  const dupBtn = q('.card-dup', wrap);
  if (dupBtn) dupBtn.onclick = async () => {
    if (!S.project) { toast('Open a folder first — the copy lands in the project.'); return; }
    const res = await api.libraryDuplicate({ filePath: p.item.filePath, type: p.item.type, projectPath: S.project.path });
    if (!res.ok) { toast(res.error || 'Copy failed'); return; }
    // A skill only runs here once the pointer says so, so the copy and the
    // announcement are one action — otherwise Use here leaves you half done.
    if (p.item.type === 'skill') {
      const w = await api.pointerWrite({ dir: S.project.path, agentIds: installedAgentIds() });
      toast(w && w.ok && (w.written || []).length
        ? `Copied in and announced — every installed agent knows about ${res.item.slug} now.`
        : 'Copied into this project — opening your editable copy.');
      await refreshPointer(true);
    } else toast('Copied into this project — opening your editable copy.');
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
    // and stop advertising it, along with any native link that pointed at it
    if (p.item.type === 'skill' && p.item.scope === 'project' && S.project) {
      api.pointerWrite({ dir: S.project.path, agentIds: installedAgentIds() }).then(() => refreshPointer(true));
    }
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
    // The block publishes each skill's description, so editing one here is a
    // reason to rewrite it — the announcement should not lag the file.
    if (p.item.type === 'skill' && p.item.scope === 'project' && S.project) {
      api.pointerWrite({ dir: S.project.path, agentIds: installedAgentIds() }).then(() => refreshPointer(true));
    }
    // A master agent's copies must never lag the master — regenerate on save.
    if (p.item.type === 'agent' && p.item.platform === 'project' && S.project) {
      api.deliverAgents({ projectPath: S.project.path, agentIds: installedAgentIds() });
    }
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
function micBtn(p) {
  const t = tileEls.get(p.id); if (!t) return null;
  // The mic never disappears: in Cards it sits in the composer, in Term in
  // the head. State lands on whichever one is showing.
  if (canShowCards(p) && cardView(p) === 'cards' && t.cardsUi) return q('.cd-mic-btn', t.cardsUi.el);
  return q('.t-mic', t.head);
}
function setMicState(p, state) {
  const b = micBtn(p); if (!b) return;
  if (!b.dataset.idle) b.dataset.idle = b.innerHTML; // whatever glyph pair it was born with
  b.classList.toggle('rec', state === 'recording');
  b.classList.toggle('busy', state === 'transcribing');
  if (state === 'recording') b.innerHTML = '<span class="rec-square"></span>';
  else if (state === 'transcribing') b.textContent = '…';
  else b.innerHTML = b.dataset.idle;
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
  // In Cards the composer is the keyboard: dictation lands there, reviewable,
  // and Enter sends it — the same courtesy the terminal's settled-line gets.
  if (canShowCards(p) && cardView(p) === 'cards') {
    const t = tileEls.get(p.id);
    if (t && t.cardsUi) { t.cardsUi.insertText(text); return; }
  }
  if (p.kind === 'editor') {
    const t = tileEls.get(p.id); if (!t || !t.ta) return;
    // Same reason as the Tab key: assigning ta.value costs the undo stack, and
    // dictation was spending it on every insert. focusPanel above already put
    // the keyboard here; execCommand needs that for certain, so say so.
    t.ta.focus();
    document.execCommand('insertText', false, text);
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
    // A one-shot that has run comes back as a plain terminal, not as its
    // command. Restoring the command re-ran it: leave an install tile on the
    // desk, quit, and Nami piped curl into bash again on the next launch, and
    // the one after that. A session is worth restoring; an errand is not.
    if (p.oneShot && (p.commandDone || p.exited)) {
      return { kind: 'shell', title: p.title, titleSource: p.titleSource, code: p.code, chipKind: p.chipKind, cwd: p.cwd };
    }
    return { kind: p.kind, title: p.title, titleSource: p.titleSource, code: p.code, chipKind: p.chipKind, cwd: p.cwd, command: p.command, program: p.program, args: p.args, sid: p.sid, acpSid: p.acpSid, view: p.view, oneShot: p.oneShot, agentId: p.agentId, watchDone: p.watchDone };
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
      else if (s.kind) startPanel({ kind: s.kind, title: s.title, titleSource: s.titleSource, code: s.code, chipKind: s.chipKind, cwd: s.cwd, command: s.command, program: s.program, args: s.args, sid: s.sid, acpSid: s.acpSid, view: s.view, oneShot: s.oneShot, agentId: s.agentId, watchDone: s.watchDone, cont: s.kind === 'claude' && (!!s.sid || s === newestLegacy) });
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
const VIEWER_CODES = { image: 'IM', video: 'VI', audio: 'AU', pdf: 'PD', html: 'HT', other: 'FI' };
function viewerPanel(filePath, sub, note) {
  return { id: uid('p_'), kind: 'viewer', sub, note, chipKind: 'viewer', code: VIEWER_CODES[sub] || 'VW', title: baseNameOf(filePath), filePath, status: 'live', cwd: S.project && S.project.path };
}
// Build the right panel for any path: media/pdf as viewer, text as editor,
// unreadable/binary as an 'other' viewer card carrying the reason.
async function buildFilePanel(filePath) {
  const kind = fileKind(filePath);
  // html is text underneath: it goes to the editor, which gives it the same
  // Read/Edit tabs markdown has — Read renders the page, Edit is the source.
  if (kind !== 'text' && kind !== 'html') return viewerPanel(filePath, kind);
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
  else if (p.kind !== 'editor' && p.kind !== 'viewer' && p.kind !== 'card') {
    api.termKill({ id });
    if (p.agentLive) api.agentStop({ id });
  }
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
// A session runs inside a folder. With one open, launch straight away; without,
// the folder-first card asks where — recents are one click, and the OS dialog
// only appears from its "another folder" row. The continuation rides on the
// overlay itself: Esc / ✕ / click-out use the generic dismiss and simply drop
// it, so nothing awaits and nothing can hang.
function withFolder(run, who) {
  if (S.project) return run();
  S.overlay = { type: 'folder-first', run, who };
  renderOverlay();
}
function renderFolderFirst() {
  const o = S.overlay;
  const who = o.who || 'this session';
  const recents = (S.recents || []).filter((r) => !r.missing);
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">＋</span>
    <span style="font-weight:700">Where should ${esc(who)} work?</span>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)">then your session starts</span></div>
    ${recents.length
    ? `<div class="ff-lead">a session runs inside a folder. Pick one and ${esc(who)} starts there</div>
      <div class="picker-list" id="ff-list">${recents.map((r, i) => `
        <div class="picker-row" data-i="${i}" title="${esc(r.path)}">
          <span class="folder-glyph">${treeIcon('', 'dir', false)}</span>
          <span class="col"><span class="name">${esc(r.name)}</span><span class="desc">${esc(r.pathShort)}</span></span>
          ${r.pinned ? '<span class="ff-pin">pinned</span>' : ''}
        </div>`).join('')}</div>
      <button class="ff-other" id="ff-pick"><span class="plus">＋</span><span>Choose another folder…</span><span class="kbd">opens the Mac dialog</span></button>`
    : `<div class="ff-empty">
        <div class="ff-msg">No folders here yet</div>
        <div class="ff-sub">a folder is where your files and the session live. One of your projects, or an empty one to start in</div>
        <button class="btn btn--go" id="ff-pick">Choose a folder…</button>
        <div class="ff-hint">opens the Mac folder dialog</div>
      </div>`}`, { top: true });
  // A pick has to outlive the overlay: closeOverlay() nulls S.overlay, so the
  // continuation is captured before anything closes.
  const run = o.run;
  modal.querySelectorAll('.picker-row').forEach((row) => {
    row.onclick = async () => {
      const r = recents[+row.dataset.i]; if (!r) return;
      closeOverlay();
      await openFolder(r.path);
      if (S.project) run();
    };
  });
  q('#ff-pick', modal).onclick = async () => {
    const info = await api.pickFolder(); if (!info) return;
    closeOverlay();
    await switchToFolder(info);
    if (S.project) run();
  };
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
  if (['launcher', 'agent-setup', 'agent-remove', 'connect-form', 'connect-custom', 'connect-own', 'create', 'improve-item'].includes(ot)) renderOverlay();
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
  // The one just added sorts to the top. Anything else and the user is handed
  // back a list and asked to find their own new thing in it.
  const ready = (S.agents || []).filter((a) => a.found)
    .sort((x, y) => (y.id === S.justAdded) - (x.id === S.justAdded));
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
    // Which agents can be born as cards: claude plus every bin the adapter
    // table drives. The surface is chosen here, at birth; the row remembers
    // each agent's last pick.
    const cardable = a.kind === 'claude' || ['opencode', 'hermes', 'codex', 'kimi', 'agy'].includes(a.bin);
    const lastPick = (() => { try { return localStorage.getItem('nami.surface.' + a.id) || 'term'; } catch (_) { return 'term'; } })();
    // The one just installed says so, and says it here — this list is where the
    // install sends you back to, and an agent that arrived thirty seconds ago
    // looks exactly like one that has been there for months without it.
    const fresh = S.justAdded === a.id;
    if (fresh) row.classList.add('picker-row--new');
    row.innerHTML = `${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">${esc(a.name)}</span>
      <span class="desc"><span class="ok${st.dot === 'warn' ? ' ok--warn' : ''}">●</span> ready · ${esc(st.text)}</span></span>
      ${fresh ? '<span class="row-new">just added</span>' : ''}
      ${cardable ? `<span class="ways">
        <button class="way way--cards${lastPick === 'cards' ? ' last' : ''}" data-w="cards">Cards</button>
        <button class="way${lastPick === 'term' ? ' last' : ''}" data-w="term">Terminal</button>
      </span>` : ''}
      ${manageable ? '<span class="chev" title="Manage this agent">›</span>' : ''}`;
    const launch = (surface) => {
      closeOverlay();
      withFolder(() => {
        try { localStorage.setItem('nami.surface.' + a.id, surface); } catch (_) {}
        if (a.kind === 'claude') return startPanel({ kind: 'claude', title: 'Claude session', code: 'CC', view: surface });
        startPanel({ kind: 'run', title: a.name, code: code2(a.name), command: a.bin, view: cardable ? surface : undefined });
      }, a.name);
    };
    row.onclick = async (e) => {
      if (manageable && e.target.closest('.chev')) { openAgentSheet(a); return; }
      const way = e.target.closest('.way');
      if (way) { launch(way.dataset.w); return; }
      launch(cardable ? lastPick : 'term');
    };
    list.appendChild(row);
  }
  for (const h of EVERGREEN_ROWS) {
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="code" data-kind="${esc(h.chipKind || 'shell')}">${esc(h.code)}</span>
      <span class="col"><span class="name">${esc(h.name)}</span><span class="desc">${esc(h.sub)}</span></span>`;
    row.onclick = () => { closeOverlay(); withFolder(() => launchHarness(h), 'the terminal'); };
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
  q('#su-run', modal).onclick = () => {
    closeOverlay();
    // oneShot + watchDone: this tile exists to run one command Nami chose, and
    // the tile itself reports when that command lands. Before, the only signal
    // was the shell dying — which for an install is never — so the toast asked
    // the user to go and press ⌘N themselves.
    withFolder(() => startPanel({
      kind: 'run', title: `install ${a.name}`, code: code2(a.name), command: a.install,
      oneShot: true, watchDone: true, agentId: a.id,
      onExit: () => refreshAgents(),
    }), 'this install');
  };
  q('#su-copy', modal).onclick = async () => { await api.copyText(a.install); toast('Copied.'); };
  q('#su-docs', modal).onclick = () => api.openUrl(a.docs);
}

// ---- an install that finished ----------------------------------------------
// The old ending was a shell prompt and a toast asking the user to press ⌘N and
// go find the agent. Nothing had told the app the install was over, so nothing
// could offer anything better. Now the tile knows, so it can say what happened
// and hand back the one list the user came from.

// A strip under the tile body. Deliberately not a toast: a toast is gone in
// four seconds and this is the tile's own state, which should still be there
// when someone looks back at it.
function setTileNote(p, html, kind) {
  const t = tileEls.get(p.id); if (!t) return;
  let note = q('.tile-note', t.root);
  if (!html) { if (note) note.remove(); return; }
  if (!note) {
    note = document.createElement('div');
    note.className = 'tile-note';
    t.root.appendChild(note);
  }
  note.className = 'tile-note' + (kind ? ' tile-note--' + kind : '');
  note.innerHTML = html;
  return note;
}

// One place both the live channel and --scene=install go through, so what gets
// screenshotted is what a user gets.
function runCommandFinished(p, code) {
  if (p.commandDone) return;
  p.commandDone = true; p.commandCode = code;
  // Snapshot now: from here the tile is an ordinary shell and must never be
  // restored as a command to run again.
  savePanels();
  // head, rail and the live badge all read the same status — refreshing one of
  // them left the rail saying "running" beside a tile saying "installed".
  refreshTileHead(p); refreshRail(); renderHeader();
  if (p.agentId) finishAgentInstall(p, code);
}

async function finishAgentInstall(p, code) {
  const agent = () => (S.agents || []).find((x) => x.id === p.agentId);
  const name = (agent() && agent().name) || p.agentId;
  refreshTileHead(p);

  // The scan decides, not the exit code. `curl … | bash` — four of the six
  // install commands — reports the status of bash, and a curl that never
  // reached the host still leaves bash reading an empty script and exiting 0
  // (measured against a real pty). A zero means the shell got to the end. Only
  // finding the program means it installed.
  if (code === 0) await refreshAgents();
  const found = !!(agent() && agent().found);
  const ok = code === 0 && found;
  p.installOk = ok;
  refreshTileHead(p); refreshRail();

  if (!ok) {
    setTileNote(p, `<span class="tn-tx"><b>${esc(name)} is still not on this Mac.</b>
      ${code === 0 ? 'The command ran to the end but left nothing Nami can find — the output above should say why.'
        : `The install exited with <b>${esc(String(code))}</b>.`}</span>
      <span class="tn-bt"><button class="btn btn--small" id="tn-docs">Read the guide</button>
      <button class="btn btn--small" id="tn-retry">Try again</button></span>`, 'warn');
    const t = tileEls.get(p.id); if (!t) return;
    const docs = q('#tn-docs', t.root), retry = q('#tn-retry', t.root);
    if (docs) docs.onclick = () => { const a = agent(); if (a) api.openUrl(a.docs); };
    if (retry) retry.onclick = () => { const a = agent(); if (a) { closePanel(p.id); openAgentSetup(a); } };
    return;
  }

  const a = agent();
  S.justAdded = a.id;
  const signedOut = !(S.agentStatus[a.id] && S.agentStatus[a.id].signedIn);
  setTileNote(p, `<span class="tn-tx"><b>${esc(a.name)} is on this Mac.</b>
    ${signedOut ? 'Signed out — your first session signs you in.' : 'Signed in and ready.'}</span>
    <span class="tn-bt"><button class="btn btn--go btn--small" id="tn-go">Back to New session</button></span>`, 'ok');
  const t = tileEls.get(p.id); if (!t) return;
  const go = q('#tn-go', t.root);
  // Back to the list they came from, with the new agent in it — rather than
  // dropping them into a session they did not ask for yet. The finished install
  // terminal closes on the way out: it has nothing left to say.
  if (go) go.onclick = () => { closePanel(p.id); openLauncher(); };
}

// ---- agent picker (⌘K) — fed by the library scan ---------------------------
// ⌘N answers which tool runs. This answers what it runs as — every agent on the
// shelf, whatever tool it speaks, with two ways out of every row: into the
// session you are looking at, or into a fresh one.
function pickerAgents() {
  // One agent, one row — the rule the drawer has followed since it landed. A
  // file sitting where a master's copy would land is that master shadowed on
  // one tool, not a second agent, and the master's tool list says so as ◐.
  // The scan decides that by target path, not by name, so a same-named agent in
  // a folder the master never writes to keeps its own row.
  return (S.library.items || [])
    .filter((i) => i.type === 'agent' && !i.shadows)
    .sort((a, b) => sortKey(a) - sortKey(b) || String(a.slug).localeCompare(String(b.slug)));
}
function toolNameOf(id) { const a = (S.agents || []).find((x) => x.id === id); return a ? a.name : id; }
function toolById(id) { return (S.agents || []).find((x) => x.id === id) || null; }

// Which tool a live tile is running, as a detected agent id. cardAgentFor names
// the adapter — 'agy' for Antigravity — so the registry does the last hop
// rather than a second hard-coded table.
function panelTool(p) {
  const key = cardAgentFor(p);
  if (!key || String(key).startsWith('unknown:')) return null;
  if (key === 'claude') return 'claude';
  const a = (S.agents || []).find((x) => x.bin === key);
  return a ? a.id : null;
}
function focusedPanel() { return S.panels.find((x) => x.id === S.activeId) || null; }

// One string per agent, so a habit is remembered per agent rather than globally
// — the same shape as the launcher's Cards/Terminal memory.
const TOOL_KEY = (item) => 'nami.agenttool.' + item.id;
function rememberedTool(item) { try { return localStorage.getItem(TOOL_KEY(item)) || ''; } catch (_) { return ''; } }
function rememberTool(item, toolId) { try { localStorage.setItem(TOOL_KEY(item), toolId); } catch (_) {} }

function rowTool(item) {
  const p = focusedPanel();
  return resolveTool({
    item,
    remembered: rememberedTool(item),
    focusedTool: p ? panelTool(p) : null,
    installed: installedAgentIds(),
  });
}

// Any agent that is not a master is one copy away from being one. A markdown
// file the project owns is lifted — the original becomes a marked copy that
// regenerates from the new master. Everything else — plugins, user-scope
// files, Codex TOML — is imported, and the source is read, never written.
async function copyToMaster(item) {
  if (!S.project) { toast('Open a folder first — the master lands in it.'); return; }
  const args = { projectPath: S.project.path, agentIds: installedAgentIds() };
  const lift = item.scope === 'project' && !item.readOnly && /\.(md|markdown)$/i.test(item.filePath || '');
  const res = lift
    ? await api.adoptAgent({ ...args, filePath: item.filePath, platform: item.platform })
    : await api.importAgent({ ...args, filePath: item.filePath });
  if (!res || !res.ok) { toast((res && res.error) || 'Could not copy it.'); return; }
  await loadLibrary(true); // force — the scan must see the new master
  toast(`${item.slug} runs anywhere now — it lives in agents/${item.slug}.md.`);
  if (S.overlay && S.overlay.type === 'agents') {
    // Reopen as the master it just became, so the delivery dots light up in
    // place — openToolList toggles, so the slot must be cleared first.
    S.overlay.open = null; S.overlay.delivery = null;
    const master = pickerAgents().find((a) => a.slug === item.slug && isMaster(a));
    if (master) await openToolList(master); else renderOverlay();
  }
}

// Make sure this agent has a copy on the tool about to run it. Delivery is
// tool-scoped, not agent-scoped — one pass regenerates every master for that
// one tool — which is what keeps ⌘K from quietly rewriting five other folders.
async function ensureDelivered(item, toolId) {
  if (!isMaster(item) || !S.project) return null;
  const before = await api.agentDelivery({ projectPath: S.project.path, slug: item.slug, agentIds: [toolId] });
  const was = (before && before[0]) || null;
  // `here` is not a skip: the copy regenerates so a dialect fix (opencode's
  // mode, say) reaches copies delivered before it. Marked files are Nami's to
  // rewrite; `theirs` and `none` stay untouched as ever.
  if (!was || was.state === 'theirs' || was.state === 'none' || was.state === 'via') return was;
  // Report what delivery actually did, not what it was asked to do. Saying
  // "delivered just now" about a write that failed is the same false claim this
  // whole surface exists to avoid — and deliverAgents already answers per pair.
  //
  // It answers per pair for a refusal; a read-only folder is not a refusal but a
  // throw, straight out of writeFileSync and through the ipc call. Uncaught, it
  // would abort the launch after the overlay had closed: no session, no tile, no
  // word. The session is worth having even when the copy could not be written.
  //
  // And a throw is not evidence about *this* agent: delivery runs every master
  // against the tool in one pass, so an unrelated master's unwritable file
  // rejects the whole call while ours may well have landed. Ask the disk again
  // rather than deny a copy that is sitting there.
  let done = null;
  try { done = await api.deliverAgents({ projectPath: S.project.path, agentIds: [toolId] }); }
  catch (_) {
    try {
      const after = await api.agentDelivery({ projectPath: S.project.path, slug: item.slug, agentIds: [toolId] });
      const now = (after && after[0]) || null;
      if (now && now.state === 'here') return was;   // ours landed; the throw was somebody else's
      // A file appeared at the target that is not ours — a hand-edit between
      // the two reads, or a partial write. Whatever it is, the tool will read
      // it, so this is the `theirs` note and not the failure one.
      if (now && now.state === 'theirs') return { ...was, state: 'theirs', file: now.file };
      return { ...was, state: 'failed', file: (now && now.file) || was.file };
    } catch (_) { return { ...was, state: 'failed' }; }
  }
  const mine = (done || []).find((r) => r.slug === item.slug && r.agent === toolId);
  if (mine && mine.ok === false) return { ...was, state: mine.theirs ? 'theirs' : 'failed', file: mine.file || was.file };
  if (!mine) return { ...was, state: 'failed' };
  return was;
}

// What the session says about how it got here. Never silent about a file having
// been written, never claiming one that was not. Card notes are plain text —
// cards-dom sets textContent, deliberately.
function deliveryNote(item, toolId, was) {
  const tool = toolNameOf(toolId);
  if (!isMaster(item)) return `${item.slug} — ${tool}'s own agent, from ${shortHome(item.filePath)}.`;
  if (!was) return `${item.slug} on ${tool}.`;
  if (was.state === 'theirs') {
    return `${item.slug} on ${tool} — your own ${baseNameOf(was.file)} is there and Nami left it alone, `
      + `so this runs your file, not agents/${item.slug}.md.`;
  }
  if (was.state === 'failed') {
    return `${item.slug} could not be delivered to ${tool}${was.file ? ' at ' + shortHome(was.file) : ''} — `
      + `it will run without the agent file unless you put one there yourself.`;
  }
  if (was.state === 'soon') return `Delivered ${item.slug} to ${was.file ? shortHome(was.file) : tool} just now.`;
  return `${item.slug} on ${tool} — the copy was already there.`;
}

// A line the session keeps. On a card tile it joins the conversation, which is
// where the mockup put it and where it survives scrolling; a terminal tile has
// no conversation, so it gets the tile note instead.
function announce(p, text) {
  if (!(canShowCards(p) && cardView(p) === 'cards')) {
    setTileNote(p, `<span class="tn-tx">${esc(text)}</span>`, 'ok');
    return;
  }
  const row = { kind: 'note', id: 'agent:' + (p.noteSeq = (p.noteSeq || 0) + 1), text };
  // driveCards rebuilds cardEvents from the intro (plus Claude's backlog) the
  // moment the channel comes up, so a note pushed before that would be thrown
  // away — which is exactly when the launch notes are written. Anything said
  // before the boot rides in launchNotes and is placed by driveCards itself.
  if (!p.agentInit) p.launchNotes = (p.launchNotes || []).concat(row);
  p.cardEvents = (p.cardEvents || []).concat(row);
  scheduleFeed(p);
}

// New session. Seed, surface and title are master's `useAgent` exactly, widened
// to any installed tool: the seed rides the pty seeder, the panel is a terminal,
// and the title is the weak generic one that the first prompt later replaces.
// What is new around them is delivery and the note that reports it.
//
// An earlier draft of this launched into Cards so the master's model and mode
// could be applied at birth, which meant the seed had to move to the send queue
// and the title had to stop being generic. All three were decisions this change
// had no business making, and all three were reverted. If the recipe ever seems
// to justify picking a surface here again: it does not. driveCards applies it
// when the user chooses Cards.
function launchAgent(item, toolId) {
  closeOverlay();
  withFolder(() => reallyLaunchAgent(item, toolId), item.slug);
}
async function reallyLaunchAgent(item, toolId) {
  const worker = toolById(toolId);
  if (!worker || !worker.found) { toast(`${toolNameOf(toolId)} is not on this Mac.`); return; }
  rememberTool(item, toolId);
  const was = await ensureDelivered(item, toolId);
  // How the session becomes the agent comes from the launch table, which knows
  // two mechanics and never blurs them: flag tools (claude, opencode,
  // antigravity) launch with --agent and the session opens already being the
  // agent; seed tools (codex, kimi) get one summoning sentence typed in their
  // own idiom. Both are probe-backed — see agent-launch.mjs.
  const launch = agentLaunch(toolId, item.slug);
  // No `view`, so cardView() reads 'term' — the surface master always gave.
  // `"<Name> session"` rather than the slug, because isGenericTitle keys on
  // that word: a name Nami merely assembled has to stay weak enough for the
  // first prompt, and then Claude's own transcript name, to replace it. Calling
  // the tile `ui-polisher` froze every ⌘K session under a name nothing could
  // improve. Not agentSession(): that stamps titleSource 'flow', the rung that
  // does the freezing.
  const p = startPanel({
    kind: worker.kind === 'claude' ? 'claude' : 'run',
    command: worker.kind === 'claude' ? undefined
      : launch.kind === 'flag' ? worker.bin + ' ' + launch.argv.join(' ') : worker.bin,
    args: worker.kind === 'claude' && launch.kind === 'flag' ? [...launch.argv] : undefined,
    title: item.name + ' session', code: code2(item.name),
    seed: launch.kind === 'seed' ? launch.seed : undefined,
  });
  if (!p) return;
  // Calvin's call: a launch that went right explains nothing — the session
  // speaking as the agent is its own receipt. The note survives only where
  // silence would lie: the copy could not be written, or a hand-made file won
  // and the session is running that file, not the master.
  if (was && (was.state === 'theirs' || was.state === 'failed')) {
    announce(p, deliveryNote(item, toolId, was));
  }
}



async function openAgentPicker() {
  await loadLibrary();
  S.overlay = { type: 'agents', query: '', hi: 0, open: null, delivery: null };
  renderOverlay();
  if (!S.agents) refreshAgents().then(() => { if (S.overlay && S.overlay.type === 'agents') renderOverlay(); });
}

// The ›: where this agent's copies stand across every installed tool. Read-only
// — asking never writes.
async function openToolList(item) {
  const o = S.overlay;
  if (o.open === item.slug) { o.open = null; o.delivery = null; renderOverlay(); return; }
  o.open = item.slug; o.delivery = null; renderOverlay();
  // A non-master's list is local arithmetic — where the file sits is the whole
  // answer — so there is nothing to ask the disk.
  if (!isMaster(item) || !S.project) return;
  const rows = await api.agentDelivery({
    projectPath: S.project.path, slug: item.slug, agentIds: installedAgentIds(),
  });
  if (S.overlay && S.overlay.type === 'agents' && S.overlay.open === item.slug) {
    S.overlay.delivery = rows; renderOverlay();
  }
}

const DELIVERY_DOT = { here: '●', soon: '○', theirs: '◐', via: '●', none: '—' };
const DELIVERY_CLASS = { here: 'on', soon: 'soon', theirs: 'theirs', via: 'on', none: '' };
function deliveryLine(row) {
  if (row.state === 'here') return 'delivered · ' + shortHome(row.file);
  if (row.state === 'soon') return 'delivered as ' + baseNameOf(row.file) + ' when it launches';
  if (row.state === 'theirs') return 'your own ' + baseNameOf(row.file) + ' is here — it wins, the master stays out';
  if (row.state === 'via') return 'reads ' + toolNameOf(row.via) + "'s copy";
  return row.reason || 'runs no custom agents';
}

function toolListHtml(item) {
  const o = S.overlay;
  // Not a master: the file sits in one tool's folder and that tool is the whole
  // answer. The other rows say what would change it — a copy into agents/ —
  // which is the drawer's Copy action, not a delivery that will never happen.
  if (!isMaster(item)) {
    const reach = reachOf(item);
    const act = `<div class="tool-row co-act" data-copy role="button" tabindex="0"
        title="Copy into agents/ — becomes a master that runs on every tool">
      <span class="tl-mark">＋</span>
      <span class="tl-name">Copy to this folder</span>
      <span class="tl-note">becomes agents/${esc(item.slug)}.md and runs on every tool below</span>
      <span class="tl-dot on">›</span></div>`;
    const rows = installedAgentIds().map((id) => {
      const runs = reach.includes(id);
      return `<div class="tool-row${runs ? ' picked' : ' dead'}">
        <span class="tl-mark">${iconSvg(iconKeyFor(id) || '') || esc(code2(toolNameOf(id)))}</span>
        <span class="tl-name">${esc(toolNameOf(id))}</span>
        <span class="tl-note">${runs ? 'runs here — its own folder' : 'after the copy, runs here too'}</span>
        <span class="tl-dot ${runs ? 'on' : ''}">${runs ? '●' : '—'}</span></div>`;
    }).join('');
    return `<div class="tool-list">${act}${rows}
      <div class="tool-foot">${item.scope === 'plugin'
    ? 'The plugin\'s own file is read, never written.'
    : 'The original file is never touched.'}</div></div>`;
  }
  if (!o.delivery) return '<div class="tool-list"><div class="tool-foot">looking…</div></div>';
  const rows = o.delivery.map((r) => {
    const dead = r.state === 'none';
    return `<div class="tool-row${dead ? ' dead' : ''}${rowTool(item) === r.agent ? ' picked' : ''}"
        ${dead ? '' : `data-tool="${esc(r.agent)}" role="button" tabindex="0"`}>
      <span class="tl-mark">${iconSvg(iconKeyFor(r.agent) || '') || esc(code2(toolNameOf(r.agent)))}</span>
      <span class="tl-name">${esc(toolNameOf(r.agent))}</span>
      <span class="tl-note">${esc(deliveryLine(r))}</span>
      <span class="tl-dot ${DELIVERY_CLASS[r.state] || ''}">${DELIVERY_DOT[r.state] || '—'}</span></div>`;
  }).join('');
  return `<div class="tool-list">${rows}
    <div class="tool-foot">Copies are regenerated from <b>agents/${esc(item.slug)}.md</b>.
      Files without Nami's marker are somebody's hand work and are never touched.</div></div>`;
}

// Calvin's four sections, in ownership order — the closer to you, the higher:
// masters this folder shares, this folder's per-CLI files, the agents that
// follow you between folders, and the read-only ones that came with packs.
// Plugins is the one section that is third-party AND numerous, so it alone
// collapses; a live search opens it, because a hidden match reads as a bug.
const PICKER_SECTIONS = ['IN THIS FOLDER', 'PER MODEL', 'FROM YOUR CLIS', 'PLUGINS'];

function renderAgentPickerSheet() {
  const o = S.overlay; const agents = pickerAgents();
  const query = o.query.toLowerCase();
  const filtered = agents.filter((a) => (a.slug + ' ' + a.name + ' ' + (a.description || '')).toLowerCase().includes(query));
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">❯</span>
      <input id="ap-input" placeholder="Start a session with which agent?" value="${esc(o.query)}" /></div>
    <div class="picker-list" id="ap-list"></div>
    <div class="picker-foot"><span>click a row → a session as that agent</span>
      <span><b>›</b> → run it on another tool</span></div>`, { top: true });
  // Sections first, so the keyboard and the clicks walk the same visible list:
  // a collapsed Plugins section keeps its rows out of arrow-reach too.
  const plugOpen = !!o.plugOpen || !!query;
  const groups = [[], [], [], []];
  filtered.forEach((a) => groups[sortKey(a)].push(a));
  const visible = groups[0].concat(groups[1], groups[2], plugOpen ? groups[3] : []);
  if (o.hi > visible.length - 1) o.hi = Math.max(0, visible.length - 1);
  const input = q('#ap-input', modal); setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.query = input.value; o.hi = 0; o.open = null; renderOverlay(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const a = visible[o.hi]; const t = a && rowTool(a);
      if (a && t) launchAgent(a, t);
      // A key that does nothing reads as a broken key. The click path already
      // says why on a dead row; this says the same thing out loud.
      else if (a) toast(`Nothing installed can run ${a.slug}.`);
    }
    if (e.key === 'ArrowDown') { o.hi = Math.min(visible.length - 1, o.hi + 1); renderOverlay(); }
    if (e.key === 'ArrowUp') { o.hi = Math.max(0, o.hi - 1); renderOverlay(); }
  });
  const list = q('#ap-list', modal);
  if (!filtered.length) {
    list.innerHTML = agents.length
      ? '<div class="rail-empty" style="padding:14px">No match.</div>'
      : `<div class="rail-empty" style="padding:16px 14px"><b>No agents in this folder yet.</b><br>
        A master lives in <b>agents/&lt;name&gt;.md</b> and runs on any tool Nami can see. Make one with
        ＋ in the Library tab, or drop a file in that folder yourself.<br><br>
        Agents you keep in <b>~/.claude/agents</b> would show up here too, in every folder.</div>`;
    return;
  }
  let vi = 0;
  groups.forEach((g, gi) => {
    if (!g.length) return;
    const head = document.createElement('div');
    head.className = 'picker-sec';
    if (gi === 3) {
      head.classList.add('picker-sec--toggle');
      head.setAttribute('role', 'button'); head.tabIndex = 0;
      head.innerHTML = `<span class="sec-arr">${plugOpen ? '▾' : '▸'}</span>${PICKER_SECTIONS[3]} · ${g.length}`;
      head.onclick = () => { o.plugOpen = !o.plugOpen; renderOverlay(); };
      head.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); head.click(); } };
    } else head.textContent = PICKER_SECTIONS[gi];
    list.appendChild(head);
    if (gi === 3 && !plugOpen) return;
    g.forEach((a) => {
      const i = vi++;
      const tool = rowTool(a);
      const row = document.createElement('div');
      row.className = 'picker-row picker-row--go' + (i === o.hi ? ' hilite' : '') + (tool ? '' : ' dead');
      row.title = tool ? `Start a session as ${a.slug} on ${toolNameOf(tool)}` : 'Nothing installed can run this agent';
      row.innerHTML = `${chipHtml({ key: null, code: code2(a.slug), kind: 'agent' })}
        <span class="col"><span class="name">${esc(a.slug)}</span>
        <span class="desc">${esc(a.description || originLine(a, toolNameOf))}</span></span>
        <span class="row-tool">${tool
    ? (iconSvg(iconKeyFor(tool) || '') || '') + '<span>' + esc(toolNameOf(tool)) + '</span>'
    : '<span>no tool for it</span>'}</span>
        <span class="chev" role="button" tabindex="0" title="${isMaster(a) ? 'Run it on another tool' : 'Where this agent can run'}">›</span>`;
      row.onclick = (e) => {
        if (e.target.closest('.chev')) { openToolList(a); return; }
        if (tool) launchAgent(a, tool);
        else toast(`Nothing installed can run ${a.slug}.`);
      };
      list.appendChild(row);
      if (o.open === a.slug) {
        const wrap = document.createElement('div');
        wrap.innerHTML = toolListHtml(a);
        const block = wrap.firstElementChild;
        block.querySelectorAll('.tool-row[data-tool]').forEach((tr) => {
          tr.onclick = () => { rememberTool(a, tr.dataset.tool); o.open = null; o.delivery = null; renderOverlay(); };
          tr.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tr.click(); } };
        });
        const cp = block.querySelector('[data-copy]');
        if (cp) {
          cp.onclick = () => copyToMaster(a);
          cp.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cp.click(); } };
        }
        list.appendChild(block);
      }
    });
  });
}

// ---- create an agent or a skill (Library ＋ buttons) ------------------------
// An agent takes three steps, one decision each: where it lives, whose it is,
// what it is. A skill takes one sheet, because two of those three questions have
// no honest answer for it — its content is identical whichever agent follows it,
// and it can only be announced to agents that open this folder. See
// renderCreateSkill below.
//
// Same overlay type throughout, so the sheet holds its place and does not replay
// its entrance between steps. State lives on S.overlay and the sheet is rebuilt
// on every change, so inputs must be flushed into it before any re-render — same
// discipline as the connect flow.
// One screen for everything. The brand question died with the drawers: a new
// agent is a master in agents/ (Builds 1–2 made that the answer), a new skill
// is a folder in skills/ — nothing left to ask but "what is it?".
function openCreate(kind) {
  S.overlay = { type: 'create', kind, platform: kind === 'agent' ? 'project' : 'claude',
    scope: 'project', name: '', desc: '' };
  renderOverlay(); if (!S.agents) refreshAgents();
}
function createHeadHtml(o) {
  return `<div class="picker-input"><span class="prompt-mark">＋</span>
    <span style="font-weight:700">New ${esc(o.kind)}</span>
    <span class="ni-step">one screen</span></div>`;
}
function renderCreateSheet() { return renderCreateStep3(S.overlay); }
// Who ends up knowing about a new skill or agent. Every installed agent,
// always — there is no good reason to leave one out, and a checklist whose
// boxes are all ticked by default is a decision with an obvious answer, which
// is a tax. Opting one out is a property of the project, not of each item.
// Skills are announced (AGENTS.md); agents are delivered as copies — and
// Hermes, which runs no custom agents, is named rather than implied.
function knowsLine(kind) {
  const canUse = (a) => a.found && (kind !== 'agent' || a.id !== 'hermes');
  const names = (S.agents || []).filter(canUse).map((a) => a.name);
  if (!names.length) return '';
  const list = names.length === 1 ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  if (kind === 'agent') {
    const hermes = (S.agents || []).some((a) => a.found && a.id === 'hermes');
    return `${esc(list)} will all know — Nami keeps each one's copy fresh${hermes ? ' · Hermes doesn’t run agents' : ''}`;
  }
  return `${esc(list)} will all know — it goes in <b>AGENTS.md</b>${stubCount() ? ` + ${stubCount()} stub${stubCount() > 1 ? 's' : ''}` : ''}`;
}
function stubCount() {
  const found = new Set((S.agents || []).filter((a) => a.found).map((a) => a.id));
  return ['claude', 'gemini'].filter((id) => found.has(id)).length;
}
function renderCreateStep3(o) {
  const worker = chosenAgent(o);
  // the path already says which platform and whose it is — repeating them just wraps the line
  const dir = shortHome(targetDirFor({ type: o.kind, platform: o.platform, scope: o.scope, projectPath: S.project && S.project.path }));
  const skill = o.kind === 'skill';
  const modal = overlay('picker-box', `${createHeadHtml(o)}
    <div class="ni-ask">What is it?</div>
    <div class="ni-row"><span class="lbl">Name</span>
      <input id="ni-name" placeholder="leave it blank and your agent names it" value="${esc(o.name)}" /></div>
    <div class="ni-row"><span class="lbl">What</span>
      <input id="ni-desc" placeholder="e.g. keeps the README honest after a batch of features lands" value="${esc(o.desc)}" /></div>
    <div class="ni-where">it lands in <b>${esc(dir)}</b></div>
    ${knowsLine(o.kind) ? `<div class="ni-where ni-knows">${knowsLine(o.kind)}</div>` : ''}
    <div class="ni-agent" style="margin:10px 18px 0">${worker
      ? `a new session with <select class="agent-pick" id="ni-agent-sel">${agentOptionsHtml(worker.id)}</select> builds it with you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="ni-row ni-actions"><button class="btn btn--go" id="ni-create" ${worker ? '' : 'disabled'}>Build it with my agent</button>
      <span class="action" id="ni-blank" role="button" tabindex="0">write it myself</span></div>`, { top: true });
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
    if (!S.project) { toast(`Open a folder first — ${skill ? 'skills' : 'agents'} live in the project.`); return; }
    const seed = buildCreateSeed({ type: o.kind, platform: o.platform, scope: o.scope, name: o.name, desc: o.desc, projectPath: S.project && S.project.path });
    closeOverlay();
    // The agent writes the file, so the follow-through can only run afterwards.
    // On exit is the honest moment; and if the session never exits, the rail
    // still shows the item, just not yet announced or delivered.
    const onExit = o.kind === 'skill'
      ? () => { loadLibrary(true); api.pointerWrite({ dir: S.project.path, agentIds: installedAgentIds() }).then(() => refreshPointer(true)); }
      : () => { loadLibrary(true); api.deliverAgents({ projectPath: S.project.path, agentIds: installedAgentIds() }); };
    agentSession(w, { title: 'build: ' + (o.name.trim() || o.kind), code: 'BD', seed, onExit });
    toast('Your agent has a few questions first — check the new tile.');
  };
  const blankLink = q('#ni-blank', modal);
  blankLink.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); blankLink.onclick(); } });
  blankLink.onclick = async () => {
    keep();
    if (!o.name.trim()) { toast('Give it a name first.'); return; }
    if (!S.project) { toast(`Open a folder first — ${skill ? 'skills' : 'agents'} live in the project.`); return; }
    const res = await api.libraryCreate({ projectPath: S.project.path, type: o.kind, platform: o.platform, scope: o.scope, name: o.name.trim(), agentIds: installedAgentIds() });
    if (!res.ok) { toast(res.error || 'Could not create'); return; }
    closeOverlay();
    // An item nobody has been told about is just a file. Announce or deliver
    // in the same breath as writing it, or "write it myself" leaves you half done.
    if (o.kind === 'skill') {
      const w = await api.pointerWrite({ dir: S.project.path, agentIds: installedAgentIds() });
      toast(w && w.ok ? `Created ${o.name.trim()} — ${(w.written || []).length ? w.written.join(', ') + ' updated' : 'already announced'}.` : 'Created ' + o.name.trim());
      refreshPointer(true);
    } else {
      const copies = (res.delivered || []).filter((r) => r.ok && r.file).length;
      toast(`Created ${o.name.trim()}${copies ? ` — ${copies} ${copies === 1 ? 'copy' : 'copies'} delivered` : ''}.`);
    }
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
    // An improved master must reach every tool's copy the moment the session
    // ends — the same on-exit rhythm the skills pointer uses.
    const onExit = item.type === 'agent' && item.platform === 'project' && S.project
      ? () => { loadLibrary(true); api.deliverAgents({ projectPath: S.project.path, agentIds: installedAgentIds() }); }
      : undefined;
    agentSession(w, { title: 'improve: ' + item.slug, code: 'IM', seed:
      buildImproveSeed({ platform: item.platform, type: item.type, filePath: item.filePath, ask: o.text }), onExit });
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
  if (o.type === 'folder-first') return renderFolderFirst();
  if (o.type === 'peek') return renderPeek();
  if (o.type === 'agent-setup') return renderAgentSetup();
  if (o.type === 'agent-remove') return renderAgentRemove();
  if (o.type === 'agents') return renderAgentPickerSheet();
  if (o.type === 'create') return renderCreateSheet();
  if (o.type === 'connect') return renderConnectCatalog();
  if (o.type === 'connect-form') return renderConnectForm();
  if (o.type === 'connect-done') return renderConnectDone();
  if (o.type === 'connect-custom') return renderConnectCustom();
  if (o.type === 'connect-own') return renderConnectOwn();
  if (o.type === 'improve-item') return renderImproveItem();
  if (o.type === 'fs-name') return renderFsName();
  if (o.type === 'switch-folder') return renderSwitchChoice();
  if (o.type === 'settings') return renderSettings();
  if (o.type === 'quickstart') return renderQuickStart();
}
function closeOverlay() { S.overlay = null; renderOverlay(); }

// ===========================================================================
//  Settings — the one place the app explains how it behaves
// ===========================================================================
const SET_SECTIONS = [
  { id: 'voice', name: 'Voice', lead: 'how Nami hears you' },
  { id: 'look', name: 'Look', lead: 'how Nami looks on this desk' },
  { id: 'keys', name: 'Keys', lead: 'keys every session can use' },
  { id: 'about', name: 'About', lead: 'about this copy of Nami' },
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
        sec.id === 'voice' ? voicePaneHtml()
          : sec.id === 'look' ? lookPaneHtml()
            : sec.id === 'about' ? aboutPaneHtml() : keysPaneHtml()}</div>
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
  if (sec.id === 'about') wireAboutPane(modal);
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
  // Ready on a key Nami never saved means the key arrived on the environment
  // this run was launched with. That is true right now and worth saying, but it
  // is not durable: user-path.js merges the login shell's PATH into a Dock
  // launch and nothing else, so from the Dock the variable is absent and this
  // same provider reports "no API key". Saying only "ready" is what made Voice
  // and Keys look like they disagreed about the same key.
  if (p.ready && p.needsKey && !p.keySaved) return 'ready · from your shell';
  if (p.ready) return 'ready';
  if (p.downloadBytes) return mb(p.downloadBytes) + ' to download';
  return p.reason || 'not set up';
}
function mb(bytes) { return Math.round(bytes / 1e6) + ' MB'; }

// What a download is doing, said in the units the event actually carries.
// stt-model counts FILES: { phase: 'download', done: 3, total: 7 }. This used
// to read that 7 as a byte total and print `mb(0) of mb(7)` — "0 MB of 0 MB",
// for the entire download, alongside a `loaded` field that has never existed.
// Real byte progress would mean streaming each file against its content-length;
// it is not worth it here, because two of the seven files are ~95% of the bytes,
// so a byte counter would stall twice for a long time and say less than this.
// Returns null when there is nothing to say, so the caller leaves the note as is.
function dlProgressText(ev) {
  if (!ev) return null;
  if (ev.phase === 'load') return 'Getting the model ready…';
  if (!ev.total) return null;
  return `${ev.done || 0} of ${ev.total} files…`;
}

// The picked row is the only one that opens: a pointer to the Keys tab when the
// key is missing, or a download button. Keys are typed in exactly one place —
// the Keys tab — so a ready provider shows nothing extra at all.
function voiceRowBodyHtml(p) {
  if (p.needsKey && !p.ready) {
    return `<div class="set-opt-body"><div class="setup-note">needs your ${esc(p.keyEnv)} —
        <span class="sv-help go-keys" data-keyenv="${esc(p.keyEnv)}">add it in Keys</span></div>
      ${p.keyHelpUrl ? `<div class="sv-help" data-url="${esc(p.keyHelpUrl)}">where do I find my key?</div>` : ''}</div>`;
  }
  // Usable, but on a key Nami is not holding. The row says where it came from
  // and what would make it survive the next launch.
  if (p.needsKey && p.ready && !p.keySaved) {
    return `<div class="set-opt-body"><div class="setup-note">Working from ${esc(p.keyEnv)} in the environment Nami was started in.
        Open Nami from the Dock and it will not be there.
        <span class="sv-help go-keys" data-keyenv="${esc(p.keyEnv)}">Save it in Keys</span> to make it stick.</div></div>`;
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
      const line = dlProgressText(ev);
      if (note && line) note.textContent = line;
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

// ---- About — which copy is this, and is it behind? -------------------------
// The version was nowhere in the app, which made two builds of the same number
// indistinguishable from inside it. The date is when this copy landed in
// Applications, not when it was compiled: the same release installs on two
// machines weeks apart, and "when did I last update" is the question people
// actually ask.
//
// Checking by hand matters beyond reassurance. Dismissing the update bar writes
// that version off for good (see SKIPPED_UPDATE below), and until now there was
// no way back to it. Pressing the button clears the mark.
const REPO_URL = 'https://github.com/mrdainami/nami';
// The doc pages the quick start points at. One page per row, so a reader lands
// on the answer to the row they pressed rather than on a contents page they
// then have to search. Kept next to REPO_URL so every outward link Nami has is
// read in one place.
const DOCS = {
  start: 'https://nami.dainami.ai/docs/start/',
  pickAgent: 'https://nami.dainami.ai/docs/pick-an-agent/',
  examples: 'https://nami.dainami.ai/docs/examples/',
  permissions: 'https://nami.dainami.ai/docs/permissions/',
};
// Where the app sends people who want the person rather than the program.
//
// Nami has no telemetry and is not getting any — "nothing leaves your Mac" is
// one of the three reasons anyone trusts it, and it cannot be un-spent. So the
// UTM is the entire measurement story: it costs nothing, it is visible to
// anyone who reads the link, and dainami.ai's own analytics reads it at the
// other end. `where` names the surface, so "does the empty desk ever get
// clicked" has an answer without a single byte leaving the machine.
//
// GitHub links stay bare on purpose: there is no analytics there to read them.
const makerUrl = (where) => `https://dainami.ai/links?utm_source=nami-app&utm_medium=${where}`;
const teamsUrl = (where) => `https://dainami.ai/?utm_source=nami-app&utm_medium=${where}&utm_campaign=teams`;
function updatedOn(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  // hour12 forced: the machine's locale decides otherwise, and "18:55" next to a
  // handwritten heading reads as a log line rather than a date on a page.
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase().replace(/\s+/g, '');
  return `updated ${day} at ${time}`;
}
// Four states, and the difference between the last two is the whole point:
// GitHub said no, versus GitHub never answered.
function aboutLine(a) {
  if (!a || !a.state) return { dot: 'off', text: 'Not checked yet', act: 'Check now' };
  if (a.state === 'checking') return { dot: 'off', text: 'Checking…', act: 'Check now', busy: true };
  // a.latest is the one on offer; a.version stays the one running
  if (a.state === 'update') return { dot: 'new', text: `Nami ${a.latest} is out`, act: 'Download', get: a.url };
  if (a.state === 'offline') return { dot: 'off', text: "Couldn't reach GitHub", act: 'Try again' };
  return { dot: 'ok', text: 'Up to date', act: 'Check now' };
}
function aboutPaneHtml() {
  const a = (S.overlay && S.overlay.about) || null;
  const version = (a && a.version) || S.version || '';
  const line = aboutLine(a);
  const notes = version ? `${REPO_URL}/releases/tag/v${encodeURIComponent(version)}` : `${REPO_URL}/releases`;
  return `<div class="ab-name">Nami${version ? ' ' + esc(version) : ''}</div>
    <div class="ab-built">${esc(updatedOn((a && a.updatedAt) || S.updatedAt) || 'this copy')}</div>
    <hr class="ab-rule" />
    <div class="ab-state">
      <span class="ab-status"><span class="ab-dot ab-dot--${line.dot}"></span>${esc(line.text)}</span>
      <button class="btn" id="ab-act"${line.busy ? ' disabled' : ''}>${esc(line.act)}</button>
    </div>
    <div class="ab-star">
      <button class="btn btn--go" data-url="${REPO_URL}">★ Star Nami on GitHub</button>
    </div>
    <div class="ab-links">
      <a class="ab-link" href="#" data-url="${esc(notes)}">What's new${version ? ' in ' + esc(version) : ''} <span class="arr">↗</span></a>
      <a class="ab-link" href="#" data-url="${REPO_URL}">Source on GitHub <span class="arr">↗</span></a>
      <a class="ab-link" href="#" data-url="${REPO_URL}/blob/master/LICENSE">MIT licence <span class="arr">↗</span></a>
    </div>
    <hr class="ab-rule" />
    <div class="ab-made">Made by <a class="ab-link" href="#" data-url="${makerUrl('about')}">Cal</a>, in Nami.</div>
    <div class="ab-copy">© 2026 Dainami AI · MIT licensed</div>
    <div class="ab-team">
      <button class="btn btn--quiet" data-url="${teamsUrl('about')}">Want Nami for your team? →</button>
    </div>`;
}
function wireAboutPane(modal) {
  const o = S.overlay;
  // [data-url] rather than .ab-link[data-url]: the star and team buttons carry
  // the same attribute, and a selector that only matched the text links would
  // have left both of them silently dead.
  modal.querySelectorAll('[data-url]').forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); api.openUrl(el.dataset.url); };
  });
  const act = q('#ab-act', modal);
  if (!act) return;
  act.onclick = async () => {
    const a = o.about;
    // Downloading from here is the same download as the bar's, not a second
    // one: re-arm the bar with what the pane is showing and let the progress
    // land there, so closing Settings does not lose sight of it.
    if (a && a.state === 'update' && a.url) {
      offered = { version: a.latest, url: a.url };
      paintUpdate('downloading', { percent: 0, version: a.latest });
      await api.downloadUpdate();
      return;
    }
    o.about = { ...(a || {}), state: 'checking' };
    renderOverlay();
    const res = await api.updateStatus();
    // Asking by hand un-dismisses: whatever was waved away before is fair game
    // again, or the bar could never come back for that version.
    if (res && res.state === 'update') localStorage.removeItem(SKIPPED_UPDATE);
    if (isSettingsOpen()) { S.overlay.about = res || { state: 'offline' }; renderOverlay(); }
  };
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
    <div class="svc-custom" id="svc-own" tabindex="0">
      <span class="code" data-kind="service">＋</span>
      <span class="col"><span class="sv-name">Already have one? Add it yourself</span>
      <span class="sv-desc">paste an address or command — or choose a .mcpb bundle file</span></span>
      <span class="sv-go">add it →</span>
    </div>
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
  q('#svc-own', modal).onclick = () => openConnectOwn();
  clickOnEnter(q('#svc-own', modal));
}
// The "already have it" door: an address, a command line, or a .mcpb bundle.
// All three end as one master entry, delivered everywhere — same as the catalog.
function openConnectOwn() {
  S.overlay = { type: 'connect-own', name: '', address: '', scope: 'project', values: {}, bundle: null };
  renderOverlay(); if (!S.agents) refreshAgents();
}
function renderConnectOwn() {
  const o = S.overlay;
  const b = o.bundle;
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" data-kind="service">＋</span>
      <span class="col"><span class="name">Add your own</span><span class="desc">an address, a command, or a bundle file</span></span></div>
    ${b ? `<p class="setup-copy"><b>${esc(b.name)}</b>${b.version ? ' · v' + esc(b.version) : ''} — ${esc(b.description || 'unpacked and ready')}</p>`
        : `<p class="setup-copy">Paste what the service gave you — a URL (https://…) or the command line from its README.</p>`}
    <div class="frow" style="display:flex;gap:10px;align-items:baseline;margin:0 0 10px"><span class="sv-lab" style="width:64px;flex:none">Name</span>
      <input class="text-input" id="own-name" style="flex:1" placeholder="what your agents should call it" spellcheck="false" /></div>
    ${b ? '' : `<div class="frow" style="display:flex;gap:10px;align-items:baseline;margin:0 0 10px"><span class="sv-lab" style="width:64px;flex:none">It is</span>
      <input class="text-input" id="own-addr" style="flex:1" placeholder="https://mcp.example.com/mcp  ·  or:  npx -y some-mcp-server" spellcheck="false" /></div>`}
    ${(b ? b.fields : []).map((f) => `<div class="frow" style="display:flex;gap:10px;align-items:baseline;margin:0 0 10px"><span class="sv-lab" style="width:64px;flex:none">${esc(f.label)}</span>
      <input class="text-input own-field" data-k="${esc(f.id)}" style="flex:1" type="${f.sensitive ? 'password' : 'text'}" placeholder="${esc(f.description || (f.default ? 'default: ' + f.default : ''))}" spellcheck="false" /></div>`).join('')}
    ${svcKnowsLine() ? `<div class="setup-note">${svcKnowsLine()}</div>` : ''}
    <div class="chip-row" id="own-scope" style="margin:8px 0">
      <span class="pick-chip${o.scope === 'project' ? ' picked' : ''}" data-v="project">this project</span>
      <span class="pick-chip${o.scope === 'user' ? ' picked' : ''}" data-v="user">everywhere on this Mac</span></div>
    <div class="setup-actions">
      <button class="btn btn--go" id="own-go">Connect</button>
      ${b ? '<button class="btn" id="own-clear">Different bundle</button>' : '<button class="btn" id="own-bundle">Choose a bundle…</button>'}</div>`);
  const nameIn = q('#own-name', modal), addrIn = q('#own-addr', modal);
  nameIn.value = o.name; if (addrIn) addrIn.value = o.address;
  const keep = () => {
    o.name = nameIn.value; if (addrIn) o.address = addrIn.value;
    modal.querySelectorAll('.own-field').forEach((inp) => { o.values[inp.dataset.k] = inp.value.trim(); });
  };
  nameIn.oninput = keep; if (addrIn) addrIn.oninput = keep;
  modal.querySelectorAll('.own-field').forEach((inp) => { inp.value = o.values[inp.dataset.k] || ''; inp.oninput = keep; });
  q('#own-scope', modal).querySelectorAll('.pick-chip').forEach((chip) => { chip.onclick = () => { keep(); o.scope = chip.dataset.v; renderOverlay(); }; });
  const pickBtn = q('#own-bundle', modal);
  if (pickBtn) pickBtn.onclick = async () => {
    keep();
    const res = await api.pickBundle();
    if (!res) return;
    if (!res.ok) { toast(res.error || 'Could not read that bundle.'); return; }
    o.bundle = res;
    if (!o.name.trim()) o.name = res.name || res.slug;
    renderOverlay();
  };
  const clearBtn = q('#own-clear', modal);
  if (clearBtn) clearBtn.onclick = () => { o.bundle = null; o.values = {}; renderOverlay(); };
  q('#own-go', modal).onclick = async () => {
    keep();
    if (!o.name.trim()) { toast('Give it a name first.'); return; }
    if (!b && !o.address.trim()) { toast('Paste an address or command first — or choose a bundle.'); return; }
    const missing = b ? b.fields.filter((f) => f.required && !o.values[f.id]) : [];
    if (missing.length) { toast(`Fill in ${missing[0].label} first.`); return; }
    q('#own-go', modal).textContent = 'Connecting…';
    const res = await api.connectCustom({
      name: o.name, address: o.address, values: o.values, bundleDir: b && b.dir,
      scope: o.scope, agentIds: installedAgentIds(), projectPath: S.project && S.project.path,
    });
    refreshServices(); loadLibrary(true);
    S.overlay = { type: 'connect-done', svc: { name: o.name.trim(), code: '＋', desc: 'your own connection' }, result: res };
    renderOverlay();
  };
}
function openConnectForm(svc) { S.overlay = { type: 'connect-form', svc, scope: 'project', values: {} }; renderOverlay(); }
// Who ends up seeing a new connection: every installed agent, always — the same
// no-checklist reasoning as knowsLine() for skills. Hermes is the honest
// exception; its config is hand-owned, so it is named rather than implied.
function svcKnowsLine() {
  const names = (S.agents || []).filter((a) => a.found && a.id !== 'hermes').map((a) => a.name);
  if (!names.length) return '';
  const list = names.length === 1 ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  const hermes = (S.agents || []).some((a) => a.found && a.id === 'hermes');
  return esc(list) + ' will all be able to use it' + (hermes ? ' — Hermes keeps its own list (`hermes mcp`)' : '');
}
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
    ${svcKnowsLine() ? `<div class="setup-note">${svcKnowsLine()}</div>` : ''}
    <details class="sv-fold"${o.foldOpen ? ' open' : ''}><summary>choices (fine as they are)</summary>
      <div class="sv-fold-body">
        <div class="sv-lab">works in</div>
        <div class="chip-row" id="sv-scope">
          <span class="pick-chip${o.scope === 'project' ? ' picked' : ''}" data-v="project">this project</span>
          <span class="pick-chip${o.scope === 'user' ? ' picked' : ''}" data-v="user">everywhere on this Mac</span></div>
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
    q('#sv-connect', modal).textContent = 'Connecting…';
    const res = await api.connectService({ id: svc.id, values: o.values, scope: o.scope, agentIds: installedAgentIds(), projectPath: S.project && S.project.path });
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
    // The agent registers into the master; Nami fans it out when the session
    // ends — the same rhythm as agent- and skill-building sessions.
    const onExit = S.project
      ? () => { refreshServices(); api.deliverServices({ projectPath: S.project.path, agentIds: installedAgentIds() }).then(() => refreshServices()); }
      : undefined;
    agentSession(w, { title: 'build: connector', code: 'BC', seed:
      `Build an MCP connector for this: ${o.text.trim()}. When it works, register it for this project by adding one entry to connections.json at the project root, under the standard "mcpServers" key (create the file if it is missing) — Nami copies it to every installed agent's own config from there. Then tell me what tools it exposes.`, onExit });
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
// ---- quick start -----------------------------------------------------------
//
// The one place in the window that answers "what is this and what do I do now".
// Nami had no such place: the Help menu is five outbound links, and the person
// this is for does not look in the menu bar.
//
// A checklist, not a tour. Coach marks have to be maintained across four themes
// and every layout change, they get skipped, and they teach before anyone has a
// reason to care — VS Code and Zed both landed on a resumable list instead.
// Every button here does the real thing rather than describing it, and rows
// tick off as they are done so leaving and coming back keeps your place.
// The Supademo walk-throughs the rows link to. Empty until each one is
// recorded, and a row only grows its Watch button once its URL is filled in —
// a "▶ Watch · 2 min" that plays nothing is a worse promise than no button.
// Paste a URL here and the button appears; nothing else needs touching.
const DEMOS = {
  'getting-started': '',   // first launch → folder → agent → first ask → approve
  'a-real-job': '',        // plain English in, two panes running, a file out
};
const QS_DONE = 'nami-quickstart-done';
function qsDone() {
  try { return new Set(JSON.parse(localStorage.getItem(QS_DONE) || '[]')); } catch { return new Set(); }
}
function qsMark(n) {
  const done = qsDone(); done.add(n);
  try { localStorage.setItem(QS_DONE, JSON.stringify([...done])); } catch { /* private mode */ }
}
function openQuickStart() { S.overlay = { type: 'quickstart' }; renderOverlay(); }

function quickStartRows() {
  return [
    {
      n: 1, title: 'Pick one folder to work in',
      sub: 'Nami only ever looks inside it. No folder yet? It will make you one.',
      done: !!S.project,
      acts: S.project ? [] : [{ label: 'Make me a folder', go: true, run: () => { closeOverlay(); makeFolderDialog(); } }],
    },
    {
      n: 2, title: 'Press New session and pick who runs it',
      sub: 'The list shows what is on your Mac. Anything missing installs from the same list.',
      acts: [
        { label: 'New session ⌘N', go: true, run: () => { closeOverlay(); openLauncher(); } },
        { label: '▶ Watch · 2 min', play: 'getting-started' },
      ],
    },
    {
      n: 3, title: 'Nami can run multiple agents for you',
      sub: 'Claude Code signs in with your Claude account, Codex with your ChatGPT one. No Nami account, no second bill.',
      acts: [{ label: 'Which should I pick?', run: () => api.openUrl(DOCS.pickAgent) }],
    },
    {
      n: 4, title: 'Say what you need, in plain English',
      sub: 'No commands to learn. Here are twelve things people actually ask for.',
      acts: [
        { label: 'See 12 examples', run: () => api.openUrl(DOCS.examples) },
        { label: '▶ Watch · 60s', play: 'a-real-job' },
      ],
    },
    {
      n: 5, title: 'It asks before it does anything real',
      sub: 'An amber “Needs your OK” card means it is waiting on you. Nothing happens behind your back.',
      acts: [{ label: 'How permissions work', run: () => api.openUrl(DOCS.permissions) }],
    },
  ];
}

function renderQuickStart() {
  const done = qsDone();
  const rows = quickStartRows();
  const body = rows.map((r) => {
    const ticked = r.done || done.has(r.n);
    // A demo that has not been recorded yet simply is not offered.
    const shown = r.acts.filter((a) => !a.play || DEMOS[a.play]);
    const acts = shown.length
      ? `<div class="qs-acts">${shown.map((a) =>
          `<button class="qs-mini${a.go ? ' qs-mini--go' : ''}${a.play ? ' qs-mini--play' : ''}" data-row="${r.n}" data-act="${r.acts.indexOf(a)}">${esc(a.label)}</button>`).join('')}</div>`
      : '';
    return `<div class="qs-row"${ticked ? ' data-done' : ''}>
      <div class="qs-n">0${r.n}</div>
      <div><div class="qs-t">${esc(r.title)}</div>
      <div class="qs-s">${esc(r.sub)}</div>${acts}</div></div>`;
  }).join('');

  const modal = overlay('qs-box', `<div class="qs-head"><span class="title">Quick start</span></div>
    <div class="qs-body">${body}</div>
    <div class="qs-foot"><span>Stuck? <a class="qs-link" href="#" data-url="${REPO_URL}/issues">Ask on GitHub</a></span>
    <a class="qs-link" href="#" data-url="${DOCS.start}">Full guide ↗</a></div>`, { top: true });

  modal.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      const row = rows.find((r) => r.n === +b.dataset.row);
      const act = row && row.acts[+b.dataset.act];
      if (!act) return;
      qsMark(row.n);
      if (act.play) { api.openUrl(DEMOS[act.play]); return; }
      act.run();
    };
  });
  modal.querySelectorAll('.qs-link[data-url]').forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); api.openUrl(el.dataset.url); };
  });
}

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
  // The pointer belongs to a folder, so the old folder's answer must not be
  // shown against the new one — clear it and let the next scan refill it.
  S.pointer = null;
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

// What the bar is currently saying. `offered` is what update-check found, and
// survives every repaint — the failure state needs its url to fall back to a
// browser, and the progress events do not carry one.
let offered = null;

function offerUpdate(info, initial) {
  if (!info || !info.version || !els.updateRoot) return;
  // Dismissing is per version, and it sticks. Re-asking every six hours for
  // something already refused is how an update prompt becomes wallpaper.
  if (localStorage.getItem(SKIPPED_UPDATE) === info.version) return;
  offered = info;
  // A window opened while a download was already running joins it in progress
  // rather than offering to start a second one.
  //
  // `staged` is the case that used to be lost entirely: a download finished in
  // some earlier run and was never installed, and nothing in the app knew it
  // was there — so the bar offered to fetch 166 MB that was already on disk,
  // and quitting did nothing, forever. A file waiting is a ready update.
  // `state` is always set, so staged has to be asked about on its own — as a
  // fallback for the idle case, never as an override of a live download.
  let at = (initial && initial.state) || 'idle';
  if (at === 'idle' && initial && initial.staged) at = 'ready';
  paintUpdate(at === 'downloading' ? 'downloading' : at === 'ready' ? 'ready' : 'idle', {});
}

// One function, four states, because they are the same card saying different
// things — and because a repaint from an event that arrives after the user
// dismissed the bar must not bring it back. `offered` being null means the bar
// is closed, and every state respects that.
function paintUpdate(state, ev) {
  if (!offered || !els.updateRoot) return;
  const version = esc((ev && ev.version) || offered.version);
  const close = () => { els.updateRoot.innerHTML = ''; offered = null; };

  if (state === 'downloading') {
    const pct = Math.max(0, Math.min(100, Number((ev && ev.percent) || 0)));
    els.updateRoot.innerHTML = `<div class="update-note">
      <span class="un-dot"></span>
      <span class="un-msg">getting Nami ${version}…</span>
      <span class="un-bar"><span class="un-fill" style="width:${pct}%"></span></span>
      <span class="un-pct">${pct}%</span>
    </div>`;
    return;
  }

  if (state === 'ready') {
    // There is a button now, and there did not used to be. Waiting for a quit
    // was the whole design — an update should never end a session somebody is
    // in the middle of — but on a real machine it lost every time: the app
    // takes its time closing, Squirrel waits for it, and reopening Nami inside
    // that window cancels the install with nothing said. So the wait stays as
    // the quiet default and this is the way to make it happen on purpose.
    els.updateRoot.innerHTML = `<div class="update-note">
      <span class="un-dot un-done"></span>
      <span class="un-msg">Nami ${version} is ready</span>
      <button class="un-act" id="uc-now">install now</button>
      <span class="un-sep">·</span>
      <button class="un-act un-quiet" id="uc-ok">on quit</button>
    </div>`;
    q('#uc-ok', els.updateRoot).onclick = close;
    q('#uc-now', els.updateRoot).onclick = async () => {
      // Ask main rather than counting tiles: sessions belong to other windows
      // too, and this window can only see its own.
      let live = 0;
      try { live = await api.liveSessions(); } catch (_) {}
      if (live > 0) return paintUpdate('confirm', { version: (ev && ev.version) || offered.version, live });
      await api.installUpdate();
    };
    return;
  }

  // The one warning this feature owes anybody. Installing restarts Nami, and
  // restarting ends every session — so when there is work in flight, say what
  // will be lost and make them say yes to it.
  if (state === 'confirm') {
    const live = Number((ev && ev.live) || 0);
    els.updateRoot.innerHTML = `<div class="update-note">
      <span class="un-dot"></span>
      <span class="un-msg">${live} session${live === 1 ? '' : 's'} running — installing stops ${live === 1 ? 'it' : 'them'}</span>
      <button class="un-act" id="uc-yes">install anyway</button>
      <span class="un-sep">·</span>
      <button class="un-act un-quiet" id="uc-no">not now</button>
    </div>`;
    q('#uc-yes', els.updateRoot).onclick = async () => { await api.installUpdate(); };
    q('#uc-no', els.updateRoot).onclick = () => paintUpdate('ready', ev);
    return;
  }

  // idle, and failed. They differ only in what the button does: before anything
  // has gone wrong it downloads in place, and afterwards it hands the dmg to a
  // browser, which is exactly what 0.1.3 did.
  const broke = state === 'failed';
  els.updateRoot.innerHTML = `<div class="update-note">
    <span class="un-dot"></span>
    <span class="un-msg">${broke ? `Nami ${version} has to be installed by hand` : `Nami ${version} is out`}</span>
    <button class="un-act" id="uc-get">download</button>
    <span class="un-sep">·</span>
    <button class="un-act un-quiet" id="uc-later">not now</button>
  </div>`;

  q('#uc-get', els.updateRoot).onclick = async () => {
    if (broke) { await api.openUpdate(offered.url); close(); return; }
    // Everything after this arrives as an event: progress, then ready, or
    // failed — at which point this same bar comes back offering the browser.
    await api.downloadUpdate();
  };
  q('#uc-later', els.updateRoot).onclick = () => {
    localStorage.setItem(SKIPPED_UPDATE, offered.version);
    close();
  };
}

// ===========================================================================
//  The one time Nami asks for anything
// ===========================================================================
// Nami is free, and the only thing that helps anyone find it is a star. But the
// app has no account, no telemetry and no way to reach the person using it —
// which is the point — so the ask has to happen here, and it gets exactly one
// chance. Once. Dismissed is forever, same as a skipped update.
//
// Counted in launches rather than sessions on purpose. Five sessions can all
// happen in one sitting on the first afternoon, when nobody owes you anything
// yet; five separate launches means somebody came back, which is the only
// evidence available that Nami earned its place. Nothing is sent anywhere to
// learn this — it is a number in localStorage on one machine.

const STAR_ASKED = 'nami-star-asked';
const LAUNCH_TALLY = 'nami-launches';
const ASK_AFTER_LAUNCHES = 5;
// Long enough that the bar is never part of the app opening. Someone who just
// launched Nami is going somewhere; this waits until they have arrived.
const ASK_AFTER_MS = 90_000;

function tallyLaunch() {
  const n = Number(localStorage.getItem(LAUNCH_TALLY) || 0) + 1;
  // Stop counting once it is moot, so the number cannot grow without bound.
  if (n <= ASK_AFTER_LAUNCHES) localStorage.setItem(LAUNCH_TALLY, String(n));
  return n;
}

// Pure, so the rules are testable without a DOM: asked already, or not enough
// launches, means never.
function starAskDue({ asked, launches }) {
  if (asked) return false;
  return Number(launches) >= ASK_AFTER_LAUNCHES;
}

function closeStarAsk() {
  // Clicked or waved away, it makes no difference: both are an answer, and
  // asking a second time is how a request becomes a nag.
  localStorage.setItem(STAR_ASKED, '1');
  if (els.updateRoot) els.updateRoot.innerHTML = '';
}

function paintStarAsk() {
  // An update is always the more important thing in this slot, and it must
  // never be displaced by a favour. If one is showing, the moment has passed.
  if (!els.updateRoot || offered || localStorage.getItem(STAR_ASKED)) return;
  // Green, not amber: amber in Nami means *needs you*, and this does not.
  els.updateRoot.innerHTML = `<div class="update-note">
    <span class="un-dot un-done"></span>
    <span class="un-msg un-ask">Enjoying Nami? A star helps other people find it.</span>
    <button class="un-act" id="star-go">★ Star it</button>
    <span class="un-sep">·</span>
    <button class="un-act un-quiet" id="star-no">no thanks</button>
  </div>`;
  q('#star-go', els.updateRoot).onclick = () => { api.openUrl(REPO_URL); closeStarAsk(); };
  q('#star-no', els.updateRoot).onclick = closeStarAsk;
}

// Called once at boot. A demo or screenshot run counts nothing — those launches
// are not a person coming back to the app.
function armStarAsk() {
  if (S.demo) return;
  const launches = tallyLaunch();
  if (!starAskDue({ asked: localStorage.getItem(STAR_ASKED), launches })) return;
  setTimeout(paintStarAsk, ASK_AFTER_MS);
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
