const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dainami', {
  boot: () => ipcRenderer.invoke('boot'),
  droppedFilePath: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },

  pickFolder: () => ipcRenderer.invoke('folder:pick'),
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
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  transcribe: (args) => ipcRenderer.invoke('stt:transcribe', args),
  sttStatus: () => ipcRenderer.invoke('stt:status'),
  sttPrepare: () => ipcRenderer.invoke('stt:prepare'),
  onSttProgress: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('stt:progress', h); return () => ipcRenderer.removeListener('stt:progress', h); },

  savePanels: (args) => ipcRenderer.invoke('panels:save', args),
  loadPanels: (folder) => ipcRenderer.invoke('panels:load', folder),
  recentsPin: (path, pinned) => ipcRenderer.invoke('recents:pin', { path, pinned }),
  recentsRemove: (path) => ipcRenderer.invoke('recents:remove', path),
  onRecentsChanged: (cb) => { const h = (_e, rows) => cb(rows); ipcRenderer.on('recents:changed', h); return () => ipcRenderer.removeListener('recents:changed', h); },
  newWindow: (folder) => ipcRenderer.invoke('window:new', { folder }),
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  agentStatus: (id) => ipcRenderer.invoke('agents:status', { id }),
  agentRemovalPlan: (id, binPath) => ipcRenderer.invoke('agents:removalPlan', { id, binPath }),
  agentRemove: (id, binPath) => ipcRenderer.invoke('agents:remove', { id, binPath }),
  listServices: (args) => ipcRenderer.invoke('services:list', args),
  connectService: (args) => ipcRenderer.invoke('services:connect', args),
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
  pointerStatus: (args) => ipcRenderer.invoke('pointer:status', args),
  pointerWrite: (args) => ipcRenderer.invoke('pointer:write', args),
  fsNewFile: (args) => ipcRenderer.invoke('fs:newFile', args),
  fsNewFolder: (args) => ipcRenderer.invoke('fs:newFolder', args),
  fsMove: (args) => ipcRenderer.invoke('fs:move', args),
  fsTrash: (args) => ipcRenderer.invoke('fs:trash', args),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),

  claudeStart: (args) => ipcRenderer.invoke('claude:start', args),
  claudeSend: (args) => ipcRenderer.invoke('claude:send', args),
  claudePermission: (args) => ipcRenderer.invoke('claude:permission', args),
  claudeInterrupt: (args) => ipcRenderer.invoke('claude:interrupt', args),
  claudeClose: (args) => ipcRenderer.invoke('claude:close', args),
  onClaudeEvent: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('claude:event', h); return () => ipcRenderer.removeListener('claude:event', h); },

  termCreate: (args) => ipcRenderer.invoke('term:create', args),
  termWrite: (args) => ipcRenderer.invoke('term:write', args),
  termResize: (args) => ipcRenderer.invoke('term:resize', args),
  termKill: (args) => ipcRenderer.invoke('term:kill', args),
  onTermData: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('term:data', h); return () => ipcRenderer.removeListener('term:data', h); },
  onTermExit: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('term:exit', h); return () => ipcRenderer.removeListener('term:exit', h); },
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
