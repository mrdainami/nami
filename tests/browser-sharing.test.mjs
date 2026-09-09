import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
