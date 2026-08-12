// Nami — Electron main process.
// Owns: the window, PTY terminal sessions, agent sessions (via agent-session),
// the open folder + its .claude scan, restart-proof state, and all IPC.

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, protocol, net } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { resolveClaudeExecutable } = require('./adapters/claude-sdk.js');
const { AgentSessions, claudeTranscript } = require('./agent-session.js');
const { claudeSpawnArgs, projectSlug } = require('./claude-args');
const { readTailTitle } = require('./session-title');
const { readFrom, tailStart } = require('./transcript-tail.js');
const { parseTranscript } = require('./transcript-events.js');
const { feedOscTitle } = require('./osc-title');
const { readLiveSession, liveSessionChanged } = require('./session-registry');
const { stripInheritedClaude } = require('./session-env');
const { detectAgents, agentStatus } = require('./agents-detect');
const { planRemoval, removeAgent } = require('./agent-remove');
const { KNOWN_SERVICES, serviceById } = require('./services-catalog');
const { upsertMcpJson, upsertOpencode, removeService, detectServices, knownFiles } = require('./mcp-config');
const { checkServer } = require('./mcp-check');
const { execFile } = require('child_process');
const { scanLibrary, createItem, duplicateItem, deleteItem, extractEdges } = require('./library');
const { writePointers, pointerStatus, linkNative, hasForeignSkillsSection, POINTER_FILE } = require('./pointer.js');
const fsActions = require('./fs-actions');
const settingsStore = require('./settings');
const { migrateRecents, sortRecents, rememberFolderIn, setPinnedIn, removeFrom } = require('./recents');
const { loginShell, windowChrome } = require('./platform');
const { userPath } = require('./user-path');
const { exitNote } = require('./exit-note');
const { checkForUpdate, updateStatus } = require('./update-check');
const { downloadUpdate, installNow, hasStagedFile, updaterState } = require('./updater');
const { parseDocUrl, resolveWithinRoot } = require('./doc-protocol');
const stt = require('./stt');

// nami-doc:// — how a viewed HTML page and its neighbouring images are served.
//
// A standard, secure scheme so the page gets a real origin of its own, which is
// what lets an <iframe sandbox="allow-scripts allow-same-origin"> load its
// relative files while staying cross-origin to Nami's file:// renderer — it can
// paint itself but cannot read window.parent. Must be declared before the app is
// ready; the handler that answers requests is installed once it is (below).
protocol.registerSchemesAsPrivileged([{
  scheme: 'nami-doc',
  privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
}]);

// A minimal content type from the extension — enough for a browser to render a
// document and its own assets. Unknown types are served as octet-stream, which a
// page never asks for as an image or stylesheet, so an accidental download of
// something odd stays inert.
function docContentType(file) {
  const e = (file.split('.').pop() || '').toLowerCase();
  // The text types carry a charset or an em-dash arrives as mojibake — the file
  // is read as bytes and the browser guesses latin-1 without this.
  return ({
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8', svg: 'image/svg+xml; charset=utf-8',
    png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav',
  })[e] || 'application/octet-stream';
}

// The one policy every served response carries: the page may run and style
// itself (agents inline both) and load its own assets, but connect-src 'none'
// means it can open no socket, so anything it managed to read it cannot send
// anywhere. No frame-ancestors on purpose — Nami is a file:// origin embedding a
// nami-doc:// page, and 'self' there would refuse the very frame we want; the
// isolation that matters is the cross-origin wall and the sandbox, not this.
const DOC_CSP = "default-src 'self' data: blob:; img-src 'self' data: blob:; "
  + "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; "
  + "media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'self'; "
  + "form-action 'none';";

function installDocProtocol() {
  protocol.handle('nami-doc', async (request) => {
    const parsed = parseDocUrl(request.url);
    if (!parsed) return new Response('bad request', { status: 400 });
    const file = resolveWithinRoot(parsed.root, parsed.rel);
    // null means the path escaped its folder — refuse, do not explain.
    if (!file) return new Response('not found', { status: 404 });
    const res = await net.fetch('file://' + file.split('/').map(encodeURIComponent).join('/'));
    // Re-wrap so we set our own content type and, above all, our CSP — net.fetch
    // of a file:// URL carries neither.
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': docContentType(file), 'content-security-policy': DOC_CSP },
    });
  });
}

let pty = null;
try { pty = require('@lydell/node-pty'); } catch (_) { try { pty = require('node-pty'); } catch (_) {} }

process.on('uncaughtException', (err) => { console.error('[main] uncaught:', err && err.stack || err); });

const DEMO = process.argv.includes('--demo');
const SHOT_IDX = process.argv.indexOf('--screenshot');
const SHOT_PATH = SHOT_IDX >= 0 ? process.argv[SHOT_IDX + 1] : null;
const SCENE = (process.argv.find((a) => a.startsWith('--scene=')) || '').split('=')[1] || null;

// Screenshot runs open behind whatever the user has on screen; macOS then stops
// compositing the occluded window and capturePage returns a frozen frame from
// seconds ago (paper theme, no scene). Keep the renderer drawing regardless.
if (SHOT_PATH) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

// `productName: Nami` resolves the same packaged and unpackaged, so a dev run and the
// installed Nami.app would otherwise share one userData — the same state.json (recents,
// open windows) and settings.json (theme, API keys, mode 0600). That makes the shipped
// app impossible to daily-drive while developing, and makes a clean first launch
// impossible to see at all without deleting your own config. Development gets its own
// directory instead. Must run before anything reads userData, hence module scope.
if (!app.isPackaged) app.setPath('userData', app.getPath('userData') + '-dev');

let win = null;                   // most recently created window (fallback target)
const wins = new Set();           // every open window — each is its own project space
const winFolders = new Map();     // webContents.id -> folder that window works in
const sessionOwners = new Map();  // session id -> webContents.id, so closing a window reaps its sessions
const termSessions = new Map();   // id -> pty
// Sessions Nami is ending on purpose — quit, window close, tile close. pty.kill()
// sends SIGHUP, which surfaces as exit 129, and without this the tile cannot tell
// "you closed me" from "I died". Recorded before the kill, read in onExit.
const deliberateKills = new Set();

// Every intentional teardown goes through here, so the exit note stays honest.
function killSession(id) {
  const p = termSessions.get(id);
  if (!p) return false;
  deliberateKills.add(id);
  try { p.kill(); } catch (_) {}
  termSessions.delete(id);
  return true;
}
const agentSessions = new AgentSessions(); // tile id -> live adapter (Cards drive mode)

// ---- state (restart-proof) -------------------------------------------------
function stateFile() { return path.join(app.getPath('userData'), 'state.json'); }
let state = { recentFolders: [], currentFolder: null, panels: [], panelsByFolder: {}, windows: [] };
function loadState() {
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(stateFile(), 'utf8'))); } catch (_) {}
  if (!state.panelsByFolder || typeof state.panelsByFolder !== 'object') state.panelsByFolder = {};
  if (!Array.isArray(state.windows)) state.windows = [];
  // pre-multi-window states kept a single desk in `panels`
  if (Array.isArray(state.panels) && state.panels.length && state.currentFolder && !state.panelsByFolder[state.currentFolder]) {
    state.panelsByFolder[state.currentFolder] = state.panels;
  }
  // recentFolders used to be a bare path list; it now carries when it was last
  // opened and whether it is pinned, so the popover can sort and label rows.
  state.recentFolders = migrateRecents(state.recentFolders);
}
const folderKey = (f) => f || '__no_folder__';
function panelsFor(folder) { const p = state.panelsByFolder[folderKey(folder)]; return Array.isArray(p) ? p.slice(0, 12) : []; }
let saveTimer = null;
function persist(partial) {
  if (partial) state = Object.assign(state, partial);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile() + '.tmp', JSON.stringify(state, null, 2));
      fs.renameSync(stateFile() + '.tmp', stateFile());
    } catch (_) {}
  }, 250);
}

// ---- settings (how the app behaves: theme, model, transcription) ------------
// Every write merges and renames — see settings.js for why.
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() { return settingsStore.readSettings({ file: settingsFile() }); }
function writeSettings(patch) { return settingsStore.writeSettings({ file: settingsFile(), patch }); }

function sendWc(wc, channel, payload) { if (wc && !wc.isDestroyed()) wc.send(channel, payload); }

// ---- folder helpers --------------------------------------------------------
function homeShort(p) { const h = os.homedir(); return p && p.startsWith(h) ? '~' + p.slice(h.length) : p; }
function baseName(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || ''; }

function scanFolder(folder) {
  const info = { path: folder, pathShort: homeShort(folder), name: baseName(folder) || folder, tree: [], agents: [], skills: [], hasClaude: false };
  try {
    const claudeDir = path.join(folder, '.claude');
    info.hasClaude = fs.existsSync(claudeDir);
    // agents
    const agentsDir = path.join(claudeDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir)) {
        if (!f.endsWith('.md')) continue;
        const full = path.join(agentsDir, f);
        const meta = readFrontmatter(full);
        info.agents.push({
          slug: f.replace(/\.md$/, ''),
          name: meta.name || f.replace(/\.md$/, ''),
          desc: meta.description || '',
          tools: meta.tools || '',
        });
      }
    }
    // skills
    const skillsDir = path.join(claudeDir, 'skills');
    if (fs.existsSync(skillsDir)) {
      for (const d of fs.readdirSync(skillsDir)) {
        const skillMd = path.join(skillsDir, d, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          const meta = readFrontmatter(skillMd);
          info.skills.push({ slug: d, name: meta.name || d });
        }
      }
    }
    // shallow tree (top level)
    info.tree = readTree(folder, 0, 2);
  } catch (_) {}
  return info;
}

function readFrontmatter(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const m = txt.match(/^---\s*\n([\s\S]*?)\n---/);
    const out = {};
    if (m) {
      for (const line of m[1].split('\n')) {
        const mm = line.match(/^(\w[\w-]*):\s*(.*)$/);
        if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
      }
    }
    return out;
  } catch (_) { return {}; }
}

const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '.next', '.cache']);
function readTree(dir, depth, maxDepth) {
  const rows = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return rows; }
  entries = entries
    .filter((e) => !IGNORE.has(e.name) && !(e.name.startsWith('.') && e.name !== '.claude'))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 40);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      let count = 0;
      try { count = fs.readdirSync(full).length; } catch (_) {}
      rows.push({ name: e.name, kind: 'dir', pad: depth, meta: count + (count === 1 ? ' item' : ' items') });
      if (depth < maxDepth - 1) rows.push(...readTree(full, depth + 1, maxDepth));
    } else {
      let size = '';
      try { const s = fs.statSync(full); size = fmtSize(s.size); } catch (_) {}
      rows.push({ name: e.name, kind: 'file', pad: depth, meta: size });
    }
  }
  return rows;
}
function fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }

function rememberFolder(folder) {
  state.recentFolders = rememberFolderIn(state.recentFolders || [], folder, Date.now());
  state.currentFolder = folder;
  persist();
  broadcastRecents();
}

// The list lives in main but every window renders its own copy, so a change in
// one window has to reach the others or their popovers show a stale order.
function recentsForRenderer() {
  return sortRecents(state.recentFolders || []).map((r) => ({
    path: r.path, pathShort: homeShort(r.path), name: baseName(r.path),
    at: r.at, pinned: !!r.pinned, missing: !fs.existsSync(r.path),
  }));
}
function broadcastRecents() {
  const rows = recentsForRenderer();
  for (const w of wins) sendWc(w.webContents, 'recents:changed', rows);
}

// ---- updates ---------------------------------------------------------------
// Ask GitHub what the latest release is; if it beats what is running, tell the
// windows so they can offer it. Notify-only — see update-check.js for why.
//
// Never runs in development: the version in package.json is always behind the
// last published release while working, so every launch would nag about an
// update you are in the middle of building.
const UPDATE_EVERY = 6 * 60 * 60 * 1000;
let lastOffered = null;

async function pollForUpdate() {
  const found = await checkForUpdate({ currentVersion: app.getVersion() });
  if (!found) return;
  lastOffered = found;
  for (const w of wins) sendWc(w.webContents, 'update:available', found);
}

function startUpdatePolling() {
  if (!app.isPackaged) return;
  // A beat after launch, not during it — the first seconds belong to the window.
  setTimeout(pollForUpdate, 8000).unref?.();
  setInterval(pollForUpdate, UPDATE_EVERY).unref?.();
}

// ---- window ----------------------------------------------------------------
// Quit used to restore `state.currentFolder` — one slot, so three open windows
// came back as one and which one you got was "whichever folder was touched
// last". `state.windows` records what is open right now instead, so a relaunch
// reopens each window on its own folder, where you left it. A window you close
// on purpose drops out of the list and does not come back.
let winSnapTimer = null;
function snapshotWindows() {
  clearTimeout(winSnapTimer);
  winSnapTimer = setTimeout(() => {
    state.windows = [...wins].filter((w) => !w.isDestroyed()).map((w) => ({
      folder: winFolders.get(w.webContents.id) || null,
      bounds: w.getNormalBounds(),
    }));
    persist();
  }, 300);
}

// This window is Nami and nothing may replace it. Rendered content — a doc's
// markdown, anything an agent writes — can carry a link, and a bare <a href>
// would otherwise navigate the whole app away with no way back. Web links are
// handed to the browser instead; everything else is simply refused.
function lockNavigation(wc) {
  wc.on('will-navigate', (e, url) => {
    if (url === wc.getURL()) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Each window is its own project space. `folder` sets what it opens with:
// omit it for the last-used folder, pass null for an empty window.
function createWindow(folder, bounds) {
  const w = new BrowserWindow({
    // The floor is what the layout survives, not what looks best: below 560 the
    // tile head runs out of room even with its controls dropped. Nami is often a
    // side pane next to an editor, so the old 1040 floor — wider than half a
    // laptop screen — made that impossible. See the narrow-window media queries
    // at the foot of paper.css.
    width: 1360, height: 940, minWidth: 560, minHeight: 480,
    ...(bounds && Number.isFinite(bounds.width) ? bounds : {}),
    ...windowChrome(),
    backgroundColor: settingsStore.themeBackground(readSettings().theme),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, plugins: true },
  });
  const wcId = w.webContents.id;
  wins.add(w); win = w;
  winFolders.set(wcId, folder === undefined ? state.currentFolder : folder);
  lockNavigation(w.webContents);
  w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  w.on('resize', snapshotWindows);
  w.on('move', snapshotWindows);
  w.on('closed', () => {
    wins.delete(w);
    winFolders.delete(wcId);
    reapSessions(wcId);
    if (win === w) win = [...wins].pop() || null;
    snapshotWindows();
  });
  snapshotWindows();

  if (SHOT_PATH && wins.size === 1) {
    w.webContents.on('did-finish-load', async () => {
      // a --scene= shot has to wait out the library scan before the surface is real
      const zi = process.argv.indexOf('--zoom');
      if (zi >= 0) w.webContents.setZoomFactor(Number(process.argv[zi + 1]));
      await new Promise((r) => setTimeout(r, SCENE ? 2600 : (DEMO ? 1400 : 700)));
      // capturePage can grab a stale (blank) compositor frame; force a repaint
      // and give it a beat, or roughly one shot in three comes back empty
      w.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 350));
      try {
        if (process.env.SHOT_DEBUG) {
          const probe = await w.webContents.executeJavaScript(process.env.SHOT_DEBUG);
          console.log('[shot-debug]', JSON.stringify(probe));
        }
        const img = await w.webContents.capturePage();
        fs.mkdirSync(path.dirname(path.resolve(SHOT_PATH)), { recursive: true });
        fs.writeFileSync(path.resolve(SHOT_PATH), img.toPNG());
        console.log('screenshot →', path.resolve(SHOT_PATH));
      } catch (e) { console.error('shot failed', e); }
      setTimeout(() => app.quit(), 300);
    });
  }
  return w;
}

// A closing window takes its live sessions with it (same as quit does for all).
function reapSessions(wcId) {
  for (const [id, owner] of [...sessionOwners]) {
    if (owner !== wcId) continue;
    sessionOwners.delete(id);
    killSession(id);
    agentSessions.stop(id);
  }
}

app.whenReady().then(() => {
  loadState();
  installDocProtocol();  // serve viewed HTML + its assets from nami-doc://
  // Ask the login shell for the real PATH now, so the answer is already waiting
  // when the first session spawns. Deliberately not awaited: a slow .zshrc must
  // delay a terminal, never the window.
  userPath();
  // point the on-device engine at its weights, then warm the session in the
  // background so the first dictation isn't the slow one
  try {
    const engine = require('./stt-local');
    engine.configure({ dir: sttModelDir() });
    setTimeout(() => engine.warm(stt.sttConfig(readSettings(), process.env)), 1500);
  } catch (e) { console.error('[stt] local engine unavailable:', e.message); }
  // Screenshot and demo runs want exactly one predictable window, never the
  // desk the developer happened to leave open.
  const restore = (!SHOT_PATH && !DEMO && state.windows.length) ? state.windows.slice(0, 8) : null;
  if (restore) for (const w of restore) createWindow(w.folder || null, w.bounds);
  else createWindow();
  if (process.argv.includes('--second-window')) createWindow(null); // dev: multi-window smoke test
  startUpdatePolling();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  // The snapshot is debounced; quitting mid-debounce would lose the last move
  // or the folder a window switched to a moment ago.
  clearTimeout(winSnapTimer);
  state.windows = [...wins].filter((w) => !w.isDestroyed()).map((w) => ({
    folder: winFolders.get(w.webContents.id) || null,
    bounds: w.getNormalBounds(),
  }));
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile() + '.tmp', JSON.stringify(state, null, 2));
    fs.renameSync(stateFile() + '.tmp', stateFile());
  } catch (_) {}
  for (const id of [...termSessions.keys()]) killSession(id);
  agentSessions.stopAll();
});

// Quit means quit. The window closes at once, but the process was observed
// living another 30 to 140 seconds — native threads (the Whisper engine, pty
// plumbing) keep a dead Electron alive long after the event loop is done. To
// the user that is invisible; to Squirrel it is fatal: install-on-quit waits
// for the process to actually go, and anyone reopening Nami inside that window
// got "App Still Running Error" and no update, with nothing said.
//
// By the time 'quit' fires, everything that matters has already happened —
// state written, sessions killed, the updater's own quit handler run (it
// spawns ShipIt as a separate process, which does not need us alive). The
// timer is unref'd so it never holds a fast exit open; it only fires if the
// process is still here two seconds after it had any reason to be.
app.on('quit', () => {
  setTimeout(() => process.exit(0), 2000).unref?.();
});

// ---- IPC: boot + folders ---------------------------------------------------

// Every session map in main (termSessions, sessionOwners, titleWatch) is keyed
// by the panel id the renderer chose — and each renderer numbers its panels from
// 1. Two windows therefore both call their first tile p_1, and main, having no
// way to tell them apart, hands window A's keystrokes to window B's pty and
// reaps A's sessions when B closes a folder. Handing every renderer a unique
// prefix at boot makes the names it invents globally unique, which is all the
// bookkeeping below ever needed.
//
// Counted per boot rather than per window on purpose: webContents.id survives a
// reload while the renderer's counter restarts, so a reloaded window would
// collide with the sessions it just left behind.
let bootSeq = 0;

ipcMain.handle('boot', (e) => {
  // each window boots with its own folder; fresh windows fall back to the last-used one
  const folder = winFolders.has(e.sender.id) ? winFolders.get(e.sender.id) : state.currentFolder;
  const ok = folder && fs.existsSync(folder);
  bootSeq += 1;
  return {
    winId: bootSeq,
    // A window opened after the check already ran would otherwise never hear
    // about the update — the event has been and gone.
    update: lastOffered,
    // And a window opened mid-download, or after one finished, would otherwise
    // offer to start a download that is already running or already done.
    // `staged` is the one that survives a restart: a download left in the cache
    // by an earlier run, which nothing would otherwise ever install.
    updater: { ...updaterState(), staged: stagedUpdateWaiting(), sessions: liveSessionCount() },
    // For the About pane. Sent at boot rather than fetched when the tab opens,
    // so opening it costs nothing and shows the truth instantly; the button is
    // the only thing that touches the network.
    version: app.getVersion(),
    updatedAt: appUpdatedAt(),
    demo: DEMO,
    collapsed: process.argv.includes('--collapsed'),
    // --theme=operator forces a theme for this run (screenshots); not persisted
    themeArg: (process.argv.find((a) => a.startsWith('--theme=')) || '').split('=')[1] || null,
    // --scene=<name> opens one surface on boot so it can be screenshotted; screenshots only
    scene: SCENE,
    // ask the provider registry, not the environment — a key typed into Settings
    // counts just as much as an exported one, and the local engine needs neither
    sttInfo: sttStatus(),
    claudeExe: resolveClaudeExecutable(),
    recentFolders: recentsForRenderer(),
    currentFolder: ok ? scanFolder(folder) : null,
    panels: panelsFor(ok ? folder : null),
  };
});

// Renderer sends its panel layout after every change; restored per folder on next boot.
ipcMain.handle('panels:save', (_e, { panels, folder }) => {
  state.panelsByFolder[folderKey(folder)] = Array.isArray(panels) ? panels.slice(0, 12) : [];
  persist();
  return { ok: true };
});
// A folder switch inside a live window needs the incoming folder's desk without
// a restart — same snapshot boot would have handed it.
ipcMain.handle('panels:load', (_e, folder) => panelsFor(folder));

ipcMain.handle('recents:pin', (_e, { path: p, pinned }) => {
  state.recentFolders = setPinnedIn(state.recentFolders || [], p, pinned);
  persist(); broadcastRecents();
  return recentsForRenderer();
});
ipcMain.handle('recents:remove', (_e, p) => {
  state.recentFolders = removeFrom(state.recentFolders || [], p);
  // Forget the desk too — leaving it behind would resurrect the tiles if the
  // same path is ever opened again, which is not what "remove" looks like.
  delete state.panelsByFolder[folderKey(p)];
  if (state.currentFolder === p) state.currentFolder = null;
  persist(); broadcastRecents();
  return recentsForRenderer();
});

ipcMain.handle('window:new', (_e, args) => { createWindow((args && args.folder) || null); return { ok: true }; });

ipcMain.handle('app:version', () => app.getVersion());
// What the About pane shows: which copy this is, and whether it is behind.
//
// `updatedAt` is the app bundle's own timestamp, which macOS stamps when the
// bundle lands in Applications, so it answers "when did I last update this"
// rather than "when was this built" — the same version number can sit on two
// machines that installed it weeks apart. Running from source there is no
// bundle, so the folder's own date stands in.
//
// The check runs even in development, unlike the background poll: the poll is
// switched off there because it would nag about a version you are in the middle
// of writing, but a button somebody pressed should always answer.
function appUpdatedAt() {
  try {
    // .../Nami.app/Contents/MacOS/Nami → .../Nami.app
    const bundle = app.isPackaged
      ? path.resolve(app.getPath('exe'), '..', '..', '..')
      : app.getAppPath();
    return fs.statSync(bundle).mtime.toISOString();
  } catch (_) { return null; }
}

ipcMain.handle('update:status', async () => {
  const st = await updateStatus({ currentVersion: app.getVersion() });
  // A manual check that finds something also re-arms the bar: the renderer
  // clears its "skipped" mark off the back of this, so a version somebody once
  // waved away can be found again.
  if (st.state === 'update') lastOffered = { version: st.version, url: st.url };
  // `version` is always the one running and `latest` the one on offer. They were
  // one field to begin with, and the pane duly announced "Nami 0.1.3, updated
  // tonight" about a copy the user did not have.
  return {
    state: st.state,
    version: app.getVersion(),
    updatedAt: appUpdatedAt(),
    latest: st.version || null,
    url: st.url || null,
  };
});

// Still here, and still the fallback rather than the plan. The updater below
// installs in place; when it cannot, this is what the bar goes back to offering,
// so the worst outcome of a failed update is the app we shipped in 0.1.3.
// Only https — the url arrives from a network response, and shell.openExternal
// will happily run other schemes.
ipcMain.handle('update:open', (_e, url) => {
  const ok = /^https:\/\//i.test(String(url || ''));
  if (ok) shell.openExternal(String(url));
  return { ok };
});

// Download the update the user just accepted, and tell every window how it is
// going. All the windows share one copy of Nami on disk, so they share one
// download and see the same progress — a second window opened halfway through
// asks for the current state at boot rather than starting its own.
ipcMain.handle('update:download', () => downloadUpdate({
  isPackaged: app.isPackaged,
  emit: (channel, payload) => {
    for (const w of wins) sendWc(w.webContents, channel, payload);
  },
}));
ipcMain.handle('update:state', () => updaterState());

// Install it now and come back on the new version, instead of waiting for a
// quit and hoping to beat the user back to the app.
ipcMain.handle('update:install', () => installNow({
  isPackaged: app.isPackaged,
  emit: (channel, payload) => {
    for (const w of wins) sendWc(w.webContents, channel, payload);
  },
}));

// electron-updater's cache dir, which it names from updaterCacheDirName in
// app-update.yml. Only somewhere to look — nothing here writes to it.
function stagedUpdateWaiting() {
  try { return hasStagedFile(path.join(app.getPath('cache'), 'nami-updater')); } catch (_) { return false; }
}

// What an update would end if it happened right now. The renderer says so
// before installing, because an update that silently kills four agents
// mid-thought is the outcome this whole feature was shaped to avoid.
function liveSessionCount() {
  return termSessions.size + agentSessions.size;
}
ipcMain.handle('update:sessions', () => liveSessionCount());

// Which of the curated agent CLIs are on this Mac (via the user's login shell).
ipcMain.handle('agents:detect', () => detectAgents());
// Who is signed in to one of them. Lazy and per-agent — a CLI that hangs must
// never stall the launcher, so every failure lands on signedIn: null.
ipcMain.handle('agents:status', (_e, { id } = {}) => agentStatus(id));
// Removal is planned before it is done, so the confirm can name real paths.
ipcMain.handle('agents:removalPlan', (_e, { id, binPath } = {}) =>
  planRemoval({ id, binPath, home: os.homedir() }));
ipcMain.handle('agents:remove', (_e, { id, binPath } = {}) =>
  removeAgent({ id, binPath, home: os.homedir() }));

// ---- IPC: connect-a-service -------------------------------------------------
// The catalog goes to the renderer without its entry-builder functions.
function catalogForRenderer() {
  return KNOWN_SERVICES.map((s) => ({ id: s.id, name: s.name, desc: s.desc, code: s.code, kind: s.kind, keys: s.keys, keyHelpUrl: s.keyHelpUrl, docs: s.docs, guide: s.guide }));
}
// User-scope Claude config belongs to the claude CLI, never hand-edited.
function claudeUserScopeAdd(id, entry) {
  return new Promise((resolve) => {
    const json = JSON.stringify(entry);
    const sh = loginShell();
    execFile(sh.file, sh.args(`claude mcp add-json --scope user ${id} ${JSON.stringify(json)}`), { timeout: 20000 }, (err) => {
      resolve(err ? 'skipped: ' + err.message.split('\n')[0] : 'written');
    });
  });
}
ipcMain.handle('services:list', (_e, { projectPath } = {}) => ({
  catalog: catalogForRenderer(),
  connected: detectServices({ projectPath, home: os.homedir() }),
}));
ipcMain.handle('services:connect', async (_e, { id, values, scope, platforms, projectPath }) => {
  const s = serviceById(id);
  if (!s) return { ok: false, error: 'unknown service' };
  if (values && values.installDir) values.installDir = values.installDir.replace(/^~/, os.homedir());
  const files = [];
  let claudeUserScope = null;
  try {
    if (platforms.includes('claude')) {
      const entry = s.claudeEntry(values);
      if (scope === 'project' && projectPath) { upsertMcpJson({ file: path.join(projectPath, '.mcp.json'), id, entry }); files.push('.mcp.json'); }
      else if (scope === 'user') { claudeUserScope = await claudeUserScopeAdd(id, entry); if (claudeUserScope === 'written') files.push('claude user settings'); }
    }
    if (platforms.includes('opencode')) {
      const entry = s.opencodeEntry(values);
      const file = scope === 'project' && projectPath
        ? path.join(projectPath, 'opencode.json')
        : path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
      upsertOpencode({ file, id, entry });
      files.push(file.indexOf('.config') >= 0 ? 'opencode config' : 'opencode.json');
    }
    const probe = s.claudeEntry(values);
    const check = await checkServer({ command: probe.command, args: probe.args, env: probe.env || {} });
    return { ok: true, files, tools: check.ok ? check.tools : 0, checked: check.ok, checkError: check.ok ? null : check.error, claudeUserScope };
  } catch (e) { return { ok: false, error: e.message, files }; }
});
ipcMain.handle('services:disconnect', async (_e, { id, projectPath }) => {
  // Hand-editable files only; user-scope Claude goes through the claude CLI.
  const files = knownFiles(projectPath, os.homedir()).filter(([f]) => f.indexOf('.claude.json') < 0).map(([f]) => f);
  const changed = removeService({ files, id });
  const viaCli = await new Promise((resolve) => {
    const sh = loginShell();
    execFile(sh.file, sh.args(`claude mcp remove --scope user ${id}`), { timeout: 20000 }, (err) => resolve(!err));
  });
  if (viaCli) changed.push('claude user settings');
  return { changed };
});
// http as well as https: a dev server an agent just started (localhost:3000) is
// the most clickable thing in a session. Still nothing else — no file://, no
// custom schemes, so a link in output can never launch an app.
ipcMain.handle('url:open', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// Theme lives in settings.json so the window background matches on next launch.
ipcMain.handle('theme:set', (_e, theme) => writeSettings({ theme: settingsStore.normalizeTheme(theme) }));

// The Settings page reads and writes settings.json directly. Only these keys are
// writable from the renderer — panel layout and recents live in state.json and
// have their own channels, and nothing else should be reachable from a page.
const WRITABLE_SETTINGS = new Set([
  'theme',
  'sttProvider', 'openaiKey', 'elevenKey', 'openaiModel', 'elevenModel',
  'sttModelId',
]);
ipcMain.handle('settings:get', () => {
  const s = readSettings();
  // keys never travel back to the renderer in full — it only needs to know one exists
  const out = Object.assign({}, s, {
    openaiKey: s.openaiKey ? '••••' + String(s.openaiKey).slice(-4) : '',
    elevenKey: s.elevenKey ? '••••' + String(s.elevenKey).slice(-4) : '',
    sttKey: s.sttKey ? '••••' + String(s.sttKey).slice(-4) : '',
  });
  delete out.envKeys; // full secrets — the Keys pane has its own masked channel
  return out;
});

// ---- IPC: keys — named secrets every session inherits ----------------------
// Stored under settings.envKeys and exported into each PTY's environment at
// spawn, so agents find their keys without the user configuring anything else.
const KEY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function storedEnvKeys() { const k = readSettings().envKeys; return (k && typeof k === 'object' && !Array.isArray(k)) ? k : {}; }
ipcMain.handle('keys:get', () => {
  const stored = storedEnvKeys();
  return {
    stored: Object.keys(stored).sort().map((name) => ({
      name,
      masked: '••••••••' + String(stored[name]).slice(-4),
    })),
  };
});
ipcMain.handle('settings:reveal', () => { try { shell.showItemInFolder(settingsFile()); } catch (_) {} });
ipcMain.handle('keys:set', (_e, { name, value }) => {
  if (!KEY_NAME_RE.test(String(name || ''))) return { ok: false, error: 'The name has to look like AN_ENV_VAR.' };
  if (!value || !String(value).trim()) return { ok: false, error: 'Paste the secret first.' };
  const next = Object.assign({}, storedEnvKeys(), { [name]: String(value).trim() });
  const res = writeSettings({ envKeys: next });
  return res.ok ? { ok: true } : res;
});
ipcMain.handle('keys:delete', (_e, { name }) => {
  const next = Object.assign({}, storedEnvKeys()); delete next[name];
  const res = writeSettings({ envKeys: next });
  return res.ok ? { ok: true } : res;
});
ipcMain.handle('keys:reveal', (_e, { name }) => ({ value: storedEnvKeys()[name] || '' }));
ipcMain.handle('settings:set', (_e, patch) => {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) if (WRITABLE_SETTINGS.has(k)) clean[k] = v;
  const res = writeSettings(clean);
  return res.ok ? { ok: true, sttInfo: sttStatus() } : res;
});

ipcMain.handle('folder:pick', async (e) => {
  const parent = BrowserWindow.fromWebContents(e.sender) || win;
  const res = await dialog.showOpenDialog(parent, { properties: ['openDirectory'], title: 'Open a folder' });
  if (res.canceled || !res.filePaths[0]) return null;
  // Deliberately does NOT commit: the renderer may still decide this folder
  // belongs in a new window instead. It commits with folder:open.
  return scanFolder(res.filePaths[0]);
});

// Adopting a folder is what makes it this window's folder, bumps it up Recents
// and marks the window for restore. It is separate from *reading* a folder
// because a switch can still be called off — a desk with live sessions gets
// offered a new window instead, and a cancelled switch must leave no trace.
function commitFolder(e, folder) {
  winFolders.set(e.sender.id, folder);
  rememberFolder(folder);
  snapshotWindows();
}
ipcMain.handle('folder:open', (e, arg) => {
  const folder = typeof arg === 'string' ? arg : (arg && arg.folder);
  const commit = typeof arg === 'string' ? true : !(arg && arg.commit === false);
  // A recents row can outlive its folder. Say so instead of returning a bare
  // null the renderer can only turn into a silent no-op.
  if (!folder) return { missing: true, path: folder };
  if (!fs.existsSync(folder)) { broadcastRecents(); return { missing: true, path: folder }; }
  if (commit) commitFolder(e, folder);
  return scanFolder(folder);
});
ipcMain.handle('folder:scan', (_e, folder) => (folder && fs.existsSync(folder)) ? scanFolder(folder) : null);
ipcMain.handle('folder:rescan', (_e, folder) => (folder && fs.existsSync(folder)) ? scanFolder(folder) : null);

// ---- IPC: explorer + editor ------------------------------------------------
ipcMain.handle('dir:list', (_e, arg) => {
  const dir = typeof arg === 'string' ? arg : arg.dir;
  const all = typeof arg === 'object' && !!arg.all;
  try {
    let entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => all ? e.name !== '.DS_Store'
                        : !IGNORE.has(e.name) && !(e.name.startsWith('.') && e.name !== '.claude'))
      .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    return entries.map((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { let c = 0; try { c = fs.readdirSync(full).length; } catch (_) {} return { name: e.name, path: full, kind: 'dir', meta: c + (c === 1 ? ' item' : ' items') }; }
      let size = ''; try { size = fmtSize(fs.statSync(full).size); } catch (_) {}
      return { name: e.name, path: full, kind: 'file', meta: size };
    });
  } catch (_) { return []; }
});
ipcMain.handle('file:raw', (_e, file) => {
  try {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) return { ok: false, error: 'is a directory' };
    if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'file too large to edit (' + fmtSize(stat.size) + ')', size: fmtSize(stat.size) };
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return { ok: false, binary: true, error: 'binary file', size: fmtSize(stat.size) };
    return { ok: true, text: buf.toString('utf8'), path: file, size: fmtSize(stat.size) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('file:save', (_e, { file, text }) => {
  try { fs.writeFileSync(file, text); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
// Resolve a token clicked in a terminal (absolute, ~, or relative to the session cwd).
ipcMain.handle('path:stat', (_e, { token, cwd }) => {
  try {
    let p = String(token || '').trim().replace(/[)>,.:'"]+$/, '');
    if (!p) return { exists: false };
    if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
    if (!path.isAbsolute(p)) p = path.resolve(cwd || os.homedir(), p);
    const st = fs.statSync(p);
    return { exists: true, isFile: st.isFile(), isDir: st.isDirectory(), abs: p };
  } catch (_) { return { exists: false }; }
});

// ---- IPC: agents & skills library ------------------------------------------
ipcMain.handle('library:scan', (_e, { projectPath }) => {
  try { const items = scanLibrary({ projectPath }); return { items, edges: extractEdges(items) }; }
  catch (_) { return { items: [], edges: [] }; }
});
ipcMain.handle('library:create', (_e, args) => createItem(args || {}));
ipcMain.handle('library:duplicate', (_e, args) => duplicateItem(args || {}));
ipcMain.handle('library:delete', (_e, args) => deleteItem({ ...(args || {}), trashFn: (p) => shell.trashItem(p) }));

// ---- IPC: the skills pointer ------------------------------------------------
// Nothing here runs unless the renderer asks. Opening a folder is a read: the
// only paths that write are a skill being created and the buttons that say so.
ipcMain.handle('pointer:status', (_e, args) => {
  const { dir, agentIds } = args || {};
  try {
    const skills = projectSkills(dir);
    const st = pointerStatus({ dir, skills, agentIds });
    const text = safeReadText(dir && path.join(dir, POINTER_FILE));
    return { ...st, skills: skills.map((s) => s.slug), foreignSection: hasForeignSkillsSection(text) };
  } catch (e) { return { inSync: true, unlisted: [], stale: [], missingFiles: [], listed: [], error: e.message }; }
});
ipcMain.handle('pointer:write', (_e, args) => {
  const { dir, agentIds, dryRun } = args || {};
  try {
    const skills = projectSkills(dir);
    const res = writePointers({ dir, skills, agentIds, dryRun });
    if (!res.ok || dryRun) return res;
    // Native registration is the stronger route where an agent's own project
    // path is verified; it is additive, so a failure here must not fail the write.
    const link = linkNative({ dir, slugs: skills.map((s) => s.slug), agentIds });
    return { ...res, linked: link.linked || [], swept: link.swept || [] };
  } catch (e) { return { ok: false, error: e.message, written: [], preview: {} }; }
});

// The pointer announces what the folder holds, so the folder is the source of
// truth — read fresh each time rather than trusting anything the renderer sends.
function projectSkills(dir) {
  if (!dir) return [];
  return scanLibrary({ projectPath: dir })
    .filter((i) => i.type === 'skill' && i.scope === 'project' && !i.broken)
    .map((i) => ({ slug: i.slug, description: i.description }));
}
function safeReadText(p) { try { return p ? fs.readFileSync(p, 'utf8') : ''; } catch (_) { return ''; } }

// ---- IPC: quick look / files ----------------------------------------------
ipcMain.handle('file:read', (_e, file) => {
  try {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(file).slice(0, 60).map((n) => ({ name: n }));
      return { kind: 'dir', name: baseName(file), files };
    }
    if (stat.size > 400 * 1024) return { kind: 'text', name: baseName(file), rows: [{ n: 1, t: '(file too large to preview)' }], size: fmtSize(stat.size) };
    const txt = fs.readFileSync(file, 'utf8');
    const rows = txt.split('\n').slice(0, 400).map((t, i) => ({ n: i + 1, t }));
    return { kind: 'text', name: baseName(file), rows, size: fmtSize(stat.size) };
  } catch (e) { return { kind: 'text', name: baseName(file), rows: [{ n: 1, t: 'Could not read: ' + e.message }] }; }
});
ipcMain.handle('file:reveal', (_e, file) => { try { shell.showItemInFolder(file); } catch (_) {} });
// Workspace file verbs: guarded in fs-actions.js to stay inside the project root.
ipcMain.handle('fs:newFile', (_e, a) => fsActions.newFile(a || {}));
ipcMain.handle('fs:newFolder', (_e, a) => fsActions.newFolder(a || {}));
ipcMain.handle('fs:move', (_e, a) => fsActions.movePath(a || {}));
ipcMain.handle('fs:trash', (_e, a) => fsActions.trashPath({ ...(a || {}), trashFn: (p) => shell.trashItem(p) }));
// Plain directory dialog for Move to…: unlike folder:pick it must NOT remember
// the choice as a recent project.
ipcMain.handle('folder:choose', async (e) => {
  const parent = BrowserWindow.fromWebContents(e.sender) || win;
  const res = await dialog.showOpenDialog(parent, { properties: ['openDirectory'], title: 'Move to which folder?' });
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
});
ipcMain.handle('clipboard:write', (_e, text) => { try { clipboard.writeText(String(text || '')); } catch (_) {} return true; });
ipcMain.handle('clipboard:read', () => { try { return clipboard.readText(); } catch (_) { return ''; } });

// ---- IPC: dictation → text -------------------------------------------------
// Which engine runs is stt.js's problem; this only supplies config and a way to
// report download progress back to the window that asked.
function sttEnv() { return { settings: readSettings(), env: process.env }; }
function sttStatus() { return stt.status(sttEnv()); }

// Whisper weights live in one writable folder under userData. A packaged build
// ships tiny.en inside the app bundle, which is read-only, so on first launch we
// copy it across — after that there is a single place that both the engine reads
// and a bigger model can be downloaded into.
function sttModelDir() {
  const user = path.join(app.getPath('userData'), 'models');
  const bundled = process.resourcesPath && path.join(process.resourcesPath, 'models');
  try {
    if (bundled && fs.existsSync(bundled) && !fs.existsSync(path.join(user, 'onnx-community'))) {
      fs.mkdirSync(user, { recursive: true });
      fs.cpSync(bundled, user, { recursive: true, force: false, errorOnExist: false });
    }
  } catch (e) { console.error('[stt] could not seed bundled model:', e.message); }
  return user;
}

ipcMain.handle('stt:transcribe', (e, clip) =>
  stt.transcribe(Object.assign(sttEnv(), {
    clip,
    deps: { onProgress: (p) => sendWc(e.sender, 'stt:progress', p) },
  })));
ipcMain.handle('stt:status', () => sttStatus());
ipcMain.handle('stt:prepare', (e) =>
  stt.prepare(Object.assign(sttEnv(), {
    deps: { onProgress: (p) => sendWc(e.sender, 'stt:progress', p) },
  })));

// ---- IPC: agent sessions (Cards drive mode) --------------------------------
// One live runtime per tile: starting an agent session for a tile closes any
// previous one, and the pty is the renderer's to stop first. Events flow back
// on 'agent:event', already speaking the vocabulary in agent-events.js.
ipcMain.handle('agent:start', async (e, { id, agent, cwd, sid, model, prompt }) => {
  const wc = e.sender;
  sessionOwners.set(id, wc.id);
  const envPath = await userPath();
  const res = await agentSessions.start({
    id, agent, cwd, sid, model, prompt,
    // The same env discipline the ptys get: login PATH, stripInheritedClaude,
    // stored keys — a session must behave the same in either view.
    env: sessionEnv(envPath),
    // tileId rides its own field — every event already owns `id` for its row.
    onEvent: (ev) => sendWc(wc, 'agent:event', { tileId: id, ...ev }),
  });
  // The SDK writes the same transcript the pty would, so the title watcher
  // keeps the rail name honest while Cards drive.
  if (res.ok && agent === 'claude' && sid) {
    const file = path.join(os.homedir(), '.claude', 'projects', projectSlug(cwd), sid + '.jsonl');
    watchTitle(id, wc, file, { sid, cwd });
  }
  return res;
});
ipcMain.handle('agent:send', (_e, { id, text }) => ({ ok: agentSessions.send(id, text) }));
ipcMain.handle('agent:permission', (_e, { id, permissionId, optionId }) => ({ ok: agentSessions.permission(id, permissionId, optionId) }));
ipcMain.handle('agent:interrupt', (_e, { id }) => ({ ok: agentSessions.interrupt(id) }));
ipcMain.handle('agent:config', (_e, { id, configId, value }) => ({ ok: agentSessions.config(id, configId, value) }));
ipcMain.handle('agent:stop', (_e, { id }) => { agentSessions.stop(id); return { ok: true }; });

// Everything the conversation already holds, read once on a switch to Cards —
// the backlog a live adapter cannot replay. Bounded exactly like the tail: a
// large transcript opens on its last screenful, never whole.
ipcMain.handle('cards:backlog', (_e, { cwd, sid }) => {
  const file = claudeTranscript(cwd, sid);
  if (!file) return { events: [] };
  try {
    const size = fs.statSync(file).size;
    const { offset, partial } = tailStart(size, {});
    const r = readFrom(file, offset, {});
    return { events: parseTranscript(r.lines), partial };
  } catch (_) { return { events: [] }; }
});


// Every session inherits the saved Keys as env vars. A key saved in Nami wins
// over the shell's own export — what you set in the app is what runs.
//
// `path` is the user's real login PATH, not the one this process was handed.
// Launched from the Dock that difference is everything: launchd gives an app
// four directories, so an agent spawned with it cannot find node, git, or any
// tool the user installed. A shell tile papers over this by sourcing .zshrc on
// its way up, but anything spawned directly — claude, a harness — does not.
function sessionEnv(path) {
  // stripInheritedClaude first: a tile is a top-level agent, and inheriting the
  // launching conversation's handles makes claude disable transcript saving.
  const env = Object.assign(stripInheritedClaude(process.env), { TERM: 'xterm-256color', FORCE_COLOR: '1' });
  if (path) env.PATH = path;
  // TUIs that check COLORFGBG (vim, htop, some harnesses) pick palettes that
  // suit the theme's ground: "fg;bg" where bg 15=light desk, 0=dark desk.
  const theme = settingsStore.normalizeTheme(readSettings().theme);
  env.COLORFGBG = (theme === 'paper' || theme === 'glass') ? '0;15' : '15;0';
  for (const [k, v] of Object.entries(storedEnvKeys())) env[k] = v;
  return env;
}

// ---- IPC: terminal / harness sessions --------------------------------------
// kind: 'claude' (spawn the logged-in claude directly), 'shell' (a plain shell),
// 'run' (a shell that then runs `command`), 'harness' (spawn `program args`).
ipcMain.handle('term:create', async (e, { id, cwd, cols, rows, kind, command, program, args, seed, cont, sid, name }) => {
  const wc = e.sender;
  if (!pty) { sendWc(wc, 'term:data', { id, data: '\r\n[node-pty unavailable — terminal disabled]\r\n' }); return { ok: false }; }
  // Primed at startup, so by the time anyone opens a tile this is already
  // settled; the await only ever bites on a session created within the first
  // second of launch.
  const envPath = await userPath();
  const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const claudeExe = resolveClaudeExecutable();

  let file = shellPath, spawnArgs = [], afterStart = null, claudeWatch = null;
  if (kind === 'claude') {
    // sid: the panel's own conversation id, minted in the renderer at first spawn.
    // A fresh spawn pins it with --session-id; a restored panel resumes it with
    // --resume, so four tiles come back as four conversations. cont-without-sid is
    // the migration path for snapshots saved before ids existed: --continue.
    // --resume on a conversation that never got a first message errors out, so a
    // restored-but-unused panel falls back to a fresh spawn keeping the same id.
    const transcript = sid && path.join(os.homedir(), '.claude', 'projects', projectSlug(cwd), sid + '.jsonl');
    const hasTranscript = !!transcript && fs.existsSync(transcript);
    const claudeArgs = claudeSpawnArgs({ cont, sid, hasTranscript, name });
    // From here on, claude's own title for this conversation drives the label.
    // The pinned id is only a starting guess: /resume moves claude to another
    // conversation, so the watcher re-reads the live id and follows it. Started
    // after the spawn below, because following it needs the pty's pid.
    if (transcript) claudeWatch = { transcript, sid, cwd };
    if (claudeExe) { file = claudeExe; spawnArgs = claudeArgs; }
    else { file = shellPath; afterStart = ['claude', ...claudeArgs].join(' '); }
    if (seed) afterStart = (afterStart ? afterStart + '\r' : '') + '\u0000SEED\u0000'; // handled below
  } else if (kind === 'harness' && program) {
    file = program; spawnArgs = Array.isArray(args) ? args : [];
  } else if (kind === 'run' && command) {
    file = shellPath; afterStart = command;
  } else {
    file = shellPath;
  }

  let p;
  try {
    p = pty.spawn(file, spawnArgs, {
      name: 'xterm-256color', cols: cols || 100, rows: rows || 30,
      cwd: (cwd && fs.existsSync(cwd)) ? cwd : os.homedir(),
      env: sessionEnv(envPath),
    });
  } catch (err) { sendWc(wc, 'term:data', { id, data: '\r\n[could not start: ' + err.message + ']\r\n' }); return { ok: false }; }

  termSessions.set(id, p);
  sessionOwners.set(id, wc.id);
  if (claudeWatch) watchTitle(id, wc, claudeWatch.transcript, { pid: p.pid, sid: claudeWatch.sid, cwd: claudeWatch.cwd });
  // Claude publishes its name for the LIVE conversation as an OSC 0 title on
  // nearly every frame. Reading it out of the stream costs nothing and, unlike
  // the transcript, it is still right after the user runs /resume inside the
  // tile and lands in a different conversation. feedOscTitle reports only when
  // the name changes, so the spinner glyph never re-renders the rail.
  const osc = { last: null };
  p.onData((data) => {
    sendWc(wc, 'term:data', { id, data });
    if (kind !== 'claude') return;
    const t = feedOscTitle(osc, data);
    if (t) sendWc(wc, 'session:title', { id, title: t });
  });
  p.onExit(({ exitCode, signal }) => {
    termSessions.delete(id); sessionOwners.delete(id); titleWatch.delete(id);
    // The note is built here rather than in the renderer because only main knows
    // whether this teardown was Nami's own doing.
    const deliberate = deliberateKills.delete(id);
    sendWc(wc, 'term:exit', { id, code: exitCode, signal, deliberate, note: exitNote({ code: exitCode, signal, deliberate }) });
  });

  // Run a launch command in a plain shell (kind 'run' / fallback claude-in-shell).
  if (afterStart && afterStart.indexOf('\u0000SEED\u0000') < 0) setTimeout(() => { try { p.write(afterStart + '\r'); } catch (_) {} }, 200);
  else if (afterStart) setTimeout(() => { try { p.write('claude\r'); } catch (_) {} }, 200);

  // Seed a first message into an interactive session once it's ready
  // (claude spawns fast; run-kind agent TUIs draw slower, give them longer).
  if (seed && (kind === 'claude' || kind === 'run')) {
    const delay = kind === 'claude' ? (claudeExe ? 1600 : 2200) : 2500;
    setTimeout(() => { try { p.write(seed); } catch (_) {} }, delay);
    setTimeout(() => { try { p.write('\r'); } catch (_) {} }, delay + 350);
  }
  return { ok: true };
});
// ---- claude's own name for a session ---------------------------------------
// Claude titles its conversations and writes the title into the transcript.
// Watching for it is what keeps the rail label honest: a tile named from your
// first typed line ("go ahead") upgrades itself to what the session is really
// about, and it matches what `claude --resume` will show you tomorrow.
//
// A poll, not fs.watch: transcripts are appended to constantly, so a watcher
// would fire hundreds of times per turn for a string that changes twice a
// session. Only the tail is read — these files reach hundreds of megabytes.
//
// The same watcher feeds the card view. A tile in Cards is reading this file's
// body as well as its name — see pumpCards below — so the sweep speeds up while
// any tile has cards open, and drops back to the title cadence when none does.
const titleWatch = new Map(); // panel id -> { file, wc, mtime, title, cards, offset }
let titleTimer = null;
let titleEvery = 0;
const TITLE_MS = 4000;
// A turn writes a dozen records; anything slower than this and a card view
// arrives in visible lurches. Only ever runs while a tile is actually in Cards.
const CARDS_MS = 700;

// One tick may cross several bounded reads — a burst after the app was asleep,
// or a long tool result — but never more than this, so a huge backlog cannot
// hold the main process inside one sweep.
const CARD_READS_PER_TICK = 8;

// Everything new in this transcript since the last tick, as card events.
function pumpCards(id, w) {
  // First tick after Cards was switched on: a large transcript opens on its
  // last screenful rather than its history, and the renderer clears whatever
  // it had. A short one is read from the top.
  if (w.offset === null) {
    let size = 0;
    try { size = fs.statSync(w.file).size; } catch (_) { return; }
    w.offset = tailStart(size).offset;
    sendWc(w.wc, 'session:events', { id, events: [], reset: true });
  }
  for (let i = 0; i < CARD_READS_PER_TICK; i++) {
    const r = readFrom(w.file, w.offset);
    if (r.missing) return;
    w.offset = r.offset;
    // The file shrank: /clear, or a resume that replaced it. What the tile is
    // showing belongs to a conversation that no longer exists.
    if (r.reset) sendWc(w.wc, 'session:events', { id, events: [], reset: true });
    if (r.lines.length) {
      // Titles come from readTailTitle below — one name, one source.
      const events = parseTranscript(r.lines).filter((e) => e.kind !== 'title');
      if (events.length) sendWc(w.wc, 'session:events', { id, events });
    }
    if (!r.lines.length && !r.dropped) return;
  }
}

// Cards want 700ms; titles alone are content with 4s. Restart the interval only
// when the answer actually changes.
function retimeTitles() {
  const want = [...titleWatch.values()].some((w) => w.cards) ? CARDS_MS : TITLE_MS;
  if (titleTimer && titleEvery === want) return;
  if (titleTimer) clearInterval(titleTimer);
  titleEvery = want;
  titleTimer = setInterval(sweepTitles, want);
  if (titleTimer.unref) titleTimer.unref(); // never hold the app open
}

function sweepTitles() {
  for (const [id, w] of titleWatch) {
    if (w.wc.isDestroyed()) { titleWatch.delete(id); continue; } // window went away
    // Follow the conversation, not the id we guessed. /resume inside a tile
    // moves claude to another conversation and never writes a line to the
    // pinned one, so without this the stat below fails forever, in silence.
    if (w.pid) {
      const live = readLiveSession(w.pid);
      if (live && liveSessionChanged(w.sid, live.sessionId)) {
        w.sid = live.sessionId;
        w.file = path.join(os.homedir(), '.claude', 'projects', projectSlug(w.cwd), w.sid + '.jsonl');
        w.mtime = 0;
        // A different conversation entirely: re-seed the tail so the cards
        // show the one the user is now in, not the tail of the old one.
        w.offset = null;
        // The renderer persists this, so the next launch resumes the conversation
        // the user is actually in rather than starting a blank one.
        sendWc(w.wc, 'session:sid', { id, sid: w.sid });
      }
    }
    let stat = null;
    try { stat = fs.statSync(w.file); } catch (_) { continue; } // not written yet
    // Cards are seeded on their first tick, before anything has been appended,
    // so they run whether or not the file moved since last time.
    if (w.cards) pumpCards(id, w);
    if (stat.mtimeMs === w.mtime) continue;
    w.mtime = stat.mtimeMs;
    const title = readTailTitle(w.file);
    if (!title || title === w.title) continue;
    w.title = title;
    sendWc(w.wc, 'session:title', { id, title });
  }
  if (!titleWatch.size) { clearInterval(titleTimer); titleTimer = null; titleEvery = 0; }
}

function watchTitle(id, wc, file, { pid = null, sid = null, cwd = null } = {}) {
  titleWatch.set(id, { file, wc, mtime: 0, title: null, pid, sid, cwd, cards: false, offset: null });
  retimeTitles();
}

// A tile switched to Cards (or back). Turning it on re-seeds the tail and
// sweeps at once, so the view fills immediately instead of on the next tick.
ipcMain.handle('cards:watch', (_e, { id, on }) => {
  const w = titleWatch.get(id);
  if (!w) return { ok: false };
  w.cards = !!on;
  if (on) w.offset = null;
  retimeTitles();
  if (on) sweepTitles();
  return { ok: true };
});

ipcMain.handle('term:write', (_e, { id, data }) => { const p = termSessions.get(id); if (p) try { p.write(data); } catch (_) {} return { ok: !!p }; });
ipcMain.handle('term:resize', (_e, { id, cols, rows }) => { const p = termSessions.get(id); if (p) try { p.resize(cols, rows); } catch (_) {} return { ok: !!p }; });
ipcMain.handle('term:kill', (_e, { id }) => { killSession(id); sessionOwners.delete(id); titleWatch.delete(id); return { ok: true }; });
