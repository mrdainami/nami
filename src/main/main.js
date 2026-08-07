// Dainami CLI — Electron main process.
// Owns: the window, PTY terminal sessions, Claude Code sessions (via claude-driver),
// the open folder + its .claude scan, restart-proof state, and all IPC.

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ClaudeSession, resolveClaudeExecutable } = require('./claude-driver');
const { scanLibrary, createItem, duplicateItem, extractEdges } = require('./library');
const { OpenAISession } = require('./openai-driver');

let pty = null;
try { pty = require('@lydell/node-pty'); } catch (_) { try { pty = require('node-pty'); } catch (_) {} }

process.on('uncaughtException', (err) => { console.error('[main] uncaught:', err && err.stack || err); });

const DEMO = process.argv.includes('--demo');
const SHOT_IDX = process.argv.indexOf('--screenshot');
const SHOT_PATH = SHOT_IDX >= 0 ? process.argv[SHOT_IDX + 1] : null;

let win = null;
const termSessions = new Map();   // id -> pty
const claudeSessions = new Map(); // id -> ClaudeSession
const aiSessions = new Map();     // id -> OpenAISession (any OpenAI-compatible model)

// ---- state (restart-proof) -------------------------------------------------
function stateFile() { return path.join(app.getPath('userData'), 'state.json'); }
let state = { recentFolders: [], currentFolder: null, panels: [] };
function loadState() {
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(stateFile(), 'utf8'))); } catch (_) {}
}
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

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

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
  state.recentFolders = [folder, ...(state.recentFolders || []).filter((f) => f !== folder)].slice(0, 8);
  state.currentFolder = folder;
  persist();
}

// ---- window ----------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 940, minWidth: 1040, minHeight: 700,
    titleBarStyle: 'hiddenInset', backgroundColor: '#cfc3ac',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, plugins: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });

  if (SHOT_PATH) {
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, DEMO ? 1400 : 700));
      try {
        const img = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(path.resolve(SHOT_PATH)), { recursive: true });
        fs.writeFileSync(path.resolve(SHOT_PATH), img.toPNG());
        console.log('screenshot →', path.resolve(SHOT_PATH));
      } catch (e) { console.error('shot failed', e); }
      setTimeout(() => app.quit(), 300);
    });
  }
}

app.whenReady().then(() => {
  loadState();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  for (const p of termSessions.values()) { try { p.kill(); } catch (_) {} }
  for (const c of claudeSessions.values()) { try { c.close(); } catch (_) {} }
  for (const a of aiSessions.values()) { try { a.close(); } catch (_) {} }
});

// ---- IPC: boot + folders ---------------------------------------------------
ipcMain.handle('boot', () => ({
  demo: DEMO,
  collapsed: process.argv.includes('--collapsed'),
  stt: !!(process.env.OPENAI_API_KEY || process.env.ELEVENLABS_API_KEY),
  claudeExe: resolveClaudeExecutable(),
  recentFolders: (state.recentFolders || []).map((f) => ({ path: f, pathShort: homeShort(f), name: baseName(f) })),
  currentFolder: state.currentFolder && fs.existsSync(state.currentFolder)
    ? scanFolder(state.currentFolder) : null,
  panels: Array.isArray(state.panels) ? state.panels.slice(0, 12) : [],
}));

// Renderer sends its panel layout after every change; restored on next boot.
ipcMain.handle('panels:save', (_e, { panels }) => { persist({ panels: Array.isArray(panels) ? panels.slice(0, 12) : [] }); return { ok: true }; });

ipcMain.handle('folder:pick', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open a folder' });
  if (res.canceled || !res.filePaths[0]) return null;
  const folder = res.filePaths[0];
  rememberFolder(folder);
  return scanFolder(folder);
});
ipcMain.handle('folder:open', (_e, folder) => {
  if (!folder || !fs.existsSync(folder)) return null;
  rememberFolder(folder);
  return scanFolder(folder);
});
ipcMain.handle('folder:scan', (_e, folder) => (folder && fs.existsSync(folder)) ? scanFolder(folder) : null);
ipcMain.handle('folder:rescan', (_e, folder) => (folder && fs.existsSync(folder)) ? scanFolder(folder) : null);

// ---- IPC: explorer + editor ------------------------------------------------
ipcMain.handle('dir:list', (_e, dir) => {
  try {
    let entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !IGNORE.has(e.name) && !(e.name.startsWith('.') && e.name !== '.claude'))
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
ipcMain.handle('clipboard:write', (_e, text) => { try { clipboard.writeText(String(text || '')); } catch (_) {} return true; });
ipcMain.handle('clipboard:read', () => { try { return clipboard.readText(); } catch (_) { return ''; } });

// ---- IPC: dictation → text (in-app record, OpenAI Whisper / ElevenLabs Scribe) ----
function sttConfig() {
  // env first; a userData/settings.json can override later.
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); } catch (_) {}
  const openai = s.openaiKey || process.env.OPENAI_API_KEY || '';
  const eleven = s.elevenKey || process.env.ELEVENLABS_API_KEY || '';
  const provider = s.sttProvider || (openai ? 'openai' : (eleven ? 'elevenlabs' : ''));
  return { provider, openai, eleven };
}
ipcMain.handle('stt:transcribe', async (_e, { bytes, mime }) => {
  const cfg = sttConfig();
  if (!cfg.provider) return { ok: false, error: 'No OPENAI_API_KEY or ELEVENLABS_API_KEY set' };
  try {
    const buf = Buffer.from(bytes);
    const blob = new Blob([buf], { type: mime || 'audio/webm' });
    const form = new FormData();
    let url, headers;
    if (cfg.provider === 'openai') {
      form.append('file', blob, 'audio.webm');
      form.append('model', 'whisper-1');
      url = 'https://api.openai.com/v1/audio/transcriptions';
      headers = { Authorization: `Bearer ${cfg.openai}` };
    } else {
      form.append('file', blob, 'audio.webm');
      form.append('model_id', 'scribe_v1');
      url = 'https://api.elevenlabs.io/v1/speech-to-text';
      headers = { 'xi-api-key': cfg.eleven };
    }
    const r = await fetch(url, { method: 'POST', headers, body: form });
    if (!r.ok) { const t = await r.text().catch(() => ''); return { ok: false, error: `${cfg.provider} ${r.status}: ${t.slice(0, 140)}` }; }
    const j = await r.json();
    return { ok: true, text: (j.text || '').trim(), provider: cfg.provider };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---- IPC: Claude sessions --------------------------------------------------
ipcMain.handle('claude:start', (_e, { id, cwd, model, agentName, prompt, resumeId }) => {
  if (claudeSessions.has(id)) { try { claudeSessions.get(id).close(); } catch (_) {} }
  const sess = new ClaudeSession({ id, cwd, model, agentName, onEvent: (ev) => send('claude:event', ev) });
  claudeSessions.set(id, sess);
  sess.start(prompt, resumeId);
  return { ok: true };
});
ipcMain.handle('claude:send', (_e, { id, text }) => { const s = claudeSessions.get(id); if (s) s.send(text); return { ok: !!s }; });
ipcMain.handle('claude:permission', (_e, { id, permissionId, allow, note }) => { const s = claudeSessions.get(id); if (s) s.resolvePermission(permissionId, allow, note); return { ok: !!s }; });
ipcMain.handle('claude:interrupt', (_e, { id }) => { const s = claudeSessions.get(id); if (s) s.interrupt(); return { ok: !!s }; });
ipcMain.handle('claude:close', (_e, { id }) => { const s = claudeSessions.get(id); if (s) { s.close(); claudeSessions.delete(id); } return { ok: true }; });

// ---- IPC: any-model AI sessions (OpenAI-compatible endpoints) ---------------
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (_) { return {}; } }
ipcMain.handle('ai:config:get', () => readSettings().aiModel || null);
ipcMain.handle('ai:config:set', (_e, cfg) => {
  try {
    const s = readSettings(); s.aiModel = cfg;
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ai:start', (_e, { id, cwd, config }) => {
  if (aiSessions.has(id)) { try { aiSessions.get(id).close(); } catch (_) {} }
  const s = new OpenAISession({ id, cwd, config, onEvent: (ev) => send('ai:event', ev) });
  aiSessions.set(id, s);
  return { ok: true };
});
ipcMain.handle('ai:send', (_e, { id, text }) => { const s = aiSessions.get(id); if (s) s.send(text); return { ok: !!s }; });
ipcMain.handle('ai:permission', (_e, { id, permissionId, allow }) => { const s = aiSessions.get(id); if (s) s.resolvePermission(permissionId, allow); return { ok: !!s }; });
ipcMain.handle('ai:close', (_e, { id }) => { const s = aiSessions.get(id); if (s) { s.close(); aiSessions.delete(id); } return { ok: true }; });

// ---- IPC: terminal / harness sessions --------------------------------------
// kind: 'claude' (spawn the logged-in claude directly), 'shell' (a plain shell),
// 'run' (a shell that then runs `command`), 'harness' (spawn `program args`).
ipcMain.handle('term:create', (_e, { id, cwd, cols, rows, kind, command, program, args, seed, cont }) => {
  if (!pty) { send('term:data', { id, data: '\r\n[node-pty unavailable — terminal disabled]\r\n' }); return { ok: false }; }
  const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const claudeExe = resolveClaudeExecutable();

  let file = shellPath, spawnArgs = [], afterStart = null;
  if (kind === 'claude') {
    // cont: restored session — pick the conversation back up in this cwd
    if (claudeExe) { file = claudeExe; spawnArgs = cont ? ['--continue'] : []; }
    else { file = shellPath; afterStart = cont ? 'claude --continue' : 'claude'; }
    if (seed) afterStart = (afterStart ? afterStart + '\r' : '') + ' SEED '; // handled below
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
      env: Object.assign({}, process.env, { TERM: 'xterm-256color', FORCE_COLOR: '1' }),
    });
  } catch (e) { send('term:data', { id, data: '\r\n[could not start: ' + e.message + ']\r\n' }); return { ok: false }; }

  termSessions.set(id, p);
  p.onData((data) => send('term:data', { id, data }));
  p.onExit(({ exitCode }) => { termSessions.delete(id); send('term:exit', { id, code: exitCode }); });

  // Run a launch command in a plain shell (kind 'run' / fallback claude-in-shell).
  if (afterStart && afterStart.indexOf(' SEED ') < 0) setTimeout(() => { try { p.write(afterStart + '\r'); } catch (_) {} }, 200);
  else if (afterStart) setTimeout(() => { try { p.write('claude\r'); } catch (_) {} }, 200);

  // Seed a first message into an interactive claude session once it's ready.
  if (kind === 'claude' && seed) {
    const delay = claudeExe ? 1600 : 2200;
    setTimeout(() => { try { p.write(seed); } catch (_) {} }, delay);
    setTimeout(() => { try { p.write('\r'); } catch (_) {} }, delay + 350);
  }
  return { ok: true };
});
ipcMain.handle('term:write', (_e, { id, data }) => { const p = termSessions.get(id); if (p) try { p.write(data); } catch (_) {} return { ok: !!p }; });
ipcMain.handle('term:resize', (_e, { id, cols, rows }) => { const p = termSessions.get(id); if (p) try { p.resize(cols, rows); } catch (_) {} return { ok: !!p }; });
ipcMain.handle('term:kill', (_e, { id }) => { const p = termSessions.get(id); if (p) { try { p.kill(); } catch (_) {} termSessions.delete(id); } return { ok: true }; });
