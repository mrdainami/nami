import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KNOWN_AGENTS, POINTER_FILE, contextFilesFor, detectAgents, pathFromShellOutput, findOnDisk } = require('../src/main/agents-detect.js');

test('registry carries the curated six with everything the launcher needs', () => {
  // gemini and cursor left the registry 2026-08-12: Google shut Gemini CLI
  // down and Antigravity (agy) replaced it; cursor was never verified here.
  const ids = KNOWN_AGENTS.map((a) => a.id);
  assert.ok(!ids.includes('gemini'), 'gemini is gone');
  assert.ok(!ids.includes('cursor'), 'cursor is gone');
  for (const id of ['claude', 'codex', 'opencode', 'antigravity', 'hermes', 'kimi']) {
    assert.ok(ids.includes(id), `registry missing ${id}`);
  }
  for (const a of KNOWN_AGENTS) {
    for (const k of ['id', 'name', 'bin', 'kind', 'sub', 'install', 'docs']) {
      assert.ok(a[k], `${a.id} missing ${k}`);
    }
    assert.ok(['claude', 'run'].includes(a.kind));
    assert.ok(/^https:\/\//.test(a.docs), `${a.id} docs must be a real https link`);
  }
  assert.equal(KNOWN_AGENTS.find((a) => a.id === 'claude').kind, 'claude');
});

// The pointer's whole cost is measured here: a skill is announced in one file,
// and only the agents that refuse to read that file need one of their own.
test('every agent declares a contextFile, and only two differ from AGENTS.md', () => {
  for (const a of KNOWN_AGENTS) {
    assert.ok(a.contextFile, `${a.id} missing contextFile`);
    assert.match(a.contextFile, /\.md$/, `${a.id} contextFile should be a markdown file`);
  }
  const odd = KNOWN_AGENTS.filter((a) => a.contextFile !== POINTER_FILE).map((a) => a.id).sort();
  assert.deepEqual(odd, ['antigravity', 'claude']);
});

test('contextFilesFor returns AGENTS.md plus a stub only where one is needed', () => {
  assert.deepEqual(contextFilesFor(['codex']), ['AGENTS.md']);
  assert.deepEqual(contextFilesFor(['codex', 'hermes', 'kimi', 'opencode']), ['AGENTS.md']);
  assert.deepEqual(contextFilesFor(['claude', 'codex', 'antigravity']).sort(), ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
  assert.deepEqual(contextFilesFor([]), ['AGENTS.md']);   // the block still has a home
  assert.deepEqual(contextFilesFor(), ['AGENTS.md']);
});

test('only agents with a verified project skills dir claim native registration', () => {
  const native = KNOWN_AGENTS.filter((a) => a.projectSkillsDir).map((a) => a.id);
  assert.deepEqual(native, ['claude']);
  assert.equal(KNOWN_AGENTS.find((a) => a.id === 'claude').projectSkillsDir, '.claude/skills');
});

test('detectAgents marks found agents with their path', async () => {
  const fake = async (bin) => {
    if (bin === 'claude') return '/opt/homebrew/bin/claude';
    if (bin === 'opencode') return '/usr/local/bin/opencode';
    throw new Error('not found');
  };
  const out = await detectAgents({ exec: fake });
  assert.equal(out.length, KNOWN_AGENTS.length);
  const claude = out.find((a) => a.id === 'claude');
  assert.equal(claude.found, true);
  assert.equal(claude.path, '/opt/homebrew/bin/claude');
  const codex = out.find((a) => a.id === 'codex');
  assert.equal(codex.found, false);
  assert.equal(codex.path, '');
});

test('detectAgents survives an exec that always throws', async () => {
  const out = await detectAgents({ exec: async () => { throw new Error('boom'); } });
  assert.ok(out.every((a) => a.found === false && a.path === ''));
});

test('detectAgents treats empty output as not found', async () => {
  const out = await detectAgents({ exec: async () => '   \n' });
  assert.ok(out.every((a) => a.found === false));
});

// ---- reading a real shell's answer ----------------------------------------
// The probe now runs an *interactive* login shell, because that is the only
// kind that reads .zshrc. The cost is that anything the user's rc file prints —
// a greeting, a version manager, an nvm warning — arrives on stdout ahead of
// the answer we asked for.

test('the path is picked out of a chatty rc file', () => {
  const noisy = 'nvm: using v22\nWelcome back!\n/Users/x/.opencode/bin/opencode\n';
  assert.equal(pathFromShellOutput(noisy), '/Users/x/.opencode/bin/opencode');
});

test('a shell that prints only a greeting reads as not installed', () => {
  assert.equal(pathFromShellOutput('Welcome back!\nno agent here\n'), '');
  assert.equal(pathFromShellOutput(''), '');
  assert.equal(pathFromShellOutput(undefined), '');
});

test('the answer wins over an rc line that also looks like a path', () => {
  // command -v runs after every startup file, so the last path is ours
  const out = '/some/banner/path\n/opt/homebrew/bin/claude\n';
  assert.equal(pathFromShellOutput(out), '/opt/homebrew/bin/claude');
});

test('a windows drive letter counts as a path', () => {
  assert.equal(pathFromShellOutput('C:\\Users\\x\\claude.exe\n', 'win32'), 'C:\\Users\\x\\claude.exe');
});

// ---- the fallback when the shell tells us nothing --------------------------

test('findOnDisk locates a binary the shell never mentioned', async () => {
  const seen = [];
  const access = async (p) => { seen.push(p); if (p !== '/Users/x/.opencode/bin/opencode') throw new Error('nope'); };
  const found = await findOnDisk('opencode', { home: '/Users/x', env: {}, platform: 'darwin', access });
  assert.equal(found, '/Users/x/.opencode/bin/opencode');
  assert.ok(seen.length > 1, 'it should have tried earlier directories first');
});

test('findOnDisk returns empty rather than throwing when nothing is installed', async () => {
  const found = await findOnDisk('kimi', {
    home: '/Users/x', env: {}, platform: 'darwin',
    access: async () => { throw new Error('nope'); },
  });
  assert.equal(found, '');
});

test('findOnDisk tries the windows extensions, since bare names are not executable there', async () => {
  const tried = [];
  await findOnDisk('claude', {
    home: 'C:\\Users\\x', env: {}, platform: 'win32',
    access: async (p) => { tried.push(p); throw new Error('nope'); },
  });
  assert.ok(tried.some((p) => p.endsWith('claude.exe')), 'must try .exe');
  assert.ok(tried.some((p) => p.endsWith('claude.cmd')), 'must try .cmd (npm -g)');
});

// ---- lifecycle: who is signed in, and what we can do about it --------------

const { agentStatus } = require('../src/main/agents-detect.js');

const HERMES_AUTH = JSON.stringify({
  credential_pool: { anthropic: [{ label: 'claude_code' }], openrouter: [{ label: 'OPENROUTER_API_KEY' }] },
});

test('lifecycle fields only exist for agents verified on a real machine', () => {
  // all six were verified on this Mac 2026-08-12; antigravity and kimi
  // joined when their auth files and commands were confirmed live
  const withLifecycle = KNOWN_AGENTS.filter((a) => a.lifecycle).map((a) => a.id).sort();
  assert.deepEqual(withLifecycle, ['antigravity', 'claude', 'codex', 'hermes', 'kimi', 'opencode']);
  // kimi can log in but its CLI has no logout — so the sheet offers neither,
  // and the pairing rule below stays intact
  assert.equal(KNOWN_AGENTS.find((a) => a.id === 'kimi').lifecycle.login, undefined);
});

test('every lifecycle that can sign in can also sign out', () => {
  for (const a of KNOWN_AGENTS) {
    const lc = a.lifecycle; if (!lc) continue;
    if (lc.login) assert.ok(lc.logout, `${a.id} can log in but not out`);
    assert.ok(lc.statusCmd || (lc.statusFiles && lc.statusFiles.length), `${a.id} has no way to read status`);
    if (lc.statusFiles) for (const p of lc.statusFiles) assert.ok(p.startsWith('~/'), `${a.id}: ${p} must be ~-relative`);
    if (lc.accountUrl) assert.ok(/^https:\/\//.test(lc.accountUrl), `${a.id} accountUrl must be https`);
  }
});

test('agentStatus runs the status command and parses it', async () => {
  const exec = async (cmd) => {
    assert.equal(cmd, 'claude auth status --json');
    return JSON.stringify({ loggedIn: true, email: 'dev@example.com', subscriptionType: 'max', authMethod: 'claude.ai' });
  };
  const s = await agentStatus('claude', { exec, readFile: async () => null, home: '/h' });
  assert.equal(s.id, 'claude');
  assert.equal(s.signedIn, true);
  assert.equal(s.label, 'dev@example.com · Max');
  assert.equal(s.source, 'claude auth status');
});

test('agentStatus expands ~ and reads files for file-based agents', async () => {
  const seen = [];
  const readFile = async (p) => { seen.push(p); return p.endsWith('auth.json') ? HERMES_AUTH : null; };
  const s = await agentStatus('hermes', { exec: async () => { throw new Error('must not exec'); }, readFile, home: '/h' });
  assert.ok(seen.includes('/h/.hermes/auth.json'), 'did not expand ~');
  assert.equal(s.signedIn, true);
  assert.equal(s.label, '2 sign-ins');
  assert.equal(s.source, 'reads ~/.hermes');
});

test('agentStatus returns unknown when the status command fails', async () => {
  const s = await agentStatus('claude', { exec: async () => { throw new Error('boom'); }, readFile: async () => null, home: '/h' });
  assert.equal(s.signedIn, null);
  assert.deepEqual(s.rows, []);
});

test('agentStatus reads antigravity identity from its google account files', async () => {
  const readFile = async (p) => (p.endsWith('oauth_creds.json') ? '{"access_token":"x"}' : null);
  const s = await agentStatus('antigravity', { exec: async () => { throw new Error('must not exec'); }, readFile, home: '/h' });
  assert.equal(s.source, 'reads ~/.gemini');
});

test('agentStatus returns unknown for an id that is not in the registry', async () => {
  const s = await agentStatus('nope', { exec: async () => 'x', readFile: async () => null, home: '/h' });
  assert.equal(s.signedIn, null);
});

test('detectAgents expands configPath so the renderer never needs $HOME', async () => {
  const out = await detectAgents({ exec: async () => '/bin/x', home: '/h' });
  assert.equal(out.find((a) => a.id === 'hermes').configFile, '/h/.hermes/config.yaml');
  assert.equal(out.find((a) => a.id === 'antigravity').configFile, '/h/.gemini/settings.json');
});
