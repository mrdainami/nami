import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
  const io = memIo({
    '/proj/.mcp.json': JSON.stringify({ mcpServers: { notion: { command: 'npx' }, wiki: { command: 'node' } } }),
    '/home/u/.config/opencode/opencode.json': JSON.stringify({ mcp: { notion: { type: 'local' } } }),
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
