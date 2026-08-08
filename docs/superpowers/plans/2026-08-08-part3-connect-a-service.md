# Part 3 Connect a Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can plug Notion, Slack, Telegram, Creative models (kie-mcp), a folder, and (guided) Gmail or Google Drive into their agents by pasting one key, and the Library regroups into Agents / Skills / Services / Plugins; anything not in the catalog gets built by the user's own agent from a seeded session.

**Architecture:** Three new small main-process modules mirror Part 1's registry pattern: `services-catalog.js` (what can be connected, per-platform config shapes), `mcp-config.js` (read and merge-write the settings files agents already read, plus detect existing connections), and `mcp-check.js` (start a connector once over stdio JSON-RPC and count its tools so "connected" is proven). The renderer gains a Services section in a type-regrouped Library rail and a three-screen connect flow (catalog, one-key form, done with a folded receipt) built from the launcher's overlay idioms. The custom door seeds a session with whichever detected agent the user has.

**Tech Stack:** Electron main-process CJS modules with injectable IO for `node --test`; vanilla DOM renderer; no new dependencies.

## Global Constraints

- No em dashes anywhere: not in UI copy, code comments, docs, commit messages, or anything Calvin reads.
- Copy never assumes Claude (standing decision): UI text says "agent" / "a new session"; a specific agent is named only where technically true (which settings file is written for which platform).
- Do NOT touch `src/renderer/index.html`, assets, or header markup (logo session), and only ADD lines to `src/renderer/theme-operator.css` (theme session's uncommitted file; never commit it).
- Shared dirty tree: every commit to a file with peer diffs (`app.js`, `paper.css`, `main.js`, `preload.js`, `README.md`) uses the surgical index-staging pattern (base `git show :file`, python exact-string replaces applied identically to working tree and index blob, `git hash-object -w` + `git update-index --cacheinfo`). New files commit normally. `src/main/main.js` has a stray byte: grep it with `grep -a`; python scripts must read/write it as bytes or with `errors='surrogateescape'`.
- Dual themes: paper styles via tokens in `paper.css`; operator overrides only in `theme-operator.css` scoped `body[data-theme="operator"]`. Screenshot BOTH themes for any visual change (`--theme=paper` / `--theme=operator` flags on `npm run shot`'s command) and actually look at the images. TEMP-SHOT lines are reverted before staging.
- Verification: `npm test` (baseline 42 tests; this plan adds ~14, ending near 56), demo-shot boot check, ui-polisher review for visual work, and a final detached-worktree check (`git worktree add --detach /tmp/verify-p3 master`) proving committed master stands alone.
- Web-sourced facts below were checked 2026-08-08 but MUST be re-verified during Task 1 (fetch each package's README; confirm package name, env var, key page URL). Sources: github.com/makenotion/notion-mcp-server, npmjs.com/package/@slack/mcp-server, npmjs.com/package/@node2flow/telegram-bot-mcp, github.com/GongRzhe/Gmail-MCP-Server, github.com/mrdainami/kie-mcp.
- Honesty rule from Part 1: no card may dead-end. A service that cannot be one-paste (Google OAuth) is presented honestly as guided, never faked.
- Existing code style: `q()` helper, `esc()` for all interpolated HTML, single quotes, semicolons.

## File Structure

- Create `src/main/services-catalog.js`: the registry. Pure data + pure functions; no IO.
- Create `src/main/mcp-config.js`: read/merge-write config files; detect existing connections. All fs injectable.
- Create `src/main/mcp-check.js`: start-once stdio JSON-RPC probe. Spawn injectable.
- Create `tests/services-catalog.test.mjs`, `tests/mcp-config.test.mjs`, `tests/mcp-check.test.mjs`.
- Modify `src/main/main.js` (IPC handlers + seed typing for run kind), `src/main/preload.js` (API surface), `src/renderer/app.js` (Library regroup, Services section, connect sheets, custom handoff), `src/renderer/paper.css` (connect sheet styles), `src/renderer/theme-operator.css` (additive overrides), `README.md`, roadmap.

---

### Task 1: The service catalog (`services-catalog.js`)

Registry of connectable services. Each entry says what it is in plain words, how to get its key, and how to write its config for each platform. Re-verify every package/URL against its live README before locking the entry (WebFetch each repo; update values if they moved; note "verified 2026-08-08" in the header comment).

**Files:**
- Create: `src/main/services-catalog.js`
- Test: `tests/services-catalog.test.mjs`

**Interfaces:**
- Produces: `KNOWN_SERVICES` array. Each entry: `{ id, name, desc, code, kind, keys, keyHelpUrl, docs, claudeEntry(values), opencodeEntry(values) }` where `kind` is `'key' | 'folder' | 'guided' | 'install'`, `keys` is an array of `{ id, label, placeholder }` (empty for `folder`), `values` passed to the entry builders is `{ [keyId]: string, folder?: string, installDir?: string }`, `claudeEntry` returns the object to place under `mcpServers.<id>` in `.mcp.json`, and `opencodeEntry` returns the object to place under `mcp.<id>` in OpenCode config. Also `serviceById(id)`.
- Consumed by: Task 2 (writers take the entry objects), Task 4 (IPC exposes the registry), Task 6 (sheets render it).

- [ ] **Step 1: Write the failing test**

Create `tests/services-catalog.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { KNOWN_SERVICES, serviceById } = require('../src/main/services-catalog.js');

test('registry carries the launch set with everything the connect flow needs', () => {
  const ids = KNOWN_SERVICES.map((s) => s.id);
  for (const id of ['notion', 'slack', 'telegram', 'kie', 'folder', 'gmail', 'gdrive']) {
    assert.ok(ids.includes(id), `registry missing ${id}`);
  }
  for (const s of KNOWN_SERVICES) {
    for (const k of ['id', 'name', 'desc', 'code', 'kind', 'keys', 'docs']) assert.ok(s[k] !== undefined, `${s.id} missing ${k}`);
    assert.ok(['key', 'folder', 'guided', 'install'].includes(s.kind));
    assert.ok(/^https:\/\//.test(s.docs), `${s.id} docs must be https`);
    if (s.kind === 'key') { assert.ok(s.keys.length >= 1); assert.ok(/^https:\/\//.test(s.keyHelpUrl), `${s.id} needs a real key page`); }
    if (s.kind === 'folder') assert.equal(s.keys.length, 0);
  }
});

test('notion config entries carry the token into both platforms', () => {
  const s = serviceById('notion');
  const c = s.claudeEntry({ token: 'ntn_abc' });
  assert.deepEqual(c, { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_abc' } });
  const o = s.opencodeEntry({ token: 'ntn_abc' });
  assert.deepEqual(o, { type: 'local', command: ['npx', '-y', '@notionhq/notion-mcp-server'], environment: { NOTION_TOKEN: 'ntn_abc' }, enabled: true });
});

test('folder service points the reference filesystem server at the chosen folder', () => {
  const s = serviceById('folder');
  const c = s.claudeEntry({ folder: '/Users/x/Sites' });
  assert.deepEqual(c.args.slice(0, 2), ['-y', '@modelcontextprotocol/server-filesystem']);
  assert.ok(c.args.includes('/Users/x/Sites'));
});

test('kie (install kind) points config at the built server with the key in env', () => {
  const s = serviceById('kie');
  assert.equal(s.kind, 'install');
  const c = s.claudeEntry({ token: 'kie_1', installDir: '/Users/x/.nami/connectors/kie-mcp' });
  assert.equal(c.command, 'node');
  assert.ok(c.args[0].endsWith('dist/index.js'));
  assert.equal(c.env.KIE_API_KEY, 'kie_1');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`. Expected: the new file fails (module not found); existing 42 pass.

- [ ] **Step 3: Implement the registry**

Create `src/main/services-catalog.js` (values below re-verified against live READMEs in this step; adjust if a package moved and update the test to match reality, never the reverse):

```js
// What a Nami user can connect, and how each agent platform wants it written.
// Registry only: no IO here. Package names, env vars, and key pages verified
// against their READMEs 2026-08-08 (re-verify on change).
const KNOWN_SERVICES = [
  {
    id: 'notion', name: 'Notion', desc: 'your notes and docs', code: 'NO', kind: 'key',
    keys: [{ id: 'token', label: 'your Notion secret key', placeholder: 'ntn_...' }],
    keyHelpUrl: 'https://www.notion.so/profile/integrations',
    docs: 'https://github.com/makenotion/notion-mcp-server',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', '@notionhq/notion-mcp-server'], environment: { NOTION_TOKEN: v.token }, enabled: true }),
  },
  {
    id: 'slack', name: 'Slack', desc: 'your team chat', code: 'SL', kind: 'key',
    keys: [{ id: 'token', label: 'your Slack bot token', placeholder: 'xoxb-...' }],
    keyHelpUrl: 'https://api.slack.com/apps',
    docs: 'https://www.npmjs.com/package/@slack/mcp-server',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', '@slack/mcp-server'], env: { SLACK_BOT_TOKEN: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', '@slack/mcp-server'], environment: { SLACK_BOT_TOKEN: v.token }, enabled: true }),
  },
  {
    id: 'telegram', name: 'Telegram', desc: 'updates on your phone', code: 'TG', kind: 'key',
    keys: [{ id: 'token', label: 'your bot token (from @BotFather)', placeholder: '123456:ABC...' }],
    keyHelpUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    docs: 'https://github.com/node2flow-th/telegram-bot-mcp-community',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', '@node2flow/telegram-bot-mcp'], env: { TELEGRAM_BOT_TOKEN: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', '@node2flow/telegram-bot-mcp'], environment: { TELEGRAM_BOT_TOKEN: v.token }, enabled: true }),
  },
  {
    id: 'kie', name: 'Creative models', desc: 'make images, video, music', code: 'CM', kind: 'install',
    keys: [{ id: 'token', label: 'your KIE key', placeholder: 'kie_...' }],
    keyHelpUrl: 'https://kie.ai',
    docs: 'https://github.com/mrdainami/kie-mcp',
    repo: 'https://github.com/mrdainami/kie-mcp',
    claudeEntry: (v) => ({ command: 'node', args: [v.installDir + '/dist/index.js'], env: { KIE_API_KEY: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['node', v.installDir + '/dist/index.js'], environment: { KIE_API_KEY: v.token }, enabled: true }),
  },
  {
    id: 'folder', name: 'A folder', desc: 'read and edit one chosen folder', code: 'FS', kind: 'folder',
    keys: [],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', v.folder] }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', v.folder], enabled: true }),
  },
  {
    id: 'gmail', name: 'Gmail', desc: 'read and reply to email', code: 'GM', kind: 'guided',
    keys: [],
    docs: 'https://github.com/GongRzhe/Gmail-MCP-Server',
    guide: 'Google asks for a short sign-in setup (about 5 minutes). A session with your agent walks you through it and finishes the connection.',
    claudeEntry: () => ({ command: 'npx', args: ['@gongrzhe/server-gmail-autoauth-mcp'] }),
    opencodeEntry: () => ({ type: 'local', command: ['npx', '@gongrzhe/server-gmail-autoauth-mcp'], enabled: true }),
  },
  {
    id: 'gdrive', name: 'Google Drive', desc: 'your files', code: 'GD', kind: 'guided',
    keys: [],
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive',
    guide: 'Google asks for a short sign-in setup (about 5 minutes). A session with your agent walks you through it and finishes the connection.',
    claudeEntry: () => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-gdrive'] }),
    opencodeEntry: () => ({ type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-gdrive'], enabled: true }),
  },
];
function serviceById(id) { return KNOWN_SERVICES.find((s) => s.id === id) || null; }
module.exports = { KNOWN_SERVICES, serviceById };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`. Expected: 46/46.

- [ ] **Step 5: Commit (both files new, plain `git add` is safe)**

```bash
git add src/main/services-catalog.js tests/services-catalog.test.mjs
git commit -m "feat: service catalog registry, everyday apps plus kie-mcp"
```

---

### Task 2: Config read/write + detection (`mcp-config.js`)

Write the entry where each platform already looks; read what is already there so connected services show green however they got set up. Never clobber unknown keys.

Targets (verify paths against docs during implementation): Claude project scope `<project>/.mcp.json` under `mcpServers`; OpenCode project scope `<project>/opencode.json` under `mcp`; OpenCode user scope `~/.config/opencode/opencode.json` under `mcp`. Claude USER scope is `~/.claude.json`, which Claude Code itself owns; do not hand-edit it. For user-scope Claude writes, shell out to the detected `claude` binary: `claude mcp add-json --scope user <id> '<json>'` (and `claude mcp remove --scope user <id>`); if no claude binary is found, user-scope Claude is simply not offered.

**Files:**
- Create: `src/main/mcp-config.js`
- Test: `tests/mcp-config.test.mjs`

**Interfaces:**
- Consumes: entry objects from Task 1's `claudeEntry` / `opencodeEntry`.
- Produces:
  - `readJson(file, io)` → object or null (tolerates missing file and bad JSON).
  - `upsertMcpJson({ file, id, entry, io })` → writes `.mcp.json` with `mcpServers[id] = entry`, preserving everything else; creates the file if missing; returns `{ ok, file }`.
  - `upsertOpencode({ file, id, entry, io })` → same for OpenCode config under `mcp[id]`.
  - `removeService({ files, id, io })` → deletes `mcpServers[id]` / `mcp[id]` from each existing file in the list; returns the files actually changed.
  - `detectServices({ projectPath, home, io })` → array of `{ id, name, custom, scopes: string[], platforms: string[] }` merging what the config files contain with the catalog (unknown ids appear with `custom: true` and their own id as name).
  - `io` is `{ read(file), write(file, text), exists(file) }`; the default uses `fs` and is exported as `fsIo` so main.js passes nothing but tests pass fakes.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { upsertMcpJson, upsertOpencode, removeService, detectServices } = require('../src/main/mcp-config.js');

function memIo(seed = {}) {
  const files = { ...seed };
  return {
    read: (f) => { if (!(f in files)) throw new Error('ENOENT ' + f); return files[f]; },
    write: (f, t) => { files[f] = t; },
    exists: (f) => f in files,
    files,
  };
}

test('upsertMcpJson creates the file and preserves neighbors on second write', () => {
  const io = memIo();
  upsertMcpJson({ file: '/p/.mcp.json', id: 'notion', entry: { command: 'npx', args: ['x'] }, io });
  upsertMcpJson({ file: '/p/.mcp.json', id: 'slack', entry: { command: 'npx', args: ['y'] }, io });
  const out = JSON.parse(io.files['/p/.mcp.json']);
  assert.deepEqual(Object.keys(out.mcpServers).sort(), ['notion', 'slack']);
});

test('upsertMcpJson never clobbers unrelated keys or malformed-but-parseable extras', () => {
  const io = memIo({ '/p/.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'x' } }, somethingElse: 1 }) });
  upsertMcpJson({ file: '/p/.mcp.json', id: 'notion', entry: { command: 'npx' }, io });
  const out = JSON.parse(io.files['/p/.mcp.json']);
  assert.equal(out.somethingElse, 1);
  assert.ok(out.mcpServers.db);
});

test('opencode entries land under mcp and removal cleans both shapes', () => {
  const io = memIo();
  upsertOpencode({ file: '/p/opencode.json', id: 'notion', entry: { type: 'local', command: ['x'] }, io });
  assert.ok(JSON.parse(io.files['/p/opencode.json']).mcp.notion);
  const changed = removeService({ files: ['/p/.mcp.json', '/p/opencode.json'], id: 'notion', io });
  assert.deepEqual(changed, ['/p/opencode.json']);
  assert.equal(JSON.parse(io.files['/p/opencode.json']).mcp.notion, undefined);
});

test('detectServices merges catalog names, flags strangers as custom, reports scope and platform', () => {
  const io = memIo({
    '/proj/.mcp.json': JSON.stringify({ mcpServers: { notion: { command: 'npx' }, wiki: { command: 'node' } } }),
    '/home/u/.config/opencode/opencode.json': JSON.stringify({ mcp: { notion: { type: 'local' } } }),
  });
  const out = detectServices({ projectPath: '/proj', home: '/home/u', io });
  const notion = out.find((s) => s.id === 'notion');
  assert.equal(notion.name, 'Notion');
  assert.equal(notion.custom, false);
  assert.ok(notion.scopes.includes('project') && notion.scopes.includes('user'));
  assert.ok(notion.platforms.includes('claude') && notion.platforms.includes('opencode'));
  const wiki = out.find((s) => s.id === 'wiki');
  assert.equal(wiki.custom, true);
});
```

- [ ] **Step 2: Run to verify failure** (`npm test`, new file fails, 46 old pass)

- [ ] **Step 3: Implement**

Create `src/main/mcp-config.js`:

```js
// Read and merge-write the MCP settings files each platform already reads.
// All IO goes through an injectable io so tests never touch the disk.
const fs = require('fs');
const path = require('path');
const { serviceById } = require('./services-catalog');

const fsIo = {
  read: (f) => fs.readFileSync(f, 'utf8'),
  write: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); },
  exists: (f) => fs.existsSync(f),
};

function readJson(file, io) {
  if (!io.exists(file)) return null;
  try { return JSON.parse(io.read(file)); } catch (_) { return null; }
}
function writeJson(file, obj, io) { io.write(file, JSON.stringify(obj, null, 2) + '\n'); }

function upsertMcpJson({ file, id, entry, io = fsIo }) {
  const doc = readJson(file, io) || {};
  doc.mcpServers = doc.mcpServers || {};
  doc.mcpServers[id] = entry;
  writeJson(file, doc, io);
  return { ok: true, file };
}
function upsertOpencode({ file, id, entry, io = fsIo }) {
  const doc = readJson(file, io) || { $schema: 'https://opencode.ai/config.json' };
  doc.mcp = doc.mcp || {};
  doc.mcp[id] = entry;
  writeJson(file, doc, io);
  return { ok: true, file };
}
function removeService({ files, id, io = fsIo }) {
  const changed = [];
  for (const file of files) {
    const doc = readJson(file, io);
    if (!doc) continue;
    let hit = false;
    if (doc.mcpServers && doc.mcpServers[id]) { delete doc.mcpServers[id]; hit = true; }
    if (doc.mcp && doc.mcp[id]) { delete doc.mcp[id]; hit = true; }
    if (hit) { writeJson(file, doc, io); changed.push(file); }
  }
  return changed;
}

// Every place a connection can already live: [file, scope, platform, section]
function knownFiles(projectPath, home) {
  const out = [];
  if (projectPath) {
    out.push([path.join(projectPath, '.mcp.json'), 'project', 'claude', 'mcpServers']);
    out.push([path.join(projectPath, 'opencode.json'), 'project', 'opencode', 'mcp']);
  }
  if (home) {
    out.push([path.join(home, '.claude.json'), 'user', 'claude', 'mcpServers']);
    out.push([path.join(home, '.config', 'opencode', 'opencode.json'), 'user', 'opencode', 'mcp']);
  }
  return out;
}
function detectServices({ projectPath, home, io = fsIo }) {
  const found = new Map();
  for (const [file, scope, platform, section] of knownFiles(projectPath, home)) {
    const doc = readJson(file, io);
    const entries = doc && doc[section];
    if (!entries) continue;
    for (const id of Object.keys(entries)) {
      if (!found.has(id)) {
        const cat = serviceById(id);
        found.set(id, { id, name: cat ? cat.name : id, custom: !cat, scopes: [], platforms: [], files: [] });
      }
      const rec = found.get(id);
      if (!rec.scopes.includes(scope)) rec.scopes.push(scope);
      if (!rec.platforms.includes(platform)) rec.platforms.push(platform);
      rec.files.push(file);
    }
  }
  return [...found.values()];
}

module.exports = { fsIo, readJson, upsertMcpJson, upsertOpencode, removeService, detectServices, knownFiles };
```

- [ ] **Step 4: Run to verify pass** (`npm test`: 50/50)

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-config.js tests/mcp-config.test.mjs
git commit -m "feat: mcp config writers, readers, and connection detection"
```

---

### Task 3: The start-once check (`mcp-check.js`)

Proof over promise: after writing config, start the connector once over stdio, do the MCP handshake, count its tools, kill it. Feeds the "tested just now: Notion answers · 19 tools ready" line.

**Files:**
- Create: `src/main/mcp-check.js`
- Test: `tests/mcp-check.test.mjs`

**Interfaces:**
- Produces: `checkServer({ command, args, env, spawnFn, timeoutMs = 15000 })` → Promise of `{ ok: true, tools: number }` or `{ ok: false, error: string }`. `spawnFn` defaults to `child_process.spawn`; tests inject a fake child (`EventEmitter` with `stdin.write`, `stdout` emitter, `kill()`). The wire format is JSON-RPC 2.0, one message per line is NOT guaranteed by MCP (it uses LSP-style or newline framing depending on server); use newline-delimited JSON which the reference servers speak on stdio, and treat any parse miss as noise to skip.
- Consumed by: Task 4's `services:connect` IPC.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-check.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkServer } = require('../src/main/mcp-check.js');

function fakeChild(script) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin = { write: (line) => { const msg = JSON.parse(line); const reply = script(msg); if (reply) setImmediate(() => child.stdout.emit('data', Buffer.from(JSON.stringify(reply) + '\n'))); } };
  return child;
}

test('handshake then tools/list yields the tool count and kills the child', async () => {
  const child = fakeChild((msg) => {
    if (msg.method === 'initialize') return { jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } };
    if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } };
    return null;
  });
  const out = await checkServer({ command: 'npx', args: ['x'], spawnFn: () => child });
  assert.deepEqual(out, { ok: true, tools: 3 });
  assert.ok(child.killed);
});

test('a server that never answers resolves ok:false at the timeout, not a hang', async () => {
  const child = fakeChild(() => null);
  const out = await checkServer({ command: 'npx', args: ['x'], spawnFn: () => child, timeoutMs: 50 });
  assert.equal(out.ok, false);
  assert.ok(child.killed);
});

test('spawn failure surfaces as a friendly error', async () => {
  const out = await checkServer({ command: 'nope', args: [], spawnFn: () => { throw new Error('ENOENT'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /ENOENT|could not start/i);
});
```

- [ ] **Step 2: Run to verify failure** (`npm test`)

- [ ] **Step 3: Implement**

Create `src/main/mcp-check.js`:

```js
// Start an MCP server once over stdio, shake hands, count tools, kill it.
// "Connected" in the UI is this function saying so, never an assumption.
const { spawn } = require('child_process');

function checkServer({ command, args = [], env = {}, spawnFn = spawn, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: 'could not start: ' + e.message });
      return;
    }
    let buf = '', done = false, id = 0;
    const finish = (out) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch (_) {} resolve(out); };
    const timer = setTimeout(() => finish({ ok: false, error: 'no answer within ' + Math.round(timeoutMs / 1000) + 's' }), timeoutMs);
    const send = (method, params) => { id += 1; try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); } catch (_) {} return id; };
    let initId = null, listId = null;
    child.on('error', (e) => finish({ ok: false, error: 'could not start: ' + e.message }));
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.id === initId) {
          try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } catch (_) {}
          listId = send('tools/list', {});
        } else if (msg.id === listId) {
          const tools = msg.result && Array.isArray(msg.result.tools) ? msg.result.tools.length : 0;
          finish({ ok: true, tools });
        }
      }
    });
    initId = send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nami', version: '1.0' } });
  });
}
module.exports = { checkServer };
```

- [ ] **Step 4: Run to verify pass** (`npm test`: 53/53)

- [ ] **Step 5: Commit**

```bash
git add src/main/mcp-check.js tests/mcp-check.test.mjs
git commit -m "feat: start-once MCP check proves a connection before the UI says so"
```

---

### Task 4: IPC + preload + seed typing for every agent

**Files:**
- Modify: `src/main/main.js` (requires at top near `agents-detect`; handlers after the `agents:detect` handler; the seed block in `term:create` around line 401, found with `grep -an "kind === 'claude' && seed" src/main/main.js`)
- Modify: `src/main/preload.js` (after `detectAgents`)

Reminder: `main.js` has a stray byte. Use `grep -a`, and if staging with python use `open(..., encoding='utf8', errors='surrogateescape')`.

**Interfaces:**
- Produces (renderer-visible via `window.dainami`):
  - `listServices({ projectPath })` → `{ catalog: KNOWN_SERVICES-without-functions, connected: detectServices() }` (strip the entry-builder functions before sending: map each catalog item to `{ id, name, desc, code, kind, keys, keyHelpUrl, docs, guide }`).
  - `connectService({ id, values, scope, platforms, projectPath })` → runs the writers for each ticked platform at the chosen scope, then `checkServer` on the claude-shaped entry (`entry.command/args/env`), returns `{ ok, tools, files, error }`.
  - `disconnectService({ id, projectPath })` → `removeService` over `knownFiles`, returns `{ changed }`.
- Seed typing: `term:create` currently types `seed` only when `kind === 'claude'`. Change the condition to type for run kind too, with a longer delay (run agents draw their TUI slower). This powers the custom handoff for non-Claude agents.

- [ ] **Step 1: main.js requires**

After the `agents-detect` require line add:

```js
const { KNOWN_SERVICES } = require('./services-catalog');
const { serviceById } = require('./services-catalog');
const { fsIo, upsertMcpJson, upsertOpencode, removeService, detectServices, knownFiles } = require('./mcp-config');
const { checkServer } = require('./mcp-check');
```

(Combine the two catalog requires into one line in practice.)

- [ ] **Step 2: main.js handlers**

After the `agents:detect` handler add:

```js
const os = require('os'); // only if not already required; check first with grep -a "require('os')"
function catalogForRenderer() {
  return KNOWN_SERVICES.map((s) => ({ id: s.id, name: s.name, desc: s.desc, code: s.code, kind: s.kind, keys: s.keys, keyHelpUrl: s.keyHelpUrl, docs: s.docs, guide: s.guide }));
}
ipcMain.handle('services:list', (_e, { projectPath } = {}) => ({
  catalog: catalogForRenderer(),
  connected: detectServices({ projectPath, home: os.homedir() }),
}));
ipcMain.handle('services:connect', async (_e, { id, values, scope, platforms, projectPath }) => {
  const s = serviceById(id);
  if (!s) return { ok: false, error: 'unknown service' };
  const files = [];
  try {
    if (platforms.includes('claude')) {
      const entry = s.claudeEntry(values);
      if (scope === 'project' && projectPath) { upsertMcpJson({ file: require('path').join(projectPath, '.mcp.json'), id, entry }); files.push('.mcp.json'); }
      // user-scope claude goes through the claude CLI; find it like agents-detect does and run
      // `claude mcp add-json --scope user <id> '<json>'`; skip silently if claude is absent.
    }
    if (platforms.includes('opencode')) {
      const entry = s.opencodeEntry(values);
      const file = scope === 'project' && projectPath
        ? require('path').join(projectPath, 'opencode.json')
        : require('path').join(os.homedir(), '.config', 'opencode', 'opencode.json');
      upsertOpencode({ file, id, entry }); files.push(file.includes('.config') ? 'opencode config' : 'opencode.json');
    }
    const probe = s.claudeEntry(values);
    const check = await checkServer({ command: probe.command, args: probe.args, env: probe.env || {} });
    return { ok: true, files, tools: check.ok ? check.tools : 0, checked: check.ok, checkError: check.ok ? null : check.error };
  } catch (e) { return { ok: false, error: e.message, files }; }
});
ipcMain.handle('services:disconnect', (_e, { id, projectPath }) => {
  const files = knownFiles(projectPath, os.homedir()).map(([f]) => f);
  return { changed: removeService({ files, id }) };
});
```

Implement the user-scope claude branch for real (not the comment): reuse the same `execFile('/bin/zsh', ['-lc', ...])` helper style as `agents-detect.js`, running `claude mcp add-json --scope user ${id} ${JSON.stringify(JSON.stringify(entry))}`; on any error include `claudeUserScope: 'skipped: ' + message` in the return instead of failing the whole connect.

- [ ] **Step 3: seed typing for run kind**

In `term:create`, find the block `if (kind === 'claude' && seed) { ... }` and change it to type for both kinds, keeping the existing claude delay and using 2500ms for run:

```js
if (seed && (kind === 'claude' || kind === 'run')) {
  const delay = kind === 'claude' ? /* keep existing value */ : 2500;
  setTimeout(() => { try { p.write(seed); } catch (_) {} }, delay);
}
```

Read the current block first (`grep -a -n -A 4 "kind === 'claude' && seed" src/main/main.js`) and preserve whatever the existing claude delay expression is. Also inspect the odd `' SEED '` placeholder near line 374 and leave it untouched unless it is dead code in the same block you are editing.

- [ ] **Step 4: preload.js**

After `detectAgents:` add:

```js
  listServices: (args) => ipcRenderer.invoke('services:list', args),
  connectService: (args) => ipcRenderer.invoke('services:connect', args),
  disconnectService: (args) => ipcRenderer.invoke('services:disconnect', args),
```

- [ ] **Step 5: Verify + commit (surgical staging: both files carry peer diffs)**

`node --check` is unusable on main.js (stray byte); instead run `npm test` plus a demo-shot boot (`npx electron . --demo --screenshot shots/boot-check.png`) and confirm the image renders. Stage with a `stage-p3-task4.py` following the established pattern (bytes-safe for main.js), verify `git diff --cached` contains only these hunks, then:

```bash
git commit -m "feat: services IPC, connect and check wiring, seeds type into any agent"
```

---

### Task 5: Library regrouped by type + Services section (renderer)

**Files:**
- Modify: `src/renderer/app.js`: `LIB_GROUPS`/`refreshLibraryRail` region (find with `grep -n "LIB_GROUPS" src/renderer/app.js`), state `S`, boot.
- Modify: `src/renderer/paper.css`: after the `.lib-*` rules (find `.lib-group`).

**Interfaces:**
- Consumes: `api.listServices` from Task 4.
- Produces: `S.services = { catalog: [], connected: [] }`, `refreshServices()` (guards a loading flag, re-renders the library rail when done, called from `boot` alongside `refreshAgents()` and from `applyProject`), and `openConnect()` stub that Task 6 fills (for this task it may `toast('coming right up')`; replaced in Task 6 before any commit message claims the flow works).
- The rail's new order: `agents`, `skills` (agent/skill/command types together, commands keep their CM chip), `services`, `plugins · read-only`. Scope shows as a `.scope-tag` on each row ("this project" / "your Mac"); plugin rows keep no tag (the group name says it).

- [ ] **Step 1: State + fetch**

In `S` add `services: { catalog: [], connected: [], loading: false },`. Add:

```js
async function refreshServices() {
  if (S.services.loading) return;
  S.services.loading = true;
  try {
    const res = await api.listServices({ projectPath: S.project && S.project.path });
    S.services.catalog = res.catalog || []; S.services.connected = res.connected || [];
  } catch (_) {}
  S.services.loading = false;
  if (S.railTab === 'library') refreshRail();
}
```

Call `refreshServices();` in `boot` next to `refreshAgents();` and at the end of `applyProject`.

- [ ] **Step 2: Regroup the rail**

Replace `LIB_GROUPS` and the group loop inside `refreshLibraryRail` with type-based groups. The items list still comes from `S.library.items`; plugins are `scope === 'plugin'`; everything else groups by `type` (`agent` → agents; `skill` and `command` → skills). Scope tag text: `i.scope === 'project' ? 'this project' : 'your Mac'`. Services rows come from `S.services.connected` (green `●` + platform list) and the group ends with a `+ connect a service` row invoking `openConnect()`. The Library head keeps `＋ new` and gains `· ＋ connect`. Keep the existing filter box working across all groups (services match on `id + name`).

Row template for a connected service (mirrors `agent-row`):

```js
const row = document.createElement('div'); row.className = 'agent-row';
row.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(sv.id)]}">${esc((catEntry && catEntry.code) || 'SV')}</span>
  <span class="col"><span class="name">${esc(sv.name)}</span>
  <span class="tools"><span class="ok">●</span> connected · ${esc(sv.platforms.join(' + '))}</span></span>
  <span class="scope-tag">${sv.scopes.includes('project') ? 'this project' : 'your Mac'}</span>`;
row.onclick = () => openServiceDetails(sv);
```

(`openServiceDetails` arrives in Task 6; for this task point it at `openConnect()`.)

- [ ] **Step 3: CSS**

After the `.lib-group` rules in `paper.css` add:

```css
.scope-tag { margin-left: auto; flex: none; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-2); border: 1px dashed var(--dash); padding: 2px 6px; border-radius: 2px; white-space: nowrap; }
.agent-row .tools .ok { color: var(--green-ok); }
```

- [ ] **Step 4: Verify visually**

TEMP-SHOT: in the demo seed, set `S.services.connected = [{ id: 'notion', name: 'Notion', custom: false, scopes: ['project'], platforms: ['claude', 'opencode'] }]` and `S.railTab = 'library'` plus a seeded `S.library.items`; `npm run shot` both themes; LOOK: four groups in order, scope tags legible, service row green. Revert temp lines.

- [ ] **Step 5: Test + commit (surgical staging for app.js and paper.css)**

`npm test` (still 53), boot shot, stage only these hunks, then:

```bash
git commit -m "feat: library reads like an inventory, agents skills services plugins"
```

---

### Task 6: The connect flow (catalog sheet, one-key form, done screen)

Three overlays in the launcher's idiom. Copy comes from the approved v3 mockup verbatim (no em dashes, agent-agnostic).

**Files:**
- Modify: `src/renderer/app.js` (new functions near `renderAgentSetup`; branches in `renderOverlay`)
- Modify: `src/renderer/paper.css` (styles after the `.setup-note` / peek block)
- Modify: `src/renderer/theme-operator.css` (ADDITIVE overrides only)

**Interfaces:**
- Consumes: `S.services`, `api.connectService`, `api.disconnectService`, `api.openUrl`, `startPanel`, `overlay()` helper, Task 5's `refreshServices`.
- Produces: `openConnect()` → `S.overlay = { type: 'connect' }`; `renderConnectCatalog()`; `openConnectForm(svc)` → `{ type: 'connect-form', svc, scope: 'project', platforms: ['claude', 'opencode'] }`; `renderConnectForm()`; `renderConnectDone()` for `{ type: 'connect-done', svc, result }`; `openServiceDetails(sv)` → done-style sheet with a Disconnect button; `renderOverlay` gains the three branches.

- [ ] **Step 1: Catalog sheet**

```js
function openConnect() { S.overlay = { type: 'connect' }; renderOverlay(); refreshServices(); }
function renderConnectCatalog() {
  const cat = S.services.catalog;
  const connectedIds = new Set(S.services.connected.map((s) => s.id));
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">⚡</span>
    <span style="font-weight:700">What should your agents reach?</span>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)">pick one to start</span></div>
    <div class="svc-grid">${cat.map((s) => `
      <div class="svc-card${connectedIds.has(s.id) ? ' connected' : ''}" data-id="${esc(s.id)}" tabindex="0">
        <span class="code" style="background:${TINTS[hashIdx(s.id)]}">${esc(s.code)}</span>
        <span class="sv-name">${esc(s.name)}</span>
        <span class="sv-desc">${esc(s.desc)}</span>
        ${s.id === 'kie' ? '<span class="sv-by">by Dainami</span>' : ''}
        <span class="sv-go">${connectedIds.has(s.id) ? '<span class="ok">●</span> connected' : 'connect →'}</span>
      </div>`).join('')}</div>
    <div class="svc-custom" id="svc-custom" tabindex="0">
      <span class="code" style="background:${TINTS[1]}">✳</span>
      <span class="col"><span class="sv-name">Something else? It gets built for you</span>
      <span class="sv-desc">say it in plain words, watch it happen</span></span>
      <span class="sv-go">build it →</span>
    </div>`);
  modal.querySelectorAll('.svc-card').forEach((el) => {
    el.onclick = () => {
      const svc = cat.find((s) => s.id === el.dataset.id);
      const already = S.services.connected.find((s) => s.id === svc.id);
      if (already) return openServiceDetails(already);
      openConnectForm(svc);
    };
  });
  q('#svc-custom', modal).onclick = () => openConnectCustom();
}
```

- [ ] **Step 2: One-key form (folder and guided kinds branch here too)**

```js
function openConnectForm(svc) { S.overlay = { type: 'connect-form', svc, scope: 'project', platforms: ['claude', 'opencode'], values: {} }; renderOverlay(); }
function renderConnectForm() {
  const o = S.overlay, svc = o.svc;
  const keyRows = svc.keys.map((k) => `
    <input class="text-input sv-key" data-k="${esc(k.id)}" placeholder="${esc(k.placeholder)}" spellcheck="false" />
    ${svc.keyHelpUrl ? `<div class="sv-help" data-url="${esc(svc.keyHelpUrl)}">where do I find my key?</div>` : ''}`).join('');
  const guided = svc.kind === 'guided';
  const folder = svc.kind === 'folder';
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[hashIdx(svc.id)]}">${esc(svc.code)}</span>
      <span><span class="name">Connect ${esc(svc.name)}</span><span class="desc">${esc(svc.desc)}</span></span></div>
    ${guided
      ? `<p class="setup-copy">${esc(svc.guide)}</p>`
      : folder
        ? `<p class="setup-copy">Pick the one folder your agents may read and edit. Nothing outside it is reachable.</p><button class="btn" id="sv-pick-folder">Choose a folder…</button><div class="setup-note" id="sv-folder-note"></div>`
        : `<p class="setup-copy">${esc(svc.name)} gives you one key so your agents can get in. Paste it here. It stays on your Mac.</p>${keyRows}`}
    <details class="sv-fold"><summary>choices (fine as they are)</summary>
      <div class="sv-fold-body">
        <div class="sv-lab">works in</div>
        <div class="chip-row" id="sv-scope">
          <span class="pick-chip picked" data-v="project">this project</span>
          <span class="pick-chip" data-v="user">everywhere on this Mac</span></div>
        <div class="sv-lab">for</div>
        <div class="chip-row" id="sv-plat">
          <span class="pick-chip picked" data-v="claude">Claude Code</span>
          <span class="pick-chip picked" data-v="opencode">OpenCode</span></div>
      </div></details>
    <div class="setup-actions">
      <button class="btn btn--go" id="sv-connect">${guided ? 'Set it up with my agent' : 'Connect'}</button>
      <button class="btn" id="sv-docs">Guide</button></div>`);
  modal.querySelectorAll('.sv-help').forEach((el) => { el.onclick = () => api.openUrl(el.dataset.url); });
  q('#sv-docs', modal).onclick = () => api.openUrl(svc.docs);
  q('#sv-scope', modal).querySelectorAll('.pick-chip').forEach((c) => { c.onclick = () => { o.scope = c.dataset.v; renderOverlay(); }; });
  q('#sv-plat', modal).querySelectorAll('.pick-chip').forEach((c) => {
    c.onclick = () => { const v = c.dataset.v; o.platforms = o.platforms.includes(v) ? o.platforms.filter((x) => x !== v) : [...o.platforms, v]; renderOverlay(); };
  });
  const pickBtn = q('#sv-pick-folder', modal);
  if (pickBtn) pickBtn.onclick = async () => { const info = await api.pickFolder(); if (info) { o.values.folder = info.path; q('#sv-folder-note', modal).textContent = info.pathShort; } };
  q('#sv-connect', modal).onclick = async () => {
    if (guided) return startGuidedSetup(svc);
    modal.querySelectorAll('.sv-key').forEach((inp) => { o.values[inp.dataset.k] = inp.value.trim(); });
    if (svc.keys.some((k) => !o.values[k.id]) || (svc.kind === 'folder' && !o.values.folder)) { toast(svc.kind === 'folder' ? 'Choose a folder first.' : 'Paste your key first.'); return; }
    q('#sv-connect', modal).textContent = 'Connecting…';
    const res = await api.connectService({ id: svc.id, values: o.values, scope: o.scope, platforms: o.platforms, projectPath: S.project && S.project.path });
    refreshServices(); loadLibrary(true);
    S.overlay = { type: 'connect-done', svc, result: res }; renderOverlay();
  };
}
```

Re-render note: the chips call `renderOverlay()` which rebuilds the sheet; key input values live in the DOM, so read them into `o.values` inside every chip handler BEFORE re-rendering, and seed inputs from `o.values` on render (`inp.value = o.values[inp.dataset.k] || ''`). Write it that way, not as shown above; this is the one fiddly bit.

- [ ] **Step 3: Done screen + details/disconnect**

```js
function renderConnectDone() {
  const { svc, result } = S.overlay;
  const okLine = result.ok
    ? (result.checked ? `tested just now: ${esc(svc.name)} answers · ${result.tools} tools ready` : `written, but the test could not confirm it yet (${esc(result.checkError || 'no answer')})`)
    : `something went wrong: ${esc(result.error || 'unknown')}`;
  const modal = overlay('setup-box', `
    <div class="sv-bigok"><div class="sv-bigok-t caveat">${esc(svc.name)} is connected!</div>
      <div class="sv-bigok-s">your agents can use it from the very next session</div></div>
    <div class="sv-okline"><span class="ok">●</span> ${okLine}</div>
    <details class="sv-fold"><summary>curious what got written? peek here</summary>
      <div class="sv-fold-body"><div class="setup-note">${(result.files || []).map(esc).join(' · ') || 'nothing yet'}</div></div></details>
    <div class="setup-actions">
      <button class="btn btn--go" id="sv-done">Done</button>
      <button class="btn" id="sv-more">Connect another</button></div>`);
  q('#sv-done', modal).onclick = closeOverlay;
  q('#sv-more', modal).onclick = openConnect;
}
function openServiceDetails(sv) {
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[hashIdx(sv.id)]}">SV</span>
      <span><span class="name">${esc(sv.name)}</span>
      <span class="desc"><span class="ok">●</span> connected · ${esc(sv.platforms.join(' + '))} · ${esc(sv.scopes.map((s) => s === 'project' ? 'this project' : 'your Mac').join(', '))}</span></span></div>
    <div class="setup-actions">
      <button class="btn" id="sv-disc">Disconnect</button>
      <button class="btn btn--go" id="sv-ok">Done</button></div>`);
  q('#sv-ok', modal).onclick = closeOverlay;
  q('#sv-disc', modal).onclick = async () => {
    await api.disconnectService({ id: sv.id, projectPath: S.project && S.project.path });
    refreshServices(); closeOverlay(); toast(sv.name + ' disconnected.');
  };
}
```

`renderOverlay` gains:

```js
  if (o.type === 'connect') return renderConnectCatalog();
  if (o.type === 'connect-form') return renderConnectForm();
  if (o.type === 'connect-done') return renderConnectDone();
```

- [ ] **Step 4: CSS (paper + additive operator)**

`paper.css` after the peek block:

```css
/* connect a service */
.svc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 10px 12px; }
.svc-card { border: 1px dashed var(--dash); background: var(--paper); border-radius: 2px; padding: 9px 10px;
  cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.svc-card:hover, .svc-card:focus-visible { border-style: solid; box-shadow: 2px 2px 0 var(--shadow-mid); outline: none; }
.svc-card .code { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; border: 1px solid rgba(60, 45, 25, 0.3); margin-bottom: 2px; }
.svc-card .sv-name { font-weight: 700; font-size: 12px; }
.svc-card .sv-desc { font-size: 10.5px; color: var(--muted); }
.svc-card .sv-by { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--green-ok); }
.svc-card .sv-go { font-size: 10.5px; color: var(--amber-ink); margin-top: 2px; }
.svc-card.connected .sv-go { color: var(--green-ok); }
.svc-custom { display: flex; gap: 11px; align-items: center; margin: 0 12px 12px; padding: 10px 12px;
  border: 1px dashed var(--dash); background: var(--paper); border-radius: 2px; cursor: pointer; }
.svc-custom:hover, .svc-custom:focus-visible { border-style: solid; box-shadow: 2px 2px 0 var(--shadow-mid); outline: none; }
.svc-custom .sv-go { margin-left: auto; font-size: 11px; color: var(--amber-ink); white-space: nowrap; }
.sv-help { font-size: 11px; color: var(--amber-ink); margin: 4px 0 10px; cursor: pointer; }
.sv-fold { border: 1px dashed var(--dash); background: var(--paper-2); border-radius: 2px; margin: 12px 0; }
.sv-fold summary { cursor: pointer; padding: 8px 11px; font-size: 11.5px; color: var(--muted); list-style: none; }
.sv-fold summary::before { content: '▸ '; color: var(--amber-ink); }
.sv-fold[open] summary::before { content: '▾ '; }
.sv-fold-body { padding: 4px 11px 11px; border-top: 1px dashed var(--dash); }
.sv-lab { font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 8px 0 5px; }
.sv-bigok { text-align: center; padding: 6px 0 2px; }
.sv-bigok-t { font-size: 30px; font-weight: 700; color: var(--green-ok); }
.sv-bigok-s { font-size: 12px; color: var(--muted); margin-top: 2px; }
.sv-okline { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; margin: 10px 0 4px; }
.sv-okline .ok { color: var(--green-ok); }
```

`theme-operator.css` additive: add `.svc-card .code` to the dark chip `!important` group; add `.svc-card, .svc-custom, .sv-fold` to the 6px-radius line and the hover-flatten line; add a `body[data-theme="operator"] .sv-bigok-t { font-family: 'Courier Prime', 'Courier New', monospace; letter-spacing: 0.1em; text-transform: uppercase; font-size: 18px; }` line beside the other Caveat remaps.

- [ ] **Step 5: Verify, screenshot, commit**

`npm test`; TEMP-SHOT each sheet (catalog, form, done) in both themes with seeded `S.services`; LOOK at all six images; revert temp lines; surgical staging; commit:

```bash
git commit -m "feat: connect a service, one key and a folded receipt"
```

---

### Task 7: Built for you (custom connector by whichever agent) + kie install flow

**Files:**
- Modify: `src/renderer/app.js` (two functions near the Task 6 block)

**Interfaces:**
- Consumes: `S.agents` (Part 1 detection), `startPanel`, `overlay()`, `serviceById`-shaped catalog rows in `S.services.catalog`.
- Produces: `openConnectCustom()` + `renderConnectCustom()` (overlay type `connect-custom`), `startGuidedSetup(svc)` (used by Task 6's guided kind), and the kie `install` kind path inside `openConnectForm`'s connect handler.

- [ ] **Step 1: Picking the worker agent, never assuming Claude**

```js
function bestAgent() {
  const ready = (S.agents || []).filter((a) => a.found);
  return ready[0] || null; // registry order: claude, codex, opencode, gemini, hermes, kimi
}
```

- [ ] **Step 2: Custom sheet + handoff**

```js
function openConnectCustom() { S.overlay = { type: 'connect-custom', text: '' }; renderOverlay(); }
function renderConnectCustom() {
  const o = S.overlay;
  const worker = bestAgent();
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[1]}">✳</span>
      <span><span class="name">Built for you</span><span class="desc">describe it like you would to a person</span></span></div>
    <input class="text-input" id="svc-desc" placeholder="our internal wiki at wiki.acme.dev, read-only is fine" spellcheck="false" />
    <div class="setup-actions" style="margin-top:12px"><button class="btn btn--go" id="svc-go" ${worker ? '' : 'disabled'}>Go</button></div>
    <p class="setup-note">${worker
      ? `A new session opens with the job written out, using ${esc(worker.name)}. Watch it work, talk to it if you want.`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</p>`);
  const input = q('#svc-desc', modal); input.value = o.text; input.focus();
  input.oninput = () => { o.text = input.value; };
  q('#svc-go', modal).onclick = () => {
    if (!o.text.trim() || !worker) return;
    closeOverlay();
    startPanel({ kind: worker.kind === 'claude' ? 'claude' : 'run', command: worker.kind === 'claude' ? undefined : worker.bin,
      title: 'build: connector', code: 'BC', seed:
      `Build an MCP connector for this: ${o.text.trim()}. When it works, register it for this project by adding it to .mcp.json (and opencode.json if OpenCode is installed), then tell me what tools it exposes.\r` });
    toast('Your agent is on it. The service appears under Library when it lands.');
  };
}
function startGuidedSetup(svc) {
  const worker = bestAgent();
  if (!worker) { toast('No agent is installed yet. Press ⌘N to add one first.'); return; }
  closeOverlay();
  startPanel({ kind: worker.kind === 'claude' ? 'claude' : 'run', command: worker.kind === 'claude' ? undefined : worker.bin,
    title: 'set up ' + svc.name, code: svc.code, seed:
    `Walk me through connecting ${svc.name} step by step (${svc.docs}). Do every step you can yourself, ask me only when a browser sign-in needs me, and when it works register it for this project.\r` });
  toast('Your agent will walk you through it, right in the tile.');
}
```

- [ ] **Step 3: kie install kind**

In `openConnectForm`'s connect handler, before calling `api.connectService`, branch on `svc.kind === 'install'`: start a run tile `startPanel({ kind: 'run', title: 'install Creative models', code: 'CM', command: 'git clone https://github.com/mrdainami/kie-mcp ~/.nami/connectors/kie-mcp && cd ~/.nami/connectors/kie-mcp && npm install && npm run build' })`, set `o.values.installDir = '~/.nami/connectors/kie-mcp'` expanded via a small IPC or by having main.js expand `~` in `services:connect` (add `values.installDir = values.installDir.replace(/^~/, os.homedir())` there), then continue to `api.connectService` with a toast 'Connecting once the install finishes takes one more click here.' Keep it two explicit clicks (install, then Connect) rather than pretending to orchestrate; the sheet's button relabels to 'Install first' then 'Connect' once a re-open detects `~/.nami/connectors/kie-mcp/dist/index.js` exists (expose a tiny `api.statPath` check, which already exists for terminal links: `api.statPath({ token, cwd })`).

- [ ] **Step 4: Verify + commit (surgical staging)**

Manual test in `npm start`: custom sheet opens, Go seeds a session with the FIRST detected agent (on Calvin's Mac: claude; temporarily reorder to prove opencode also receives the typed seed), guided Gmail opens a seeded session. `npm test`; commit:

```bash
git commit -m "feat: built-for-you connectors and guided setups use whichever agent you have"
```

---

### Task 8: Screenshots, polish review, standalone verification

- [ ] **Step 1:** TEMP-SHOT the full journey (library with services group; catalog; form; done) in BOTH themes; look at every image; revert temp lines.
- [ ] **Step 2:** Dispatch `ui-polisher` over the new CSS + screenshots; apply must-fixes; re-shot and look again.
- [ ] **Step 3:** Real end-to-end on Calvin's Mac: connect the folder service (no key needed) to a scratch project; confirm `.mcp.json` and `opencode.json` appear with only the new entry; open a Claude session and confirm the filesystem tools respond; disconnect and confirm the entries vanish and nothing else changed (`git diff` in the scratch project if it is a repo, else diff the files by hand).
- [ ] **Step 4:** `git worktree add --detach /tmp/verify-p3 master`, symlink node_modules, `npm test` (expect the full new count), demo-shot boot, remove worktree.
- [ ] **Step 5:** Commit any polish with surgical staging:

```bash
git commit -m "polish: connect flow after review, both themes verified"
```

---

### Task 9: Docs

**Files:**
- Modify: `README.md` (surgical staging: the logo session may still hold its rewrite; ALSO apply the same edit to the working tree so their later commit keeps it)
- Modify: `docs/superpowers/plans/2026-08-08-non-dev-workbench-roadmap.md`

- [ ] **Step 1:** README gains a bullet after the honest-launcher one:

```markdown
- **Connect a service**: the Library's Services section plugs Notion, Slack, Telegram,
  Creative models, a folder, and (guided) Gmail or Google Drive into your agents. Pick a
  card, paste one key, done: the app writes the settings where each agent already looks
  (`.mcp.json` for Claude Code, OpenCode's config for OpenCode) and proves the connection
  by starting it once. Anything else, describe in plain words and a session with your own
  agent builds and registers it.
```

Also update the Library bullet's group description to Agents / Skills / Services / Plugins.

- [ ] **Step 2:** Tick Part 3 in the roadmap with commits, test count, and verification evidence, in the voice of Parts 1 and 2.

- [ ] **Step 3:** Commit:

```bash
git commit -m "docs: connect a service shipped"
```

---

## Self-review notes

- Spec coverage: everyday catalog + kie-mcp (Task 1), one-key flow with folded choices and folded receipt (Task 6), receipt-as-disclosure decided by Calvin (Task 6 done screen), Library regrouped by type with scope tags (Task 5), custom connectors built by whichever agent (Task 7, plus Task 4's seed extension making non-Claude seeding possible), guided honesty for Google services (Tasks 1 and 7), proof-not-promise check (Task 3), detection of pre-existing connections (Task 2), disconnect (Tasks 2, 4, 6).
- Open questions folded in as defaults Calvin can veto cheaply: default reach is "this project"; front cards are Notion, Slack, Telegram, Creative models, A folder, Gmail, Google Drive (seven; the grid wraps).
- Type consistency checked: `values` object flows Task 1 → 4 → 6; `detectServices` row shape flows Task 2 → 4 → 5 → 6; `checkServer` result flows Task 3 → 4 → 6's done screen; overlay types `connect` / `connect-form` / `connect-done` / `connect-custom` consistent across Tasks 6 and 7.
- Known risks named where they live: exact Slack/Telegram package names re-verified in Task 1; Claude user-scope writes go through the claude CLI, never hand-editing `~/.claude.json`; seed typing into run-kind TUIs is best-effort with a delay; kie install is two honest clicks.
