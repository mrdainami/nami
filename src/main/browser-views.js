const { WebContentsView, BrowserWindow, session, net, app, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { browserUrl, userBrowserUrl, isBlankTab, cleanSelection, cleanAnnotationLayout, Access, loadFailureMessage, browserUserAgent } = require('./browser-policy');
const { buildDocUrl, parseDocUrl, resolveWithinRoot, docContentType } = require('./doc-protocol');
const { createProfileStore, uniqueDownloadPath, popupDecision, permissionAllowed, detectChromiumProfiles, selectChromiumImportSource, cookieImportStatus, popupModeOf } = require('./browser-profiles');
const { createImportJobs } = require('./browser-import-jobs');
const { createImportWorker } = require('./browser-import-worker');
const WELCOME = path.join(__dirname, '../renderer/browser-welcome.html');

function blankMode(settings) {
  const mode = settings?.browserNewTab;
  return mode === 'dark' || mode === 'light' ? mode : 'system';
}
function namiThemeIsDark(settings) {
  const theme = settings?.theme || '';
  return theme === 'operator' || theme === 'graphite' || theme === 'dusk';
}
// "System" means Nami's own theme. It used to fall through to the Mac's dark
// mode when Nami was light, which on a light desk over a dark Mac gave a dark
// new tab, then a dark website, then a light desk again — the flicker people
// reported. Nami is the system the tab lives in.
function blankIsDark(mode, settings) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return namiThemeIsDark(settings);
}
// Websites read prefers-color-scheme from Chromium, which reads it from the
// Mac unless told otherwise. Tell it, so a page renders in the same mode as
// the desk around it. Nami's own window styles itself by data-theme and never
// consults this, so nothing there moves.
function syncNativeTheme(settings) {
  try { require('electron').nativeTheme.themeSource = blankIsDark(blankMode(settings), settings) ? 'dark' : 'light'; } catch {}
}
async function paintBlank(wc, dark) {
  if (!wc || wc.isDestroyed()) return;
  const css = dark
    ? 'html{color-scheme:only dark}html,body{background:#1f1f1f !important}'
    : 'html{color-scheme:only light}html,body{background:#fffdf6 !important}';
  await wc.insertCSS(css).catch(() => {});
}

function wireBrowserViews(ipcMain, { readSettings, writeSettings }) {
  // Status is polled frequently. Never turn a UI refresh into filesystem or
  // macOS privacy access; only startup and an explicit toggle touch settings.
  let browserEnabled = !!readSettings().browserEnabled;
  const views = new Map(), access = new Access(), partitions = new Map();
  function applyBlankAppearance(mode) {
    const settings = readSettings();
    const dark = blankIsDark(mode, settings);
    for (const e of views.values()) {
      const wc = e.view?.webContents;
      if (!wc || wc.isDestroyed()) continue;
      try {
        if (!isBlankTab(wc.getURL())) continue;
      } catch { continue; }
      e.view.setBackgroundColor(dark ? '#1f1f1f' : '#fffdf6');
      paintBlank(wc, dark);
    }
  }
  try {
    require('electron').nativeTheme.on('updated', () => {
      if (blankMode(readSettings()) === 'system') applyBlankAppearance('system');
    });
  } catch {}
  syncNativeTheme(readSettings());
  ipcMain.on('theme:applied', () => {
    syncNativeTheme(readSettings());
    if (blankMode(readSettings()) === 'system') applyBlankAppearance('system');
  });
  const profiles = createProfileStore({ directory: path.join(app.getPath('userData'), 'browser-profiles'), safeStorage });
  const contexts = new (require('./browser-context').SessionContextStore)();
  const { AnnotationImageStore, captureRect } = require('./browser-images');
  const images = new AnnotationImageStore(path.join(app.getPath('userData'), 'annotation-images'));
  const captures = new Map();
  const profileLocks = new Set(), importBlocks = new Set();
  const importJobs = createImportJobs({
    resolveSource: id => selectChromiumImportSource(detectChromiumProfiles(), id),
    resolveProfile: id => profiles.get(id),
    createWorker: createImportWorker,
    applyBatch: (job, category, rows) => mutateProfile(job.profileId, async () => {
      profiles.get(job.profileId);
      if (job.cancelled()) return { copied: 0 };
      if (category === 'passwords') return { copied: profiles.importLogins(job.profileId, rows).imported };
      if (category === 'history') {
        const previous = job.firstBatch ? [] : profiles.get(job.profileId).history || [];
        profiles.setHistory(job.profileId, previous.concat(rows));
        return { copied: rows.length };
      }
      const record = partitions.get(job.profileId);
      if (!record) throw new Error('Import destination is no longer available.');
      let copied = 0, failed = 0;
      for (const row of rows) {
        if (job.cancelled()) break;
        try { await record.session.cookies.set(row); copied++; } catch { failed++; }
        if ((copied + failed) % 25 === 0) await new Promise(resolve => setImmediate(resolve));
      }
      return { copied, failed };
    }),
    onChange: (job, owner) => {
      const w = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.id === owner);
      w?.webContents.send('browser:event', { type: 'import-job', job });
    },
  });
  let importsStopped = false;
  app.on('before-quit', event => {
    if (importsStopped) return;
    event.preventDefault();
    importJobs.shutdown().finally(() => { importsStopped = true; app.quit(); });
  });
  let mutations = Promise.resolve(), pendingIdentityChanges = 0;
  let gateway, gatewayStarting;
  const send = (e, type, data) => { if (type !== 'closed' && views.get(e.id) !== e) return; if (!e.window.isDestroyed() && !e.window.webContents.isDestroyed()) e.window.webContents.send('browser:event', { id: e.id, type, ...data }); };
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
    record.session.setUserAgent(browserUserAgent(record.session.getUserAgent()));
    record.session.setPermissionRequestHandler((wc, permission, callback) => {
      let origin = '';
      try { origin = new URL(wc.getURL()).origin; } catch {}
      const e = [...views.values()].find((v) => v.view.webContents === wc);
      const profileId = e?.profileId || 'default';
      try {
        if (permissionAllowed(profiles.get(profileId).permissions?.[origin], permission)) { callback(true); return; }
        profiles.notePermissionRequest(profileId, origin, permission);
      } catch {}
      callback(false);
    });
    record.session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      let origin = '';
      try { origin = requestingOrigin ? new URL(requestingOrigin).origin : ''; } catch { origin = ''; }
      const e = [...views.values()].find((v) => v.record === record);
      try { return permissionAllowed(profiles.get(e?.profileId || 'default').permissions?.[origin], permission); }
      catch { return false; }
    });
    record.session.on('will-download', (_event, item, wc) => {
      const e = [...views.values()].find((v) => v.view.webContents === wc);
      let mode = 'ask';
      try { mode = profiles.get(e?.profileId || 'default').downloadMode === 'auto' ? 'auto' : 'ask'; } catch {}
      if (mode === 'auto') item.setSavePath(uniqueDownloadPath(app.getPath('downloads'), item.getFilename()));
    });
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
  async function create(w, args, { pendingCount = 0, replacing = null } = {}) {
    if (typeof args.id !== 'string' || !/^[\w-]{1,200}$/.test(args.id)) throw new Error('Invalid browser view.');
    if (views.has(args.id) && views.get(args.id) !== replacing) return find(w, args.id);
    const profileId = args.profileId || profiles.list()[0].id;
    if (profileLocks.has(profileId) || importBlocks.has(profileId)) throw new Error('Browser profile is being updated. Try again shortly.');
    // Validate before allocating or abandoning a working view.
    let url, root;
    if (args.filePath) {
      const file = fs.realpathSync(args.filePath);
      if (!/\.html?$/i.test(file) || !fs.statSync(file).isFile()) throw new Error('Choose an HTML file.');
      root = path.dirname(file); url = buildDocUrl(root, file);
    } else url = args.userNavigation ? userBrowserUrl(args.url) || 'about:blank' : browserUrl(args.url || 'about:blank');
    const settings = readSettings();
    const dark = blankIsDark(blankMode(settings), settings);
    // A replacement local document gets its own ephemeral partition. Retiring
    // the previous document must not clear the new document's approved root.
    const localId = args.filePath ? (replacing ? args.id + '-' + randomUUID() : args.id) : null;
    const record = getPartition(w, profileId, localId);
    if (root) record.roots.add(root);
    let view;
    try {
      view = new WebContentsView({ webPreferences: { session: record.session, preload: path.join(__dirname, 'browser-preload.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
      view.setBackgroundColor(dark ? '#1f1f1f' : '#fffdf6');
      const e = { id: args.id, identity: randomUUID(), owner: args.owner, profileId, pendingCount, record, window: w, view, filePath: args.filePath, localUrl: args.filePath ? url : null };
      const wc = view.webContents;
      wc.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && (input.meta || input.control) && !input.alt && String(input.key).toLowerCase() === 'l') { event.preventDefault(); w.webContents.focus(); send(e, 'address-focus', {}); }
      });
      const allowed = (value) => { if (isBlankTab(value)) return true; try { browserUrl(value); return true; } catch (_) { const p = parseDocUrl(value); return !!(p && e.localUrl && record.roots.has(p.root)); } };
      const checkNavigation = (event, target) => {
        if (!allowed(target)) { event.preventDefault(); return; }
        // Local documents never acquire a named profile's signed-in identity
        // through a page-controlled navigation. External links open a web tab.
        if (record.local && /^https?:/.test(target)) { event.preventDefault(); send(e, 'new-tab', { url: target, profileId: e.profileId }); }
      };
      wc.on('will-navigate', checkNavigation);
      wc.on('will-redirect', checkNavigation);
      wc.setWindowOpenHandler(({ url: target, disposition }) => {
        let popupMode = 'block';
        try { popupMode = popupModeOf(profiles.get(e.profileId)); } catch {}
        const decision = popupDecision(target, popupMode, disposition);
        if (decision.newTab && allowed(target)) send(e, 'new-tab', { url: target, profileId: e.profileId });
        if (decision.action !== 'allow' || !allowed(target)) return { action: 'deny' };
        // A sign-in popup only works as a popup: Google finishes in it, tells the
        // page that opened it, and closes itself. Opened as a new tab instead, it
        // has no page to tell, and Canva sits there signed out. So it is a real
        // child window on the same profile, painted before it loads — the black
        // box people saw was a window with no background drawn yet.
        return { action: 'allow', overrideBrowserWindowOptions: {
          parent: w, width: 520, height: 680, autoHideMenuBar: true, backgroundColor: dark ? '#1f1f1f' : '#fffdf6',
          webPreferences: { session: record.session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
        } };
      });
      // A popup does not get popups of its own, and it may not wander: it exists
      // to finish one sign-in and close.
      wc.on('did-create-window', (child) => {
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        child.webContents.on('will-navigate', (event, target) => { if (!allowed(target)) event.preventDefault(); });
      });
      const update = () => {
        if (wc.isDestroyed() || views.get(e.id) !== e) return;
        const local = parseDocUrl(wc.getURL());
        e.filePath = local ? resolveWithinRoot(local.root, local.rel) : null;
        const blank = !e.filePath && isBlankTab(wc.getURL());
        send(e, 'state', { filePath: e.filePath, profileId: e.profileId, profileName: profiles.get(e.profileId).name, profileLocal: record.local, zoom: wc.getZoomFactor(), url: e.filePath || (blank ? 'about:blank' : wc.getURL()), title: blank ? 'New tab' : wc.getTitle(), loading: wc.isLoading(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward() });
      };
      e.update = update;
      for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) wc.on(ev, update);
      wc.on('did-start-navigation', (_ev, _url, inPlace, main) => { if (main && !inPlace) { e.documentEpoch = (e.documentEpoch || 0) + 1; e.documentId = null; e.selections = new Map(); } });
      wc.on('did-finish-load', () => send(e, 'error', { error: '' }));
      wc.on('did-fail-load', (_event, code, description, failedUrl, main) => {
        if (!main) return;
        // Let the commit settle first: getURL() during the event can still name
        // the page that was there before the click.
        setImmediate(() => {
          if (wc.isDestroyed()) return;
          const message = loadFailureMessage({ code, description, failedUrl, currentUrl: wc.getURL() });
          if (message) send(e, 'error', { error: message });
        });
      });
      wc.on('render-process-gone', () => send(e, 'error', { error: 'Page stopped. Reload to try again.' }));
      wc.on('context-menu', (_event, params) => { if (params.selectionText) wc.send('browser:selection-request'); });
      // Install the replacement completely before retiring the old native view.
      // It cannot request website permissions or emit page state until committed.
      view.setVisible(false);
      w.contentView.addChildView(view);
      if (replacing) {
        if (views.get(args.id) !== replacing) throw new Error('The browser tab changed. Choose its profile again.');
        await remove(replacing.id, { notify: false, confirmed: true });
      }
      if (w.isDestroyed()) throw new Error('The Nami window has closed.');
      views.set(e.id, e);
      if (url === 'about:blank' && !args.filePath) {
        await wc.loadFile(WELCOME).catch((error) => send(e, 'error', { error: error.message }));
        await paintBlank(wc, dark);
      } else await wc.loadURL(url).catch((error) => send(e, 'error', { error: error.message }));
      return e;
    } catch (error) {
      if (view) {
        if (views.get(args.id)?.view === view) views.delete(args.id);
        if (!w.isDestroyed()) w.contentView.removeChildView(view);
        if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close();
      }
      if (record.local) {
        record.roots.clear(); record.session.protocol.unhandle('nami-doc'); partitions.delete(record.key);
        await record.session.clearStorageData();
      }
      throw error;
    }
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
      const profileMutation = channel === 'browser:profiles' && !['list', 'credentials', 'contents', 'import-browser', 'import-cookies'].includes(args.action || 'list');
      const navigation = channel === 'browser:action' && args.action === 'navigate';
      const identityChange = (profileMutation && ['switch', 'clear', 'remove', 'import-passwords', 'import-cookies', 'delete-credential'].includes(args.action)) || (navigation && find(w, args.id).record.local);
      const serialized = profileMutation || navigation || ['browser:create', 'browser:close', 'browser:grant', 'browser:enable', 'browser:sync', 'browser:connection'].includes(channel);
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
    else if (action === 'capture-annotation' || action === 'capture-selection') {
      const selection = e.selections?.get(value?.selectionId);
      if (!selection || !e.documentId || value.documentId !== e.documentId || selection.documentId !== e.documentId) throw new Error('This selection is no longer on the current page. Select it again.');
      let rect;
      const requestId = randomUUID(), documentId = e.documentId;
      try {
        const prepared = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { captures.delete(requestId); reject(new Error('Could not prepare this selection for capture. Try again.')); }, 2500);
          captures.set(requestId, { wc, documentId, resolve: (value) => { clearTimeout(timeout); resolve(value); } });
          wc.send('browser:annotation-capture', { requestId, documentId, selectionId: selection.selectionId });
        });
        if (e.documentId !== documentId || wc.isDestroyed()) throw new Error('The page changed before capture. Select the area again.');
        if (!prepared.selection || prepared.selection.stale) throw new Error('The selected area changed. Select it again.');
        rect = captureRect(prepared.selection.rect, prepared.viewport, e.view.getBounds());
        const picture = await wc.capturePage(rect);
        if (picture.isEmpty() || e.documentId !== documentId) throw new Error('The selected image is unavailable. Select the area again.');
        return { image: images.add(w.webContents.id, picture, { tabId: id, url: e.filePath || wc.getURL(), capturedAt: Date.now() }) };
      } finally { captures.delete(requestId); if (!wc.isDestroyed()) wc.send('browser:annotation-capture-end', { requestId }); }
    }
    else if (action === 'capture') {
      const picture = await wc.capturePage();
      const result = await dialog.showSaveDialog(w, { title: 'Save browser screenshot', defaultPath: 'nami-browser.png', filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath, picture.toPNG());
      return { canceled: result.canceled };
    }
    else if (action === 'cancel-annotation') wc.send('browser:annotate-mode', false);
    else if (action === 'snapshot') {
      const text = await wc.executeJavaScript("(document.body && document.body.innerText || '').slice(0, 16000)", true).catch(() => '');
      return { title: wc.getTitle(), url: e.filePath || wc.getURL(), text: String(text || '') };
    }
    return {};
  });
  async function revokeProfile(profileId) {
    const ids = new Set([...views.values()].filter((e) => e.profileId === profileId).map((e) => e.id));
    await revokeViews(ids);
  }
  async function revokeViews(ids) {
    for (const [id, s] of access.sessions) if ([...s.views].some((viewId) => ids.has(viewId))) {
      for (const viewId of ids) s.views.delete(viewId);
      await gateway?.refresh(id);
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
  async function startImport(w, args) {
    if (typeof args.profileId !== 'string' || !args.profileId) throw new Error('Choose a destination Nami profile before importing.');
    profiles.get(args.profileId);
    selectChromiumImportSource(detectChromiumProfiles(), args.sourceId);
    if (importBlocks.has(args.profileId) || profileLocks.has(args.profileId)) throw new Error('Browser profile is being updated.');
    if (importJobs.active(args.profileId)) throw new Error('An import is already running for this profile. Open its progress or cancel it first.');
    getPartition(w, args.profileId);
    await mutateProfile(args.profileId, () => {});
    if (importBlocks.has(args.profileId)) throw new Error('Browser profile is being updated.');
    return importJobs.start(w.webContents.id, args);
  }
  guarded('browser:import', async (w, args) => {
    const owner = w.webContents.id;
    if (args.action === 'start') return { job: await startImport(w, args) };
    if (args.action === 'cancel') return { job: await importJobs.cancel(owner, args.jobId) };
    if (args.action === 'get') return { job: importJobs.get(owner, args.jobId) };
    if (!args.action || args.action === 'list') return { jobs: importJobs.list(owner) };
    throw new Error('Unknown import action.');
  });
  guarded('browser:profiles', async (w, args) => {
    const { action = 'list' } = args;
    // Imports must name their destination before reading a source, asking
    // Keychain or opening a CSV dialog. A missing choice is never Personal.
    const importing = ['import-browser', 'import-cookies', 'import-passwords'].includes(action);
    if (importing && (typeof args.profileId !== 'string' || !args.profileId)) throw new Error('Choose a destination Nami profile before importing.');
    const profileId = args.profileId || profiles.list()[0].id;
    if (importing) profiles.get(profileId);
    let output = {};
    if (action === 'create') output.profile = profiles.create(args.name);
    else if (action === 'rename') {
      output.profile = profiles.rename(profileId, args.name);
      for (const e of views.values()) if (e.profileId === profileId) e.update();
    }
    else if (action === 'switch') {
      const e = find(w, args.id); profiles.get(profileId);
      if (profileLocks.has(profileId)) throw new Error('Browser profile is being updated.');
      const oldProfile = e.profileId;
      if (oldProfile === profileId) return { profiles: profiles.list() };
      await mutateProfile(oldProfile, async () => {
        const currentUrl = e.view.webContents.getURL();
        // The internal welcome file is a blank web tab, never a user file URL.
        const next = { id: e.id, owner: e.owner, profileId, filePath: e.filePath,
          url: !e.filePath && isBlankTab(currentUrl) ? 'about:blank' : currentUrl };
        // The shared mutation lane keeps destination imports, removal and
        // grants from running until the replacement view is ready.
        const created = await create(w, next, { pendingCount: e.pendingCount, replacing: e });
        send(created, 'profile-changed', { profileId });
      });
    } else if (action === 'clear' || action === 'remove') {
      if (args.confirmed !== true) throw new Error('Confirm clearing this Nami browser data first.');
      if (action === 'remove' && profiles.list().length === 1) throw new Error('Keep at least one browser profile.');
      importBlocks.add(profileId);
      try {
      await importJobs.cancelProfile(profileId);
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
      } finally { importBlocks.delete(profileId); }
    } else if (action === 'import-passwords') {
      if (importJobs.active(profileId)) throw new Error('Cancel the running browser import before importing a password CSV.');
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
    } else if (action === 'configure') {
      output.profile = profiles.configure(profileId, args);
    } else if (action === 'new-tab') {
      const mode = args.value === 'dark' || args.value === 'light' ? args.value : 'system';
      writeSettings({ browserNewTab: mode });
      syncNativeTheme(readSettings());
      applyBlankAppearance(mode);
      output.newTab = mode;
    } else if (action === 'import-browser' || action === 'import-cookies') {
      const job = await startImport(w, action === 'import-cookies' ? { ...args, cookies: true, passwords: false, history: false } : args);
      const done = await importJobs.wait(w.webContents.id, job.id);
      output = { job: done, imported: done.results.cookies?.copied || 0, passwords: done.results.passwords?.copied || 0,
        history: done.results.history?.copied || 0, message: 'Import ' + done.state + ' into ' + done.profileName + '.' };
    } else if (action === 'contents') {
      // Count the live cookie store, including session-only cookies. Neither
      // type of cookie is proof that a website accepts an authenticated session.
      const record = getPartition(w, profileId);
      let cookies = 0, session = 0;
      try {
        const all = await record.session.cookies.get({});
        cookies = all.length;
        session = all.filter((c) => !c.expirationDate).length;
      } catch {}
      let passwords = args.includePasswords === false ? null : 0, history = 0;
      if (args.includePasswords !== false) { try { passwords = profiles.credentials(profileId).length; } catch {} }
      try { history = (profiles.get(profileId).history || []).length; } catch {}
      output.contents = { cookies, session, passwords, history };
    } else if (action !== 'list') throw new Error('Unknown browser profile action.');
    // Capability discovery must not unlock the Keychain. Password actions
    // check availability when the user actually requests protected data.
    return { ...output, profiles: profiles.list(), importJobs: importJobs.list(w.webContents.id), capabilities: { passwordCsv: typeof safeStorage.encryptString === 'function', cookieImport: cookieImportStatus(), cookies: true, history: true, newTab: blankMode(readSettings()) } };
  });
  guarded('browser:sync', async (w, { sessions = [] }) => {
    for (const s of sessions.slice(0, 100)) access.register(s.id, w.webContents.id, s.title);
    for (const [id, s] of access.sessions) if (s.windowId === w.webContents.id && !sessions.some((s) => s.id === id)) { await gateway?.revoke(id); contexts.remove(id); images.removeRecipient(id); access.sessions.delete(id); }
    return {};
  });
  guarded('browser:status', async (w) => {
    const sessions = [...access.sessions].filter(([, s]) => s.windowId === w.webContents.id).map(([id, s]) => ({ id, title: s.title, views: [...s.views], connected: !!gateway?.isConnected(id), ...gateway?.status(id), sources: contexts.list(id), peers: [...(s.peers || [])] }));
    return { enabled: browserEnabled, sessions, views: [...views.values()].filter((e) => e.window === w).map((e) => ({ id: e.id, identity: e.identity, owner: e.owner, profileId: e.profileId, profileName: profiles.get(e.profileId).name, profileLocal: e.record.local, title: e.view.webContents.getTitle(), url: e.filePath || e.view.webContents.getURL() })) };
  });
  guarded('browser:enable', async (_w, { enabled }) => {
    const result = writeSettings({ browserEnabled: !!enabled });
    if (!result.ok) throw new Error(result.error);
    browserEnabled = !!enabled;
    if (!enabled) { if (gatewayStarting) await gatewayStarting; contexts.clearGrants(); for (const s of access.sessions.values()) { s.views.clear(); s.peers = []; } await gateway?.close(); gateway = null; for (const s of access.sessions.values()) { s.views.clear(); s.peers = []; } }
    return {};
  });
  async function ensureGateway() {
    if (gatewayStarting) return gatewayStarting;
    if (!gateway) gatewayStarting = require('./browser-mcp').createBrowserMcp({ access, views, create, remove, send, contexts, images,
      onActivity: (sessionId, activity) => {
        const s = access.sessions.get(sessionId);
        const target = s && BrowserWindow.getAllWindows().find(w => w.webContents.id === s.windowId);
        target?.webContents.send('browser:event', { type: 'activity', sessionId, activity });
      },
      notifyMessage: (windowId, message) => {
        const target = BrowserWindow.getAllWindows().find(w => w.webContents.id === windowId);
        target?.webContents.send('browser:event', { type: 'message', ...message });
      } }).then(service => { gateway = service; return service; }).finally(() => { gatewayStarting = null; });
    return gateway || gatewayStarting;
  }
  async function connectionFor(id) {
    if (!browserEnabled) return null;
    access.get(id); const service = await ensureGateway();
    if (!browserEnabled) return null;
    return service.connection(id);
  }
  guarded('browser:connection', async (w, { id }) => { access.get(id, w.webContents.id); const connection = await connectionFor(id); return connection || { enabled: false }; });
  guarded('browser:grant', async (w, { id, viewIds = [], peers = [], sourceIds, expectedIdentities, expectedSourceIdentities }) => {
    if (!browserEnabled) throw new Error('Enable the browser connection in Settings first.');
    access.get(id, w.webContents.id);
    if (![viewIds, peers, sourceIds || []].every(ids => Array.isArray(ids) && ids.length <= 100)) throw new Error('Too many shared sources.');
    for (const vid of viewIds) {
      const entry = find(w, vid);
      if (profileLocks.has(entry.profileId)) throw new Error('Browser profile is being updated.');
      if (expectedIdentities && expectedIdentities[vid] !== entry.identity) throw new Error('A browser profile changed. Reopen Browser access and review the selected tabs.');
    }
    for (const peer of peers) access.get(peer, w.webContents.id);
    const service = await ensureGateway();
    // A source may resume another conversation while the browser engine drains.
    // Pin the identity selected by the user and recheck before any grant edit.
    const selectedSources = new Map(), existingSources = new Map(contexts.list(id).map(source => [source.id, source.identity]));
    if (sourceIds) for (const sourceId of sourceIds) {
      const source = contexts.sources.get(sourceId);
      if (!source || source.windowId !== w.webContents.id || sourceId === id) throw new Error('Session context is unavailable.');
      const identity = expectedSourceIdentities?.[sourceId] || existingSources.get(sourceId);
      if (!identity || identity !== source.identity) throw new Error('The source conversation changed. Review session context before sharing it.');
      selectedSources.set(sourceId, identity);
    }
    await service.refresh(id, () => {
      for (const [sourceId, identity] of selectedSources) {
        const source = contexts.sources.get(sourceId);
        if (!source || source.windowId !== w.webContents.id || source.identity !== identity) throw new Error('The source conversation changed. Review session context before sharing it.');
      }
      if (sourceIds) contexts.grant(id, w.webContents.id, sourceIds);
      access.grant(id, w.webContents.id, viewIds); access.get(id).peers = peers.filter(p => p !== id);
    });
    return service.connection(id);
  });
  guarded('browser:context', (w, args) => {
    if (args.action === 'update') { access.get(args.id, w.webContents.id); return { source: contexts.update({ ...args, windowId: w.webContents.id }) }; }
    if (args.action === 'read') { access.get(args.recipientId, w.webContents.id); return { source: contexts.read(args.recipientId, args.sourceId) }; }
    throw new Error('Unknown context action.');
  });
  guarded('browser:annotation-image', (w, { action, id, recipientIds = [] }) => {
    if (action === 'read') { const entry = images.get(id, w.webContents.id); return { data: fs.readFileSync(entry.path).toString('base64'), mimeType: entry.mimeType }; }
    if (action === 'discard') images.discard(id, w.webContents.id);
    else if (action === 'grant') {
      if (!Array.isArray(recipientIds) || recipientIds.length > 100) throw new Error('Too many image recipients.');
      for (const recipient of recipientIds) access.get(recipient, w.webContents.id);
      images.grant(id, w.webContents.id, recipientIds); images.get(id).inserted = true;
    } else throw new Error('Unknown annotation image action.');
    return {};
  });
  ipcMain.on('browser:annotation-capture-ready', (event, value) => {
    const pending = captures.get(value?.requestId);
    if (!pending || pending.wc !== event.sender || event.senderFrame !== event.sender.mainFrame || pending.documentId !== value.documentId) return;
    captures.delete(value.requestId); pending.resolve(value);
  });
  ipcMain.on('browser:annotation-layout', (event, value) => {
    const e = [...views.values()].find((e) => e.view.webContents === event.sender);
    if (!e || event.senderFrame !== event.sender.mainFrame) return;
    const layout = cleanAnnotationLayout(value); if (layout) { e.documentId = layout.documentId; send(e, 'annotation-layout', { layout }); }
  });
  for (const [channel, type] of [['browser:selection', 'selection'], ['browser:text-selection', 'text-selection'], ['browser:annotation-end', 'annotation-end'], ['browser:focus', 'focus']]) {
    ipcMain.on(channel, (event, value) => {
      const e = [...views.values()].find((e) => e.view.webContents === event.sender);
      if (!e || event.senderFrame !== event.sender.mainFrame) return;
      try {
        const selection = ['annotation-end', 'focus'].includes(type) ? null : cleanSelection(value, e.filePath || event.sender.getURL());
        if (selection?.selectionId && selection.documentId) {
          e.documentId = selection.documentId; e.selections ||= new Map();
          if (e.selections.size >= 200) e.selections.delete(e.selections.keys().next().value);
          e.selections.set(selection.selectionId, selection);
        }
        send(e, type, { selection });
      } catch (_) {}
    });
  }
  function bindWindow(w) {
    const windowId = w.webContents.id;
    w.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace) return;
      for (const [id, s] of access.sessions) if (s.windowId === windowId) gateway?.revoke(id);
      for (const [id, session] of access.sessions) if (session.windowId === windowId) contexts.remove(id);
      images.removeWindow(windowId); access.removeWindow(windowId);
      for (const e of [...views.values()]) if (e.window === w) remove(e.id, { notify: false, confirmed: true });
    });
    w.once('closed', () => {
      for (const job of importJobs.list(windowId)) if (['running', 'cancelling'].includes(job.state)) void importJobs.cancel(windowId, job.id);
      for (const [id, s] of access.sessions) if (s.windowId === windowId) gateway?.revoke(id);
      for (const e of [...views.values()]) if (e.window === w) remove(e.id, { confirmed: true });
      for (const [id, session] of access.sessions) if (session.windowId === windowId) contexts.remove(id);
      images.removeWindow(windowId); access.removeWindow(windowId);
      // Persistent browser sessions are shared only within their named profile.
    });
    w.webContents.once('destroyed', () => { for (const e of [...views.values()]) if (e.window === w) remove(e.id, { confirmed: true }); });
  }
  return { bindWindow, views, access, contexts, images, connectionFor, registerSession: ({ id, windowId, title }) => access.register(id, windowId, title), close: async () => { await gateway?.close(); for (const id of [...views.keys()]) await remove(id, { confirmed: true }); } };
}
module.exports = { wireBrowserViews };
