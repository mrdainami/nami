import test from 'node:test';
import assert from 'node:assert/strict';
import seedLaunch from '../src/main/seed-launch.js';
const { initialPromptArgs, seedAgentForLaunch } = seedLaunch;
const seed = "--not-a-flag\nO'Brien $(touch /tmp/unwanted) `echo no`\n" + 'Long description. '.repeat(400);

test('interactive initial messages preserve long multiline text as one argument', () => {
  // The platform is said out loud, and the program is a real one: on Windows a
  // .cmd shim gets no message this way at all (tests/cmd-shim.test.mjs).
  for (const at of [{ platform: 'darwin' }, { platform: 'linux' }, { platform: 'win32', program: 'C:\\tools\\agent.exe' }]) {
    for (const id of ['claude', 'codex', 'grok']) assert.deepEqual(initialPromptArgs(id, seed, at), ['--', seed]);
    assert.deepEqual(initialPromptArgs('opencode', seed, at), ['--prompt=' + seed]);
    assert.deepEqual(initialPromptArgs('antigravity', seed, at), ['--prompt-interactive=' + seed]);
  }
  if (process.platform !== 'win32') assert.deepEqual(initialPromptArgs('claude', seed), ['--', seed], 'and with nothing said, a Mac is a Mac');
});
test('agents without interactive initial-message flags never get a headless flag', () => {
  for (const id of ['kimi', 'hermes', 'unknown']) assert.deepEqual(initialPromptArgs(id, seed), []);
});
test('only actual agent launches receive generated messages, never setup or compound commands', () => {
  assert.equal(seedAgentForLaunch({ kind: 'claude' }), 'claude');
  assert.equal(seedAgentForLaunch({ kind: 'run', command: 'codex' }), 'codex');
  assert.equal(seedAgentForLaunch({ kind: 'run', command: "opencode '--agent' 'reviewer'", args: ['--agent', 'reviewer'], agentId: 'opencode' }), 'opencode');
  for (const command of ['codex login', 'codex; echo no', 'echo codex', 'hermes setup']) {
    assert.equal(seedAgentForLaunch({ kind: 'run', command, agentId: 'codex' }), null);
  }
  assert.equal(seedAgentForLaunch({ kind: 'run', command: 'codex', watchDone: true }), null);
  assert.equal(seedAgentForLaunch({ kind: 'shell', command: 'codex' }), null);
});

test('Hermes can receive one native startup message without changing its selected interface', () => {
  const env = { HOME: '/home/test', KEEP: 'unchanged' };
  const result = seedLaunch.initialPromptEnv(env, 'hermes', seed);
  assert.equal(result.HERMES_TUI_QUERY, seed);
  assert.equal(result.KEEP, 'unchanged');
  assert.equal(result.HOME, '/home/test');
  assert.equal(env.HERMES_TUI_QUERY, undefined);
});
test('a startup message cannot be inherited by an unrelated or restored session', () => {
  const env = { HERMES_TUI_QUERY: 'old message', HOME: '/home/test' };
  for (const id of ['claude', 'codex', 'opencode', 'kimi', 'grok', 'antigravity', null, 'hermes']) {
    const result = seedLaunch.initialPromptEnv(env, id, id === 'hermes' ? undefined : seed);
    assert.equal(result.HERMES_TUI_QUERY, undefined);
    assert.equal(result.HOME, env.HOME);
  }
  assert.equal(env.HERMES_TUI_QUERY, 'old message');
});
