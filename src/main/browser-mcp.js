// Streamable HTTP MCP, with a distinct bearer URL per Nami session. Browser
// tools are Microsoft's Playwright MCP, connected to our scoped CDP transport.
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createCdpBridge } = require('./browser-cdp');
const { clean } = require('./browser-policy');
const ALLOWED_TOOLS = new Set(['browser_snapshot', 'browser_navigate', 'browser_navigate_back', 'browser_click', 'browser_type', 'browser_fill_form', 'browser_hover', 'browser_drag', 'browser_press_key', 'browser_select_option', 'browser_wait_for', 'browser_evaluate', 'browser_tabs', 'browser_handle_dialog', 'browser_console_messages', 'browser_network_requests']);
const MESSAGE_TOOLS = [
  { name: 'nami_sessions', description: 'List sessions you may message on this Nami desk.', inputSchema: { type: 'object', properties: {} } },
  { name: 'nami_send_message', description: 'Leave a message in an allowed peer session inbox. Does not submit a terminal prompt.', inputSchema: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'] } },
  { name: 'nami_inbox', description: 'Read and acknowledge messages sent to this session.', inputSchema: { type: 'object', properties: {} } },
];
const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const NAMI_TOOLS = [
  { name: 'nami_browser_screenshot', description: 'Read a screenshot of an exact shared Nami Browser tab. Returns the visible page image, title, URL and access time. Never uses an external browser.', inputSchema: { type: 'object', properties: { tabId: { type: 'string' } }, required: ['tabId'] } },
  { name: 'nami_browser_tabs', description: 'List the exact Nami Browser tabs currently shared with this session. Use these tab IDs for screenshots.', inputSchema: { type: 'object', properties: {} } },
  { name: 'nami_read_annotation_image', description: 'Read an explicitly inserted Nami annotation image by its opaque ID. No arbitrary files.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'nami_read_session_context', description: 'Read the latest published visible context of an explicitly linked Nami session. Terminal snapshots can be incomplete. Does not send a message or start a turn.', inputSchema: { type: 'object', properties: { sourceId: { type: 'string' } }, required: ['sourceId'] } },
];
async function createBrowserMcp({ access, views, create, remove, send, notifyMessage, contexts, images, onActivity }) {
  const routes = new Map(); let serial = Promise.resolve();
  let schemaPromise;
  async function toolSchema() {
    if (!schemaPromise) schemaPromise = (async () => {
      // MCP exposes its schema without acquiring a browser. The schema stays
      // stable even when the scoped endpoint initially has zero tabs.
      const { createConnection } = require('@playwright/mcp');
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
      const server = await createConnection({}, async () => { throw new Error('No page is needed to list Nami Browser tools.'); });
      const client = new Client({ name: 'nami-schema', version: '1.0.0' });
      const [a, b] = InMemoryTransport.createLinkedPair();
      try { await server.connect(a); await client.connect(b);
        return (await client.listTools()).tools.filter(t => ALLOWED_TOOLS.has(t.name)).map(tool => {
          const inputSchema = structuredClone(tool.inputSchema);
          if (inputSchema.properties) delete inputSchema.properties.filename;
          return { ...tool, description: 'Nami Browser only. ' + tool.description, inputSchema };
        });
      } finally { await client.close(); await server.close(); }
    })();
    return schemaPromise;
  }
  function activity(route, tabId, tool, error, captured) {
    const e = views.get(tabId);
    if (!e || !access.allows(route.id, tabId)) return;
    const previous = route.activity?.[tabId], at = Date.now();
    const value = { tabId, lastSuccessfulAt: error ? previous?.lastSuccessfulAt || null : at, title: e.view.webContents.getTitle(), url: e.filePath || e.view.webContents.getURL(), at, tool, ...captured, ...(error ? { error } : {}) };
    route.activity ||= {}; route.activity[tabId] = value; onActivity?.(route.id, value);
  }
  async function stopEngine(route) {
    await route.client?.close().catch(() => {});
    await route.bridge?.close();
    await route.browser?.close().catch(() => {});
    if (route.outputDir) fs.rmSync(route.outputDir, { recursive: true, force: true });
    route.outputDir = null;
    route.engine = route.client = route.bridge = route.browser = null;
  }
  async function engine(route) {
    if (route.engine) return route.engine;
    // Tools are serialized. Release overlapping debuggers when another session
    // takes its turn; disjoint browser sessions keep their own connections.
    for (const other of routes.values()) if (other !== route && other.engine &&
      [...access.get(route.id).views].some((id) => access.allows(other.id, id))) await stopEngine(other);
    route.engine = (async () => {
      const entries = () => route.revoked || route.updating ? [] : [...views.values()].filter((e) => access.allows(route.id, e.id));
      if (!entries().length) throw new Error('No browser tabs are shared with this session.');
      const bridge = await createCdpBridge({ entries, create: async (url) => {
        const first = entries().find(e=>!e.record?.local); if (!first) throw new Error('Open the website in Nami and grant its browser tab access first. Local HTML permission does not include signed-in browser profiles.');
        const e = await create(first.window, { id: 'browser-' + randomBytes(8).toString('hex'), owner: route.id, profileId: first.profileId, url });
        access.get(route.id).views.add(e.id); send(e, 'created', { owner: route.id, profileId: first.profileId, url }); return e;
      }, close: remove, onCommand: (id) => route.touched?.add(id) });
      route.bridge = bridge;
      const { chromium } = require('playwright');
      const browser = await chromium.connectOverCDP(bridge.endpoint, { timeout: 15000 }); route.browser = browser;
      const { createConnection } = require('@playwright/mcp');
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
      route.outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-browser-'));
      const server = await createConnection({ browser: { contextOptions: { viewport: null } }, outputDir: route.outputDir, timeouts: { action: 10000, navigation: 15000 } }, async () => browser.contexts()[0]);
      const client = new Client({ name: 'nami', version: '1.0.0' });
      route.client = client;
      const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
      if (route.revoked) throw new Error('Connection revoked.');
      return client;
    })().catch(async (error) => { await stopEngine(route); throw error; });
    return route.engine;
  }
  async function dispatch(route, message) {
    const s = access.get(route.id);
    if (message.method === 'initialize') { route.connected = true; route.initializedAt = Date.now(); return { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'nami-browser', version: '1.0.0' } }; }
    if (message.method === 'ping') return {};
    if (message.method === 'tools/list') {
      return { tools: [...await toolSchema(), ...NAMI_TOOLS, ...MESSAGE_TOOLS] };
    }
    if (message.method !== 'tools/call') throw new Error('Unsupported MCP method.');
    const { name, arguments: args = {} } = message.params || {};
    if (route.updating || route.revoked) throw new Error('Nami Browser access is being updated. Try again.');
    if (name === 'nami_sessions') return result((s.peers || []).filter((id) => access.sessions.has(id)).map((id) => ({ id, title: access.get(id).title })));
    if (name === 'nami_inbox') { const messages = s.inbox.splice(0); return result(messages); }
    if (name === 'nami_send_message') {
      if (!(s.peers || []).includes(args.to)) throw new Error('This session is not an allowed recipient.');
      const target = access.get(args.to), text = clean(args.text, 16000);
      if (!text.trim()) throw new Error('Write a message.');
      if (target.inbox.length >= 100) throw new Error('Recipient inbox is full.');
      const msg = { from: route.id, title: s.title, text, at: Date.now() }; target.inbox.push(msg);
      notifyMessage?.(target.windowId, { sessionId: args.to, message: msg });
      return result({ delivered: true });
    }
    if (name === 'nami_browser_tabs') return result([...s.views].flatMap(id => { const e = views.get(id); return e ? [{ id, title: e.view.webContents.getTitle(), url: e.filePath || e.view.webContents.getURL() }] : []; }));
    if (name === 'nami_read_annotation_image') {
      if (!images) throw new Error('Annotation images are unavailable.');
      return images.read(args.id, route.id);
    }
    if (name === 'nami_read_session_context') {
      if (!contexts) throw new Error('Session context is unavailable.');
      return result(contexts.read(route.id, args.sourceId));
    }
    if (name === 'nami_browser_screenshot') {
      const e = views.get(args.tabId);
      if (!e || !access.allows(route.id, e.id)) throw new Error('This Nami Browser tab is not shared with the session.');
      const captured = { title: e.view.webContents.getTitle(), url: e.filePath || e.view.webContents.getURL(), capturedAt: Date.now() };
      const documentId = e.documentId, documentEpoch = e.documentEpoch;
      let picture;
      try { picture = await e.view.webContents.capturePage(); }
      catch (_) { const message = 'The browser image is unavailable. Reveal the tab in Nami and try again.'; activity(route, e.id, name, message); throw new Error(message); }
      if (route.revoked || route.updating || !access.allows(route.id, e.id)) throw new Error('Browser access changed during capture.');
      if (views.get(e.id) !== e || e.documentId !== documentId || e.documentEpoch !== documentEpoch || e.view.webContents.isDestroyed() || (e.filePath || e.view.webContents.getURL()) !== captured.url) throw new Error('The browser page changed during capture. Try the screenshot again.');
      if (picture.isEmpty()) throw new Error('The browser image is unavailable. Reveal the tab and try again.');
      const bytes = picture.toPNG();
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Browser image is too large. Reduce the view size.');
      activity(route, e.id, name, undefined, captured);
      return { content: [{ type: 'text', text: JSON.stringify(route.activity[e.id]) }, { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }] };
    }
    if ((name==='browser_navigate'||(name==='browser_tabs'&&args.action==='new')) && [...s.views].every(id=>views.get(id)?.record?.local)) throw new Error('Open the website in Nami and grant its browser tab access first. Local HTML permission does not include signed-in browser profiles.');
    if(name==='browser_tabs' && args.action==='close' && [...s.views].some(id=>views.get(id)?.pendingCount>0)) throw new Error('Review or discard pending annotations before closing browser tabs through the agent.');
    if (!ALLOWED_TOOLS.has(name)) throw new Error('Tool is not available in Nami.');
    if (Object.hasOwn(args, 'filename')) throw new Error('Browser tools return context directly; file output is not enabled.');
    const client = await engine(route);
    route.touched = new Set();
    try {
      const output = await client.callTool({ name, arguments: args });
      if (route.revoked || route.updating) throw new Error('Browser access changed during this operation.');
      for (const tabId of route.touched) activity(route, tabId, name, output.isError ? 'Browser tool failed.' : undefined);
      return output;
    } catch (error) { for (const tabId of route.touched) activity(route, tabId, name, error.message); throw error; }
    finally { route.touched = null; }
  }
  const server = http.createServer(async (req, res) => {
    // No web-origin access, no DNS-rebinding hosts, no unbounded request body.
    if (req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
    const route = routes.get(req.url?.split('?')[0]);
    if (!route) { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = []; let length = 0;
    try {
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 128000) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
    } catch (_) { res.destroy(); return; }
    let m;
    try { m = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!m || typeof m.method !== 'string') throw new Error('Invalid request.'); }
    catch (_) { res.writeHead(400).end(); return; }
    if (m.id === undefined) { res.writeHead(202).end(); return; }
    const run = serial.then(async () => { if (!routes.has(req.url?.split('?')[0]) || route.revoked) throw new Error('Connection revoked.'); route.inFlight = dispatch(route, m); try { return await route.inFlight; } finally { route.inFlight = null; } });
    serial = run.catch(() => {});
    try { const output = await run; res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: output })); }
    catch (error) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: error.message } })); }
  });
  server.requestTimeout = 30000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  async function revoke(id) { for (const [key, route] of routes) if (route.id === id) {
    routes.delete(key); route.revoked = true;
    // Drain an already running operation before changing a browser identity.
    // Queued requests now fail their route check; no old grant reaches new data.
    await route.inFlight?.catch(() => {}); await stopEngine(route);
  } }
  async function refresh(id, update) {
    const relevant = [...routes.values()].filter(r => r.id === id);
    // Deny CDP commands immediately, including commands inside an old call.
    for (const r of relevant) r.updating = true;
    try {
      for (const r of relevant) { await r.inFlight?.catch(() => {}); await stopEngine(r); }
      update?.();
      for (const r of relevant) if (r.activity) for (const tabId of Object.keys(r.activity)) if (!access.allows(id, tabId)) delete r.activity[tabId];
    } finally { for (const r of relevant) r.updating = false; }
  }
  return { connection: async (id) => {
      access.get(id);
      let key = [...routes].find(([, r]) => r.id === id && !r.revoked)?.[0];
      if (!key) { key = '/mcp/' + randomBytes(24).toString('hex'); routes.set(key, { id }); }
      return { url: `http://127.0.0.1:${server.address().port}${key}`, name: 'nami-browser', transport: 'http' };
    },
    isConnected: (id) => [...routes.values()].some((r) => r.id === id && r.connected && !r.revoked),
    status: (id) => { const r = [...routes.values()].find(r => r.id === id && !r.revoked); return { initialized: !!r?.connected, initializedAt: r?.initializedAt || null, activities: Object.values(r?.activity || {}) }; },
    refresh, revoke, close: async () => { for (const route of [...routes.values()]) await revoke(route.id); server.closeAllConnections(); server.close(); } };
}
module.exports = { createBrowserMcp, ALLOWED_TOOLS };
