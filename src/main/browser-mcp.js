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
async function createBrowserMcp({ access, views, create, remove, send, notifyMessage }) {
  const routes = new Map(); let serial = Promise.resolve();
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
      const entries = () => route.revoked ? [] : [...views.values()].filter((e) => access.allows(route.id, e.id));
      if (!entries().length) throw new Error('No browser tabs are shared with this session.');
      const bridge = await createCdpBridge({ entries, create: async (url) => {
        const first = entries().find(e=>!e.record?.local); if (!first) throw new Error('Open the website in Nami and grant its browser tab access first. Local HTML permission does not include signed-in browser profiles.');
        const e = await create(first.window, { id: 'browser-' + randomBytes(8).toString('hex'), owner: route.id, profileId: first.profileId, url });
        access.get(route.id).views.add(e.id); send(e, 'created', { owner: route.id, profileId: first.profileId, url }); return e;
      }, close: remove });
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
    if (message.method === 'initialize') { route.connected = true; return { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'nami-browser', version: '1.0.0' } }; }
    if (message.method === 'ping') return {};
    if (message.method === 'tools/list') {
      const browserTools = s.views.size ? (await (await engine(route)).listTools()).tools.filter((t) => ALLOWED_TOOLS.has(t.name)).map((tool) => {
        const schema = structuredClone(tool.inputSchema);
        if (schema.properties) delete schema.properties.filename;
        return { ...tool, inputSchema: schema };
      }) : [];
      return { tools: [...browserTools, ...MESSAGE_TOOLS] };
    }
    if (message.method !== 'tools/call') throw new Error('Unsupported MCP method.');
    const { name, arguments: args = {} } = message.params || {};
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
    if ((name==='browser_navigate'||(name==='browser_tabs'&&args.action==='new')) && [...s.views].every(id=>views.get(id)?.record?.local)) throw new Error('Open the website in Nami and grant its browser tab access first. Local HTML permission does not include signed-in browser profiles.');
    if(name==='browser_tabs' && args.action==='close' && [...s.views].some(id=>views.get(id)?.pendingCount>0)) throw new Error('Review or discard pending annotations before closing browser tabs through the agent.');
    if (!ALLOWED_TOOLS.has(name)) throw new Error('Tool is not available in Nami.');
    if (Object.hasOwn(args, 'filename')) throw new Error('Browser tools return context directly; file output is not enabled.');
    return (await engine(route)).callTool({ name, arguments: args });
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
    const run = serial.then(async () => { if (!routes.has(req.url)) throw new Error('Connection revoked.'); route.inFlight = dispatch(route, m); try { return await route.inFlight; } finally { route.inFlight = null; } });
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
  return { connection: async (id) => { access.get(id); const key = '/mcp/' + randomBytes(24).toString('hex'); routes.set(key, { id }); return { url: `http://127.0.0.1:${server.address().port}${key}` }; },
    isConnected: (id) => [...routes.values()].some((r) => r.id === id && r.connected && !r.revoked),
    revoke, close: async () => { for (const route of [...routes.values()]) await revoke(route.id); server.closeAllConnections(); server.close(); } };
}
module.exports = { createBrowserMcp, ALLOWED_TOOLS };
