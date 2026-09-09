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
