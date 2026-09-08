import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkHintText, createLinkHint } from '../src/renderer/link-hint.mjs';

test('hints only promise actions available for the resolved target', () => {
  assert.equal(linkHintText({ kind: 'path' }), null);
  assert.equal(linkHintText({ kind: 'path', st: { exists: false } }), null);
  assert.equal(linkHintText({ kind: 'path', st: { exists: true } }), null);
  assert.equal(linkHintText({ kind: 'url' })[0], '⌘ Click to open in browser');
  assert.equal(linkHintText({ kind: 'path', st: { exists: true, isFile: true } })[0], '⌘ Click to open file');
  assert.equal(linkHintText({ kind: 'path', st: { exists: true, isDir: true } })[0], '⌘ Click to reveal in Finder');
});

function fixture() {
  const pending = new Map(), nodes = [];
  let serial = 0;
  const document = {
    body: { appendChild: (node) => nodes.push(node) },
    createElement: () => ({
      style: {}, children: [], setAttribute() {},
      appendChild(node) { this.children.push(node); },
      getBoundingClientRect: () => ({ width: 240, height: 90 }),
      remove() { nodes.splice(nodes.indexOf(this), 1); },
    }),
  };
  const hint = createLinkHint({
    document, window: { innerWidth: 800, innerHeight: 600 },
    schedule: (run) => { pending.set(++serial, run); return serial; },
    cancel: (id) => pending.delete(id),
  });
  return { hint, nodes, flush() { const runs = [...pending.values()]; pending.clear(); runs.forEach((run) => run()); } };
}

test('leaving before the hover dwell never mounts a hint', () => {
  const f = fixture();
  f.hint.show({ kind: 'url' }, { clientX: 100, clientY: 100 }, 'first');
  assert.equal(f.nodes.length, 0);
  assert.equal(f.hint.hide('first'), true);
  f.flush();
  assert.equal(f.nodes.length, 0);
  assert.equal(f.hint.hide(), false);
});

test('a stale leave or disposed pane cannot erase another pane’s hint', () => {
  const f = fixture();
  f.hint.show({ kind: 'url' }, { clientX: 100, clientY: 100 }, 'first');
  f.hint.show({ kind: 'url' }, { clientX: 780, clientY: 580 }, 'second');
  assert.equal(f.hint.hide('first'), false);
  f.flush();
  assert.equal(f.nodes.length, 1);
  assert.equal(f.nodes[0].style.left, '548px');
  assert.equal(f.nodes[0].style.top, '476px');
  assert.equal(f.hint.hide('second'), true);
  assert.equal(f.nodes.length, 0);
});

test('moving from a valid link to a missing path cancels its pending hint', () => {
  const f = fixture();
  f.hint.show({ kind: 'url' }, { clientX: 100, clientY: 100 }, 'first');
  f.hint.show({ kind: 'path', st: { exists: false } }, { clientX: 100, clientY: 100 }, 'first');
  f.flush();
  assert.equal(f.nodes.length, 0);
});

test('a hint displays instructions only, never the path or URL', () => {
  const f = fixture();
  f.hint.show({ kind: 'url', text: 'untrusted <img onerror="bad()">' }, { clientX: 100, clientY: 100 }, 'first');
  f.flush();
  const text = f.nodes[0].children.map((child) => child.textContent).join(' ');
  assert.equal(text, '⌘ Click to open in browser Right-click for more options');
  assert.ok(!text.includes('untrusted'));
});

// A slow file stat must not resurrect a tooltip after Escape or scrolling.
test('dismissal invalidates unresolved lookups even before a hint is mounted', () => {
  const f = fixture();
  const before = f.hint.revision;
  assert.equal(f.hint.hide(), false);
  assert.notEqual(f.hint.revision, before);
});
