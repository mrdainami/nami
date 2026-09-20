import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { upsertMcpJson, upsertOpencode, removeService, detectServices } = require('../src/main/mcp-config.js');

function memIo(seed = {}) {
  const files = { ...seed };
  return {
    read: (f) => { if (!(f in files)) throw new Error('ENOENT ' + f); return files[f]; },
    write: (f, t) => { files[f] = t; },
    exists: (f) => f in files,
    files,
  };
}

test('upsertMcpJson creates the file and preserves neighbors on second write', () => {
  const io = memIo();
  upsertMcpJson({ file: '/p/.mcp.json', id: 'notion', entry: { command: 'npx', args: ['x'] }, io });
  upsertMcpJson({ file: '/p/.mcp.json', id: 'slack', entry: { command: 'npx', args: ['y'] }, io });
  const out = JSON.parse(io.files['/p/.mcp.json']);
  assert.deepEqual(Object.keys(out.mcpServers).sort(), ['notion', 'slack']);
});

test('upsertMcpJson never clobbers unrelated keys or malformed-but-parseable extras', () => {
  const io = memIo({ '/p/.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'x' } }, somethingElse: 1 }) });
  upsertMcpJson({ file: '/p/.mcp.json', id: 'notion', entry: { command: 'npx' }, io });
  const out = JSON.parse(io.files['/p/.mcp.json']);
  assert.equal(out.somethingElse, 1);
  assert.ok(out.mcpServers.db);
});

test('opencode entries land under mcp and removal cleans both shapes', () => {
  const io = memIo();
  upsertOpencode({ file: '/p/opencode.json', id: 'notion', entry: { type: 'local', command: ['x'] }, io });
  assert.ok(JSON.parse(io.files['/p/opencode.json']).mcp.notion);
  const changed = removeService({ files: ['/p/.mcp.json', '/p/opencode.json'], id: 'notion', io });
  assert.deepEqual(changed, ['/p/opencode.json']);
  assert.equal(JSON.parse(io.files['/p/opencode.json']).mcp.notion, undefined);
});

test('detectServices merges catalog names, flags strangers as custom, reports scope and platform', () => {
  // detectServices path.join()s its way to each file, so the seeds are keyed the
  // same way — on Windows that is \proj\.mcp.json, and a '/' key is never asked for
  const io = memIo({
    [path.join('/proj', '.mcp.json')]: JSON.stringify({ mcpServers: { notion: { command: 'npx' }, wiki: { command: 'node' } } }),
    [path.join('/home/u', '.config', 'opencode', 'opencode.json')]: JSON.stringify({ mcp: { notion: { type: 'local' } } }),
  });
  const out = detectServices({ projectPath: '/proj', home: '/home/u', io });
  const notion = out.find((s) => s.id === 'notion');
  assert.equal(notion.name, 'Notion');
  assert.equal(notion.custom, false);
  assert.ok(notion.scopes.includes('project') && notion.scopes.includes('user'));
  assert.ok(notion.platforms.includes('claude') && notion.platforms.includes('opencode'));
  const wiki = out.find((s) => s.id === 'wiki');
  assert.equal(wiki.custom, true);
});

// ---- one connector, two spellings (a Mac's `npx`, a PC's `cmd /c npx`) ------

test('a PC-style entry and a Mac-style entry under one id are one connector, not two', () => {
  const io = memIo({
    [path.join('/proj', '.mcp.json')]: JSON.stringify({ mcpServers: { notion: { command: 'cmd', args: ['/c', 'npx', '-y', '@notionhq/notion-mcp-server'] } } }),
    [path.join('/home/u', '.gemini', 'settings.json')]: JSON.stringify({ mcpServers: { notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'] } } }),
  });
  const out = detectServices({ projectPath: '/proj', home: '/home/u', io });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Notion');
  assert.equal(out[0].custom, false);
  assert.deepEqual(out[0].platforms, ['claude', 'gemini']);
});

test('a Mac teammate\'s plain entry is never traded for the cmd /c spelling of the same server', () => {
  const mac = { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_1' } };
  const seeded = JSON.stringify({ mcpServers: { notion: mac } }, null, 2) + '\n';
  const io = memIo({ '/p/.mcp.json': seeded });
  upsertMcpJson({ file: '/p/.mcp.json', id: 'notion', entry: { command: 'cmd', args: ['/c', 'npx', '-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_1' } }, io });
  assert.equal(io.files['/p/.mcp.json'], seeded);
  // OpenCode's dialect, the same rule
  const oc = { type: 'local', command: ['npx', '-y', 'p'], enabled: true };
  const io2 = memIo({ '/p/opencode.json': JSON.stringify({ mcp: { x: oc } }) });
  upsertOpencode({ file: '/p/opencode.json', id: 'x', entry: { type: 'local', command: ['cmd', '/c', 'npx', '-y', 'p'], enabled: true }, io: io2 });
  assert.deepEqual(JSON.parse(io2.files['/p/opencode.json']).mcp.x, oc);
});

test('a new key, or the plain spelling landing on a wrapper, still writes', () => {
  const io = memIo({ '/p/.mcp.json': JSON.stringify({ mcpServers: {
    notion: { command: 'npx', args: ['-y', 'n'], env: { T: 'old' } },
    slack: { command: 'cmd', args: ['/c', 'npx', '-y', 's'] },
  } }) });
  upsertMcpJson({ file: '/p/.mcp.json', id: 'notion', entry: { command: 'cmd', args: ['/c', 'npx', '-y', 'n'], env: { T: 'new' } }, io });
  upsertMcpJson({ file: '/p/.mcp.json', id: 'slack', entry: { command: 'npx', args: ['-y', 's'] }, io });
  const out = JSON.parse(io.files['/p/.mcp.json']).mcpServers;
  assert.equal(out.notion.env.T, 'new');
  assert.deepEqual(out.slack, { command: 'npx', args: ['-y', 's'] });
});
