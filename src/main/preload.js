const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dainami', {
  boot: () => ipcRenderer.invoke('boot'),
  // The renderer styles window chrome per OS (traffic-light deck on mac,
  // titleBarOverlay clearance on windows); a string beats an IPC round-trip.
  platform: process.platform,
  onFullScreen: (cb) => { const h = (_e, on) => cb(on); ipcRenderer.on('window:fullscreen', h); return () => ipcRenderer.removeListener('window:fullscreen', h); },
  droppedFilePath: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },

  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  // Same return shape as pickFolder, so the renderer switches to it the same
  // way — it just made the folder first, and left a note in it.
  makeFolder: () => ipcRenderer.invoke('folder:make'),
  // commit:false reads the folder without adopting it — the renderer needs the
  // scan before it can decide whether the switch happens at all.
  openFolder: (folder, commit) => ipcRenderer.invoke('folder:open', { folder, commit: commit !== false }),
  scanFolder: (folder) => ipcRenderer.invoke('folder:scan', folder),
  rescanFolder: (folder) => ipcRenderer.invoke('folder:rescan', folder),

  readFile: (file) => ipcRenderer.invoke('file:read', file),
  listDir: (dir, all) => ipcRenderer.invoke('dir:list', { dir, all: !!all }),
  rawFile: (file) => ipcRenderer.invoke('file:raw', file),
  saveFile: (args) => ipcRenderer.invoke('file:save', args),
  statPath: (args) => ipcRenderer.invoke('path:stat', args),
  revealFile: (file) => ipcRenderer.invoke('file:reveal', file),
  openFileInBrowser: (file) => ipcRenderer.invoke('file:openBrowser', file),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  transcribe: (args) => ipcRenderer.invoke('stt:transcribe', args),
  sttStatus: () => ipcRenderer.invoke('stt:status'),
  sttPrepare: () => ipcRenderer.invoke('stt:prepare'),
  onSttProgress: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('stt:progress', h); return () => ipcRenderer.removeListener('stt:progress', h); },

  openLink: (url) => ipcRenderer.invoke('link:open', url),
  acpStart: (args) => ipcRenderer.invoke('acp:start', args),
  acpSend: (args) => ipcRenderer.invoke('acp:send', args),
  acpKill: (args) => ipcRenderer.invoke('acp:kill', args),
  onAcpMsg: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('acp:msg', h); return () => ipcRenderer.removeListener('acp:msg', h); },
  onAcpErr: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('acp:err', h); return () => ipcRenderer.removeListener('acp:err', h); },
  onAcpExit: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('acp:exit', h); return () => ipcRenderer.removeListener('acp:exit', h); },
  savePanels: (args) => ipcRenderer.invoke('panels:save', args),
  loadPanels: (folder) => ipcRenderer.invoke('panels:load', folder),
  recentsPin: (path, pinned) => ipcRenderer.invoke('recents:pin', { path, pinned }),
  recentsRemove: (path) => ipcRenderer.invoke('recents:remove', path),
  onRecentsChanged: (cb) => { const h = (_e, rows) => cb(rows); ipcRenderer.on('recents:changed', h); return () => ipcRenderer.removeListener('recents:changed', h); },
  // openFile is only set by the switch sheet: the desk declined to change
  // folders, so the file rides along to the window being made instead.
  newWindow: (folder, openFile) => ipcRenderer.invoke('window:new', { folder, openFile: openFile || null }),

  // Finder opened a file with Nami. adopt says the folder has to change first;
  // without it the file already lives on this desk. See src/main/open-with.js.
  onOpenFile: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('open:file', h); return () => ipcRenderer.removeListener('open:file', h); },

  // One channel for the whole menu bar. Every Nami item in it is a string this
  // window turns into the same call the keyboard already made, so the menu adds
  // labels rather than a second way for anything to work.
  onMenuCommand: (cb) => { const h = (_e, cmd) => cb(cmd); ipcRenderer.on('menu:command', h); return () => ipcRenderer.removeListener('menu:command', h); },
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  agentStatus: (id) => ipcRenderer.invoke('agents:status', { id }),
  agentRemovalPlan: (id, binPath) => ipcRenderer.invoke('agents:removalPlan', { id, binPath }),
  agentRemove: (id, binPath) => ipcRenderer.invoke('agents:remove', { id, binPath }),
  listServices: (args) => ipcRenderer.invoke('services:list', args),
  connectService: (args) => ipcRenderer.invoke('services:connect', args),
  deliverServices: (args) => ipcRenderer.invoke('services:deliver', args),
  pickBundle: () => ipcRenderer.invoke('services:pickBundle'),
  connectCustom: (args) => ipcRenderer.invoke('services:connectCustom', args),
  disconnectService: (args) => ipcRenderer.invoke('services:disconnect', args),
  openUrl: (url) => ipcRenderer.invoke('url:open', url),
  themeSet: (theme) => ipcRenderer.invoke('theme:set', theme),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  keysGet: () => ipcRenderer.invoke('keys:get'),
  settingsReveal: () => ipcRenderer.invoke('settings:reveal'),
  keysSet: (name, value) => ipcRenderer.invoke('keys:set', { name, value }),
  keysDelete: (name) => ipcRenderer.invoke('keys:delete', { name }),
  keysReveal: (name) => ipcRenderer.invoke('keys:reveal', { name }),

  libraryScan: (args) => ipcRenderer.invoke('library:scan', args),
  libraryCreate: (args) => ipcRenderer.invoke('library:create', args),
  libraryDuplicate: (args) => ipcRenderer.invoke('library:duplicate', args),
  libraryDelete: (args) => ipcRenderer.invoke('library:delete', args),
  deliverAgents: (args) => ipcRenderer.invoke('library:deliverAgents', args),
  agentDelivery: (args) => ipcRenderer.invoke('library:agentDelivery', args),
  importAgent: (args) => ipcRenderer.invoke('library:importAgent', args),
  adoptAgent: (args) => ipcRenderer.invoke('library:adoptAgent', args),
  pointerStatus: (args) => ipcRenderer.invoke('pointer:status', args),
  pointerWrite: (args) => ipcRenderer.invoke('pointer:write', args),
  fsNewFile: (args) => ipcRenderer.invoke('fs:newFile', args),
  fsNewFolder: (args) => ipcRenderer.invoke('fs:newFolder', args),
  fsMove: (args) => ipcRenderer.invoke('fs:move', args),
  fsRename: (args) => ipcRenderer.invoke('fs:rename', args),
  // Files dragged in from Finder. Paths come from droppedFilePath above, never
  // File.path — Electron removed that in v32 and it reads undefined here.
  fsImport: (args) => ipcRenderer.invoke('fs:import', args),
  fsDuplicate: (args) => ipcRenderer.invoke('fs:duplicate', args),
  fsTrash: (args) => ipcRenderer.invoke('fs:trash', args),
  // The tree declares every folder it can see; main diffs that against the
  // watchers it has open and reports back { watching, overflow, failed }.
  dirWatch: (root) => ipcRenderer.invoke('dir:watch', { root }),
  onDirChanged: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('dir:changed', h); return () => ipcRenderer.removeListener('dir:changed', h); },
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),

  termCreate: (args) => ipcRenderer.invoke('term:create', args),
  termWrite: (args) => ipcRenderer.invoke('term:write', args),
  termResize: (args) => ipcRenderer.invoke('term:resize', args),
  termKill: (args) => ipcRenderer.invoke('term:kill', args),
  onTermData: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('term:data', h); return () => ipcRenderer.removeListener('term:data', h); },
  onTermCommandDone: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('term:command-done', h); return () => ipcRenderer.removeListener('term:command-done', h); },
  onTermExit: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('term:exit', h); return () => ipcRenderer.removeListener('term:exit', h); },

  // Main found the conversation a terminal-run agent tile landed in, by
  // polling the agent's store after spawn — { id, sid }. The renderer saves
  // it as acpSid so the next launch resumes it.
  onTermSessionId: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('term:session-id', h); return () => ipcRenderer.removeListener('term:session-id', h); },

  // claude worked out a name for this conversation — { id, title }
  onSessionTitle: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('session:title', h); return () => ipcRenderer.removeListener('session:title', h); },
  // Claude moved this tile to a different conversation (the user ran /resume).
  // The panel has to store the new id or the next launch resumes the wrong one.
  onSessionSid: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('session:sid', h); return () => ipcRenderer.removeListener('session:sid', h); },

  // A newer Nami exists — { version, url }. Only ever fires when there is one;
  // silence is the normal case and means nothing went wrong.
  onUpdateAvailable: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('update:available', h); return () => ipcRenderer.removeListener('update:available', h); },
  openUpdate: (url) => ipcRenderer.invoke('update:open', url),
  updateStatus: () => ipcRenderer.invoke('update:status'),

  // Downloading one. All three fire on every window, because one download
  // serves the whole app — see main's update:download.
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  updaterState: () => ipcRenderer.invoke('update:state'),
  liveSessions: () => ipcRenderer.invoke('update:sessions'),
  onUpdateProgress: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('update:progress', h); return () => ipcRenderer.removeListener('update:progress', h); },
  onUpdateReady: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('update:ready', h); return () => ipcRenderer.removeListener('update:ready', h); },
  onUpdateFailed: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('update:failed', h); return () => ipcRenderer.removeListener('update:failed', h); },
  appVersion: () => ipcRenderer.invoke('app:version'),
});
