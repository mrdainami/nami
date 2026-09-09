import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CONNECT_OVERLAYS,
  catalogServices,
  guidedSetupSeed,
  customSetupSeed,
  connectDoneView,
  connectDoneHtml,
  connectCatalogHtml,
  createMcpSetup,
} from '../src/renderer/mcp-setup.mjs';

const GMAIL = {
  id: 'gmail', name: 'Gmail', desc: 'read and reply to email', code: 'GM', kind: 'guided',
  docs: 'https://github.com/GongRzhe/Gmail-MCP-Server',
  guide: 'Google asks for a short sign-in setup (about 5 minutes). A session with your agent walks you through it and finishes the connection.',
  keys: [],
};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const src = fs.readFileSync(new URL('../src/renderer/mcp-setup.mjs', import.meta.url), 'utf8');

test('the overlay types parent dispatches are the five connect sheets', () => {
  assert.deepEqual([...CONNECT_OVERLAYS].sort(), [
    'connect', 'connect-custom', 'connect-done', 'connect-form', 'connect-own',
  ]);
});

test('catalogServices never surfaces nami-browser even if it is stuffed in', () => {
  const cat = catalogServices([
    { id: 'notion', name: 'Notion' },
    { id: 'nami-browser', name: 'Nami Browser' },
    { id: 'gmail', name: 'Gmail' },
  ]);
  assert.deepEqual(cat.map((s) => s.id), ['notion', 'gmail']);
});

test('guided seed tells the agent to register connections.json mcpServers, then Nami delivers', () => {
  const s = guidedSetupSeed(GMAIL);
  assert.match(s, /Walk me through connecting Gmail/);
  assert.match(s, /GongRzhe\/Gmail-MCP-Server/);
  assert.match(s, /connections\.json/);
  assert.match(s, /mcpServers/);
  assert.match(s, /Nami copies it to every installed agent's own config/);
  assert.equal(s.includes('\n'), false, 'one line for the pty seeder');
  assert.doesNotMatch(s, /nami-browser/);
});

test('custom seed uses the same master-register contract', () => {
  const s = customSetupSeed('our internal wiki at wiki.acme.dev');
  assert.match(s, /our internal wiki at wiki\.acme\.dev/);
  assert.match(s, /connections\.json/);
  assert.match(s, /mcpServers/);
  assert.match(s, /Nami copies it to every installed agent's own config/);
  assert.equal(s.includes('\n'), false);
  assert.doesNotMatch(s, /nami-browser/);
});

test('a failed connect stays Failed and claims nothing was half-written', () => {
  const v = connectDoneView({ ok: false, error: 'unknown service' }, { name: 'Notion' });
  assert.equal(v.ok, false);
  assert.equal(v.title, 'Not yet.');
  assert.match(v.subtitle, /nothing was half-written/);
  assert.match(v.okLine, /unknown service/);
});

test('a proven connect says connected; an unconfirmed test still wrote the master', () => {
  const ok = connectDoneView({ ok: true, checked: true, tools: 4 }, { name: 'Notion' });
  assert.equal(ok.title, 'Notion is connected!');
  assert.match(ok.okLine, /4 tools ready/);
  const unconfirmed = connectDoneView({ ok: true, checked: false, checkError: 'no answer' }, { name: 'Slack' });
  assert.match(unconfirmed.okLine, /could not confirm/);
  assert.match(unconfirmed.okLine, /no answer/);
});

test('file-path peek is a closed details, never a JSON dump', () => {
  const html = connectDoneHtml({
    svc: { name: 'Notion' },
    result: { ok: true, checked: true, tools: 2, files: ['~/proj/connections.json (the master)', '~/.mcp.json'] },
    esc,
  });
  assert.match(html, /<details class="sv-fold"><summary>curious what got written\? peek here<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /connections\.json \(the master\)/);
  assert.doesNotMatch(html, /"mcpServers"/);
  assert.doesNotMatch(html, /nami-browser/);
});

test('catalog html hides nami-browser and keeps click-to-connect copy', () => {
  const html = connectCatalogHtml({
    catalog: [
      { id: 'notion', name: 'Notion', desc: 'your notes and docs', code: 'NO' },
      { id: 'nami-browser', name: 'Nami Browser', desc: 'this Mac\'s browser', code: 'NB' },
    ],
    connectedIds: new Set(['notion']),
    esc,
  });
  assert.match(html, /Connect MCP/);
  assert.match(html, /data-id="notion"/);
  assert.match(html, /connected/);
  assert.doesNotMatch(html, /nami-browser/);
  assert.doesNotMatch(html, /Nami Browser/);
});

test('this module never dumps nami-browser JSON; browser MCP is not this catalog', () => {
  assert.doesNotMatch(src, /JSON\.stringify/);
  assert.doesNotMatch(src, /type:\s*'http'/);
  assert.doesNotMatch(src, /mcpServers:\s*\{/);
});

function harness(over = {}) {
  const calls = [];
  const state = {
    overlay: null,
    services: { catalog: [GMAIL], connected: [], coverage: null },
    agents: [{ id: 'claude', name: 'Claude Code', kind: 'claude', found: true }],
    project: { path: '/proj' },
  };
  const mcp = createMcpSetup({
    state,
    overlay: (cls, inner) => { calls.push(['overlay', cls, inner]); return { querySelector() { return null; }, querySelectorAll() { return []; } }; },
    q: () => null,
    esc,
    api: {
      connectService: async (args) => { calls.push(['connectService', args]); return { ok: true, checked: true, tools: 3, files: ['/proj/connections.json (the master)'] }; },
      deliverServices: async (args) => { calls.push(['deliverServices', args]); return []; },
      disconnectService: async (args) => { calls.push(['disconnectService', args]); return { changed: [] }; },
    },
    toast: (m) => calls.push(['toast', m]),
    closeOverlay: () => { calls.push(['closeOverlay']); state.overlay = null; },
    renderOverlay: () => { calls.push(['renderOverlay']); },
    refreshServices: () => calls.push(['refreshServices']),
    refreshAgents: () => calls.push(['refreshAgents']),
    loadLibrary: () => calls.push(['loadLibrary']),
    installedAgentIds: () => ['claude', 'codex'],
    chosenAgent: () => state.agents[0],
    agentOptionsHtml: () => '<option value="claude">Claude Code</option>',
    agentSession: (w, opts) => calls.push(['agentSession', w, opts]),
    bestAgent: () => state.agents[0],
    startPanel: (opts) => calls.push(['startPanel', opts]),
    shortHome: (p) => p,
    agentNameOf: (id) => id === 'claude' ? 'Claude Code' : id,
    ...over,
  });
  return { mcp, state, calls };
}

test('guided setup opens a session whose onExit delivers then refreshes', async () => {
  const { mcp, calls } = harness();
  mcp.startGuidedSetup(GMAIL, { id: 'claude', kind: 'claude', name: 'Claude Code' });
  assert.equal(calls[0][0], 'closeOverlay');
  const session = calls.find((c) => c[0] === 'agentSession');
  assert.ok(session, 'opens an agent session');
  assert.equal(session[2].title, 'set up Gmail');
  assert.equal(session[2].code, 'GM');
  assert.match(session[2].seed, /connections\.json/);
  assert.match(session[2].seed, /mcpServers/);
  assert.equal(typeof session[2].onExit, 'function');
  await session[2].onExit();
  const kinds = calls.filter((c) => c[0] === 'deliverServices' || c[0] === 'refreshServices').map((c) => c[0]);
  assert.deepEqual(kinds, ['refreshServices', 'deliverServices', 'refreshServices']);
  assert.deepEqual(calls.find((c) => c[0] === 'deliverServices')[1], {
    projectPath: '/proj', agentIds: ['claude', 'codex'],
  });
});

test('guided setup without an agent does not start a session', () => {
  const { mcp, calls } = harness({ bestAgent: () => null, chosenAgent: () => null });
  mcp.startGuidedSetup(GMAIL, null);
  assert.ok(!calls.some((c) => c[0] === 'agentSession'));
  assert.match(calls.find((c) => c[0] === 'toast')[1], /No agent is installed/);
});

test('openConnect shows the catalog sheet and refreshes services', () => {
  const { mcp, state, calls } = harness();
  mcp.openConnect();
  assert.equal(state.overlay.type, 'connect');
  assert.ok(calls.some((c) => c[0] === 'renderOverlay'));
  assert.ok(calls.some((c) => c[0] === 'refreshServices'));
});
