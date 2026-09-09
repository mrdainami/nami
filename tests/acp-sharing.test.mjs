import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcpClient } from '../src/renderer/acp-client.mjs';
function fixture(capabilities = {}) {
  let receive, exit; const calls = [];
  const transport = { send(message) { calls.push(message); queueMicrotask(() => receive({ id: message.id, result: message.method === 'initialize' ? { agentCapabilities: capabilities } : message.method === 'session/new' ? { sessionId: 'fresh-id' } : {} })); }, onMessage(cb) { receive = cb; }, onError() {}, onExit(cb) { exit = cb; }, kill() {} };
  return { client: createAcpClient(transport), calls, exit: () => exit(1), transport };
}
const server = { name: 'nami-browser', type: 'http', url: 'http://127.0.0.1:4000/mcp/session', headers: [] };

test('ACP passes only advertised MCP transports to new and loaded sessions', async () => {
  const f = fixture({ mcpCapabilities: { http: true }, loadSession: true });
  await f.client.connect('/project', { mcpServers: [server, { ...server, name: 'unsupported', type: 'sse' }] });
  assert.deepEqual(f.calls.find(c => c.method === 'session/new').params.mcpServers, [server]);
  await f.client.loadSession('existing-id', '/project');
  assert.deepEqual(f.calls.find(c => c.method === 'session/load').params.mcpServers, [server]);
  assert.equal(f.client.sessionId, 'existing-id');
  assert.equal(f.client.capabilities.mcpHttp, true); assert.equal(f.client.capabilities.configuredMcp.length, 1);
  assert.equal(JSON.stringify(f.client.capabilities).includes('/mcp/session'), false, 'capability status excludes bearer URL');
});

test('unsupported agents receive no HTTP MCP descriptor or image prompt', async () => {
  const f = fixture(); await f.client.connect('/project', { mcpServers: [server] });
  assert.deepEqual(f.calls.find(c => c.method === 'session/new').params.mcpServers, []);
  await assert.rejects(f.client.prompt('look', { images: [{ type: 'image', data: 'aW1n', mimeType: 'image/png' }] }), /does not support image/);
  await assert.rejects(f.client.loadSession('old', '/project'), /does not support loading/);
  assert.equal(f.calls.some(c => c.method === 'session/prompt' || c.method === 'session/load'), false);
});

test('image-capable ACP agents receive real image content, not a path pretending to be an image', async () => {
  const f = fixture({ promptCapabilities: { image: true } }); await f.client.connect('/project');
  await f.client.prompt('look', { images: [{ type: 'image', data: 'aW1n', mimeType: 'image/png', path: '/private/image.png' }] });
  assert.deepEqual(f.calls.at(-1).params.prompt, [{ type: 'text', text: 'look' }, { type: 'image', data: 'aW1n', mimeType: 'image/png' }]);
  await assert.rejects(f.client.prompt('look', { images: [{ type: 'image', data: '/private/image.png', mimeType: 'image/png' }] }), /Invalid image/);
});

test('transport exit rejects pending prompts so a draft can be recovered', async () => {
  const f = fixture(); await f.client.connect('/project');
  f.transport.send = () => {};
  const prompt = f.client.prompt('Pending'); f.exit(); await assert.rejects(prompt, /stopped before responding/);
});
