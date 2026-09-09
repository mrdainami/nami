const { WebContentsView, BrowserWindow, session, net, app, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { browserUrl, userBrowserUrl, cleanSelection, cleanAnnotationLayout, Access } = require('./browser-policy');
const { buildDocUrl, parseDocUrl, resolveWithinRoot, docContentType } = require('./doc-protocol');

function wireBrowserViews(ipcMain, { readSettings, writeSettings }) {
  const views = new Map(), access = new Access(), partitions = new Map();
  const profiles = require('./browser-profiles').createProfileStore({ directory: path.join(app.getPath('userData'), 'browser-profiles'), safeStorage });
  const profileLocks = new Set();
  let mutations = Promise.resolve(), pendingIdentityChanges = 0;
  let gateway;
  const send = (e, type, data) => { if (!e.window.isDestroyed() && !e.window.webContents.isDestroyed()) e.window.webContents.send('browser:event', { id: e.id, type, ...data }); };
  const mainWindow = (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame) throw new Error('Browser action is not from Nami.');
    return w;
  };
  const find = (w, id) => { const e = views.get(id); if (!e || e.window !== w) throw new Error('Browser view is no longer available.'); return e; };
  function getPartition(w, profileId = 'default', localId = null) {
    profiles.get(profileId);
    const key = localId ? 'local:' + w.webContents.id + ':' + localId : profileId;
    if (partitions.has(key)) return partitions.get(key);
    const record = { key, local: !!localId, session: session.fromPartition((localId ? 'nami-browser-' : 'persist:nami-browser-') + key), roots: new Set() };
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
  async function create(w, args, { pendingCount = 0 } = {}) {
    if (typeof args.id !== 'string' || !/^[\w-]{1,200}$/.test(args.id)) throw new Error('Invalid browser view.');
    if (views.has(args.id)) return find(w, args.id);
    const profileId = args.profileId || profiles.list()[0].id;
    if (profileLocks.has(profileId)) throw new Error('Browser profile is being updated. Try again shortly.');
    const record = getPartition(w, profileId, args.filePath ? args.id : null);
    let url;
    if (args.filePath) {
      const file = fs.realpathSync(args.filePath);
      if (!/\.html?$/i.test(file) || !fs.statSync(file).isFile()) throw new Error('Choose an HTML file.');
      const root = path.dirname(file); record.roots.add(root); url = buildDocUrl(root, file);
    } else url = args.userNavigation ? userBrowserUrl(args.url) || 'about:blank' : browserUrl(args.url || 'about:blank');
    const view = new WebContentsView({ webPreferences: { session: record.session, preload: path.join(__dirname, 'browser-preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    const e = { id: args.id, identity: randomUUID(), owner: args.owner, profileId, pendingCount, record, window: w, view, filePath: args.filePath, localUrl: args.filePath ? url : null };
    views.set(e.id, e); w.contentView.addChildView(view); view.setVisible(false);
    const wc = view.webContents;
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.meta || input.control) && !input.alt && String(input.key).toLowerCase() === 'l') { event.preventDefault(); w.webContents.focus(); send(e, 'address-focus', {}); }
    });
    const allowed = (value) => { try { browserUrl(value); return true; } catch (_) { const p = parseDocUrl(value); return !!(p && e.localUrl && record.roots.has(p.root)); } };
    const checkNavigation = (event, target) => {
      if (!allowed(target)) { event.preventDefault(); return; }
      // Local documents never acquire a named profile's signed-in identity
      // through a page-controlled navigation. External links open a web tab.
      if (record.local && /^https?:/.test(target)) { event.preventDefault(); send(e, 'new-tab', { url: target, profileId: e.profileId }); }
    };
    wc.on('will-navigate', checkNavigation);
    wc.on('will-redirect', checkNavigation);
    wc.setWindowOpenHandler(({ url: target }) => { if (allowed(target) && /^https?:/.test(target)) send(e, 'new-tab', { url: target, profileId: e.profileId }); return { action: 'deny' }; });
    const update = () => {
      const local = parseDocUrl(wc.getURL());
      e.filePath = local ? resolveWithinRoot(local.root, local.rel) : null;
      send(e, 'state', { filePath: e.filePath, profileId: e.profileId, zoom: wc.getZoomFactor(), url: e.filePath || wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward() });
    };
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) wc.on(ev, update);
    wc.on('did-finish-load', () => send(e, 'error', { error: '' }));
    wc.on('did-fail-load', (_event, code, description, _url, main) => { if (main && code !== -3) send(e, 'error', { error: description }); });
    wc.on('render-process-gone', () => send(e, 'error', { error: 'Page stopped. Reload to try again.' }));
    wc.on('context-menu', (_event, params) => { if (params.selectionText) send(e, 'selection', { selection: cleanSelection({ text: params.selectionText, label: 'Selected text' }, e.filePath || wc.getURL()) }); });
    await wc.loadURL(url).catch((error) => send(e, 'error', { error: error.message }));
    return e;
  }
  async function remove(id, { notify = true, confirmed = false } = {}) {
    const e = views.get(id); if (!e) return;
    if (e.pendingCount && !confirmed) throw new Error('This tab has pending annotations. Review or discard them in Nami before closing the tab.');
    views.delete(id);
    for (const s of access.sessions.values()) s.views.delete(id);
    if (notify) send(e, 'closed', {});
    if (!e.window.isDestroyed()) e.window.contentView.removeChildView(e.view);
    if (!e.view.webContents.isDestroyed()) e.view.webContents.close();
    if (e.record.local) { e.record.roots.clear(); e.record.session.protocol.unhandle('nami-doc'); partitions.delete(e.record.key); await e.record.session.clearStorageData(); }
  }
  const guarded = (channel, action) => ipcMain.handle(channel, async (ev, args = {}) => {
    try {
      const w = mainWindow(ev);
      const profileMutation = channel === 'browser:profiles' && !['list', 'credentials'].includes(args.action || 'list');
      const navigation = channel === 'browser:action' && args.action === 'navigate';
      const identityChange = (profileMutation && ['switch', 'clear', 'remove', 'import-passwords', 'delete-credential'].includes(args.action)) || (navigation && find(w, args.id).record.local);
      const serialized = profileMutation || navigation || ['browser:create', 'browser:close', 'browser:grant', 'browser:enable', 'browser:sync'].includes(channel);
      // A grant chosen before an identity change must not be replayed against
      // the same tab ID after that change. Ask the user to review it again.
      if (channel === 'browser:grant' && pendingIdentityChanges) throw new Error('Browser profiles are being updated. Review browser access again when the update finishes.');
      if (!serialized) return { ok: true, ...await action(w, args) };
      if (identityChange) pendingIdentityChanges++;
      const run = mutations.then(() => {
        if (w.isDestroyed() || ev.sender.isDestroyed()) throw new Error('The Nami window has closed.');
        return action(w, args);
      }).finally(() => { if (identityChange) pendingIdentityChanges--; });
      mutations = run.catch(() => {});
      return { ok: true, ...await run };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  guarded('browser:create', async (w, args) => { await create(w, args); return {}; });
  guarded('browser:close', async (w, { id, confirmed = false }) => { find(w, id); await remove(id, { confirmed: confirmed === true }); return {}; });
  guarded('browser:layout', (w, { items = [], hidden = false, pending = [] }) => {
    const zoom = w.webContents.getZoomFactor();
    for (const e of views.values()) if (e.window === w) {
      const count = Array.isArray(pending) ? pending.find((p) => p?.id === e.id)?.count : 0;
      e.pendingCount = Number.isInteger(count) ? Math.max(0, Math.min(201, count)) : 0;
      const r = items.find((r) => r.id === e.id);
      const visible = !hidden && r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
      if (visible) e.view.setBounds({ x: Math.max(0, Math.round(r.x * zoom)), y: Math.max(0, Math.round(r.y * zoom)), width: Math.round(r.width * zoom), height: Math.round(r.height * zoom) });
      e.view.setVisible(!!visible);
    }
    return {};
  });
  guarded('browser:resolve', (_w, { value }) => ({ url: userBrowserUrl(value) }));
  guarded('browser:action', async (w, { id, action, url, value }) => {
    const e = find(w, id), wc = e.view.webContents;
    if (action === 'navigate') {
      const target = userBrowserUrl(url);
      if (target && e.record.local && /^https?:/.test(target)) {
        await revokeViews(new Set([e.id]));
        const next = { id: e.id, owner: e.owner, profileId: e.profileId, url: target };
        const pendingCount = e.pendingCount;
        await remove(e.id, { notify: false, confirmed: true });
        const created = await create(w, next, { pendingCount });
        send(created, 'profile-changed', { profileId: created.profileId });
      } else if (target) await wc.loadURL(target);
    }
    else if (action === 'reload') wc.reload();
    else if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'annotate') wc.send('browser:annotate-mode', value || { active: true, mode: 'component' });
    else if (action === 'annotation-track') wc.send('browser:annotation-track', { remove: Array.isArray(value?.remove) ? value.remove.filter((id) => typeof id === 'string').slice(0, 200) : [] });
    else if (action === 'find') { const query = String(value || '').slice(0, 2000); if (query) wc.findInPage(query); }
    else if (action === 'stop-find') wc.stopFindInPage('clearSelection');
    else if (action === 'zoom') { wc.setZoomFactor(Math.min(3, Math.max(0.5, Number(value) || 1))); return { zoom: wc.getZoomFactor() }; }
    else if (action === 'capture') {
      const picture = await wc.capturePage();
      const result = await dialog.showSaveDialog(w, { title: 'Save browser screenshot', defaultPath: 'nami-browser.png', filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath, picture.toPNG());
      return { canceled: result.canceled };
    }
    else if (action === 'cancel-annotation') wc.send('browser:annotate-mode', false);
    return {};
  });
  async function revokeProfile(profileId) {
    const ids = new Set([...views.values()].filter((e) => e.profileId === profileId).map((e) => e.id));
    await revokeViews(ids);
  }
  async function revokeViews(ids) {
    for (const [id, s] of access.sessions) if ([...s.views].some((viewId) => ids.has(viewId))) {
      s.views.clear(); s.peers = [];
      await gateway?.revoke(id);
      s.views.clear(); s.peers = [];
      const window = BrowserWindow.getAllWindows().find((w) => w.webContents.id === s.windowId);
      window?.webContents.send('browser:event', { type: 'access-revoked', sessionId: id, reason: 'Browser profile changed. Grant access again when ready.' });
    }
  }
  async function mutateProfile(profileId, operation) {
    profiles.get(profileId);
    if (profileLocks.has(profileId)) throw new Error('Browser profile is being updated.');
    profileLocks.add(profileId);
    try {
      for (const e of views.values()) if (e.profileId === profileId) e.identity = randomUUID();
      await revokeProfile(profileId); return await operation();
    } finally { profileLocks.delete(profileId); }
  }
  guarded('browser:profiles', async (w, args) => {
    const { action = 'list' } = args;
    const profileId = args.profileId || profiles.list()[0].id;
    let output = {};
    if (action === 'create') output.profile = profiles.create(args.name);
    else if (action === 'rename') output.profile = profiles.rename(profileId, args.name);
    else if (action === 'switch') {
      const e = find(w, args.id); profiles.get(profileId);
      if (profileLocks.has(profileId)) throw new Error('Browser profile is being updated.');
      const oldProfile = e.profileId;
      if (oldProfile === profileId) return { profiles: profiles.list() };
      await mutateProfile(oldProfile, async () => {
        const next = { id: e.id, owner: e.owner, profileId, filePath: e.filePath, url: e.view.webContents.getURL() };
        await remove(e.id, { notify: false, confirmed: true });
        // The shared mutation lane keeps destination imports, removal and
        // grants from running until the replacement view is ready.
        const created = await create(w, next); send(created, 'profile-changed', { profileId });
      });
    } else if (action === 'clear' || action === 'remove') {
      if (args.confirmed !== true) throw new Error('Confirm clearing this Nami browser data first.');
      if (action === 'remove' && profiles.list().length === 1) throw new Error('Keep at least one browser profile.');
      await mutateProfile(profileId, async () => {
        const record = getPartition(w, profileId);
        if (action === 'remove' || args.siteData) {
          const affected = [...views.values()].filter((e) => e.profileId === profileId);
          // Close documents before clearing so running scripts cannot repopulate
          // storage or retain the previous signed-in DOM after the operation.
          for (const entry of affected) await remove(entry.id, { confirmed: true });
          await record.session.clearStorageData(); await record.session.clearCache();
          await record.session.clearAuthCache(); await record.session.cookies.flushStore(); record.roots.clear();
        }
        if (action === 'remove' || args.credentials) profiles.clearCredentials(profileId);
        if (action === 'remove') { profiles.remove(profileId); record.session.protocol.unhandle('nami-doc'); partitions.delete(profileId); }
      });
    } else if (action === 'import-passwords') {
      profiles.get(profileId);
      if (!profiles.available()) throw new Error('macOS protected password storage is unavailable.');
      const chosen = await dialog.showOpenDialog(w, { title: 'Import an exported Chrome password CSV', properties: ['openFile'], filters: [{ name: 'Chrome password export', extensions: ['csv'] }] });
      if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
      const file = chosen.filePaths[0];
      if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Password file is too large (maximum 5 MB).');
      output = await mutateProfile(profileId, () => profiles.importPasswords(profileId, fs.readFileSync(file, 'utf8')));
    } else if (action === 'credentials') {
      const origin = args.id ? new URL(find(w, args.id).view.webContents.getURL()).origin : undefined;
      output.credentials = profiles.credentials(profileId, origin);
    } else if (action === 'delete-credential') {
      await mutateProfile(profileId, () => profiles.deleteCredential(profileId, args.credentialId));
    } else if (action === 'autofill') {
      const e = find(w, args.id), wc = e.view.webContents;
      const origin = new URL(wc.getURL()).origin;
      const credential = profiles.credential(e.profileId, args.credentialId, origin);
      // Explicit trusted action, exact origin, top-level password form only. It
      // does not submit; an agent with page access can see values used in a page.
      let filled;
      try { filled = await wc.executeJavaScript(`(() => {
        if (location.origin !== ${JSON.stringify(origin)}) return false;
        const password = [...document.querySelectorAll('input[type="password"]')].find(el => !el.disabled && el.getClientRects().length);
        if (!password) return false;
        const scope = password.form || document;
        const username = [...scope.querySelectorAll('input[autocomplete="username"],input[type="email"],input[name="username"],input[name="email"],input[type="text"]')].find(el => !el.disabled && el.getClientRects().length);
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        if (username) { set.call(username, ${JSON.stringify(credential.username)}); username.dispatchEvent(new Event('input', { bubbles: true })); username.dispatchEvent(new Event('change', { bubbles: true })); }
        set.call(password, ${JSON.stringify(credential.password)}); password.dispatchEvent(new Event('input', { bubbles: true })); password.dispatchEvent(new Event('change', { bubbles: true })); return true;
      })()`); } catch (_) { throw new Error('This website could not accept autofill. Try entering the password manually.'); }
      if (!filled) throw new Error('No visible sign-in form found on this website.');
      output.filled = true;
    } else if (action !== 'list') throw new Error('Unknown browser profile action.');
    return { ...output, profiles: profiles.list(), capabilities: { passwordCsv: profiles.available(), directChrome: false, cookies: false, history: false } };
  });
  guarded('browser:sync', async (w, { sessions = [] }) => {
    for (const s of sessions.slice(0, 100)) access.register(s.id, w.webContents.id, s.title);
    for (const [id, s] of access.sessions) if (s.windowId === w.webContents.id && !sessions.some((s) => s.id === id)) { await gateway?.revoke(id); access.sessions.delete(id); }
    return {};
  });
  guarded('browser:status', async (w) => {
    const sessions = [...access.sessions].filter(([, s]) => s.windowId === w.webContents.id).map(([id, s]) => ({ id, title: s.title, views: [...s.views], connected: !!gateway?.isConnected(id), peers: [...(s.peers || [])] }));
    return { enabled: !!readSettings().browserEnabled, sessions, views: [...views.values()].filter((e) => e.window === w).map((e) => ({ id: e.id, identity: e.identity, owner: e.owner, profileId: e.profileId, title: e.view.webContents.getTitle(), url: e.filePath || e.view.webContents.getURL() })) };
  });
  guarded('browser:enable', async (_w, { enabled }) => {
    const result = writeSettings({ browserEnabled: !!enabled });
    if (!result.ok) throw new Error(result.error);
    if (!enabled) { for (const s of access.sessions.values()) { s.views.clear(); s.peers = []; } await gateway?.close(); gateway = null; for (const s of access.sessions.values()) { s.views.clear(); s.peers = []; } }
    return {};
  });
  guarded('browser:grant', async (w, { id, viewIds = [], peers = [], expectedIdentities }) => {
    if (!readSettings().browserEnabled) throw new Error('Enable the browser connection in Settings first.');
    for (const vid of viewIds) {
      const entry = find(w, vid);
      if (profileLocks.has(entry.profileId)) throw new Error('Browser profile is being updated.');
      if (expectedIdentities && expectedIdentities[vid] !== entry.identity) throw new Error('A browser profile changed. Reopen Browser access and review the selected tabs.');
    }
    for (const peer of peers) access.get(peer, w.webContents.id);
    await gateway?.revoke(id);
    access.grant(id, w.webContents.id, viewIds); access.get(id).peers = peers.filter((p) => p !== id);
    if (!viewIds.length && !access.get(id).peers.length) return { revoked: true };
    if (!gateway) gateway = await require('./browser-mcp').createBrowserMcp({ access, views, create, remove, send,
      notifyMessage: (windowId, message) => {
        const target = BrowserWindow.getAllWindows().find((w) => w.webContents.id === windowId);
        target?.webContents.send('browser:event', { type: 'message', ...message });
      } });
    return await gateway.connection(id);
  });
  ipcMain.on('browser:annotation-layout', (event, value) => {
    const e = [...views.values()].find((e) => e.view.webContents === event.sender);
    if (!e || event.senderFrame !== event.sender.mainFrame) return;
    const layout = cleanAnnotationLayout(value); if (layout) send(e, 'annotation-layout', { layout });
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
      for (const e of [...views.values()]) if (e.window === w) remove(e.id, { notify: false, confirmed: true });
    });
    w.once('closed', () => {
      for (const [id, s] of access.sessions) if (s.windowId === windowId) gateway?.revoke(id);
      for (const e of [...views.values()]) if (e.window === w) remove(e.id, { confirmed: true });
      access.removeWindow(windowId);
      // Persistent browser sessions are shared only within their named profile.
    });
    w.webContents.once('destroyed', () => { for (const e of [...views.values()]) if (e.window === w) remove(e.id, { confirmed: true }); });
  }
  return { bindWindow, views, access, close: async () => { await gateway?.close(); for (const id of [...views.keys()]) await remove(id, { confirmed: true }); } };
}
module.exports = { wireBrowserViews };
