// Trusted, bounded native surfaces sit above guest pages. Guest webContents
// never receive this channel, app markup, feedback, or input events.
const { BrowserWindow, WebContentsView, dialog } = require('electron');
const path = require('node:path');
function wireBrowserOverlays(ipcMain) {
  const windows = new Map();
  ipcMain.handle('browser:confirm-discard', async (event, { count = 0 } = {}) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame) return false;
    const result = await dialog.showMessageBox(w, { type:'question', message:`Discard ${Math.max(1, Math.min(201, Number(count) || 1))} pending annotation(s)?`, detail:'These notes have not been inserted into a session.', buttons:['Keep notes','Discard'], defaultId:0, cancelId:0 });
    return result.response === 1;
  });
  ipcMain.handle('browser:overlays', async (event, payload = {}) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame) return { ok: false };
    let records = windows.get(w);
    if (!records) {
      records = new Map(); windows.set(w, records);
      let asking=false, approved=false;
      w.on('close', async event => {
        if(approved || !records.pendingCount)return;
        event.preventDefault(); if(asking)return; asking=true;
        try { const result=await dialog.showMessageBox(w,{type:'question',message:'Discard pending browser annotations and close Nami?',detail:'These temporary notes have not been inserted into a session.',buttons:['Keep notes','Discard and close'],defaultId:0,cancelId:0});
          if(result.response===1&&!w.isDestroyed()){approved=true;w.close();}
        } finally {asking=false;}
      });
      const clear = () => { for (const rec of records.values()) { if (!w.isDestroyed()) w.contentView.removeChildView(rec.view); if (!rec.view.webContents.isDestroyed()) rec.view.webContents.close(); } records.clear(); };
      w.once('closed', () => { clear(); windows.delete(w); });
      w.webContents.on('did-start-navigation', (_e, _url, inPlace, main) => { if (main && !inPlace) clear(); });
    }
    records.pendingCount=Math.max(0,Math.min(10000,Number(payload.pendingCount)||0));
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 80) : [];
    const ids = new Set(items.map(x => x.id));
    for (const [id, rec] of records) if (!ids.has(id)) { w.contentView.removeChildView(rec.view); rec.view.webContents.close(); records.delete(id); }
    for (const item of items) {
      if (typeof item.id !== 'string' || typeof item.html !== 'string' || item.html.length > 150000 || ![item.x,item.y,item.width,item.height].every(Number.isFinite) || item.width <= 0 || item.height <= 0) continue;
      let rec = records.get(item.id);
      if (!rec) {
        const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'browser-overlay-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'nami-trusted-overlays' } });
        view.setBackgroundColor('#00000000'); view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        view.webContents.on('will-navigate', e => e.preventDefault());
        rec = { view, window: w, ready: false, pending: null }; records.set(item.id, rec);
        w.contentView.addChildView(view); view.setVisible(false);
        view.webContents.once('did-finish-load', () => { rec.ready = true; if (rec.pending) { view.webContents.setZoomFactor(rec.pending.zoom || 1); view.webContents.send('overlay:render', rec.pending); } view.setVisible(true); });
        view.webContents.loadFile(path.join(__dirname, '../renderer/browser-overlay.html'));
      }
      const zoom = w.webContents.getZoomFactor(), area = w.getContentBounds();
      const x = Math.max(0, Math.round(item.x * zoom)), y = Math.max(0, Math.round(item.y * zoom));
      rec.view.setBounds({ x, y, width: Math.max(1, Math.min(Math.round(item.width * zoom), area.width - x)), height: Math.max(1, Math.min(Math.round(item.height * zoom), area.height - y)) });
      rec.view.webContents.setZoomFactor(zoom);
      rec.pending = { ...item, zoom, theme: payload.theme, glass: payload.glass, soft: payload.soft };
      if (rec.ready) rec.view.webContents.send('overlay:render', rec.pending);
      // Re-add raises the surface after newly created browser tabs.
      w.contentView.addChildView(rec.view);
    }
    return { ok: true };
  });
  ipcMain.on('overlay:input', (event, input) => {
    for (const [w, records] of windows) for (const [id, rec] of records) {
      if (rec.view.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame || w.isDestroyed()) continue;
      if (!input || !['click','input','change','keydown','focus','submit'].includes(input.type) || !Number.isInteger(input.target)) return;
      w.webContents.send('browser:overlay-input', { id, version:input.version, sequence:input.sequence, type: input.type, target: input.target, value: typeof input.value === 'string' ? input.value.slice(0, 100000) : undefined, checked: !!input.checked, key: String(input.key || '').slice(0, 40), shiftKey: !!input.shiftKey });
      return;
    }
  });
  return { windows };
}
module.exports = { wireBrowserOverlays };
