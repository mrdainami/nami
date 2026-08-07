const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dainami', {
  boot: () => ipcRenderer.invoke('boot'),
  droppedFilePath: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },

  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  openFolder: (folder) => ipcRenderer.invoke('folder:open', folder),
  scanFolder: (folder) => ipcRenderer.invoke('folder:scan', folder),
  rescanFolder: (folder) => ipcRenderer.invoke('folder:rescan', folder),

  readFile: (file) => ipcRenderer.invoke('file:read', file),
  listDir: (dir) => ipcRenderer.invoke('dir:list', dir),
  rawFile: (file) => ipcRenderer.invoke('file:raw', file),
  saveFile: (args) => ipcRenderer.invoke('file:save', args),
  statPath: (args) => ipcRenderer.invoke('path:stat', args),
  revealFile: (file) => ipcRenderer.invoke('file:reveal', file),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  transcribe: (args) => ipcRenderer.invoke('stt:transcribe', args),

  savePanels: (args) => ipcRenderer.invoke('panels:save', args),
  libraryScan: (args) => ipcRenderer.invoke('library:scan', args),
  libraryCreate: (args) => ipcRenderer.invoke('library:create', args),
  libraryDuplicate: (args) => ipcRenderer.invoke('library:duplicate', args),

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
});
