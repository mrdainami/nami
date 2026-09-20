import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import { spawn as spawnChild, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as agentLaunch from '../src/renderer/agent-launch.mjs';
import { shellQuote } from '../src/renderer/file-kinds.mjs';
const require = createRequire(import.meta.url);
const policy = require('../src/main/session-env');
const main = fs.readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
const parentEnv = { PATH: '/bin', HOME: '/home/test', SHELL: '/bin/zsh', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic', UNLISTED_TOKEN: 'other' };
const settings = { envKeys: { OPENAI_API_KEY: 'saved', UNLISTED_TOKEN: 'saved-other' }, theme: 'paper' };

// `overrides` replace entries of the handler's module scope: a pty that records
// writes, a shell that really runs, a settings PATH the child can use.
async function spawnBoundary(request, config = settings, overrides = {}) {
  let handler, captured;
  const messages = [];
  const context = {
    ...require('../src/main/seed-launch'), startSeedGate: require('../src/main/seed-gate').startSeedGate,
    ...policy, agentRunCommandAllowed: require('../src/main/agents-detect').agentRunCommandAllowed, process: { env: parentEnv, platform: 'darwin' }, readSettings: () => config,
    storedEnvKeys: () => config.envKeys, settingsStore: require('../src/main/settings'),
    ipcMain: { handle: (_channel, fn) => { handler = fn; } }, browserViews: { registerSession() {} },
    pty: { spawn: (file, args, opts) => { captured = { file, args, ...opts }; throw Error('saved-other'); } },
    sendWc: (_wc, _channel, message) => messages.push(message), userPath: async () => '/resolved/bin',
    resolveClaudeExecutable: () => '/bin/claude', path, os: { homedir: () => '/home/test' }, fs: { existsSync: () => true },
    claudeSpawnArgs: require('../src/main/claude-args').claudeSpawnArgs, projectSlug: () => 'test',
    shellQuote, resolveRunCommand: (s) => s, withSpawnFlags: (s) => s,
    paneShell: require('../src/main/platform').paneShell, scriptArgs: require('../src/main/platform').scriptArgs,
    agentForCommand: () => null, sessionExists: () => true, resumeCommand: () => null,
    oneShotArgs: () => ['-c', 'dummy-install'],
    // Module state the exit path touches; the throwing pty above never gets there.
    termSessions: new Map(), sessionOwners: new Map(), titleWatch: new Map(), deliberateKills: new Set(),
    exitNote: require('../src/main/exit-note').exitNote, feedRunDone: () => null, feedOscTitle: () => null,
    watchTitle() {}, startDiscovery: () => null, refreshUserPath() {},
    // Anything the handler defers (typing afterStart) runs at once, so a test
    // can assert what was — or was not — written without waiting.
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
    ...overrides,
  };
  vm.runInNewContext(main.slice(main.indexOf('function sessionEnv('), main.indexOf('// ---- claude\'s own name for a session')), context);
  await handler({ sender: { id: 1 } }, { id: 'test', cwd: '/project', ...request });
  return { captured, messages };
}

test('actual PTY spawn filters keys for new and resumed sessions and redacts spawn errors', async () => {
  for (const cont of [false, true]) {
    for (const request of [
      { kind: 'run', command: 'codex', purpose: 'agent', agentId: 'codex', cont },
      { kind: 'shell', purpose: 'agent', agentId: 'codex', cont },
      { kind: 'run', command: 'install', purpose: 'agent', agentId: 'codex', watchDone: true, cont },
      { kind: 'run', command: 'codex', cont },
    ]) {
      const { captured, messages } = await spawnBoundary(request);
      assert.ok(captured);
      assert.equal(captured.env.PATH, '/resolved/bin');
      assert.equal(captured.env.TERM, 'xterm-256color');
      assert.equal(captured.env.UNLISTED_TOKEN, undefined);
      assert.equal(captured.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(captured.env.OPENAI_API_KEY, request.kind === 'run' && request.purpose === 'agent' && !request.watchDone ? 'saved' : undefined);
      assert.equal(JSON.stringify(messages).includes('saved-other'), false);
    }
  }
});

test('launcher metadata survives snapshot and restore without storing secret values', async () => {
  assert.equal(typeof agentLaunch.terminalAgentOptions, 'function');
  const options = agentLaunch.terminalAgentOptions({ id: 'codex', kind: 'run', bin: 'codex' });
  assert.equal(options.agentId, 'codex');
  assert.equal(options.purpose, 'agent');
  const S = { panels: [{ ...options, id: 'before', acpSid: 'conversation' }] };
  const context = { S, isSessionPanel: () => true, DOC_STEPS: [], ownerIndexes: () => ({}),
    startPanel: (p) => S.panels.unshift({ ...p, id: 'restored' }),
    resolveOwners: () => {}, browsers: { restore() {} }, renderAll() {}, tileEls: new Map(), savePanels: () => {}, renderDesk: () => {}, renderRail: () => {} };
  vm.runInNewContext(renderer.slice(renderer.indexOf('function panelSnapshot()'), renderer.indexOf('function savePanels()')), context);
  const snapshots = JSON.parse(JSON.stringify(context.panelSnapshot()));
  S.panels = [];
  vm.runInNewContext(renderer.slice(renderer.indexOf('async function restorePanels('), renderer.indexOf('function seedTitleSource(')), context);
  await context.restorePanels(snapshots);
  assert.equal(S.panels[0].agentId, 'codex');
  assert.equal(S.panels[0].purpose, 'agent');
  assert.equal(S.panels[0].cont, true);
  const { captured } = await spawnBoundary(S.panels[0]);
  assert.equal(captured.env.OPENAI_API_KEY, 'saved');
  assert.equal(JSON.stringify(snapshots).includes('saved'), false);
});

test('renderer startProcess sends launch metadata to the real PTY boundary', async () => {
  let result;
  const context = { shouldPushName: () => false, api: { termCreate: async (request) => { result = await spawnBoundary(request); } } };
  vm.runInNewContext(renderer.slice(renderer.indexOf('async function startProcess('), renderer.indexOf('function setAttention(')), context);
  await context.startProcess({ kind: 'run', command: 'codex', agentId: 'codex', purpose: 'agent' }, 80, 24);
  assert.equal(result.captured.env.OPENAI_API_KEY, 'saved');
});

test('PTY launch preserves inherited allowed credentials without changing the parent', async () => {
  const before = JSON.stringify(parentEnv);
  const { captured } = await spawnBoundary({ kind: 'claude' });
  assert.equal(captured.env.ANTHROPIC_API_KEY, 'anthropic');
  assert.equal(captured.env.HOME, '/home/test');
  assert.equal(JSON.stringify(parentEnv), before);
});

test('custom profile grant is checked against the executable at the PTY boundary', async () => {
  const config = { ...settings, customAgentProfiles: { example: { program: '/opt/example', credentialKeys: ['UNLISTED_TOKEN'] } } };
  for (const program of ['/opt/example', '/opt/different']) {
    const { captured } = await spawnBoundary({ kind: 'harness', purpose: 'agent', agentId: 'example', program }, config);
    assert.equal(captured.file, program);
    assert.equal(captured.env.UNLISTED_TOKEN, program === '/opt/example' ? 'saved-other' : undefined);
    assert.equal(captured.env.OPENAI_API_KEY, undefined);
  }
});

test('an arbitrary harness cannot claim a built-in agent credential grant', async () => {
  const { captured } = await spawnBoundary({ kind: 'harness', purpose: 'agent', agentId: 'codex', program: '/opt/unrelated' });
  assert.equal(captured.env.OPENAI_API_KEY, undefined);
});

test('library-agent filenames remain one quoted shell argument', async () => {
  let launched;
  const context = {
    toolById: () => ({ id: 'opencode', kind: 'run', bin: 'opencode', found: true }),
    rememberTool() {}, ensureDelivered: async () => null, agentLaunch: agentLaunch.agentLaunch,
    terminalAgentOptions: agentLaunch.terminalAgentOptions,
    shellQuote,
    code2: () => 'OP', startPanel: (p) => { launched = p; return p; },
  };
  vm.runInNewContext(renderer.slice(renderer.indexOf('async function reallyLaunchAgent('), renderer.indexOf('async function openAgentPicker(')), context);
  await context.reallyLaunchAgent({ slug: 'helper; printf injected', name: 'test' }, 'opencode');
  assert.equal(launched.command, "opencode '--agent' 'helper; printf injected'");
});

test('run-session metadata cannot grant keys to a different or compound command', async () => {
  for (const command of ['claude', 'codex; echo extra', 'env', '', undefined]) {
    const { captured } = await spawnBoundary({ kind: 'run', purpose: 'agent', agentId: 'codex', command });
    assert.equal(captured.env.OPENAI_API_KEY, undefined);
  }
});

// A pty stand-in that records what Nami writes into it and never exits.
function recordingPty() {
  const writes = [];
  let captured;
  return {
    writes, get captured() { return captured; },
    spawn: (file, args, opts) => { captured = { file, args: Array.from(args), ...opts }; return { pid: 1, write: (s) => writes.push(s), onData() {}, onExit() {}, kill() {} }; },
  };
}

test('a permitted agent run tile runs its command as the shell script and types nothing', async () => {
  for (const request of [
    { kind: 'run', command: 'codex', purpose: 'agent', agentId: 'codex' },
    { kind: 'run', command: 'codex', purpose: 'agent', agentId: 'codex', cont: true, acpSid: 'conv-1' },
    { kind: 'run', command: 'opencode auth logout && opencode auth login', purpose: 'agent', agentId: 'opencode' },
  ]) {
    const fake = recordingPty();
    const { messages } = await spawnBoundary(request, settings, {
      pty: fake, agentForCommand: (c) => (c === 'codex' ? 'codex' : null),
      resumeCommand: (agent, sid) => `${agent} resume ${sid}`,
    });
    const line = request.acpSid ? 'codex resume conv-1' : request.command;
    assert.equal(fake.captured.file, '/bin/zsh');
    assert.deepEqual(fake.captured.args, ['-i', '-c', line]);
    assert.deepEqual(fake.writes, []);
    assert.equal(fake.captured.env.OPENAI_API_KEY, request.agentId === 'codex' ? 'saved' : undefined);
    assert.ok(messages.some((m) => typeof m.data === 'string' && m.data.includes('$ ' + request.command)));
  }
});

test('a run tile without agent permission is still typed into a keyless shell', async () => {
  for (const request of [
    { kind: 'run', command: 'codex' },
    { kind: 'run', command: 'codex; echo extra', purpose: 'agent', agentId: 'codex' },
    { kind: 'run', command: 'claude', purpose: 'agent', agentId: 'codex' },
  ]) {
    const fake = recordingPty();
    await spawnBoundary(request, settings, { pty: fake });
    assert.deepEqual(fake.captured.args, []);
    assert.deepEqual(fake.writes, [request.command + '\r']);
    assert.equal(fake.captured.env.OPENAI_API_KEY, undefined);
  }
  const oneShot = recordingPty();
  await spawnBoundary({ kind: 'run', command: 'install', purpose: 'agent', agentId: 'codex', watchDone: true }, settings, { pty: oneShot });
  assert.deepEqual(oneShot.captured.args, ['-c', 'dummy-install']);
  assert.deepEqual(oneShot.writes, []);
});

test('the claude-in-shell fallback runs as the shell script too', async () => {
  const fake = recordingPty();
  await spawnBoundary({ kind: 'claude', sid: 'abc', name: 'a named session' }, settings, { pty: fake, resolveClaudeExecutable: () => null, shellQuote: require('../src/main/claude-args').shellQuote });
  assert.equal(fake.captured.file, '/bin/zsh');
  assert.equal(fake.captured.args.length, 3);
  assert.deepEqual(fake.captured.args.slice(0, 2), ['-i', '-c']);
  assert.match(fake.captured.args[2], /^claude .*'a named session'/);
  assert.deepEqual(fake.writes, []);
  assert.equal(fake.captured.env.ANTHROPIC_API_KEY, 'anthropic');
});

// The tile really ends with the agent: a real shell (isolated from the user's
// rc files) runs a dummy agent that reports the key it saw and exits 7. No
// input is ever sent, so a shell that stayed at a prompt would hang — and the
// timeout, not the test runner, is what fails it.
test('an agent tile exits with the agent, and the shell still reads its rc file', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-agent-tile-'));
  const agentScript = path.join(home, 'dummy-codex');
  fs.writeFileSync(path.join(home, '.zshrc'), 'export NAMI_RC=read\n');
  fs.writeFileSync(agentScript, '#!/bin/sh\necho "KEY=${OPENAI_API_KEY:-absent} OTHER=${UNLISTED_TOKEN:-absent} RC=${NAMI_RC:-absent}"\nexit 7\n', { mode: 0o755 });
  const output = [], sent = [];
  let exited;
  const pty = {
    spawn: (file, args, { env, cwd }) => {
      const child = spawnChild(file, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      exited = new Promise((resolve) => child.on('close', resolve)); // after exit AND stdio drained
      return {
        pid: child.pid, write: () => assert.fail('nothing should be typed into an agent tile'), kill() {},
        onData: (fn) => { for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => fn(String(d))); },
        onExit: (fn) => child.on('exit', (exitCode, signal) => fn({ exitCode, signal })),
      };
    },
  };
  const env = { PATH: '/usr/bin:/bin', HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh', OPENAI_API_KEY: 'inherited', UNLISTED_TOKEN: 'other' };
  await spawnBoundary({ kind: 'run', command: 'codex', purpose: 'agent', agentId: 'codex', cwd: home }, settings, {
    pty, process: { env, platform: process.platform }, userPath: async () => env.PATH,
    resolveRunCommand: (c) => (c === 'codex' ? agentScript : c), fs, sendWc: (_wc, _channel, m) => { sent.push(m); if (typeof m.data === 'string') output.push(m.data); },
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('the tile did not exit with the agent')), 10000).unref());
  await Promise.race([exited, timeout]);
  await new Promise((r) => setImmediate(r));
  const text = output.join('');
  assert.match(text, /KEY=saved/);
  assert.match(text, /OTHER=absent/);
  assert.match(text, /RC=read/);
  const exit = sent.find((m) => 'note' in m);
  assert.ok(exit, 'term:exit was sent');
  assert.equal(exit.code, 7);
  assert.equal(exit.note, 'exited · 7');
  assert.equal(exit.deliberate, false);
  fs.rmSync(home, { recursive: true, force: true });
});

const longSeed = "A description with 'quotes', $(echo unsafe), `echo unsafe`\n" + 'Another paragraph.\n'.repeat(400);
test('generated prompts use native interactive arguments and never terminal retries', async () => {
  for (const [agentId, command, flag] of [['codex', 'codex', '--'], ['grok', 'grok', '--'], ['opencode', 'opencode', '--prompt='], ['antigravity', 'agy', '--prompt-interactive=']]) {
    const pty = recordingPty();
    await spawnBoundary({ kind: 'run', command, agentId, purpose: 'agent', seed: longSeed }, settings, { pty });
    const tail = flag === '--' ? "'--' " + shellQuote(longSeed) : shellQuote(flag + longSeed);
    assert.equal(pty.captured.args[2], command + ' ' + tail);
    assert.deepEqual(pty.writes, []);
    assert.equal(pty.captured.env.OPENAI_API_KEY, agentId === 'codex' ? 'saved' : undefined);
  }
  const pty = recordingPty();
  await spawnBoundary({ kind: 'claude', seed: longSeed, sid: 'conv-1' }, settings, { pty });
  assert.deepEqual(pty.captured.args.slice(-2), ['--', longSeed]);
  assert.deepEqual(pty.writes, []);
});
test('Claude shell fallback quotes the initial message without displaying it as a shell command', async () => {
  const pty = recordingPty();
  const result = await spawnBoundary({ kind: 'claude', seed: longSeed }, settings, { pty, resolveClaudeExecutable: () => null });
  assert.ok(pty.captured.args[2].endsWith("'--' " + shellQuote(longSeed)));
  assert.equal(JSON.stringify(result.messages).includes('Another paragraph'), false);
  assert.deepEqual(pty.writes, []);
});
test('resumed native agents receive a deliberate message once; ordinary restore adds none', async () => {
  for (const seed of [undefined, longSeed]) {
    const pty = recordingPty();
    await spawnBoundary({ kind: 'run', command: 'codex', purpose: 'agent', agentId: 'codex', cont: true, acpSid: 'conv-1', seed }, settings,
      { pty, agentForCommand: () => 'codex', resumeCommand: () => 'codex resume conv-1' });
    assert.equal(pty.captured.args[2], 'codex resume conv-1' + (seed ? " '--' " + shellQuote(seed) : ''));
    assert.deepEqual(pty.writes, []);
  }
});

test('the actual shell preserves every prompt character without interpreting it', async () => {
  const pty = recordingPty();
  const executable = shellQuote(process.execPath) + ' -e ' + shellQuote('process.stdout.write(JSON.stringify(process.argv.slice(1)))');
  await spawnBoundary({ kind: 'run', command: 'codex', purpose: 'agent', agentId: 'codex', seed: longSeed }, settings,
    { pty, resolveRunCommand: () => executable });
  const output = execFileSync('/bin/sh', ['-c', pty.captured.args[2]], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), [longSeed]);
});

test('Hermes startup messages are scoped to its launch and omitted on normal restore', async () => {
  for (const seed of [longSeed, undefined]) {
    const { captured } = await spawnBoundary({ kind: 'run', command: 'hermes', purpose: 'agent', agentId: 'hermes', seed });
    assert.equal(captured.env.HERMES_TUI_QUERY, seed);
    assert.equal(captured.env.OPENAI_API_KEY, undefined);
    assert.equal(captured.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(captured.args[2], 'hermes');
  }
  const { captured } = await spawnBoundary({ kind: 'run', command: 'hermes setup', purpose: 'agent', agentId: 'hermes', seed: longSeed });
  assert.equal(captured.env.HERMES_TUI_QUERY, undefined);
});
