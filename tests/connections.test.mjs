import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  masterPath, readMaster, upsertMaster, removeMaster,
  toOpencode, codexBlock, writeCodexBlock, presentInToml, presentInYaml,
  deliveryPlan, readNotebooks, coverage, validServiceId,
} = require('../src/main/connections.js');

function memIo(seed = {}) {
  const files = { ...seed };
  return {
    read: (f) => { if (!(f in files)) throw new Error('ENOENT ' + f); return files[f]; },
    write: (f, t) => { files[f] = t; },
    exists: (f) => f in files,
    files,
  };
}

const HOME = '/home/u';
const PROJ = '/proj';
const NOTION = { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_x' } };
const LINEAR = { url: 'https://mcp.linear.app/mcp' };

test('validServiceId accepts normal ids, rejects shell metacharacters', () => {
  for (const ok of ['notion', 'linear', 'kie.ai', 'my_server', 'a-b.c_1', '1password', '21st-dev']) {
    assert.equal(validServiceId(ok), true, ok);
  }
  for (const bad of [
    '', ' ', 'x; rm -rf ~', 'a b', '$(whoami)', '`id`', 'a|b', 'a&b',
    'a>b', 'a\nb', "a'b", 'a"b', '--scope', '-x', 'a/b', 'a\\b', '.hidden',
  ]) {
    assert.equal(validServiceId(bad), false, JSON.stringify(bad));
  }
});

// ---- masters ----------------------------------------------------------------

test('masterPath: project scope in the project, user scope under ~/.nami', () => {
  assert.equal(masterPath({ scope: 'project', projectPath: PROJ, homeDir: HOME }), '/proj/connections.json');
  assert.equal(masterPath({ scope: 'user', projectPath: PROJ, homeDir: HOME }), '/home/u/.nami/connections.json');
});

test('upsertMaster writes the standard mcpServers shape and round-trips', () => {
  const io = memIo();
  upsertMaster({ scope: 'project', projectPath: PROJ, homeDir: HOME, id: 'notion', entry: NOTION, io });
  upsertMaster({ scope: 'project', projectPath: PROJ, homeDir: HOME, id: 'linear', entry: LINEAR, io });
  const doc = JSON.parse(io.files['/proj/connections.json']);
  assert.deepEqual(Object.keys(doc.mcpServers).sort(), ['linear', 'notion']);
  assert.deepEqual(doc.mcpServers.notion, NOTION);
  const masters = readMaster({ scope: 'project', projectPath: PROJ, homeDir: HOME, io });
  assert.deepEqual(masters.linear, LINEAR);
});

test('upsertMaster in a git repo adds connections.json to .gitignore once', () => {
  const io = memIo({ '/proj/.git': '', '/proj/.gitignore': 'node_modules\n' });
  upsertMaster({ scope: 'project', projectPath: PROJ, homeDir: HOME, id: 'notion', entry: NOTION, io });
  assert.match(io.files['/proj/.gitignore'], /connections\.json/);
  upsertMaster({ scope: 'project', projectPath: PROJ, homeDir: HOME, id: 'linear', entry: LINEAR, io });
  const hits = io.files['/proj/.gitignore'].split('\n').filter((l) => l === 'connections.json');
  assert.equal(hits.length, 1);
});

test('upsertMaster outside a git repo leaves .gitignore alone', () => {
  const io = memIo();
  upsertMaster({ scope: 'project', projectPath: PROJ, homeDir: HOME, id: 'notion', entry: NOTION, io });
  assert.ok(!('/proj/.gitignore' in io.files));
});

test('removeMaster deletes one entry and keeps the rest', () => {
  const io = memIo();
  upsertMaster({ scope: 'user', projectPath: null, homeDir: HOME, id: 'notion', entry: NOTION, io });
  upsertMaster({ scope: 'user', projectPath: null, homeDir: HOME, id: 'linear', entry: LINEAR, io });
  removeMaster({ scope: 'user', projectPath: null, homeDir: HOME, id: 'notion', io });
  const masters = readMaster({ scope: 'user', projectPath: null, homeDir: HOME, io });
  assert.deepEqual(Object.keys(masters), ['linear']);
});

// ---- dialect translation ----------------------------------------------------

test('toOpencode translates a local entry', () => {
  assert.deepEqual(toOpencode(NOTION), {
    type: 'local',
    command: ['npx', '-y', '@notionhq/notion-mcp-server'],
    environment: { NOTION_TOKEN: 'ntn_x' },
    enabled: true,
  });
});

test('toOpencode translates a remote entry and skips empty env', () => {
  assert.deepEqual(toOpencode(LINEAR), { type: 'remote', url: 'https://mcp.linear.app/mcp', enabled: true });
  const local = toOpencode({ command: 'node', args: [] });
  assert.ok(!('environment' in local));
});

test('codexBlock renders TOML tables for local and remote entries', () => {
  const text = codexBlock({ notion: NOTION, linear: LINEAR });
  assert.match(text, /\[mcp_servers\.notion\]/);
  assert.match(text, /command = "npx"/);
  assert.match(text, /args = \["-y", "@notionhq\/notion-mcp-server"\]/);
  assert.match(text, /\[mcp_servers\.notion\.env\]/);
  assert.match(text, /NOTION_TOKEN = "ntn_x"/);
  assert.match(text, /\[mcp_servers\.linear\]/);
  assert.match(text, /url = "https:\/\/mcp\.linear\.app\/mcp"/);
});

test('codexBlock escapes quotes and backslashes in values', () => {
  const text = codexBlock({ odd: { command: 'a"b\\c', args: [] } });
  assert.match(text, /command = "a\\"b\\\\c"/);
});

// ---- the codex marker block (the pointer contract) --------------------------

test('writeCodexBlock appends once, then replaces only between markers', () => {
  const io = memIo({ '/proj/.codex/config.toml': '# theirs\nmodel = "gpt-5"\n' });
  writeCodexBlock({ file: '/proj/.codex/config.toml', masters: { notion: NOTION }, io });
  const first = io.files['/proj/.codex/config.toml'];
  assert.match(first, /^# theirs\nmodel = "gpt-5"\n/);
  assert.match(first, /# nami:connections start/);
  writeCodexBlock({ file: '/proj/.codex/config.toml', masters: { linear: LINEAR }, io });
  const second = io.files['/proj/.codex/config.toml'];
  assert.match(second, /model = "gpt-5"/);
  assert.match(second, /mcp_servers\.linear/);
  assert.ok(!second.includes('mcp_servers.notion'), 'old block fully replaced');
  assert.equal(second.split('# nami:connections start').length, 2, 'one block only');
});

test('writeCodexBlock creates the file when missing and refuses on two start markers', () => {
  const io = memIo();
  writeCodexBlock({ file: '/x/config.toml', masters: { notion: NOTION }, io });
  assert.match(io.files['/x/config.toml'], /mcp_servers\.notion/);
  const twice = '# nami:connections start\n# nami:connections end\n# nami:connections start\n# nami:connections end\n';
  const io2 = memIo({ '/x/config.toml': twice });
  const res = writeCodexBlock({ file: '/x/config.toml', masters: {}, io: io2 });
  assert.equal(res.ok, false);
  assert.equal(io2.files['/x/config.toml'], twice);
});

test('writeCodexBlock skips ids already defined outside the block (no duplicate tables)', () => {
  const io = memIo({ '/x/config.toml': '[mcp_servers.notion]\ncommand = "theirs"\n' });
  writeCodexBlock({ file: '/x/config.toml', masters: { notion: NOTION, linear: LINEAR }, io });
  const out = io.files['/x/config.toml'];
  assert.equal(out.match(/\[mcp_servers\.notion\]/g).length, 1, 'their table untouched, ours not added');
  assert.match(out, /\[mcp_servers\.linear\]/);
});

// ---- presence detection (read-only, no parsers) -----------------------------

test('presentInToml sees table headers only', () => {
  const toml = '[mcp_servers.notion]\ncommand = "npx"\n\n[other]\nnotion = "red-herring"\n';
  assert.equal(presentInToml(toml, 'notion'), true);
  assert.equal(presentInToml(toml, 'linear'), false);
});

test('presentInYaml sees keys under mcp_servers: only', () => {
  const yaml = 'model: x\nmcp_servers:\n  notion:\n    command: npx\nskills:\n  linear: nope\n';
  assert.equal(presentInYaml(yaml, 'notion'), true);
  assert.equal(presentInYaml(yaml, 'linear'), false);
  assert.equal(presentInYaml('skills: {}\n', 'notion'), false);
});

// ---- the delivery plan ------------------------------------------------------

test('deliveryPlan project scope: json merges for the four natives + opencode translation + codex block', () => {
  const plan = deliveryPlan({
    masters: { notion: NOTION }, scope: 'project',
    agentIds: ['claude', 'cursor', 'gemini', 'kimi', 'opencode', 'codex', 'hermes'],
    projectPath: PROJ, homeDir: HOME,
  });
  const byAgent = Object.fromEntries(plan.map((s) => [s.agent + ':' + s.kind, s]));
  assert.equal(byAgent['claude:json'].file, '/proj/.mcp.json');
  assert.equal(byAgent['claude:json'].section, 'mcpServers');
  assert.equal(byAgent['cursor:json'].file, '/proj/.cursor/mcp.json');
  assert.equal(byAgent['gemini:json'].file, '/proj/.gemini/settings.json');
  assert.equal(byAgent['kimi:json'].file, '/proj/.kimi-code/mcp.json');
  assert.equal(byAgent['opencode:json'].file, '/proj/opencode.json');
  assert.equal(byAgent['opencode:json'].section, 'mcp');
  assert.equal(byAgent['opencode:json'].entries.notion.type, 'local');
  assert.equal(byAgent['codex:block'].file, '/proj/.codex/config.toml');
  assert.equal(byAgent['hermes:manual'].kind, 'manual');
});

test('deliveryPlan user scope: claude goes via its own CLI, codex block lands in ~/.codex', () => {
  const plan = deliveryPlan({
    masters: { notion: NOTION, linear: LINEAR }, scope: 'user',
    agentIds: ['claude', 'codex', 'cursor'],
    projectPath: null, homeDir: HOME,
  });
  const cli = plan.filter((s) => s.agent === 'claude' && s.kind === 'cli');
  assert.equal(cli.length, 2, 'one CLI add per entry');
  assert.match(cli[0].cmd, /^claude mcp add-json --scope user /);
  const codex = plan.find((s) => s.agent === 'codex');
  assert.equal(codex.file, '/home/u/.codex/config.toml');
  const cursor = plan.find((s) => s.agent === 'cursor');
  assert.equal(cursor.file, '/home/u/.cursor/mcp.json');
});

test('deliveryPlan only plans for installed agents', () => {
  const plan = deliveryPlan({ masters: { notion: NOTION }, scope: 'project', agentIds: ['claude'], projectPath: PROJ, homeDir: HOME });
  assert.deepEqual([...new Set(plan.map((s) => s.agent))], ['claude']);
});

// ---- coverage ---------------------------------------------------------------

test('readNotebooks + coverage: who has it, who is missing it', () => {
  const io = memIo({
    '/proj/.mcp.json': JSON.stringify({ mcpServers: { notion: NOTION } }),
    '/home/u/.cursor/mcp.json': JSON.stringify({ mcpServers: { notion: NOTION, n8n: { command: 'x' } } }),
    '/home/u/.codex/config.toml': '[mcp_servers.notion]\ncommand = "npx"\n',
    '/home/u/.hermes/config.yaml': 'mcp_servers:\n  other:\n    command: y\n',
  });
  const notebooks = readNotebooks({ projectPath: PROJ, homeDir: HOME, agentIds: ['claude', 'cursor', 'codex', 'hermes', 'gemini'], io });
  const cov = coverage({ masters: { notion: NOTION }, notebooks });
  assert.deepEqual(cov.notion.have.sort(), ['claude', 'codex', 'cursor']);
  assert.deepEqual(cov.notion.missing.sort(), ['gemini', 'hermes']);
  assert.ok(notebooks.cursor.has('n8n'), 'hand-made entries are visible for adoption');
});

// ---- the executor -----------------------------------------------------------

test('runPlan merges json, writes the block, records cli and manual honestly', async () => {
  const { runPlan } = require('../src/main/connections-deliver.js');
  const io = memIo({ '/proj/opencode.json': JSON.stringify({ mcp: { theirs: { type: 'local' } } }) });
  const ran = [];
  const plan = deliveryPlan({
    masters: { notion: NOTION }, scope: 'project',
    agentIds: ['claude', 'opencode', 'codex', 'hermes'],
    projectPath: PROJ, homeDir: HOME,
  });
  const results = await runPlan({ plan, io, execCmd: async (cmd) => { ran.push(cmd); return { ok: true }; } });
  assert.deepEqual(JSON.parse(io.files['/proj/.mcp.json']).mcpServers.notion, NOTION);
  const oc = JSON.parse(io.files['/proj/opencode.json']);
  assert.ok(oc.mcp.theirs, 'hand-made opencode entry preserved');
  assert.equal(oc.mcp.notion.type, 'local');
  assert.match(io.files['/proj/.codex/config.toml'], /mcp_servers\.notion/);
  assert.equal(ran.length, 0, 'no cli in project scope');
  const hermes = results.find((r) => r.agent === 'hermes');
  assert.equal(hermes.ok, false);
  assert.ok(hermes.manual);
});

test('runPlan: a failing cli step is recorded, not thrown', async () => {
  const { runPlan } = require('../src/main/connections-deliver.js');
  const plan = deliveryPlan({ masters: { notion: NOTION }, scope: 'user', agentIds: ['claude'], projectPath: null, homeDir: HOME });
  const results = await runPlan({ plan, io: memIo(), execCmd: async () => ({ ok: false, error: 'claude not found' }) });
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /not found/);
});

test('antigravity aliases the gemini notebook, and unknown tools never read as missing', () => {
  const plan = deliveryPlan({ masters: { notion: NOTION }, scope: 'project', agentIds: ['antigravity'], projectPath: PROJ, homeDir: HOME });
  assert.equal(plan[0].file, '/proj/.gemini/settings.json');
  const io = memIo({ '/proj/.mcp.json': JSON.stringify({ mcpServers: { notion: NOTION } }) });
  const notebooks = readNotebooks({ projectPath: PROJ, homeDir: HOME, agentIds: ['claude', 'someday-tool'], io });
  assert.ok(!('someday-tool' in notebooks), 'no reader, no verdict');
  const cov = coverage({ masters: { notion: NOTION }, notebooks });
  assert.deepEqual(cov.notion.missing, []);
});
