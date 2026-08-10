import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { stripInheritedClaude } = require('../src/main/session-env.js');

// The bug: launch Nami from a terminal that is itself inside a claude session
// — `open -a Nami` from such a shell, an `npm start` in a claude tile — and
// every var that session exported lands in Nami's environment, and from there
// in every tile Nami spawns. claude reads CLAUDE_CODE_CHILD_SESSION, decides it
// is a nested instance, and turns transcript saving off. The only sign is one
// grey warning line inside the tile; --resume and the session rail read that
// transcript, so the loss is silent and total.

test('the child-session marker never reaches a tile', () => {
  const env = stripInheritedClaude({ CLAUDE_CODE_CHILD_SESSION: '1', PATH: '/usr/bin' });
  assert.equal('CLAUDE_CODE_CHILD_SESSION' in env, false);
  assert.equal(env.PATH, '/usr/bin');
});

test('every handle on the launching conversation is dropped', () => {
  const env = stripInheritedClaude({
    CLAUDE_CODE_SESSION_ID: 'c367e94b', CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_01',
    CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/4215.sock', CLAUDE_PID: '4215',
    CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli',
  });
  assert.deepEqual(Object.keys(env), []);
});

test('the caller keeps its own environment', () => {
  const source = { CLAUDE_CODE_CHILD_SESSION: '1', HOME: '/Users/x' };
  stripInheritedClaude(source);
  assert.equal(source.CLAUDE_CODE_CHILD_SESSION, '1');
});

test('a normal launch is left exactly as it was', () => {
  const env = { PATH: '/usr/bin', TERM: 'xterm-256color', ANTHROPIC_API_KEY: 'sk-x' };
  assert.deepEqual(stripInheritedClaude(env), env);
});

test('the user\'s own claude settings survive — only session handles go', () => {
  // CLAUDE_CONFIG_DIR and friends are the machine's setup, not a live
  // conversation; stripping them would change which claude the tile runs as.
  const env = stripInheritedClaude({ CLAUDE_CONFIG_DIR: '/Users/x/.claude', CLAUDE_CODE_CHILD_SESSION: '1' });
  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: '/Users/x/.claude' });
});
