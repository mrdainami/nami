# Agent CLI Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every detected agent CLI in Nami a life beyond "launch it" — show which account it runs as, sign out, switch account, re-run setup, check health, open its settings, and remove it from the Mac.

**Architecture:** Nami never owns an account. A new pure module (`agent-status.js`) turns each CLI's own status output or auth file into display rows. `agents-detect.js` gains optional lifecycle fields per registry entry plus an `agentStatus()` reader that does the IO. Two new IPC handlers expose status and removal. The renderer adds an identity line + chevron to the launcher row, and a "connected" face to the existing `setup-box` sheet. Every action shells out through the terminal tile that already runs installs.

**Tech Stack:** Electron (main + preload + renderer), CommonJS in `src/main`, ES modules in `src/renderer`, `node:test` with `node --test tests/*.test.mjs`. No new dependencies.

## Global Constraints

- **No new npm dependencies.** In particular no YAML parser — Hermes' `config.yaml` is read by a two-key null-safe matcher.
- **No secrets, ever.** No code path reads the macOS keychain or any token/key value. Displayable fields are limited to: email, plan name, org name, provider names, credential labels, auth types, and filesystem paths.
- **Optional lifecycle fields.** An agent with no lifecycle fields must render exactly today's UI. Absent field → button not rendered.
- **Failure degrades to less UI, never a broken action.** Any status read that errors, times out, or fails to parse yields `signedIn: null` and an empty row list.
- **`detectAgents()` stays fast and unchanged.** All status work is lazy and per-agent, after the launcher paints.
- **Injectable IO for tests.** Every function doing IO takes `exec` / `readFile` / `rm` as an option, matching `detectAgents({ exec })`.
- **Verified agents only.** Ship lifecycle fields for `claude`, `hermes`, `opencode` (commands run against real binaries) and `statusFiles` only for `codex`. `gemini` and `kimi` get nothing.
- **Copy is human, not schema.** "Team" not `orgName`, "Program" not "binary", "Signed in through claude.ai".
- Paper design language per `.claude/skills/paper-design/SKILL.md`; reuse existing `setup-box`, `scan-box`, `btn`, `picker-row` classes.

---

### Task 1: Status parsers

Pure functions turning each CLI's payload into `{ signedIn, label, rows }`. No IO, no requires beyond node builtins.

**Files:**
- Create: `src/main/agent-status.js`
- Test: `tests/agent-status.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseAgentStatus(id, payload) → { signedIn: true|false|null, label: string, rows: [{k,v}] }`
    where `payload` is `{ stdout: string }` for command-based agents, or `{ files: { [absPath]: string|null } }` for file-based agents.
  - `hermesModelFromYaml(text) → { default?: string, provider?: string } | null`
  - `shortModel(slug) → string`

- [ ] **Step 1: Write the failing test**

Create `tests/agent-status.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agent-status.test.mjs`
Expected: FAIL — `Cannot find module '../src/main/agent-status.js'`

- [ ] **Step 3: Write the implementation**

Create `src/main/agent-status.js`:

```js
// What each agent CLI says about who is signed in — pure, no IO.
// One rule governs this whole file: nothing that could be a secret ever reaches
// a row. We read labels, provider names, plans and paths; never a token, key or
// fingerprint. Callers do the IO and hand the payload in, so every parser here
// is testable against a captured fixture with no CLI on the box.
//
// Payload shapes, captured on macOS 2026-08-09:
//   claude   { stdout }  — `claude auth status --json`, the only CLI of the six
//                          with a machine-readable status command
//   hermes   { files }   — ~/.hermes/auth.json + ~/.hermes/config.yaml
//                          (`hermes auth status` demands a provider argument)
//   opencode { files }   — ~/.local/share/opencode/auth.json
//                          (`opencode auth list` prints decorated prose)
//   codex    { files }   — ~/.codex/auth.json

const UNKNOWN = () => ({ signedIn: null, label: '', rows: [] });
const SIGNED_OUT = () => ({ signedIn: false, label: 'signed out', rows: [] });

function readJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}
function onlyFile(payload) {
  const files = (payload && payload.files) || {};
  const key = Object.keys(files)[0];
  return key === undefined ? undefined : files[key];
}
function fileEndingWith(payload, suffix) {
  const files = (payload && payload.files) || {};
  const key = Object.keys(files).find((k) => k.endsWith(suffix));
  return key === undefined ? undefined : files[key];
}

// "openrouter/anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
function shortModel(slug) {
  const parts = String(slug || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// The repo has no YAML parser and won't gain one for two keys. Match the
// `model:` block's `default:` and `provider:` lines, stop at the first dedent,
// and give up (null) on anything unexpected — the model row is a bonus.
function hermesModelFromYaml(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const start = lines.findIndex((l) => /^model:\s*$/.test(l));
  if (start < 0) return null;
  const out = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const m = /^\s+(default|provider):\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return (out.default || out.provider) ? out : null;
}

function parseClaude(payload) {
  const j = readJson(payload && payload.stdout);
  if (!j || typeof j.loggedIn !== 'boolean') return UNKNOWN();
  if (!j.loggedIn) return SIGNED_OUT();
  const plan = j.subscriptionType ? String(j.subscriptionType) : '';
  const planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '';
  const rows = [];
  if (j.email) rows.push({ k: 'Account', v: String(j.email) });
  if (planLabel) rows.push({ k: 'Plan', v: planLabel });
  if (j.authMethod) rows.push({ k: 'Signed in', v: 'through ' + String(j.authMethod) });
  if (j.orgName) rows.push({ k: 'Team', v: String(j.orgName) });
  const label = [j.email, planLabel].filter(Boolean).join(' · ') || 'signed in';
  return { signedIn: true, label, rows };
}

function parseHermes(payload) {
  const auth = readJson(fileEndingWith(payload, 'auth.json'));
  if (!auth) return UNKNOWN();
  const pool = (auth.credential_pool && typeof auth.credential_pool === 'object') ? auth.credential_pool : {};
  const providers = Object.keys(pool).filter((p) => Array.isArray(pool[p]) && pool[p].length).sort();
  const total = providers.reduce((n, p) => n + pool[p].length, 0);
  if (!total) return SIGNED_OUT();

  const rows = [];
  const model = hermesModelFromYaml(fileEndingWith(payload, 'config.yaml'));
  const modelName = model ? shortModel(model.default) : '';
  const via = model && model.default ? String(model.default).split('/')[0] : '';
  if (modelName) rows.push({ k: 'Model', v: via && via !== modelName ? `${modelName}, via ${via}` : modelName });
  if (model && model.provider) rows.push({ k: 'Provider', v: model.provider });
  rows.push({ k: 'Sign-ins', v: providers.map((p) => (pool[p].length > 1 ? `${p} ×${pool[p].length}` : p)).join(', ') });

  const count = `${total} sign-in${total === 1 ? '' : 's'}`;
  return { signedIn: true, label: [modelName, count].filter(Boolean).join(' · '), rows };
}

function parseOpencode(payload) {
  const j = readJson(onlyFile(payload));
  if (!j) return UNKNOWN();
  const providers = Object.keys(j).sort();
  if (!providers.length) return SIGNED_OUT();
  return { signedIn: true, label: providers.join(', '), rows: [{ k: 'Sign-ins', v: providers.join(', ') }] };
}

function parseCodex(payload) {
  const j = readJson(onlyFile(payload));
  if (!j) return UNKNOWN();
  const hasTokens = !!(j.tokens && j.tokens.account_id);
  const hasKey = typeof j.OPENAI_API_KEY === 'string' && j.OPENAI_API_KEY.length > 0;
  if (!hasTokens && !hasKey) return SIGNED_OUT();
  const rows = [];
  const label = hasTokens ? 'signed in through your ChatGPT account' : 'signed in with an API key';
  rows.push({ k: 'Signed in', v: hasTokens ? 'through your ChatGPT account' : 'with an API key' });
  if (hasTokens && typeof j.last_refresh === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j.last_refresh)) {
    rows.push({ k: 'Last renewed', v: j.last_refresh.slice(0, 10) });
  }
  return { signedIn: true, label, rows };
}

const PARSERS = { claude: parseClaude, hermes: parseHermes, opencode: parseOpencode, codex: parseCodex };

function parseAgentStatus(id, payload) {
  const fn = PARSERS[id];
  if (!fn) return UNKNOWN();
  try { return fn(payload || {}); } catch (_) { return UNKNOWN(); }
}

module.exports = { parseAgentStatus, hermesModelFromYaml, shortModel };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agent-status.test.mjs`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add src/main/agent-status.js tests/agent-status.test.mjs
git commit -m "feat: pure parsers for agent CLI sign-in status"
```

---

### Task 2: Registry lifecycle fields + the status reader

**Files:**
- Modify: `src/main/agents-detect.js`
- Test: `tests/agents-detect.test.mjs` (extend)

**Interfaces:**
- Consumes: `parseAgentStatus(id, payload)` from Task 1.
- Produces:
  - `KNOWN_AGENTS[].lifecycle` — optional object, fields listed in the code below.
  - `agentStatus(id, { exec, readFile, home }) → Promise<{ id, signedIn, label, rows, source }>`
    where `source` is a short human string like `claude auth status` or `reads ~/.hermes`.

- [ ] **Step 1: Write the failing test**

Append to `tests/agents-detect.test.mjs`:

```js
const { agentStatus } = require('../src/main/agents-detect.js');

const HERMES_AUTH = JSON.stringify({
  credential_pool: { anthropic: [{ label: 'claude_code' }], openrouter: [{ label: 'OPENROUTER_API_KEY' }] },
});

test('lifecycle fields only exist for agents verified on a real machine', () => {
  const withLifecycle = KNOWN_AGENTS.filter((a) => a.lifecycle).map((a) => a.id).sort();
  assert.deepEqual(withLifecycle, ['claude', 'codex', 'hermes', 'opencode']);
  const gemini = KNOWN_AGENTS.find((a) => a.id === 'gemini');
  assert.equal(gemini.lifecycle, undefined, 'gemini is unverified and must stay inert');
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

test('agentStatus returns unknown for an agent with no lifecycle', async () => {
  const s = await agentStatus('gemini', { exec: async () => 'x', readFile: async () => 'y', home: '/h' });
  assert.equal(s.signedIn, null);
  assert.equal(s.label, '');
});

test('agentStatus returns unknown for an id that is not in the registry', async () => {
  const s = await agentStatus('nope', { exec: async () => 'x', readFile: async () => null, home: '/h' });
  assert.equal(s.signedIn, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agents-detect.test.mjs`
Expected: FAIL — `agentStatus is not a function`

- [ ] **Step 3: Write the implementation**

In `src/main/agents-detect.js`, add `lifecycle` to the four verified entries and append the reader. Replace the four entries and the exports:

```js
// Claude Code
{ id: 'claude', name: 'Claude Code', bin: 'claude', kind: 'claude',
  sub: 'your subscription · slash commands work',
  install: 'curl -fsSL https://claude.ai/install.sh | bash',
  docs: 'https://docs.anthropic.com/en/docs/claude-code',
  lifecycle: {
    statusCmd: 'claude auth status --json',
    source: 'claude auth status',
    login: 'claude auth login',
    logout: 'claude auth logout',
    health: 'claude doctor',
    configPath: '~/.claude.json',
    accountUrl: 'https://claude.ai/settings/profile',
    // No uninstall: ~/.claude holds the user's own skills, agents and history.
    // Removal deletes the program only — see agent-remove.js.
    removePaths: [],
  } },

// Codex — file-verified only; its commands are unconfirmed, so no buttons.
{ id: 'codex', name: 'Codex', bin: 'codex', kind: 'run',
  sub: "OpenAI's coding agent",
  install: 'npm install -g @openai/codex',
  docs: 'https://developers.openai.com/codex/cli',
  lifecycle: {
    statusFiles: ['~/.codex/auth.json'],
    source: 'reads ~/.codex',
    configPath: '~/.codex/config.toml',
  } },

// OpenCode
{ id: 'opencode', name: 'OpenCode', bin: 'opencode', kind: 'run',
  sub: 'open-source agent · bring any model',
  install: 'curl -fsSL https://opencode.ai/install | bash',
  docs: 'https://opencode.ai/docs',
  lifecycle: {
    statusFiles: ['~/.local/share/opencode/auth.json'],
    source: 'reads its auth file',
    login: 'opencode auth login',
    logout: 'opencode auth logout',
    configPath: '~/.config/opencode/opencode.json',
    removePaths: ['~/.local/share/opencode/auth.json'],
  } },

// Hermes
{ id: 'hermes', name: 'Hermes', bin: 'hermes', kind: 'run',
  sub: "Nous Research's agent, learns as it works",
  install: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash && hermes setup --portal',
  docs: 'https://hermes-agent.nousresearch.com',
  lifecycle: {
    statusFiles: ['~/.hermes/auth.json', '~/.hermes/config.yaml'],
    source: 'reads ~/.hermes',
    // Hermes holds several sign-ins at once, so switching is its own picker
    // rather than a logout/login pair.
    login: 'hermes login',
    logout: 'hermes auth logout',
    switchCmd: 'hermes auth',
    switchLabel: 'Switch provider',
    setup: 'hermes setup --portal',
    health: 'hermes doctor',
    configPath: '~/.hermes/config.yaml',
    uninstall: 'hermes uninstall',
  } },
```

Append below `detectAgents`:

```js
const fsp = require('node:fs/promises');
const os = require('node:os');
const { parseAgentStatus } = require('./agent-status.js');

function agentById(id) { return KNOWN_AGENTS.find((a) => a.id === id) || null; }

function expandHome(p, home) {
  return String(p || '').replace(/^~(?=\/|$)/, home);
}

function shellRun(cmd) {
  return new Promise((resolve, reject) => {
    execFile('/bin/zsh', ['-lc', cmd], { timeout: 8000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || ''));
    });
  });
}
async function readIfPresent(p) {
  try { return await fsp.readFile(p, 'utf8'); } catch (_) { return null; }
}

// Who is signed in to one agent. Lazy and per-agent by design: a CLI that hangs
// must never stall the launcher, so every failure path lands on "unknown".
async function agentStatus(id, { exec = shellRun, readFile = readIfPresent, home = os.homedir() } = {}) {
  const blank = { id, signedIn: null, label: '', rows: [], source: '' };
  const agent = agentById(id);
  const lc = agent && agent.lifecycle;
  if (!lc) return blank;
  try {
    let payload;
    if (lc.statusCmd) {
      payload = { stdout: await exec(lc.statusCmd) };
    } else if (lc.statusFiles && lc.statusFiles.length) {
      const files = {};
      await Promise.all(lc.statusFiles.map(async (rel) => {
        const abs = expandHome(rel, home);
        files[abs] = await readFile(abs);
      }));
      payload = { files };
    } else {
      return blank;
    }
    const parsed = parseAgentStatus(id, payload);
    return { id, source: lc.source || '', ...parsed };
  } catch (_) {
    return blank;
  }
}

module.exports = { KNOWN_AGENTS, detectAgents, agentStatus, agentById, expandHome };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agents-detect.test.mjs`
Expected: PASS, including the four pre-existing tests

- [ ] **Step 5: Commit**

```bash
git add src/main/agents-detect.js tests/agents-detect.test.mjs
git commit -m "feat: lifecycle fields on the agent registry + lazy status reader"
```

---

### Task 3: Guarded removal

Removal is the only destructive action here, so its safety rules are a tested pure function before any filesystem call exists.

**Files:**
- Create: `src/main/agent-remove.js`
- Test: `tests/agent-remove.test.mjs`

**Interfaces:**
- Consumes: `agentById(id)`, `expandHome(p, home)` from Task 2.
- Produces:
  - `planRemoval({ id, binPath, home }) → { mode: 'uninstall', command, describe: string[] } | { mode: 'delete', paths: string[], describe: string[] } | { mode: 'none', reason: string }`
  - `isSafeRemovePath(p, home) → boolean`
  - `removeAgent({ id, binPath, home, rm }) → Promise<{ ok, removed: string[], error?: string }>`

- [ ] **Step 1: Write the failing test**

Create `tests/agent-remove.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planRemoval, isSafeRemovePath, removeAgent } = require('../src/main/agent-remove.js');

const HOME = '/Users/dev';

test('a CLI with its own uninstaller gets used instead of deleting files', () => {
  const p = planRemoval({ id: 'hermes', binPath: '/Users/dev/.local/bin/hermes', home: HOME });
  assert.equal(p.mode, 'uninstall');
  assert.equal(p.command, 'hermes uninstall');
});

test('without an uninstaller, the program and the auth file go', () => {
  const p = planRemoval({ id: 'opencode', binPath: '/Users/dev/.opencode/bin/opencode', home: HOME });
  assert.equal(p.mode, 'delete');
  assert.deepEqual(p.paths, ['/Users/dev/.opencode/bin/opencode', '/Users/dev/.local/share/opencode/auth.json']);
});

test('claude removes the program only — ~/.claude is the user\'s own work', () => {
  const p = planRemoval({ id: 'claude', binPath: '/Users/dev/.local/bin/claude', home: HOME });
  assert.equal(p.mode, 'delete');
  assert.deepEqual(p.paths, ['/Users/dev/.local/bin/claude']);
  assert.ok(p.describe.some((d) => /settings|skills|history/i.test(d)), 'must say what survives');
});

test('an agent with no lifecycle cannot be removed', () => {
  assert.equal(planRemoval({ id: 'gemini', binPath: '/usr/local/bin/gemini', home: HOME }).mode, 'none');
});

test('an agent that was never detected cannot be removed', () => {
  assert.equal(planRemoval({ id: 'opencode', binPath: '', home: HOME }).mode, 'none');
});

test('paths outside home are refused', () => {
  assert.equal(isSafeRemovePath('/usr/local/bin/opencode', HOME), false);
  assert.equal(isSafeRemovePath('/etc/passwd', HOME), false);
  assert.equal(isSafeRemovePath('relative/path', HOME), false);
});

test('home itself and traversal are refused', () => {
  assert.equal(isSafeRemovePath(HOME, HOME), false);
  assert.equal(isSafeRemovePath(HOME + '/', HOME), false);
  assert.equal(isSafeRemovePath(HOME + '/../root/x', HOME), false);
  assert.equal(isSafeRemovePath('/Users/develop/x', HOME), false, 'prefix match must not pass');
});

test('a normal path under home is allowed', () => {
  assert.equal(isSafeRemovePath(HOME + '/.local/bin/opencode', HOME), true);
});

test('a system-installed CLI is refused rather than deleted', () => {
  const p = planRemoval({ id: 'opencode', binPath: '/usr/local/bin/opencode', home: HOME });
  assert.equal(p.mode, 'none');
  assert.match(p.reason, /outside your home folder/i);
});

test('removeAgent deletes exactly the planned paths', async () => {
  const gone = [];
  const out = await removeAgent({ id: 'claude', binPath: HOME + '/.local/bin/claude', home: HOME, rm: async (p) => { gone.push(p); } });
  assert.equal(out.ok, true);
  assert.deepEqual(gone, [HOME + '/.local/bin/claude']);
  assert.deepEqual(out.removed, [HOME + '/.local/bin/claude']);
});

test('removeAgent refuses an uninstall-mode agent — that runs in a tile', async () => {
  const out = await removeAgent({ id: 'hermes', binPath: HOME + '/.local/bin/hermes', home: HOME, rm: async () => { throw new Error('must not delete'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /uninstall/i);
});

test('removeAgent reports a delete that failed instead of claiming success', async () => {
  const out = await removeAgent({ id: 'claude', binPath: HOME + '/.local/bin/claude', home: HOME, rm: async () => { throw new Error('EACCES'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /EACCES/);
  assert.deepEqual(out.removed, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agent-remove.test.mjs`
Expected: FAIL — `Cannot find module '../src/main/agent-remove.js'`

- [ ] **Step 3: Write the implementation**

Create `src/main/agent-remove.js`:

```js
// Taking an agent CLI off this Mac. The rules here exist because this is the
// only action in the feature that destroys something:
//
//   1. If the CLI ships its own uninstaller, use it. We are not better at
//      removing someone else's program than they are.
//   2. Otherwise delete the program and the agent's own auth file — never a
//      directory that can hold the user's own work. ~/.claude holds their
//      skills, agents and history; removing Claude Code must not touch it.
//   3. Every deleted path must be absolute and inside $HOME. A CLI installed
//      to /usr/local by a package manager is refused, not force-deleted.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { agentById, expandHome } = require('./agents-detect.js');

function isSafeRemovePath(p, home) {
  if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return false;
  const norm = path.normalize(p).replace(/\/+$/, '');
  const base = path.normalize(home).replace(/\/+$/, '');
  if (norm === base) return false;
  return norm.startsWith(base + path.sep);
}

function planRemoval({ id, binPath, home }) {
  const agent = agentById(id);
  const lc = agent && agent.lifecycle;
  if (!lc) return { mode: 'none', reason: 'Nami does not know how to remove this one.' };

  if (lc.uninstall) {
    return {
      mode: 'uninstall',
      command: lc.uninstall,
      describe: [`runs ${lc.uninstall}, which ${agent.name} provides for exactly this`],
    };
  }

  if (!binPath) return { mode: 'none', reason: 'It is not installed.' };

  const paths = [binPath, ...(lc.removePaths || []).map((p) => expandHome(p, home))];
  for (const p of paths) {
    if (!isSafeRemovePath(p, home)) {
      return { mode: 'none', reason: `${agent.name} lives at ${p}, outside your home folder — remove it the way you installed it.` };
    }
  }
  const describe = paths.map((p) => p.replace(home, '~'));
  if (lc.configPath) describe.push(`your settings at ${lc.configPath} stay, along with anything you wrote — skills, agents, history`);
  return { mode: 'delete', paths, describe };
}

async function removeAgent({ id, binPath, home, rm = (p) => fsp.rm(p, { recursive: true, force: true }) }) {
  const plan = planRemoval({ id, binPath, home });
  if (plan.mode === 'uninstall') return { ok: false, removed: [], error: `${id} has its own uninstall command — run it in a tile.` };
  if (plan.mode !== 'delete') return { ok: false, removed: [], error: plan.reason };
  const removed = [];
  try {
    for (const p of plan.paths) { await rm(p); removed.push(p); }
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, removed, error: e.message };
  }
}

module.exports = { planRemoval, isSafeRemovePath, removeAgent };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agent-remove.test.mjs`
Expected: PASS

Note on the failed-delete test: `removed` is asserted empty because the very first `rm` throws. Do not "improve" this by pre-populating `removed`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — no existing test regressed

- [ ] **Step 6: Commit**

```bash
git add src/main/agent-remove.js tests/agent-remove.test.mjs
git commit -m "feat: guarded agent removal — uninstaller first, home-only deletes"
```

---

### Task 4: IPC wiring

**Files:**
- Modify: `src/main/main.js` (near the existing `agents:detect` handler, ~line 276)
- Modify: `src/main/preload.js` (near `detectAgents`, line 27)

**Interfaces:**
- Consumes: `agentStatus(id, opts)` (Task 2), `removeAgent({id, binPath, home})` and `planRemoval(...)` (Task 3).
- Produces on `window.dainami`:
  - `agentStatus(id) → Promise<{ id, signedIn, label, rows, source }>`
  - `agentRemovalPlan(id, binPath) → Promise<plan>`
  - `agentRemove(id, binPath) → Promise<{ ok, removed, error? }>`

- [ ] **Step 1: Add the handlers**

In `src/main/main.js`, extend the existing require of `agents-detect` to include `agentStatus`, add a require of `agent-remove`, and replace the `agents:detect` block with:

```js
// Which of the curated agent CLIs are on this Mac (via the user's login shell).
ipcMain.handle('agents:detect', () => detectAgents());
// Who is signed in to one of them. Lazy and per-agent — a CLI that hangs must
// never stall the launcher, so every failure lands on signedIn: null.
ipcMain.handle('agents:status', (_e, { id } = {}) => agentStatus(id));
ipcMain.handle('agents:removalPlan', (_e, { id, binPath } = {}) =>
  planRemoval({ id, binPath, home: os.homedir() }));
ipcMain.handle('agents:remove', (_e, { id, binPath } = {}) =>
  removeAgent({ id, binPath, home: os.homedir() }));
```

In `src/main/preload.js`, after line 27:

```js
  detectAgents: () => ipcRenderer.invoke('agents:detect'),
  agentStatus: (id) => ipcRenderer.invoke('agents:status', { id }),
  agentRemovalPlan: (id, binPath) => ipcRenderer.invoke('agents:removalPlan', { id, binPath }),
  agentRemove: (id, binPath) => ipcRenderer.invoke('agents:remove', { id, binPath }),
```

- [ ] **Step 2: Verify the app still boots and the bridge is complete**

Run: `npm start`
In the app, open the devtools console and run:

```js
await window.dainami.agentStatus('claude')
```

Expected: an object with `signedIn: true` and a `label` naming your account, or `signedIn: null` if `claude` is not installed. Then quit the app.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/main.js src/main/preload.js
git commit -m "feat: IPC for agent status and removal"
```

---

### Task 5: The launcher row learns the account

**Files:**
- Modify: `src/renderer/app.js` — `refreshAgents()` and `renderLauncher()`
- Modify: `src/renderer/paper.css` — one new rule

**Interfaces:**
- Consumes: `api.agentStatus(id)` (Task 4).
- Produces:
  - `S.agentStatus` — `{ [id]: { signedIn, label, rows, source } }`, read by Task 6.
  - `refreshAgentStatus(id)` — re-reads one agent and repaints if a relevant overlay is open.
  - `statusLineFor(agent)` — the row's second line, used by Task 6's header.

- [ ] **Step 1: Add status state and the lazy fetch**

In `src/renderer/app.js`, add to the `S` object beside `agents`:

```js
  agents: null, agentsLoading: false,   // detected agent CLIs (null until first scan)
  agentStatus: {},                      // id → { signedIn, label, rows, source }, filled lazily
```

Replace `refreshAgents()` with:

```js
async function refreshAgents() {
  if (S.agentsLoading) return;
  S.agentsLoading = true;
  try { S.agents = await api.detectAgents(); } catch (_) { S.agents = S.agents || []; }
  S.agentsLoading = false;
  repaintAgentOverlays();
  // Identity is read after the list paints, one agent at a time in parallel:
  // a slow CLI delays only its own second line.
  for (const a of (S.agents || [])) if (a.found) refreshAgentStatus(a.id);
}
function repaintAgentOverlays() {
  const ot = S.overlay && S.overlay.type;
  if (['launcher', 'agent-setup', 'agent-remove', 'connect-form', 'connect-custom', 'create', 'improve-item'].includes(ot)) renderOverlay();
}
async function refreshAgentStatus(id) {
  try { S.agentStatus[id] = await api.agentStatus(id); } catch (_) { S.agentStatus[id] = null; }
  repaintAgentOverlays();
}
```

- [ ] **Step 2: Show it on the row**

Add above `renderLauncher()`:

```js
// One agent's second line. Identity when we have it, the registry blurb until
// then — the row never says less than it does today.
function statusLineFor(a) {
  const st = S.agentStatus[a.id];
  if (!st || st.signedIn === null) return { dot: 'ok', text: a.sub };
  if (st.signedIn === false) return { dot: 'warn', text: 'signed out' };
  return { dot: 'ok', text: st.label || a.sub };
}
```

In `renderLauncher()`, replace the `for (const a of ready)` body's `row.innerHTML` and add the chevron:

```js
  for (const a of ready) {
    const row = document.createElement('div'); row.className = 'picker-row';
    const st = statusLineFor(a);
    const lifecycle = !!(S.agentStatus[a.id] && S.agentStatus[a.id].source);
    row.innerHTML = `${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">${esc(a.name)}</span>
      <span class="desc"><span class="ok ${st.dot === 'warn' ? 'ok--warn' : ''}">●</span> ready · ${esc(st.text)}</span></span>
      ${lifecycle ? '<span class="chev" title="Manage this agent">›</span>' : ''}`;
    row.onclick = async (e) => {
      if (lifecycle && e.target.closest('.chev')) { openAgentSheet(a); return; }
      closeOverlay(); if (!(await ensureFolder())) return;
      if (a.kind === 'claude') return startPanel({ kind: 'claude', title: 'Claude session', code: 'CC' });
      startPanel({ kind: 'run', title: a.name, code: code2(a.name), command: a.bin });
    };
    list.appendChild(row);
  }
```

- [ ] **Step 3: Add the amber dot**

In `src/renderer/paper.css`, beside the other `.ok` rules:

```css
/* installed but signed out — a state the launcher could not show before */
.picker-row .ok--warn { color: var(--amber-line); }
```

Then add the same rule to `theme-operator.css`, `theme-glass.css` and `theme-graphite.css`, each using that theme's own amber/warning token. If a theme has no amber token, use its existing "attention" colour rather than inventing one.

- [ ] **Step 4: See it work**

Run: `npm start`, press ⌘N.
Expected: installed agents show their account on the second line within a second of the sheet opening, each with a `›`. Clicking a row still starts a session; clicking `›` does nothing yet (Task 6 adds the sheet — until then it throws a ReferenceError in the console, which is expected at this checkpoint).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app.js src/renderer/paper.css src/renderer/theme-operator.css src/renderer/theme-glass.css src/renderer/theme-graphite.css
git commit -m "feat: launcher rows name the signed-in account"
```

---

### Task 6: The details sheet

**Files:**
- Modify: `src/renderer/app.js` — `renderOverlay()`, `openAgentSetup()` / `renderAgentSetup()`
- Modify: `src/renderer/paper.css`

**Interfaces:**
- Consumes: `S.agentStatus` and `refreshAgentStatus(id)` (Task 5); `api.openUrl`, `api.copyText`, `startPanel`, `openCard`-style editor tiles.
- Produces:
  - `openAgentSheet(agent)` — sets `S.overlay = { type: 'agent-setup', agent }`; the renderer picks the installed or not-installed face from `agent.found`.
  - `runAgentCommand(agent, command, title)` — opens a `run` tile and re-reads status when it exits.

- [ ] **Step 1: Run a command in a tile and re-read status when it exits**

`startPanel` already accepts `{ kind: 'run', command }`. Add the exit hook. In the `api.onTermExit` handler (~line 190), after `p.exited = true; p.status = 'exited';` add:

```js
    if (p.onExit) { try { p.onExit(code); } catch (_) {} }
```

Then add beside `openAgentSheet`:

```js
// Every lifecycle action is the CLI's own command, run in the tile that already
// runs installs. When it exits we re-read status, so the sheet is never stale.
function runAgentCommand(agent, command, title) {
  closeOverlay();
  startPanel({
    kind: 'run', title, code: code2(agent.name), command,
    onExit: () => { refreshAgents(); },
  });
}
```

- [ ] **Step 2: Split the sheet into two faces**

Replace `openAgentSetup(agent)` and `renderAgentSetup()` with:

```js
function openAgentSetup(agent) { S.overlay = { type: 'agent-setup', agent }; renderOverlay(); }
function openAgentSheet(agent) { S.overlay = { type: 'agent-setup', agent }; renderOverlay(); refreshAgentStatus(agent.id); }

function renderAgentSetup() {
  const a = S.overlay.agent;
  return a.found ? renderAgentInstalled(a) : renderAgentInstall(a);
}

// Not on this Mac yet — unchanged from before this feature.
function renderAgentInstall(a) {
  const modal = overlay('setup-box', `
    <div class="setup-head"><button class="t-btn su-back" title="Back to new session">←</button>
      ${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">${esc(a.name)}</span><span class="desc">${esc(a.sub)}</span></span></div>
    <p class="setup-copy">${esc(a.name)} is not on this Mac yet. One command installs it, and I can run that
      for you in a terminal right here. The first time it starts, it will ask you to sign in, right in the tile.</p>
    <div class="setup-cmd">${esc(a.install)}</div>
    <div class="setup-actions">
      <button class="btn btn--go" id="su-run">Install it for me</button>
      <button class="btn" id="su-copy">Copy the command</button>
      <button class="btn" id="su-docs">Read the guide</button>
    </div>
    <p class="setup-note">Install it for me opens a terminal tile and runs the line above. Copy puts it on
      your clipboard. Read the guide opens the official ${esc(a.name)} page in your browser.</p>`);
  q('.su-back', modal).onclick = () => openLauncher();
  q('#su-run', modal).onclick = async () => {
    closeOverlay(); if (!(await ensureFolder())) return;
    startPanel({ kind: 'run', title: `install ${a.name}`, code: code2(a.name), command: a.install, onExit: () => refreshAgents() });
    toast('When it finishes, press ⌘N. The button will be ready.');
  };
  q('#su-copy', modal).onclick = async () => { await api.copyText(a.install); toast('Copied.'); };
  q('#su-docs', modal).onclick = () => api.openUrl(a.docs);
}

// On this Mac — who it runs as, and everything you can do about that.
function renderAgentInstalled(a) {
  const lc = a.lifecycle || {};
  const st = S.agentStatus[a.id] || null;
  const line = st && st.signedIn === true ? esc(st.label)
    : st && st.signedIn === false ? 'signed out'
    : 'checking…';
  const rows = (st && st.rows) || [];
  const scan = rows.map((r) =>
    `<div class="scan-row"><span class="mark">✓</span><span class="label2">${esc(r.k)}</span><span class="value">${esc(r.v)}</span></div>`).join('');

  const btn = (id, label, on) => on ? `<button class="btn" id="${id}">${esc(label)}</button>` : '';
  const modal = overlay('setup-box', `
    <div class="setup-head"><button class="t-btn su-back" title="Back to new session">←</button>
      ${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">${esc(a.name)}</span>
      <span class="desc"><span class="ok${st && st.signedIn === false ? ' ok--warn' : ''}">●</span> ${line}</span></span></div>

    ${rows.length || st ? `<div class="scan-box">
      <div class="label">this Mac${st && st.source ? `<span class="scan-src">${esc(st.source)}</span>` : ''}</div>
      ${scan || '<div class="scan-row"><span class="mark">·</span><span class="value">Nothing to report — it is installed and that is all Nami can tell.</span></div>'}
      <div class="scan-row"><span class="mark">✓</span><span class="label2">Program</span><span class="value">${esc(shortHome(a.path))}</span></div>
    </div>` : ''}

    <div class="setup-actions">
      ${btn('ag-switch', lc.switchLabel || 'Switch account', lc.switchCmd || (lc.login && lc.logout))}
      ${btn('ag-out', 'Sign out', lc.logout && st && st.signedIn !== false)}
      ${btn('ag-in', 'Sign in', lc.login && st && st.signedIn === false)}
      ${btn('ag-setup', 'Run setup again', lc.setup)}
      ${btn('ag-health', "Check it's healthy", lc.health)}
    </div>
    <div class="ag-links">
      ${lc.configPath ? '<span class="action" id="ag-config">Open its settings file</span>' : ''}
      ${lc.accountUrl ? '<span class="action" id="ag-account">Manage account online</span>' : ''}
      <span class="action" id="ag-docs">Read the guide</span>
    </div>
    <div class="ag-danger">
      <button class="btn btn--ghost" id="ag-remove">Remove from this Mac</button>
      <span class="why">Asks first, and names every file it would delete.</span>
    </div>`);

  q('.su-back', modal).onclick = () => openLauncher();
  const on = (id, fn) => { const el = q('#' + id, modal); if (el) el.onclick = fn; };
  on('ag-switch', () => runAgentCommand(a, lc.switchCmd || `${lc.logout} && ${lc.login}`, `${a.name} · sign in`));
  on('ag-out', () => runAgentCommand(a, lc.logout, `${a.name} · sign out`));
  on('ag-in', () => runAgentCommand(a, lc.login, `${a.name} · sign in`));
  on('ag-setup', () => runAgentCommand(a, lc.setup, `${a.name} · setup`));
  on('ag-health', () => runAgentCommand(a, lc.health, `${a.name} · check`));
  on('ag-config', () => { closeOverlay(); openPathInEditor(lc.configPath.replace(/^~/, S.home || '~')); });
  on('ag-account', () => api.openUrl(lc.accountUrl));
  on('ag-docs', () => api.openUrl(a.docs));
  on('ag-remove', () => openAgentRemove(a));
}
```

Add the two helpers this needs, beside `baseNameOf`:

```js
function shortHome(p) { return S.home && p ? String(p).replace(S.home, '~') : String(p || ''); }
```

`openPathInEditor(path)` — if the codebase already has a function that opens a file path in an editor tile (search for where the workspace tree opens a file), call that one and delete this note. If it does not, add:

```js
function openPathInEditor(file) {
  startPanel({ kind: 'editor', title: baseNameOf(file), file, code: 'ED', chipKind: 'editor' });
}
```

`S.home` must exist. If `boot` does not already return the home directory, add `home: os.homedir()` to the `boot` handler's payload in `src/main/main.js` and store it as `S.home` where the rest of the boot payload is unpacked.

- [ ] **Step 3: Style the new pieces**

In `src/renderer/paper.css`, after the `.setup-note` rule:

```css
/* installed-agent sheet: identity source, links row, and the quiet danger zone */
.scan-box .scan-src { margin-left: auto; font-size: 10.5px; letter-spacing: 0; text-transform: none; color: var(--muted-3); }
.scan-box .label { display: flex; align-items: center; gap: 8px; }
.ag-links { display: flex; gap: 16px; flex-wrap: wrap; font-size: 11px; margin-top: 11px; }
.ag-links .action { color: var(--muted-2); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.ag-links .action:hover { color: var(--ink); }
.ag-links .action:focus-visible { color: var(--ink); outline: 1px solid var(--dash-dark); outline-offset: 2px; }
.ag-danger { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--dash); }
.ag-danger .why { flex: 1; min-width: 150px; font-size: 10.5px; color: var(--muted); line-height: 1.45; }
.btn--ghost { box-shadow: none; border-style: dashed; color: var(--muted); }
.btn--ghost:hover { border-style: solid; color: var(--ink); }
```

Check each of `theme-operator.css`, `theme-glass.css`, `theme-graphite.css` for whether `.btn--ghost` and `.scan-src` need a token override; add only what is actually wrong when you look at them.

- [ ] **Step 4: See it work in every theme**

Run: `npm start`, ⌘N, click `›` on Claude Code.
Expected: the sheet names your account and plan, shows the source `claude auth status`, and offers Switch account / Sign out / Check it's healthy. Click `›` on Hermes: it shows the model and sign-in count, sourced `reads ~/.hermes`, and offers Switch provider / Sign out / Run setup again / Check it's healthy.
Then switch themes (paper, operator, glass, graphite) and confirm the sheet is legible in all four.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app.js src/renderer/paper.css src/renderer/theme-operator.css src/renderer/theme-glass.css src/renderer/theme-graphite.css src/main/main.js
git commit -m "feat: agent details sheet — identity, sign in/out, switch, setup, health"
```

---

### Task 7: The remove confirm

**Files:**
- Modify: `src/renderer/app.js` — `renderOverlay()` plus a new `openAgentRemove` / `renderAgentRemove`
- Modify: `src/renderer/paper.css`

**Interfaces:**
- Consumes: `api.agentRemovalPlan(id, binPath)`, `api.agentRemove(id, binPath)` (Task 4); `runAgentCommand` (Task 6).
- Produces: nothing downstream.

- [ ] **Step 1: Register the overlay type**

In `renderOverlay()`, after the `agent-setup` line:

```js
  if (o.type === 'agent-remove') return renderAgentRemove();
```

- [ ] **Step 2: Write the confirm**

```js
function openAgentRemove(agent) {
  S.overlay = { type: 'agent-remove', agent, plan: null, busy: false };
  renderOverlay();
  api.agentRemovalPlan(agent.id, agent.path).then((plan) => {
    if (S.overlay && S.overlay.type === 'agent-remove') { S.overlay.plan = plan; renderOverlay(); }
  });
}

function renderAgentRemove() {
  const o = S.overlay; const a = o.agent; const plan = o.plan;
  const body = !plan ? '<p class="setup-copy">Working out what this would delete…</p>'
    : plan.mode === 'none'
      ? `<p class="setup-copy">${esc(plan.reason)}</p>`
      : `<div class="warn-box">
           <div class="wb-head">This ${plan.mode === 'uninstall' ? 'runs' : 'deletes, on this Mac'}:</div>
           <ul>${plan.describe.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
         </div>
         <p class="setup-copy">Your projects and files are untouched. You can install ${esc(a.name)} again later,
           but you would sign in from scratch.</p>`;

  const modal = overlay('setup-box', `
    <div class="setup-head">${chipHtml({ key: iconKeyFor(a.id), code: code2(a.name), kind: 'agent' })}
      <span class="col"><span class="name">Remove ${esc(a.name)}?</span>
      <span class="desc">this cannot be undone</span></span></div>
    ${body}
    <div class="setup-actions">
      ${plan && plan.mode !== 'none' ? `<button class="btn btn--red" id="ar-go"${o.busy ? ' disabled' : ''}>${o.busy ? 'Removing…' : 'Yes, remove it'}</button>` : ''}
      <button class="btn" id="ar-keep">${plan && plan.mode === 'none' ? 'Close' : 'Keep it'}</button>
    </div>`);

  q('#ar-keep', modal).onclick = () => openAgentSheet(a);
  const go = q('#ar-go', modal);
  if (go) go.onclick = async () => {
    if (plan.mode === 'uninstall') return runAgentCommand(a, plan.command, `remove ${a.name}`);
    o.busy = true; renderOverlay();
    const res = await api.agentRemove(a.id, a.path);
    o.busy = false;
    if (res.ok) { closeOverlay(); refreshAgents(); toast(`${a.name} removed.`); }
    else { renderOverlay(); toast(res.error || `Could not remove ${a.name}.`); }
  };
}
```

- [ ] **Step 3: Style the warning box**

In `src/renderer/paper.css`:

```css
/* removal confirm — names the real paths before anything is touched */
.warn-box { background: var(--red-bg); border: 1px solid var(--red-line); padding: 11px 13px; margin-bottom: 13px; }
.warn-box .wb-head { font-size: 11.5px; font-weight: 700; color: var(--red-ink); margin-bottom: 7px; }
.warn-box ul { margin: 0; padding-left: 16px; font-size: 11.5px; color: var(--red-body); line-height: 1.65; }
.warn-box li { margin: 1px 0; }
```

Check the other three themes for `--red-bg` / `--red-line` / `--red-ink` / `--red-body`; if any theme lacks one, add it there rather than hardcoding a hex in this rule.

- [ ] **Step 4: Verify both removal modes without destroying anything**

Run: `npm start`, ⌘N, `›` on Claude Code, then **Remove from this Mac**.
Expected: the confirm names `~/.local/bin/claude` (or wherever yours lives) and says your settings, skills and history stay. **Click "Keep it".**

Then `›` on Hermes → **Remove from this Mac**.
Expected: it says it runs `hermes uninstall`, not a file list. **Click "Keep it".**

Do not confirm either removal — the point of this step is the copy and the branch, not deleting your tools.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`
Expected: PASS

```bash
git add src/renderer/app.js src/renderer/paper.css src/renderer/theme-operator.css src/renderer/theme-glass.css src/renderer/theme-graphite.css
git commit -m "feat: agent removal confirm that names what it deletes"
```

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-08-09-agent-cli-lifecycle-design.md`:

- Two readers (`statusCmd` / `statusFiles`) — Tasks 1 and 2.
- Lazy, per-agent, non-blocking status — Task 2 (`agentStatus`) and Task 5 (fired after paint).
- All eleven registry fields — Task 2, except `switchCmd` / `switchLabel`, which the spec implies for Hermes ("the button is labelled Switch provider and runs that CLI's own picker") but does not name. Added explicitly.
- Row identity + chevron + amber signed-out dot — Task 5.
- Sheet with conditional buttons, human copy, source label — Task 6.
- Remove confirm naming real paths — Task 7.
- Error degradation — Task 1 (`UNKNOWN`), Task 2 (catch-all), Task 5 (`statusLineFor` falls back to `a.sub`).
- Registry integrity test — Task 2, step 1.
- No keychain, no token values — Task 1 leak tests for Hermes, OpenCode and Codex.

**One deliberate change from the spec.** The spec says removal "deletes `removePaths`" and tests that they are "absolute and under `$HOME`". That is necessary but not sufficient: `~/.claude` is under `$HOME` and holds the user's own skills, agents and history, so a passing test would still authorise destroying their work. Task 3 narrows the rule — removal deletes the program and the agent's own auth file, never a directory that can hold user-authored content — and `claude` therefore ships `removePaths: []`. The spec should be amended to match.
