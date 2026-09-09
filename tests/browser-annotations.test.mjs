import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createAnnotationStore, annotationBatch, annotationPosition } from '../src/renderer/browser-annotations.mjs';

test('annotation batches retain source and final comment but never mix unrelated owners', () => {
  const store = createAnnotationStore(), a = { id: 'tab-a', owner: 'session-1' }, b = { id: 'tab-b', owner: 'session-1' }, c = { id: 'tab-c', owner: 'session-2' };
  const note = store.save(a, { text: 'Buy', note: 'Make this clearer', title: 'Shop', url: 'https://shop.test', locator: '#buy' });
  store.save(b, { text: '', label: 'Visual region (no image attached)', note: 'Spacing' });
  store.save(c, { text: 'Secret other session' });
  store.save(a, { ...note, note: 'Edited comment' });
  assert.equal(store.list(a).length, 2);
  assert.match(annotationBatch(store.list(a)), /Edited comment/);
  assert.doesNotMatch(annotationBatch(store.list(a)), /Make this clearer|Secret other session/);
  assert.match(annotationBatch(store.list(a)), /Visual region \(no image attached\)/);
  store.clear(a); assert.equal(store.list(b).length, 0); assert.equal(store.list(c).length, 1);
});

test('geometry only follows same document and never reattaches stale selections', () => {
  const store = createAnnotationStore(), p = { id: 'a' };
  const n = store.save(p, { documentId: 'doc-1', selectionId: 'sel-1', rect: { x: 1, y: 2 } });
  store.update('a', { documentId: 'doc-1', selections: [{ selectionId: 'sel-1', rect: { x: 3, y: 4 } }] });
  assert.equal(n.rect.x, 3);
  store.update('a', { documentId: 'doc-2', selections: [{ selectionId: 'sel-1', rect: { x: 8, y: 9 } }] });
  assert.equal(n.stale, true); assert.equal(n.rect.x, 3);
  store.update('a', { documentId: 'doc-1', selections: [{ selectionId: 'sel-1', rect: { x: 99 } }] });
  assert.equal(n.rect.x, 3); assert.match(annotationBatch([n]), /Snapshot/);
});

test('bubble positions stay inside compact panes and left of right-edge selections', () => {
  assert.deepEqual(annotationPosition({ x: 550, y: 290, width: 30 }, { width: 600, height: 400 }), { x: 262, y: 212, width: 280 });
  const small = annotationPosition({ x: -20, y: -100, width: 40 }, { width: 180, height: 220 });
  assert.equal(small.x, 8); assert.equal(small.width, 164); assert.equal(small.y, 8);
});

function helper(options = {}) {
  const listeners = new Map(), ipc = new Map(), sent = [];
  const document = { title: 'Fixture', querySelectorAll: () => [element], caretRangeFromPoint: options.caretRangeFromPoint || (() => null) };
  let y = 30, text = 'Selected button';
  const element = { id: 'button', tagName: 'BUTTON', isConnected: true, getRootNode: () => document, getBoundingClientRect: () => ({ x: 20, y, width: 100, height: 25 }), getClientRects() { return [this.getBoundingClientRect()]; }, get innerText() { return text; } };
  let animation, selection = options.selection || null;
  const window = { addEventListener: (name, fn) => { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); }, getSelection: () => selection };
  const context = { require: () => ({ ipcRenderer: { on: (name, fn) => ipc.set(name, fn), send: (name, value) => sent.push([name, value]) } }), window, document,
    crypto: { randomUUID: () => 'document-1' }, CSS: { escape: (x) => x }, innerWidth: 600, innerHeight: 400, scrollX: 0, scrollY: 0,
    requestAnimationFrame: (fn) => { animation = fn; return 1; }, MutationObserver: class { observe() {} } };
  vm.runInNewContext(fs.readFileSync(new URL('../src/main/browser-preload.js', import.meta.url), 'utf8'), context);
  return { sent, element, mode: (value) => ipc.get('browser:annotate-mode')({}, value), move: (value) => { y = value; }, change: (value) => { text = value; }, layout: () => { window.addEventListener; for (const fn of listeners.get('scroll')) fn(); animation(); },
    setSelection(value) { selection = value; },
    dispatch(name, fields = {}) { const event = { isTrusted: true, clientX: 25, clientY: 35, composedPath: () => [element], preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...fields }; for (const fn of listeners.get(name) || []) { fn(event); if (event.stopped) break; } return event; } };
}

test('click infers a component without a toolbar mode and blocks website activation', () => {
  const h = helper(); h.mode({ active: true });
  assert.equal(h.dispatch('pointerdown').prevented, true);
  assert.equal(h.dispatch('click').prevented, true);
  const selected = h.sent.find(([name]) => name === 'browser:selection')[1];
  assert.equal(selected.locator, '#button'); assert.equal(selected.kind, 'component'); assert.equal(selected.rect.y, 30);
  assert.equal(h.element.style, undefined, 'selection must not inject page styles or private UI');
  h.move(-10); h.layout();
  let layout = h.sent.filter(([name]) => name === 'browser:annotation-layout').at(-1)[1];
  assert.equal(layout.selections[0].rect.y, -10);
  h.change('Replaced content'); h.layout();
  layout = h.sent.filter(([name]) => name === 'browser:annotation-layout').at(-1)[1];
  assert.equal(layout.selections[0].stale, true);
});

test('a text drag infers highlight without setting a toolbar mode', () => {
  const range = { cloneRange() { return this; }, toString: () => 'Selected words', commonAncestorContainer: { nodeType: 3, parentElement: null } };
  const h = helper({
    caretRangeFromPoint: () => ({ startContainer: { nodeType: 3, nodeValue: 'Selected words for feedback.' } }),
    selection: { toString: () => '', rangeCount: 0, getRangeAt: () => range },
  });
  range.commonAncestorContainer.parentElement = h.element;
  h.mode({ active: true });
  assert.equal(h.dispatch('pointerdown', { clientX: 10, clientY: 20 }).prevented, undefined);
  h.setSelection({ toString: () => 'Selected words', rangeCount: 1, getRangeAt: () => range });
  h.dispatch('pointerup', { clientX: 120, clientY: 22 });
  const selected = h.sent.find(([name]) => name === 'browser:selection')[1];
  assert.equal(selected.kind, 'text');
  assert.equal(selected.text, 'Selected words');
  assert.equal(h.dispatch('click').prevented, true);
  assert.equal(h.sent.filter(([name]) => name === 'browser:selection').length, 1);
});

test('a non-text drag infers a region and suppresses the trailing page click', () => {
  const h = helper(); h.mode({ active: true });
  h.dispatch('pointerdown', { clientX: 10, clientY: 15 });
  h.dispatch('pointerup', { clientX: 80, clientY: 100 });
  const selected = h.sent.find(([name]) => name === 'browser:selection')[1];
  assert.equal(selected.kind, 'region'); assert.equal(selected.rect.width, 70); assert.equal(selected.locator, '');
  assert.equal(selected.label, 'Visual region');
  assert.equal(h.dispatch('click').prevented, true);
  assert.equal(h.sent.filter(([name]) => name === 'browser:selection').length, 1);
});
