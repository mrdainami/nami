import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseAgentStatus, hermesModelFromYaml, shortModel } = require('../src/main/agent-status.js');

// Fixtures below mirror the real shapes captured on macOS 2026-08-09.
// Values are synthetic; keys and nesting are not.

const CLAUDE_IN = JSON.stringify({
  loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty',
  email: 'dev@example.com', orgId: '0000', orgName: "dev@example.com's Organization",
  subscriptionType: 'max',
});

test('claude: signed in shows email and plan', () => {
  const s = parseAgentStatus('claude', { stdout: CLAUDE_IN });
  assert.equal(s.signedIn, true);
  assert.equal(s.label, 'dev@example.com · Max');
  assert.deepEqual(s.rows.find((r) => r.k === 'Account'), { k: 'Account', v: 'dev@example.com' });
  assert.deepEqual(s.rows.find((r) => r.k === 'Team'), { k: 'Team', v: "dev@example.com's Organization" });
  assert.deepEqual(s.rows.find((r) => r.k === 'Signed in'), { k: 'Signed in', v: 'through claude.ai' });
});

test('claude: logged out is a definite no, not unknown', () => {
  const s = parseAgentStatus('claude', { stdout: JSON.stringify({ loggedIn: false }) });
  assert.equal(s.signedIn, false);
  assert.equal(s.label, 'signed out');
  assert.deepEqual(s.rows, []);
});

test('claude: unparseable output is unknown, never a crash', () => {
  const s = parseAgentStatus('claude', { stdout: 'command not found' });
  assert.equal(s.signedIn, null);
  assert.deepEqual(s.rows, []);
});

const HERMES_AUTH = JSON.stringify({
  version: 1, providers: {}, active_provider: null, updated_at: '2026-08-09',
  credential_pool: {
    openrouter: [{ label: 'OPENROUTER_API_KEY', auth_type: 'api_key', source: 'env:OPENROUTER_API_KEY', secret_fingerprint: 'ab12' }],
    copilot: [{ label: 'gh auth token', auth_type: 'api_key', source: 'gh_cli', secret_fingerprint: 'cd34' }],
    anthropic: [
      { label: 'anthropic-oauth-2', auth_type: 'oauth', source: 'manual:hermes_pkce', secret_fingerprint: 'ef56' },
      { label: 'claude_code', auth_type: 'oauth', source: 'claude_code', secret_fingerprint: 'ab78' },
    ],
  },
});
const HERMES_YAML = 'model:\n  default: openrouter/anthropic/claude-sonnet-4-6\n  provider: anthropic\nother:\n  x: 1\n';

test('hermes: counts sign-ins across the pool and names the model', () => {
  const s = parseAgentStatus('hermes', {
    files: { '/h/.hermes/auth.json': HERMES_AUTH, '/h/.hermes/config.yaml': HERMES_YAML },
  });
  assert.equal(s.signedIn, true);
  assert.equal(s.label, 'claude-sonnet-4-6 · 4 sign-ins');
  assert.deepEqual(s.rows.find((r) => r.k === 'Model'), { k: 'Model', v: 'claude-sonnet-4-6, via openrouter' });
  assert.deepEqual(s.rows.find((r) => r.k === 'Provider'), { k: 'Provider', v: 'anthropic' });
  assert.deepEqual(s.rows.find((r) => r.k === 'Sign-ins'), { k: 'Sign-ins', v: 'anthropic ×2, copilot, openrouter' });
});

test('hermes: missing config.yaml drops the model row, keeps sign-ins', () => {
  const s = parseAgentStatus('hermes', {
    files: { '/h/.hermes/auth.json': HERMES_AUTH, '/h/.hermes/config.yaml': null },
  });
  assert.equal(s.signedIn, true);
  assert.equal(s.label, '4 sign-ins');
  assert.equal(s.rows.find((r) => r.k === 'Model'), undefined);
});

test('hermes: an empty pool is signed out', () => {
  const s = parseAgentStatus('hermes', {
    files: { '/h/.hermes/auth.json': JSON.stringify({ credential_pool: {} }), '/h/.hermes/config.yaml': null },
  });
  assert.equal(s.signedIn, false);
  assert.equal(s.label, 'signed out');
});

test('hermes: never leaks a secret field into rows', () => {
  const s = parseAgentStatus('hermes', {
    files: { '/h/.hermes/auth.json': HERMES_AUTH, '/h/.hermes/config.yaml': HERMES_YAML },
  });
  const blob = JSON.stringify(s);
  for (const bad of ['secret_fingerprint', 'ab12', 'cd34', 'ef56', 'ab78']) {
    assert.ok(!blob.includes(bad), `leaked ${bad}`);
  }
});

test('opencode: lists providers from its auth file', () => {
  const s = parseAgentStatus('opencode', {
    files: { '/h/.local/share/opencode/auth.json': JSON.stringify({ openrouter: { type: 'api', key: 'x' }, opencode: { type: 'api', key: 'y' } }) },
  });
  assert.equal(s.signedIn, true);
  assert.equal(s.label, 'opencode, openrouter');
  assert.deepEqual(s.rows.find((r) => r.k === 'Sign-ins'), { k: 'Sign-ins', v: 'opencode, openrouter' });
  assert.ok(!JSON.stringify(s).includes('"x"'), 'leaked a key');
});

test('opencode: empty auth file is signed out', () => {
  const s = parseAgentStatus('opencode', { files: { '/h/.local/share/opencode/auth.json': '{}' } });
  assert.equal(s.signedIn, false);
});

test('codex: reports the account without decoding any token', () => {
  const s = parseAgentStatus('codex', {
    files: { '/h/.codex/auth.json': JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: 'jwt', access_token: 'at', refresh_token: 'rt', account_id: 'acc_1' }, last_refresh: '2026-08-01T10:00:00Z' }) },
  });
  assert.equal(s.signedIn, true);
  assert.equal(s.label, 'signed in through your ChatGPT account');
  assert.deepEqual(s.rows.find((r) => r.k === 'Last renewed'), { k: 'Last renewed', v: '2026-08-01' });
  const blob = JSON.stringify(s);
  for (const bad of ['jwt', '"at"', '"rt"', 'acc_1']) assert.ok(!blob.includes(bad), `leaked ${bad}`);
});

test('codex: an api-key install still counts as signed in', () => {
  const s = parseAgentStatus('codex', { files: { '/h/.codex/auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-x' }) } });
  assert.equal(s.signedIn, true);
  assert.equal(s.label, 'signed in with an API key');
  assert.ok(!JSON.stringify(s).includes('sk-x'), 'leaked the key');
});

test('a file that does not exist is unknown, not signed out', () => {
  const s = parseAgentStatus('opencode', { files: { '/h/.local/share/opencode/auth.json': null } });
  assert.equal(s.signedIn, null);
});

test('an agent with no parser is unknown', () => {
  assert.deepEqual(parseAgentStatus('gemini', { stdout: 'anything' }), { signedIn: null, label: '', rows: [] });
});

test('hermesModelFromYaml reads two keys and stops at the dedent', () => {
  assert.deepEqual(hermesModelFromYaml(HERMES_YAML), { default: 'openrouter/anthropic/claude-sonnet-4-6', provider: 'anthropic' });
});

test('hermesModelFromYaml returns null when there is no model block', () => {
  assert.equal(hermesModelFromYaml('other:\n  x: 1\n'), null);
  assert.equal(hermesModelFromYaml(''), null);
  assert.equal(hermesModelFromYaml(null), null);
});

test('hermesModelFromYaml strips quotes', () => {
  assert.deepEqual(hermesModelFromYaml('model:\n  provider: "anthropic"\n'), { provider: 'anthropic' });
});

test('shortModel takes the last path segment', () => {
  assert.equal(shortModel('openrouter/anthropic/claude-sonnet-4-6'), 'claude-sonnet-4-6');
  assert.equal(shortModel('gpt-5'), 'gpt-5');
  assert.equal(shortModel(''), '');
});
