// Which tools an agent can run on, and which one a row launches. Both are
// derived — from where the file sits and which binaries this Mac has — so both
// are testable without a window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reachOf, resolveTool, originLine, sortKey, canRunOn, PLATFORM_TO_TOOL,
} from '../src/renderer/agent-reach.mjs';

const item = (over = {}) => ({
  type: 'agent', platform: 'project', scope: 'project', slug: 'x',
  meta: { tools: '', model: '', mode: '', tool: '' }, ...over,
});
const master = (over = {}) => item(over);
const pinned = (platform, over = {}) => item({ platform, ...over });
const ALL = ['claude', 'codex', 'opencode', 'antigravity', 'kimi', 'hermes'];

// ---- reach ------------------------------------------------------------------

test('a master reaches every tool Nami can write a dialect for, and not Hermes', () => {
  const r = reachOf(master());
  assert.deepEqual([...r].sort(), ['antigravity', 'claude', 'codex', 'kimi', 'opencode']);
  assert.ok(!r.includes('hermes'), 'Hermes reads no agent format');
});

test('a hand-made agent reaches exactly the tool whose folder it sits in', () => {
  assert.deepEqual(reachOf(pinned('claude')), ['claude']);
  assert.deepEqual(reachOf(pinned('codex')), ['codex']);
  assert.deepEqual(reachOf(pinned('opencode')), ['opencode']);
  assert.deepEqual(reachOf(pinned('kimi')), ['kimi']);
});

test('the library calls Antigravity’s folder gemini; the detected tool is antigravity', () => {
  assert.equal(PLATFORM_TO_TOOL.gemini, 'antigravity');
  assert.deepEqual(reachOf(pinned('gemini')), ['antigravity']);
});

test('a plugin agent is Claude’s, and reach does not care that it is read-only', () => {
  assert.deepEqual(reachOf(pinned('claude', { scope: 'plugin', readOnly: true })), ['claude']);
});

test('canRunOn is reach, asked about one tool', () => {
  assert.equal(canRunOn(master(), 'codex'), true);
  assert.equal(canRunOn(master(), 'hermes'), false);
  assert.equal(canRunOn(pinned('opencode'), 'codex'), false);
});

// ---- the resolution order ---------------------------------------------------

test('1 · the tool you last ran this agent on wins', () => {
  assert.equal(resolveTool({
    item: master({ meta: { tool: 'kimi' } }), remembered: 'codex',
    focusedTool: 'opencode', installed: ALL,
  }), 'codex');
});

test('2 · with nothing remembered, the master’s own tool: is next', () => {
  assert.equal(resolveTool({
    item: master({ meta: { tool: 'kimi' } }), remembered: '',
    focusedTool: 'opencode', installed: ALL,
  }), 'kimi');
});

test('3 · then the session you are looking at', () => {
  assert.equal(resolveTool({
    item: master(), remembered: '', focusedTool: 'opencode', installed: ALL,
  }), 'opencode');
});

test('4 · then the only one installed, else Claude', () => {
  assert.equal(resolveTool({ item: master(), installed: ['kimi'] }), 'kimi');
  assert.equal(resolveTool({ item: master(), installed: ['codex', 'claude', 'kimi'] }), 'claude');
});

test('every step is skipped when it names a tool this agent cannot speak', () => {
  const it = pinned('opencode');
  assert.equal(resolveTool({
    item: it, remembered: 'codex', focusedTool: 'claude', installed: ALL,
  }), 'opencode', 'a pinned agent ignores every hint but its own folder');
});

test('every step is skipped when it names a tool that is not installed', () => {
  assert.equal(resolveTool({
    item: master(), remembered: 'kimi', focusedTool: 'codex', installed: ['claude', 'codex'],
  }), 'codex', 'kimi is remembered but gone; the focused session answers');
});

test('nothing installed that can run it resolves to nothing, not to a guess', () => {
  assert.equal(resolveTool({ item: master(), installed: ['hermes'] }), null);
  assert.equal(resolveTool({ item: pinned('kimi'), installed: ['claude'] }), null);
});

// ---- how the row reads ------------------------------------------------------

const NAMES = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity', kimi: 'Kimi' };
const nameOf = (id) => NAMES[id] || id;

test('every row says where it came from', () => {
  assert.match(originLine(master(), nameOf), /this folder/);
  assert.match(originLine(pinned('opencode'), nameOf), /OpenCode only/);
  assert.match(originLine(pinned('claude', { scope: 'user' }), nameOf), /every folder/);
  assert.match(originLine(pinned('claude', { scope: 'plugin' }), nameOf), /plugin/);
});

test('the list orders masters first, then this folder, then yours, then plugins', () => {
  const rows = [
    pinned('claude', { scope: 'plugin', slug: 'd' }),
    pinned('claude', { scope: 'user', slug: 'c' }),
    pinned('codex', { slug: 'b' }),
    master({ slug: 'a' }),
  ].sort((x, y) => sortKey(x) - sortKey(y) || x.slug.localeCompare(y.slug));
  assert.deepEqual(rows.map((r) => r.slug), ['a', 'b', 'c', 'd']);
});

// ---- the master's own tool --------------------------------------------------
// The library builds meta from a fixed list of keys. `tool` was missing from it
// for one commit, which is how a master declaring `tool: codex` still launched
// on Claude — resolveTool was right and simply never saw the value.

test('a master that names its tool launches there when nothing is remembered', () => {
  const it = master({ meta: { tool: 'codex', model: '', mode: '' } });
  assert.equal(resolveTool({ item: it, remembered: '', focusedTool: null, installed: ALL }), 'codex');
});
