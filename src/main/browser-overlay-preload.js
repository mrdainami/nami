const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('namiOverlay', {
  onRender: cb => ipcRenderer.on('overlay:render', (_event, data) => cb(data)),
  input: data => ipcRenderer.send('overlay:input', data),
});
