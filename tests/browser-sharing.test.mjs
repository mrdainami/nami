import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionSources, browserChipLabel, formatBrowserSnapshot, browserInspectActions } from '../src/renderer/session-sources.mjs';
const require = createRequire(import.meta.url);
const { SessionContextStore } = require('../src/main/browser-context');
const { AnnotationImageStore, captureRect } = require('../src/main/browser-images');

test('linked context is bounded, recipient-scoped, and revoked on conversation replacement', () => {
  const store = new SessionContextStore();
  store.update({ id: 'source', identity: 'conversation-1', windowId: 7, title: 'Source', kind: 'terminal', content: 'first' });
  assert.throws(() => store.read('reader', 'source'), /not shared/);
  assert.throws(() => store.grant('reader', 8, ['source']), /unavailable/);
  store.grant('reader', 7, ['source']);
  assert.equal(store.read('reader', 'source').incompleteHistory, true);
  store.update({ id: 'source', identity: 'conversation-1', windowId: 7, kind: 'terminal', content: 'x'.repeat(65000) });
  assert.equal(store.read('reader', 'source').content.length, 64000);
  assert.equal(store.read('reader', 'source').truncated, true);
  store.update({ id: 'source', identity: 'conversation-2', windowId: 7, kind: 'chat', content: 'private new conversation' });
  assert.throws(() => store.read('reader', 'source'), /not shared/);
  assert.deepEqual(store.list('reader'), []);
  store.grant('reader', 7, ['source']); store.remove('source');
  assert.throws(() => store.read('reader', 'source'), /not shared/);
});

test('capture crops clamp viewport edges and convert CSS coordinates at page zoom', () => {
  assert.deepEqual(captureRect({ x: -10, y: 20, width: 110, height: 80 }, { width: 400, height: 300 }, { width: 800, height: 600 }), { x: 0, y: 40, width: 200, height: 160 });
  assert.deepEqual(captureRect({ x: 390, y: 290, width: 20, height: 30 }, { width: 400, height: 300 }, { width: 800, height: 600 }), { x: 780, y: 580, width: 20, height: 20 });
  assert.throws(() => captureRect({ x: 500, y: 0, width: 2, height: 2 }, { width: 400, height: 300 }, { width: 800, height: 600 }), /outside/);
  assert.throws(() => captureRect({ x: NaN, y: 0, width: 2, height: 2 }, { width: 400, height: 300 }, { width: 800, height: 600 }), /visible/);
});

test('annotation image IDs never read arbitrary files and retain granted references', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-image-test-'));
  try {
    const store = new AnnotationImageStore(directory);
    const png = Buffer.from('89504e470d0a1a0a00', 'hex');
    const image = { toPNG: () => png, getSize: () => ({ width: 30, height: 20 }), resize: () => image, toDataURL: () => 'data:image/png;base64,' + png.toString('base64') };
    const a = store.add(7, image, { tabId: 'view' }), b = store.add(7, image);
    assert.throws(() => store.read('/etc/passwd', 'recipient'), /unavailable/);
    assert.throws(() => store.read(a.id, 'recipient'), /not shared/);
    assert.throws(() => store.grant(a.id, 8, ['recipient']), /unavailable/);
    store.grant(a.id, 7, ['recipient']); store.get(a.id).inserted = true;
    assert.equal(store.read(a.id, 'recipient').content[1].data, png.toString('base64'));
    store.discard(a.id, 7); assert.equal(fs.existsSync(a.path), true);
    store.discard(b.id, 7); assert.equal(fs.existsSync(a.path), true);
    store.removeRecipient('recipient'); assert.equal(fs.existsSync(a.path), true);
    assert.throws(() => store.read(a.id, 'recipient'), /unavailable/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('visible-only chat context stays explicitly incomplete, even below size limits', () => {
  const store = new SessionContextStore();
  const update = value => store.update({ id: 'chat', identity: 'conversation', windowId: 1, kind: 'chat', content: 'Observed since connection', ...value });
  update({}); store.grant('reader', 1, ['chat']);
  assert.equal(store.read('reader', 'chat').incompleteHistory, true);
  update({ incompleteHistory: true });
  assert.equal(store.list('reader')[0].incompleteHistory, true);
  update({ incompleteHistory: false });
  assert.equal(store.read('reader', 'chat').incompleteHistory, false);
  update({ incompleteHistory: false, truncated: true });
  assert.equal(store.read('reader', 'chat').incompleteHistory, true);
});

test('screenshot refuses pixels if its document changes while capture is pending', async () => {
  const { createBrowserMcp } = require('../src/main/browser-mcp');
  const { Access } = require('../src/main/browser-policy');
  const access = new Access(); access.register('reader', 1); access.grant('reader', 1, ['view']);
  const picture = { isEmpty: () => false, toPNG: () => Buffer.from('image') };
  const view = { id: 'view', documentId: 'one', documentEpoch: 1, view: { webContents: { getTitle: () => 'Page', getURL: () => 'https://example.test/', isDestroyed: () => false, capturePage: async () => { view.documentEpoch++; return picture; } } } };
  const gateway = await createBrowserMcp({ access, views: new Map([['view', view]]) });
  try {
    const { url } = await gateway.connection('reader');
    const output = await fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nami_browser_screenshot', arguments: { tabId: 'view' } } }) }).then(r => r.json());
    assert.match(output.error.message, /page changed during capture/);
    assert.deepEqual(gateway.status('reader').activities, []);
  } finally { await gateway.close(); }
});

test('queued peer calls cannot use old permissions while a browser operation drains', async () => {
  const { createBrowserMcp } = require('../src/main/browser-mcp');
  const { Access } = require('../src/main/browser-policy');
  const access = new Access(); access.register('reader', 1); access.register('peer', 1);
  access.grant('reader', 1, ['view']); access.get('reader').peers = ['peer'];
  let captured, finish;
  const started = new Promise(resolve => captured = resolve);
  const capture = new Promise(resolve => finish = resolve);
  const view = { id: 'view', view: { webContents: { getTitle: () => 'Page', getURL: () => 'https://example.test/', isDestroyed: () => false, capturePage: () => { captured(); return capture; } } } };
  const gateway = await createBrowserMcp({ access, views: new Map([['view', view]]) });
  try {
    const { url } = await gateway.connection('reader');
    let id = 0;
    const rpc = params => fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params }) }).then(r => r.json());
    const screenshot = rpc({ name: 'nami_browser_screenshot', arguments: { tabId: 'view' } });
    await started;
    const refresh = gateway.refresh('reader', () => { access.get('reader').peers = []; });
    const message = rpc({ name: 'nami_send_message', arguments: { to: 'peer', text: 'Old permission must not deliver this.' } });
    const list = rpc({ name: 'nami_sessions' });
    await new Promise(resolve => setTimeout(resolve, 50));
    finish({ isEmpty: () => false, toPNG: () => Buffer.from('image') });
    const [shotResult, messageResult, listResult] = await Promise.all([screenshot, message, list]);
    await refresh;
    assert.match(shotResult.error.message, /access changed/);
    assert.ok(messageResult.error);
    assert.equal(access.get('peer').inbox.length, 0);
    if (listResult.result) assert.deepEqual(JSON.parse(listResult.result.content[0].text), []);
    else assert.match(listResult.error.message, /being updated/);
  } finally { finish?.({ isEmpty: () => false, toPNG: () => Buffer.from('image') }); await gateway.close(); }
});

test('browser chip labels watching, last accessed, and access failed — never setup required', () => {
  assert.equal(browserChipLabel(null), 'Watching');
  assert.equal(browserChipLabel(undefined), 'Watching');
  assert.equal(browserChipLabel({}), 'Watching');
  assert.match(browserChipLabel({ lastSuccessfulAt: Date.UTC(2026, 0, 1, 15, 4, 5) }), /^Last accessed /);
  assert.match(browserChipLabel({ at: Date.UTC(2026, 0, 1, 15, 4, 5) }), /^Last accessed /);
  assert.equal(browserChipLabel({ error: 'tab closed', lastSuccessfulAt: 1 }), 'Access failed');
  assert.doesNotMatch(browserChipLabel(null) + browserChipLabel({ at: 1 }), /Setup required/);
});

test('page snapshot is title, URL, and bounded visible text', () => {
  const text = formatBrowserSnapshot({ title: 'Stripe', url: 'https://stripe.com/docs', text: 'Pay ' + 'x'.repeat(20000), capturedAt: Date.UTC(2026, 0, 1, 12) });
  assert.match(text, /Watching Stripe/);
  assert.match(text, /https:\/\/stripe\.com\/docs/);
  assert.match(text, /Pay x/);
  assert.ok(text.length < 18000, 'visible page text stays bounded');
  assert.equal(formatBrowserSnapshot({ url: 'https://www.stripe.com/pay' }), 'Watching stripe.com (https://www.stripe.com/pay)');
});

test('browser inspect offers Send page now and hides JSON setup sheets', () => {
  const labels = browserInspectActions({
    source: { id: 'tab', title: 'Stripe', url: 'https://stripe.com/' },
    access: null,
    mcpUnsupported: true,
  }).map(a => a.label);
  assert.ok(labels.includes('Send page now'));
  assert.ok(labels.some(l => /HTTP MCP unsupported/.test(l)));
  assert.equal(labels.some(l => /Copy JSON|Copy Claude|Browser setup|mcpServers|Refresh into input/i.test(l)), false);
});

function fakeEl(tag = 'div') {
  const node = {
    tagName: String(tag).toUpperCase(), className: '', style: {}, dataset: {}, children: [], parentElement: null,
    _html: '', onclick: null, disabled: false, attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      if (name === 'style') this.style.cssText = value;
    },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    before(child) {
      const siblings = this.parentElement.children, i = siblings.indexOf(this);
      child.parentElement = this.parentElement; siblings.splice(i, 0, child);
    },
    remove() { if (!this.parentElement) return; this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const all = []; const walk = n => { for (const c of n.children) { all.push(c); walk(c); } }; walk(this);
      if (sel.startsWith('.')) return all.filter(n => String(n.className).split(/\s+/).includes(sel.slice(1)));
      if (sel.startsWith('[')) {
        const attr = sel.slice(1, -1);
        return all.filter(n => n.attributes[attr] != null || n.dataset[attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] != null);
      }
      return all.filter(n => n.tagName === sel.toUpperCase());
    },
    getBoundingClientRect() { return { left: 12, bottom: 40, top: 0, right: 80 }; },
    set innerHTML(html) {
      this._html = html; this.children = [];
      for (const m of String(html).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const b = fakeEl('button');
        for (const a of m[1].matchAll(/([:\w-]+)="([^"]*)"/g)) b.setAttribute(a[1], a[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&#39;/g, "'"));
        b._html = m[2]; this.appendChild(b);
      }
    },
    get innerHTML() { return this._html; },
    get textContent() { return String(this._html || '').replace(/<[^>]+>/g, ''); },
  };
  return node;
}

function mountSources({ status, snapshot, capabilities, insert } = {}) {
  const root = fakeEl('div'), body = fakeEl('div');
  const rec = { root, body, acpCapabilities: capabilities ? () => capabilities : undefined };
  const tiles = new Map([['sess', rec]]);
  const menus = [], inserted = [], toasts = [];
  globalThis.document = { createElement: fakeEl };
  globalThis.window = { addEventListener() {} };
  const api = {
    browserStatus: async () => ({ ok: true, enabled: true, ...status }),
    browserSync: async () => ({ ok: true }),
    browserContext: async () => ({ ok: true, source: { title: 'Other', kind: 'terminal', content: 'scrollback', capturedAt: Date.now() } }),
    browserAction: async ({ action }) => action === 'snapshot' ? (snapshot || {}) : {},
    onBrowserEvent() {},
  };
  const sources = createSessionSources({
    api, state: { panels: [{ id: 'sess', title: 'Claude', kind: 'run' }, { id: 'tab', title: 'Stripe', kind: 'browser', url: 'https://stripe.com/' }] },
    tiles, esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    icon: () => '<svg></svg>', isSession: p => p.kind !== 'browser', menu: (_x, _y, items) => menus.push(items),
    toast: m => toasts.push(m), settings: () => { throw new Error('setup sheet must stay off the chip menu'); },
    publish: async () => ({ ok: true, source: { id: 'other', identity: 'c1' } }), insert: async (id, text) => { inserted.push({ id, text }); },
  });
  return { sources, rec, menus, inserted, toasts, api };
}

test('granted tab paints Watching with --green, never Setup required, and Send page now inserts the snapshot', async () => {
  const view = { id: 'tab', title: 'Stripe Checkout', url: 'https://stripe.com/checkout' };
  const { sources, rec, menus, inserted } = mountSources({
    status: { sessions: [{ id: 'sess', views: ['tab'], sources: [], activities: [] }], views: [view] },
    snapshot: { title: 'Stripe Checkout', url: view.url, text: 'Pay $20' },
  });
  await sources.refresh();
  assert.match(rec.sourceStrip.innerHTML, /Watching/);
  assert.match(rec.sourceStrip.innerHTML, /Stripe Checkout/);
  assert.match(rec.sourceStrip.innerHTML, /var\(--green\)/);
  assert.doesNotMatch(rec.sourceStrip.innerHTML, /Setup required|Copy JSON|Shared · initialized/);
  rec.sourceStrip.querySelectorAll('[data-source]')[0].onclick();
  const labels = menus.at(-1).map(a => a.label);
  assert.ok(labels.includes('Send page now'));
  assert.equal(labels.some(l => /Copy JSON|Copy Claude|Browser setup/i.test(l)), false);
  await menus.at(-1).find(a => a.label === 'Send page now').run();
  assert.match(inserted[0].text, /Watching Stripe Checkout/);
  assert.match(inserted[0].text, /https:\/\/stripe.com\/checkout/);
  assert.match(inserted[0].text, /Pay \$20/);
});

test('chat linked context includes the granted page even when HTTP MCP is unsupported', async () => {
  const view = { id: 'tab', title: 'Docs', url: 'https://example.test/docs', text: 'Already captured heading' };
  const { sources, rec, menus } = mountSources({
    status: { sessions: [{ id: 'sess', views: ['tab'], sources: [], activities: [{ tabId: 'tab', error: 'tool failed', at: Date.now() }] }], views: [view] },
    capabilities: { mcpHttp: false, mcpUnsupported: true, connected: true },
  });
  await sources.refresh();
  assert.match(rec.sourceStrip.innerHTML, /Access failed/);
  rec.sourceStrip.querySelectorAll('[data-source]')[0].onclick();
  assert.ok(menus.at(-1).some(a => /HTTP MCP unsupported/.test(a.label)));
  const text = await sources.linkedContext('sess');
  assert.match(text, /Watching Docs/);
  assert.match(text, /https:\/\/example.test\/docs/);
  assert.match(text, /Already captured heading/);
});

