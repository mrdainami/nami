import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseManifest, userConfigFields, buildEntry, parseCommandLine, bundleSlug } = require('../src/main/mcpb.js');

const MANIFEST = {
  manifest_version: '0.2',
  name: 'weather-mcp',
  display_name: 'Weather',
  version: '1.2.0',
  description: 'Forecasts for your agents.',
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js', '--units', 'metric'],
      env: { WEATHER_KEY: '${user_config.api_key}' },
    },
  },
  user_config: {
    api_key: { type: 'string', title: 'API key', sensitive: true, required: true },
    units: { type: 'string', title: 'Units', default: 'metric' },
  },
};

test('parseManifest keeps what matters and rejects garbage', () => {
  const m = parseManifest(JSON.stringify(MANIFEST));
  assert.equal(m.ok, true);
  assert.equal(m.manifest.name, 'weather-mcp');
  assert.equal(parseManifest('not json').ok, false);
  assert.equal(parseManifest(JSON.stringify({ name: 'x' })).ok, false, 'no server.mcp_config → refused');
});

test('userConfigFields lists what the form must ask', () => {
  const fields = userConfigFields(MANIFEST);
  assert.deepEqual(fields.map((f) => f.id), ['api_key', 'units']);
  assert.equal(fields[0].required, true);
  assert.equal(fields[0].sensitive, true);
  assert.equal(fields[1].default, 'metric');
  assert.deepEqual(userConfigFields({ server: { mcp_config: {} } }), []);
});

test('buildEntry substitutes __dirname and user_config, with defaults', () => {
  const entry = buildEntry({ manifest: MANIFEST, dir: '/home/u/.nami/bundles/weather-mcp', values: { api_key: 'k123' } });
  assert.deepEqual(entry, {
    command: 'node',
    args: ['/home/u/.nami/bundles/weather-mcp/server/index.js', '--units', 'metric'],
    env: { WEATHER_KEY: 'k123' },
  });
});

test('buildEntry falls back to declared defaults and drops empty env', () => {
  const m = JSON.parse(JSON.stringify(MANIFEST));
  m.server.mcp_config.env = { UNITS: '${user_config.units}' };
  const entry = buildEntry({ manifest: m, dir: '/d', values: {} });
  assert.equal(entry.env.UNITS, 'metric');
  m.server.mcp_config.env = {};
  assert.ok(!('env' in buildEntry({ manifest: m, dir: '/d', values: {} })));
});

test('bundleSlug is filesystem-safe', () => {
  assert.equal(bundleSlug({ name: 'My Server!', version: '2.0' }), 'my-server-2.0');
});

test('parseCommandLine splits like a shell, honouring quotes', () => {
  assert.deepEqual(parseCommandLine('npx -y some-mcp-server'), { command: 'npx', args: ['-y', 'some-mcp-server'] });
  assert.deepEqual(parseCommandLine('node "/a dir/x.js" --flag \'two words\''), { command: 'node', args: ['/a dir/x.js', '--flag', 'two words'] });
  assert.equal(parseCommandLine('   '), null);
});
