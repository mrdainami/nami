// The Windows column of connector delivery. Platform is a parameter all the way
// down, so a Mac can read what a PC's agents would be handed — and prove that
// its own files have not moved by a byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { deliveryPlan, codexBlock } = require('../src/main/connections.js');
const { KNOWN_SERVICES, serviceById } = require('../src/main/services-catalog.js');

const NOTION = { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_1' } };
const WRAPPED = { command: 'cmd', args: ['/c', 'npx', '-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_1' } };
const EVERYONE = ['claude', 'cursor', 'gemini', 'antigravity', 'kimi', 'opencode', 'codex', 'grok', 'hermes'];
const plan = (platform, scope = 'project') => deliveryPlan({
  masters: { notion: NOTION }, scope, agentIds: EVERYONE, projectPath: '/proj', homeDir: '/home/u', platform,
});

test('a Mac is handed exactly what it was handed before platform was a parameter', () => {
  for (const scope of ['project', 'user']) {
    for (const step of plan('darwin', scope)) {
      if (step.kind === 'json' && step.section === 'mcpServers') assert.deepEqual(step.entries.notion, NOTION, step.agent);
      if (step.kind === 'block') assert.deepEqual(step.masters.notion, NOTION, step.agent);
      if (step.kind === 'cli') assert.deepEqual(JSON.parse(step.argv[5]), NOTION);
      if (step.section === 'mcp') assert.deepEqual(step.entries.notion.command, ['npx', '-y', '@notionhq/notion-mcp-server']);
    }
  }
});

test('on a PC every client that starts a bare npx keeps the entry a Mac teammate can share', () => {
  for (const scope of ['project', 'user']) {
    for (const step of plan('win32', scope)) {
      if (step.agent === 'cursor' || step.kind === 'manual') continue;
      if (step.kind === 'cli') assert.deepEqual(JSON.parse(step.argv[5]), NOTION, step.agent);
      else if (step.kind === 'block') assert.deepEqual(step.masters.notion, NOTION, step.agent);
      else if (step.section === 'mcp') assert.deepEqual(step.entries.notion.command, ['npx', '-y', '@notionhq/notion-mcp-server'], step.agent);
      else assert.deepEqual(step.entries.notion, NOTION, step.agent);
    }
  }
  // so the Codex block is the same text on both machines
  const block = (p) => codexBlock(plan(p).find((s) => s.agent === 'codex').masters);
  assert.equal(block('win32'), block('darwin'));
});

test('on a PC the one client that cannot start npx is handed cmd /c npx', () => {
  const cursor = plan('win32').find((s) => s.agent === 'cursor');
  assert.deepEqual(cursor.entries.notion, WRAPPED);
  assert.deepEqual(plan('darwin').find((s) => s.agent === 'cursor').entries.notion, NOTION);
  // and the master it was built from is never edited in place
  assert.deepEqual(NOTION.command, 'npx');
});

test('a program that is not an npm launcher is never wrapped, on any machine', () => {
  const masters = { kie: { command: 'node', args: ['C:\\Users\\cal\\.nami\\connectors\\kie-mcp\\dist\\index.js'] }, far: { url: 'https://mcp.example.com/mcp' } };
  const cursor = deliveryPlan({ masters, scope: 'project', agentIds: ['cursor'], projectPath: '/proj', homeDir: '/home/u', platform: 'win32' })[0];
  assert.deepEqual(cursor.entries, masters);
});

test('the built-in npx recipes are one spelling on every machine', () => {
  const values = { token: 't', folder: '/Users/x/Sites', installDir: '/Users/x/.nami/connectors/kie-mcp' };
  for (const s of KNOWN_SERVICES.filter((x) => x.kind !== 'install')) {
    assert.deepEqual(s.entry(values, 'win32'), s.entry(values, 'darwin'), s.id);
    assert.equal(s.entry(values, 'win32').command, 'npx', s.id);
  }
});

test('the installed connector is pointed at with the path its own machine uses', () => {
  const kie = serviceById('kie');
  assert.deepEqual(kie.entry({ token: 'k', installDir: '/Users/x/.nami/connectors/kie-mcp' }, 'darwin').args, ['/Users/x/.nami/connectors/kie-mcp/dist/index.js']);
  assert.deepEqual(kie.entry({ token: 'k', installDir: 'C:\\Users\\x\\.nami\\connectors\\kie-mcp' }, 'win32').args, ['C:\\Users\\x\\.nami\\connectors\\kie-mcp\\dist\\index.js']);
  // main expands a leading ~ with os.homedir(), which leaves the tail in slashes
  assert.deepEqual(kie.entry({ token: 'k', installDir: 'C:\\Users\\x/.nami/connectors/kie-mcp' }, 'win32').args, ['C:\\Users\\x\\.nami\\connectors\\kie-mcp\\dist\\index.js']);
  assert.deepEqual(kie.opencodeEntry({ token: 'k', installDir: 'C:\\Users\\x\\c' }, 'win32').command, ['node', 'C:\\Users\\x\\c\\dist\\index.js']);
});
