import test from 'node:test';
import assert from 'node:assert/strict';
import launch from '../src/main/browser-launch.js';
test('scoped browser configuration preserves other servers and unsupported clients', () => {
  const c={url:'http://127.0.0.1:1234/session-token'};
  const a=launch.browserLaunchArgs('claude',c);
  assert.equal(JSON.parse(a[1]).mcpServers['nami-browser'].url,c.url);
  assert.ok(!a.includes('--strict-mcp-config'));
  assert.deepEqual(launch.browserLaunchArgs('codex',c),['-c','mcp_servers."nami-browser".url="http://127.0.0.1:1234/session-token"']);
  assert.deepEqual(launch.browserLaunchArgs('other',c),[]);
  assert.deepEqual(launch.browserLaunchArgs('claude',null),[]);
});
