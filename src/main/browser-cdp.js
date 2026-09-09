// A browser-shaped CDP transport over *only* the granted WebContents debuggers.
// No remote-debugging-port, global Target discovery, or Nami renderer target.
const { WebSocketServer } = require('ws');
const { randomBytes } = require('node:crypto');
const { browserUrl } = require('./browser-policy');

async function createCdpBridge({ entries, create, close }) {
  const secret = randomBytes(24).toString('hex');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 1024 * 1024,
    verifyClient: ({ req }) => req.url === '/' + secret && !req.headers.origin });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  let socket;
  const attached = new Map(), children = new Map();
  const send = (message) => { if (socket?.readyState === 1) socket.send(JSON.stringify(message)); };
  const info = (e) => ({ targetId: e.targetId || e.id, browserContextId: 'nami', type: 'page', title: e.view.webContents.getTitle(), url: e.view.webContents.getURL(), attached: true, canAccessOpener: false });
  function allowed(id) { const e = entries().find((e) => e.id === id || e.targetId === id); if (!e || e.view.webContents.isDestroyed()) throw new Error('Browser view is not shared with this session.'); return e; }
  async function attach(e) {
    if (attached.has(e.id)) return;
    const wc = e.view.webContents, dbg = wc.debugger;
    if (dbg.isAttached()) throw new Error('This browser view is in use by another agent.');
    dbg.attach('1.3');
    e.targetId = (await dbg.sendCommand('Target.getTargetInfo')).targetInfo.targetId;
    const listener = (_ev, method, params, child) => {
      if (!entries().some((x) => x.id === e.id)) return;
      // Child sessions are learned only from this granted page's debugger.
      if (method === 'Target.attachedToTarget') children.set(params.sessionId, e.id);
      if (method === 'Target.detachedFromTarget') children.delete(params.sessionId);
      send({ method, params, sessionId: child || e.id });
    };
    dbg.on('message', listener);
    const destroyed = () => {
      attached.delete(e.id);
      for (const [id, owner] of children) if (owner === e.id) children.delete(id);
      send({ method: 'Target.detachedFromTarget', params: { sessionId: e.id, targetId: e.targetId } });
    };
    wc.once('destroyed', destroyed);
    attached.set(e.id, { wc, listener, destroyed });
    send({ method: 'Target.attachedToTarget', params: { sessionId: e.id, targetInfo: info(e), waitingForDebugger: false } });
  }
  async function command(method, params = {}, sid) {
    if (process.env.NAMI_BROWSER_DEBUG) console.log('[browser-cdp]', method, sid || 'root');
    if (sid) {
      const owner = children.get(sid) || sid, e = allowed(owner);
      if (!attached.has(owner)) throw new Error('Unknown page session.');
      if (method === 'Target.getTargetInfo') return { targetInfo: info(e) };
      if (method === 'Target.setAutoAttach') return e.view.webContents.debugger.sendCommand(method, params, children.has(sid) ? sid : undefined);
      if (!/^(Page|Runtime|DOM|DOMSnapshot|Input|Network|Accessibility|Log|Emulation|CSS|Performance|Security)\./.test(method)) throw new Error('CDP command is outside this page.');
      if (method === 'Page.navigate') params = { ...params, url: browserUrl(params.url) };
      // Browser-managed paths and downloads never become arbitrary file IO.
      if (['DOM.setFileInputFiles', 'Page.setDownloadBehavior'].includes(method)) throw new Error('File access is not enabled.');
      return e.view.webContents.debugger.sendCommand(method, params, children.has(sid) ? sid : undefined);
    }
    switch (method) {
      case 'Browser.getVersion': return { protocolVersion: '1.3', product: 'Chrome/' + process.versions.chrome, revision: '', userAgent: 'NamiBrowser' };
      case 'Browser.setDownloadBehavior': return {};
      case 'Browser.getWindowForTarget': allowed(params.targetId); return { windowId: 1, bounds: { left: 0, top: 0, width: 1000, height: 700, windowState: 'normal' } };
      case 'Target.setAutoAttach': for (const e of entries()) await attach(e); return {};
      case 'Target.getTargetInfo': return { targetInfo: params.targetId ? info(allowed(params.targetId)) : { targetId: 'nami-browser', type: 'browser', title: '', url: '', attached: true } };
      case 'Target.getTargets': return { targetInfos: entries().map(info) };
      case 'Target.createTarget': { const e = await create(browserUrl(params.url || 'about:blank')); await attach(e); return { targetId: e.targetId }; }
      case 'Target.closeTarget': { const e = allowed(params.targetId); await close(e.id); return { success: true }; }
      case 'Target.activateTarget': allowed(params.targetId); return {};
      default: throw new Error('Browser-wide command is not available: ' + method);
    }
  }
  server.on('connection', (ws) => {
    if (socket) { ws.close(); return; } socket = ws;
    ws.on('error', () => {});
    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); if (!Number.isInteger(m.id) || typeof m.method !== 'string') throw new Error('Invalid request');
        const result = await command(m.method, m.params, m.sessionId); send({ id: m.id, sessionId: m.sessionId, result });
      } catch (error) { if (process.env.NAMI_BROWSER_DEBUG) console.log('[browser-cdp-error]', m?.method, error.message); if (m) send({ id: m.id, sessionId: m.sessionId, error: { code: -32000, message: error.message } }); }
    });
  });
  return { endpoint: `ws://127.0.0.1:${server.address().port}/${secret}`, close: async () => {
    for (const { wc, listener, destroyed } of attached.values()) if (!wc.isDestroyed()) { wc.removeListener('destroyed', destroyed); wc.debugger.removeListener('message', listener); if (wc.debugger.isAttached()) wc.debugger.detach(); }
    attached.clear(); children.clear(); socket?.terminate(); server.close();
  } };
}
module.exports = { createCdpBridge };
