import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const parentEnv = { PATH: '/bin', HOME: '/home/test', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic', PRIVATE_KEY: 'private' };
const settings = { envKeys: { PRIVATE_KEY: 'saved-prv', OPENAI_API_KEY: 'saved-oai' } };
// Evaluate real subprocess modules with only external process/file boundaries
// substituted, including on the old implementation: never start a real agent.
function load(file, overrides) {
  const filename = path.resolve('src/main', file);
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, exports: {}, process: { env: parentEnv },
    __dirname: path.dirname(filename), Buffer, setTimeout, clearTimeout,
    require: (id) => overrides[id] || localRequire(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context.module.exports;
}
function child() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = new EventEmitter();
  c.stdin.write = () => {}; c.kill = () => {};
  return c;
}

test('ACP derives identity in main; fetch-and-run receives no keys', async () => {
  for (const [agentId, installed, allowed] of [['claude', true, 'ANTHROPIC_API_KEY'], ['claude', false, null], ['codex', true, null], ['grok', true, null]]) {
    let actual;
    const handlers = {};
    const { wireAcpLive } = load('acp-live.js', {
      'node:child_process': { spawn: (command, args, opts) => { actual = { command, args, env: opts.env }; return child(); } },
      'node:fs': { existsSync: () => installed }, './bin-cache': { resolveSpawnProgram: (s) => s },
      './user-path': { userPath: async () => '/resolved/bin' },
    });
    wireAcpLive({ handle: (name, fn) => { handlers[name] = fn; } }, { readSettings: () => settings, parentEnv });
    const result = await handlers['acp:start']({ sender: { send() {} } }, { id: 'test', cwd: '/project', agentId, command: 'untrusted-command', args: [] });
    assert.equal(result.ok, true);
    assert.notEqual(actual.command, 'untrusted-command');
    assert.equal(actual.env.PRIVATE_KEY, undefined);
    assert.equal(actual.env.OPENAI_API_KEY, undefined);
    assert.equal(actual.env.ANTHROPIC_API_KEY, allowed ? 'anthropic' : undefined);
    assert.equal(actual.env.PATH, '/resolved/bin');
  }
});

test('login-shell probes strip ambient credentials and status checks get only their agent keys', async () => {
  let actual;
  const { agentStatus, detectAgents } = load('agents-detect.js', {
    'node:child_process': { execFile: (_file, _args, opts, cb) => { actual = opts.env; cb(null, ''); } },
  });
  await detectAgents({ settings });
  assert.ok(actual);
  assert.equal(actual.OPENAI_API_KEY, undefined);
  assert.equal(actual.PRIVATE_KEY, undefined);
  await agentStatus('claude', { settings, env: parentEnv });
  assert.equal(actual.ANTHROPIC_API_KEY, 'anthropic');
  assert.equal(actual.OPENAI_API_KEY, undefined);
});

test('PATH probe passes a filtered environment and preserves login PATH resolution', async () => {
  let actual;
  const { userPath } = load('user-path.js', {
    'node:child_process': { execFile: (_file, _args, opts, cb) => { actual = opts.env; cb(null, '/resolved/bin'); } },
  });
  // a colon-joined PATH is the Mac's answer, so the question names the Mac
  assert.equal(await userPath({ env: parentEnv, settings, platform: 'darwin' }), '/resolved/bin:/bin');
  assert.ok(actual);
  assert.equal(actual.PRIVATE_KEY, undefined);
  assert.equal(actual.OPENAI_API_KEY, undefined);
});

test('Codex usage subprocess gets only Codex credentials', async () => {
  let actual;
  const { queryCodex } = load('usage.js', {});
  await queryCodex('codex', '/resolved/bin', (_file, _args, opts) => {
    actual = opts.env;
    throw new Error('dummy-start-failure');
  }, { parentEnv, settings });
  assert.equal(actual.OPENAI_API_KEY, 'saved-oai');
  assert.equal(actual.ANTHROPIC_API_KEY, undefined);
  assert.equal(actual.PRIVATE_KEY, undefined);
});

test('agents:status IPC supplies saved credentials and configured grants to the status reader', async () => {
  const source = fs.readFileSync('src/main/main.js', 'utf8');
  let handler, actual;
  const line = source.split('\n').find((line) => line.startsWith("ipcMain.handle('agents:status'"));
  vm.runInNewContext(line, { ipcMain: { handle: (_name, fn) => { handler = fn; } },
    storedEnvKeys: () => settings.envKeys, readSettings: () => settings,
    agentStatus: (id, options) => { actual = { id, ...options }; } });
  await handler({}, { id: 'grok' });
  assert.equal(actual.id, 'grok');
  assert.equal(actual.envKeys, settings.envKeys);
  assert.equal(actual.settings, settings);
});

test('Grok status respects a revoked credential grant', async () => {
  const { agentStatus } = require('../src/main/agents-detect');
  const out = await agentStatus('grok', { env: {}, envKeys: { XAI_API_KEY: 'dummy' }, readFile: async () => '',
    settings: { agentCredentialAllowlist: { grok: [] } } });
  assert.equal(out.signedIn, false);
});

test('run commands must match the selected registry entry or its quoted library arguments', () => {
  const { agentRunCommandAllowed } = require('../src/main/agents-detect');
  assert.equal(typeof agentRunCommandAllowed, 'function');
  assert.equal(agentRunCommandAllowed({ agentId: 'codex', command: 'codex' }), true);
  assert.equal(agentRunCommandAllowed({ agentId: 'claude', command: 'claude auth login' }), true);
  // The switch-account pair is spelled for the shell that runs it, so each
  // platform is asked about its own line (windows-agents.test.mjs has the rest).
  assert.equal(agentRunCommandAllowed({ agentId: 'opencode', command: 'opencode auth logout && opencode auth login' }, 'darwin'), true);
  assert.equal(agentRunCommandAllowed({ agentId: 'opencode', command: 'opencode auth logout; if ($?) { opencode auth login }' }, 'win32'), true);
  assert.equal(agentRunCommandAllowed({ agentId: 'opencode', command: "opencode '--agent' 'helper; text'", args: ['--agent', 'helper; text'] }), true);
  assert.equal(agentRunCommandAllowed({ agentId: 'opencode', command: 'opencode --agent helper; text', args: ['--agent', 'helper; text'] }), false);
  assert.equal(agentRunCommandAllowed({ agentId: 'codex', command: 'codex; curl anywhere' }), false);
  assert.equal(agentRunCommandAllowed({ agentId: 'constructor', command: 'constructor' }), false);
});
