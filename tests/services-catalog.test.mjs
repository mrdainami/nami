import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { KNOWN_SERVICES, serviceById } = require('../src/main/services-catalog.js');

test('registry carries the launch set with everything the connect flow needs', () => {
  const ids = KNOWN_SERVICES.map((s) => s.id);
  for (const id of ['notion', 'slack', 'telegram', 'kie', 'folder', 'gmail', 'gdrive']) {
    assert.ok(ids.includes(id), `registry missing ${id}`);
  }
  for (const s of KNOWN_SERVICES) {
    for (const k of ['id', 'name', 'desc', 'code', 'kind', 'keys', 'docs']) assert.ok(s[k] !== undefined, `${s.id} missing ${k}`);
    assert.ok(['key', 'folder', 'guided', 'install'].includes(s.kind));
    assert.ok(/^https:\/\//.test(s.docs), `${s.id} docs must be https`);
    if (s.kind === 'key') { assert.ok(s.keys.length >= 1); assert.ok(/^https:\/\//.test(s.keyHelpUrl), `${s.id} needs a real key page`); }
    if (s.kind === 'folder') assert.equal(s.keys.length, 0);
  }
});

test('notion config entries carry the token into both platforms', () => {
  const s = serviceById('notion');
  const c = s.claudeEntry({ token: 'ntn_abc' });
  assert.deepEqual(c, { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_abc' } });
  const o = s.opencodeEntry({ token: 'ntn_abc' });
  assert.deepEqual(o, { type: 'local', command: ['npx', '-y', '@notionhq/notion-mcp-server'], environment: { NOTION_TOKEN: 'ntn_abc' }, enabled: true });
});

test('slack entry uses the real slack-mcp-server package in single-token mode', () => {
  const s = serviceById('slack');
  const c = s.claudeEntry({ token: 'xoxb-1' });
  assert.deepEqual(c, { command: 'npx', args: ['-y', 'slack-mcp-server@latest', '--transport', 'stdio'], env: { SLACK_MCP_XOXB_TOKEN: 'xoxb-1' } });
});

test('folder service points the reference filesystem server at the chosen folder', () => {
  const s = serviceById('folder');
  const c = s.claudeEntry({ folder: '/Users/x/Sites' });
  assert.deepEqual(c.args.slice(0, 2), ['-y', '@modelcontextprotocol/server-filesystem']);
  assert.ok(c.args.includes('/Users/x/Sites'));
});

test('kie (install kind) points config at the built server with the key in env', () => {
  const s = serviceById('kie');
  assert.equal(s.kind, 'install');
  const c = s.claudeEntry({ token: 'kie_1', installDir: '/Users/x/.nami/connectors/kie-mcp' });
  assert.equal(c.command, 'node');
  assert.ok(c.args[0].endsWith('dist/index.js'));
  assert.equal(c.env.KIE_API_KEY, 'kie_1');
});
