const { WebContentsView, BrowserWindow, session, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { browserUrl, cleanSelection, Access } = require('./browser-policy');
const { buildDocUrl, parseDocUrl, resolveWithinRoot, docContentType } = require('./doc-protocol');

function wireBrowserViews(ipcMain, { readSettings, writeSettings }) {
  const views = new Map(), access = new Access(), partitions = new Map();
  let gateway;
  const send = (e, type, data) => { if (!e.window.isDestroyed() && !e.window.webContents.isDestroyed()) e.window.webContents.send('browser:event', { id: e.id, type, ...data }); };
  const mainWindow = (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame) throw new Error('Browser action is not from Nami.');
    return w;
  };
  const find = (w, id) => { const e = views.get(id); if (!e || e.window !== w) throw new Error('Browser view is no longer available.'); return e; };
  function getPartition(w, owner) {
    const key = w.webContents.id + ':' + owner;
    if (partitions.has(key)) return partitions.get(key);
    const record = { session: session.fromPartition('nami-browser-' + key), roots: new Set() };
    record.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    record.session.setPermissionCheckHandler(() => false);
    record.session.on('will-download', (event) => event.preventDefault());
    record.session.protocol.handle('nami-doc', async (request) => {
      const p = parseDocUrl(request.url);
      const file = p && record.roots.has(p.root) && resolveWithinRoot(p.root, p.rel);
      if (!file) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Type', docContentType(file));
      headers.set('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; form-action 'none'");
      return new Response(response.body, { status: response.status, headers });
    });
    partitions.set(key, record); return record;
  }
  async function create(w, args) {
    if (typeof args.id !== 'string' || !/^[\w-]{1,200}$/.test(args.id)) throw new Error('Invalid browser view.');
    if (views.has(args.id)) return find(w, args.id);
    const record = getPartition(w, args.owner || args.id);
    let url;
    if (args.filePath) {
      const file = fs.realpathSync(args.filePath);
      if (!/\.html?$/i.test(file) || !fs.statSync(file).isFile()) throw new Error('Choose an HTML file.');
      const root = path.dirname(file); record.roots.add(root); url = buildDocUrl(root, file);
    } else url = browserUrl(args.url || 'about:blank');
    const view = new WebContentsView({ webPreferences: { session: record.session, preload: path.join(__dirname, 'browser-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    const e = { id: args.id, owner: args.owner, window: w, view, filePath: args.filePath, localUrl: args.filePath ? url : null };
    views.set(e.id, e); w.contentView.addChildView(view); view.setVisible(false);
    const wc = view.webContents;
    const allowed = (value) => { try { browserUrl(value); return true; } catch (_) { const p = parseDocUrl(value); return !!(p && e.localUrl && record.roots.has(p.root)); } };
    wc.on('will-navigate', (event, target) => { if (!allowed(target)) event.preventDefault(); });
    wc.on('will-redirect', (event, target) => { if (!allowed(target)) event.preventDefault(); });
    wc.setWindowOpenHandler(({ url: target }) => { if (allowed(target) && /^https?:/.test(target)) send(e, 'new-tab', { url: target }); return { action: 'deny' }; });
    const update = () => {
      const local = parseDocUrl(wc.getURL());
      e.filePath = local ? resolveWithinRoot(local.root, local.rel) : null;
      send(e, 'state', { filePath: e.filePath, url: e.filePath || wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward() });
    };
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) wc.on(ev, update);
    wc.on('did-finish-load', () => send(e, 'error', { error: '' }));
    wc.on('did-fail-load', (_event, code, description, _url, main) => { if (main && code !== -3) send(e, 'error', { error: description }); });
    wc.on('render-process-gone', () => send(e, 'error', { error: 'Page stopped. Reload to try again.' }));
    wc.on('context-menu', (_event, params) => { if (params.selectionText) send(e, 'selection', { selection: cleanSelection({ text: params.selectionText, label: 'Selected text' }, e.filePath || wc.getURL()) }); });
    await wc.loadURL(url).catch((error) => send(e, 'error', { error: error.message }));
    return e;
  }
  async function remove(id, { notify = true } = {}) {
    const e = views.get(id); if (!e) return;
    views.delete(id);
    for (const s of access.sessions.values()) s.views.delete(id);
    if (notify) send(e, 'closed', {});
    if (!e.window.isDestroyed()) e.window.contentView.removeChildView(e.view);
    if (!e.view.webContents.isDestroyed()) e.view.webContents.close();
  }
  const guarded = (channel, action) => ipcMain.handle(channel, async (ev, args = {}) => {
    try { return { ok: true, ...await action(mainWindow(ev), args) }; } catch (error) { return { ok: false, error: error.message }; }
  });
  guarded('browser:create', async (w, args) => { await create(w, args); return {}; });
  guarded('browser:close', async (w, { id }) => { find(w, id); await remove(id); return {}; });
  guarded('browser:layout', (w, { items = [], hidden = false }) => {
    const zoom = w.webContents.getZoomFactor();
    for (const e of views.values()) if (e.window === w) {
      const r = items.find((r) => r.id === e.id);
      const visible = !hidden && r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
      if (visible) e.view.setBounds({ x: Math.max(0, Math.round(r.x * zoom)), y: Math.max(0, Math.round(r.y * zoom)), width: Math.round(r.width * zoom), height: Math.round(r.height * zoom) });
      e.view.setVisible(!!visible);
    }
    return {};
  });
  guarded('browser:action', async (w, { id, action, url }) => {
    const e = find(w, id), wc = e.view.webContents;
    if (action === 'navigate') { await wc.loadURL(browserUrl(url)); }
    else if (action === 'reload') wc.reload();
    else if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'annotate') wc.send('browser:annotate-mode', true);
    else if (action === 'cancel-annotation') wc.send('browser:annotate-mode', false);
    return {};
  });
  guarded('browser:sync', async (w, { sessions = [] }) => {
    for (const s of sessions.slice(0, 100)) access.register(s.id, w.webContents.id, s.title);
    for (const [id, s] of access.sessions) if (s.windowId === w.webContents.id && !sessions.some((s) => s.id === id)) { await gateway?.revoke(id); access.sessions.delete(id); }
    return {};
  });
  guarded('browser:status', async (w) => {
    const sessions = [...access.sessions].filter(([, s]) => s.windowId === w.webContents.id).map(([id, s]) => ({ id, title: s.title, views: [...s.views], peers: [...(s.peers || [])] }));
    return { enabled: !!readSettings().browserEnabled, sessions, views: [...views.values()].filter((e) => e.window === w).map((e) => ({ id: e.id, owner: e.owner, title: e.view.webContents.getTitle(), url: e.filePath || e.view.webContents.getURL() })) };
  });
  guarded('browser:enable', async (_w, { enabled }) => {
    const result = writeSettings({ browserEnabled: !!enabled });
    if (!result.ok) throw new Error(result.error);
    if (!enabled) { for (const s of access.sessions.values()) { s.views.clear(); s.peers = []; } await gateway?.close(); gateway = null; }
    return {};
  });
  guarded('browser:grant', async (w, { id, viewIds = [], peers = [] }) => {
    if (!readSettings().browserEnabled) throw new Error('Enable the browser connection in Settings first.');
    for (const vid of viewIds) find(w, vid);
    for (const peer of peers) access.get(peer, w.webContents.id);
    await gateway?.revoke(id);
    access.grant(id, w.webContents.id, viewIds); access.get(id).peers = peers.filter((p) => p !== id);
    if (!gateway) gateway = await require('./browser-mcp').createBrowserMcp({ access, views, create, remove, send,
      notifyMessage: (windowId, message) => {
        const target = BrowserWindow.getAllWindows().find((w) => w.webContents.id === windowId);
        target?.webContents.send('browser:event', { type: 'message', ...message });
      } });
    return await gateway.connection(id);
  });
  for (const [channel, type] of [['browser:selection', 'selection'], ['browser:text-selection', 'text-selection'], ['browser:annotation-end', 'annotation-end'], ['browser:focus', 'focus']]) {
    ipcMain.on(channel, (event, value) => {
      const e = [...views.values()].find((e) => e.view.webContents === event.sender);
      if (!e || event.senderFrame !== event.sender.mainFrame) return;
      try { send(e, type, { selection: ['annotation-end', 'focus'].includes(type) ? null : cleanSelection(value, e.filePath || event.sender.getURL()) }); } catch (_) {}
    });
  }
  function bindWindow(w) {
    const windowId = w.webContents.id;
    w.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace) return;
      for (const [id, s] of access.sessions) if (s.windowId === windowId) gateway?.revoke(id);
      access.removeWindow(windowId);
      for (const e of [...views.values()]) if (e.window === w) remove(e.id, { notify: false });
    });
    w.once('closed', () => {
      for (const [id, s] of access.sessions) if (s.windowId === windowId) gateway?.revoke(id);
      for (const e of [...views.values()]) if (e.window === w) remove(e.id);
      access.removeWindow(windowId);
      for (const key of partitions.keys()) if (key.startsWith(windowId + ':')) partitions.delete(key);
    });
    w.webContents.once('destroyed', () => { for (const e of [...views.values()]) if (e.window === w) remove(e.id); });
  }
  return { bindWindow, views, access, close: async () => { await gateway?.close(); for (const id of [...views.keys()]) await remove(id); } };
}
module.exports = { wireBrowserViews };
