# Part 1: Honest Launcher — Agent Detection + Guided Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The New-session launcher only offers agents that will actually run — detected agent CLIs appear ready-to-click, missing ones offer a one-click guided install, and dead buttons are gone.

**Architecture:** A new main-process module holds a registry of known agent CLIs and detects them via the user's login shell (`command -v` through `/bin/zsh -lc`, so PATH additions from `.zshrc` count). One IPC channel exposes the detection to the renderer. The launcher becomes detection-driven: registry results render as ready/missing rows, a small setup overlay handles the missing case by running the install command inside a normal terminal tile. Non-Claude agent CLIs launch through the existing `run` PTY kind.

**Tech Stack:** Electron 43 (CJS main / ESM renderer), node-pty (already wired), node:test. No new dependencies.

## Global Constraints

- No new npm dependencies.
- Paper styles in `paper.css` via tokens only; operator overrides only in `theme-operator.css`; JS-set colors via `statusColors()` — never bare hex (paper-design skill).
- Test script is `node --test tests/*.test.mjs` (bare directory arg fails on this Node).
- All user-facing copy is plain language — no "binary", "PATH", "endpoint" in primary labels (allowed in small sub-text).
- No em dashes anywhere in user-facing copy (Calvin's rule). Plain sentences, commas, periods.
- Do not touch the uncommitted operator-theme diff in the working tree beyond additive lines; coordinate before committing if the theme session hasn't landed.

## File Structure

- Create: `src/main/agents-detect.js` — agent registry + `detectAgents()` (pure logic, injectable exec, unit-testable).
- Create: `tests/agents-detect.test.mjs` — unit tests for registry shape + detection.
- Modify: `src/main/main.js` — register `agents:detect` and `url:open` IPC handlers.
- Modify: `src/main/preload.js` — expose `detectAgents()` and `openUrl()`.
- Modify: `src/renderer/app.js` — detection-driven launcher, setup overlay, cut dead rows.
- Modify: `src/renderer/paper.css` — missing-row style + setup overlay styles (tokens only).

---

### Task 1: Detection module (registry + detectAgents)

**Files:**
- Create: `src/main/agents-detect.js`
- Test: `tests/agents-detect.test.mjs`

**Interfaces:**
- Produces: `KNOWN_AGENTS` (array of `{id, name, bin, kind, sub, install, docs}`) and `async detectAgents({ exec } = {})` → `[{...agent, found: boolean, path: string}]`. `exec(bin)` resolves to the binary's absolute path or rejects/returns '' when absent. Default exec runs `/bin/zsh -lc 'command -v <bin>'`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/agents-detect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_AGENTS, detectAgents } from '../src/main/agents-detect.js';

test('registry carries the curated six with everything the launcher needs', () => {
  const ids = KNOWN_AGENTS.map((a) => a.id);
  for (const id of ['claude', 'codex', 'opencode', 'gemini', 'hermes', 'kimi']) {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/agents-detect.test.mjs`
Expected: FAIL — Cannot find module `src/main/agents-detect.js`.

- [ ] **Step 3: Write the module**

```js
// src/main/agents-detect.js
// Which agent CLIs live on this machine? Registry + detection, exec injectable for tests.
const { execFile } = require('node:child_process');

// The curated six. Install commands and docs links verified against official
// sources on 2026-08-08; prefer official script installers (no Node.js needed).
const KNOWN_AGENTS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', kind: 'claude',
    sub: 'your subscription · slash commands work',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://docs.anthropic.com/en/docs/claude-code' },
  { id: 'codex', name: 'Codex', bin: 'codex', kind: 'run',
    sub: "OpenAI's coding agent",
    install: 'npm install -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli' },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', kind: 'run',
    sub: 'open-source agent · bring any model',
    install: 'curl -fsSL https://opencode.ai/install | bash',
    docs: 'https://opencode.ai/docs' },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', kind: 'run',
    sub: "Google's coding agent",
    install: 'npm install -g @google/gemini-cli',
    docs: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'hermes', name: 'Hermes', bin: 'hermes', kind: 'run',
    sub: "Nous Research's agent, learns as it works",
    // chain the guided first-run setup so the tile walks the user all the way in
    install: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash && hermes setup --portal',
    docs: 'https://hermes-agent.nousresearch.com' },
  { id: 'kimi', name: 'Kimi Code', bin: 'kimi', kind: 'run',
    sub: "Moonshot's coding agent",
    install: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
    docs: 'https://moonshotai.github.io/kimi-code/en/' },
];

function shellWhich(bin) {
  return new Promise((resolve, reject) => {
    execFile('/bin/zsh', ['-lc', `command -v ${bin}`], { timeout: 8000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || '').trim());
    });
  });
}

async function detectAgents({ exec = shellWhich } = {}) {
  return Promise.all(KNOWN_AGENTS.map(async (a) => {
    let p = '';
    try { p = String((await exec(a.bin)) || '').trim(); } catch (_) { p = ''; }
    return { ...a, found: !!p, path: p };
  }));
}

module.exports = { KNOWN_AGENTS, detectAgents };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/agents-detect.test.mjs`
Expected: 4 pass. Then `npm test` — all suites still green (38 total).

- [ ] **Step 5: Commit**

```bash
git add src/main/agents-detect.js tests/agents-detect.test.mjs
git commit -m "feat: agent CLI registry + detection module"
```

---

### Task 2: IPC + preload wiring

**Files:**
- Modify: `src/main/main.js` (next to the other `ipcMain.handle` registrations)
- Modify: `src/main/preload.js` (inside the `dainami` bridge object)

**Interfaces:**
- Consumes: `detectAgents` from Task 1.
- Produces: renderer-side `api.detectAgents()` → detection array; `api.openUrl(url)` → opens https link in default browser.

- [ ] **Step 1: Add the main-process handlers**

In `src/main/main.js`, add near the top with the other requires:

```js
const { detectAgents } = require('./agents-detect');
```

and with the other handlers (`shell` is already imported from electron in main.js — verify; if not, add it to the electron destructure):

```js
ipcMain.handle('agents:detect', () => detectAgents());
ipcMain.handle('url:open', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});
```

- [ ] **Step 2: Expose in preload**

In `src/main/preload.js`, add to the bridge object after `themeSet`:

```js
detectAgents: () => ipcRenderer.invoke('agents:detect'),
openUrl: (url) => ipcRenderer.invoke('url:open', url),
```

- [ ] **Step 3: Smoke-test in the running app**

Run: `npm start`, open DevTools console, run `await dainami.detectAgents()`.
Expected: array of 4+ objects; `claude` has `found: true` with a real path on this machine.

- [ ] **Step 4: Commit**

```bash
git add src/main/main.js src/main/preload.js
git commit -m "feat: agents:detect + url:open IPC"
```

---

### Task 3: Detection-driven launcher (cut dead rows)

**Files:**
- Modify: `src/renderer/app.js:60-66` (HARNESSES), `app.js:927-969` (openLauncher/renderLauncher/launchHarness), state object `app.js:69-76`
- Modify: `src/renderer/paper.css` (launcher row states)

**Interfaces:**
- Consumes: `api.detectAgents()` from Task 2; existing `startPanel`, `overlay`, `statusColors`, `TINTS`, `hashIdx`, `esc`, `shortHome`.
- Produces: `S.agents` (detection array or null), `refreshAgents()`, new `renderLauncher()`; `openAgentSetup(agent)` stub that Task 4 fills (Task 3 ships it as a toast so the app never breaks mid-plan).

- [ ] **Step 1: Replace HARNESSES with one evergreen row**

The static list shrinks to what is always true. Delete the `claude`, `custom`, `ai`, and `ai-config` entries; only Terminal survives as a static row. The OpenAI-compatible chat tile (`mountAi` and friends) stays in the codebase so restored sessions keep working, but it gets **no launcher entry for now** (Calvin's call on 2026-08-08: parked to avoid confusing non-developers; Hermes now enters through its real CLI instead):

```js
// rows that exist regardless of what's installed
const EVERGREEN_ROWS = [
  { id: 'shell', name: 'Terminal', sub: 'a plain shell, ink on paper', kind: 'shell', tint: TINTS[5], code: '❯' },
];
```

Rename all other references from `HARNESSES` accordingly (grep for `HARNESSES` — only `renderLauncher` uses it).

- [ ] **Step 2: Add detection state + refresh**

Add `agents: null, agentsLoading: false,` to `S`. Then near the launcher code:

```js
async function refreshAgents() {
  if (S.agentsLoading) return;
  S.agentsLoading = true;
  try { S.agents = await api.detectAgents(); } catch (_) { S.agents = S.agents || []; }
  S.agentsLoading = false;
  if (S.overlay && S.overlay.type === 'launcher') renderOverlay();
}
```

Call `refreshAgents()` once during boot (fire-and-forget, after `applyProject`) so the launcher is instant on first open, and again inside `openLauncher()` so it stays fresh.

- [ ] **Step 3: Rewrite renderLauncher**

Layout rule (from the approved mockup): **big rows are things that run right now; small cards are things you could add.** Ready agents render as full rows with a green dot; missing agents shrink into a compact "add an agent to this Mac" card grid.

```js
function openLauncher() { S.overlay = { type: 'launcher' }; renderOverlay(); refreshAgents(); }
function renderLauncher() {
  const modal = overlay('picker-box', `<div class="picker-input"><span class="prompt-mark">＋</span><span style="font-weight:700">New session</span>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)">${S.project ? esc(S.project.name) : 'no folder'}</span></div>
    <div class="picker-list" id="lc-list"></div>`, { top: true });
  const list = q('#lc-list', modal);
  const sc = statusColors();
  const ready = (S.agents || []).filter((a) => a.found);
  const missing = (S.agents || []).filter((a) => !a.found);

  if (!S.agents) {
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="col"><span class="desc">looking for agents on this Mac…</span></span>`;
    list.appendChild(row);
  }
  for (const a of ready) {
    const tint = TINTS[hashIdx(a.id)];
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="code" style="background:${tint}">${esc(code2(a.name))}</span>
      <span class="col"><span class="name">${esc(a.name)}</span>
      <span class="desc"><span style="color:${sc.live}">●</span> ready · ${esc(a.sub)}</span></span>`;
    row.onclick = async () => {
      closeOverlay(); if (!(await ensureFolder())) return;
      if (a.kind === 'claude') return startPanel({ kind: 'claude', title: 'Claude session', code: 'CC', tint });
      startPanel({ kind: 'run', title: a.name, code: code2(a.name), tint, command: a.bin });
    };
    list.appendChild(row);
  }
  for (const h of EVERGREEN_ROWS) {
    const row = document.createElement('div'); row.className = 'picker-row';
    row.innerHTML = `<span class="code" style="background:${h.tint}">${esc(h.code)}</span>
      <span class="col"><span class="name">${esc(h.name)}</span><span class="desc">${esc(h.sub)}</span></span>`;
    row.onclick = async () => { closeOverlay(); if (!(await ensureFolder())) return; launchHarness(h); };
    list.appendChild(row);
  }
  // add section: every not-yet-installed agent from the curated six, as small cards
  if (missing.length) {
    const div = document.createElement('div'); div.className = 'picker-divider';
    div.textContent = 'add an agent to this Mac'; list.appendChild(div);
    const grid = document.createElement('div'); grid.className = 'add-grid'; list.appendChild(grid);
    for (const a of missing) {
      const card = document.createElement('div'); card.className = 'add-card'; card.tabIndex = 0;
      card.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.id)]}">${esc(code2(a.name))}</span>
        <span class="ac-name">${esc(a.name)}</span><span class="ac-desc">${esc(a.sub)}</span><span class="ac-go">set up →</span>`;
      card.onclick = () => { closeOverlay(); openAgentSetup(a); };
      grid.appendChild(card);
    }
  }
}
```

Trim `launchHarness` to only the `shell` branch (delete the `ai`, `ai-config`, `custom`, and `claude` branches; `configureAiModel` and `mountAi` stay in the file, unreferenced by the launcher, so restored AI sessions keep working). Add the Task-4 stub so nothing dangles:

```js
function openAgentSetup(agent) { toast(`${agent.name} setup coming in Task 4.`); }
```

- [ ] **Step 4: Style the add section**

In `paper.css` next to the existing `.picker-row` rules (tokens only; check the operator screenshot after, add overrides in `theme-operator.css` only if a paper literal leaks):

```css
.picker-divider { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted); padding: 10px 12px 2px; border-top: 1px solid var(--dash); }
.add-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px 12px 12px; }
.add-card { border: 1px dashed var(--dash); background: var(--paper); border-radius: 2px;
  padding: 9px 10px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.add-card:hover { border-style: solid; }
.add-card .code { width: 24px; height: 24px; font-size: 10.5px; margin-bottom: 2px; }
.add-card .ac-name { font-weight: 700; font-size: 12px; }
.add-card .ac-desc { font-size: 10.5px; color: var(--muted); }
.add-card .ac-go { font-size: 10.5px; color: var(--amber-line, var(--muted)); margin-top: 2px; }
```

- [ ] **Step 5: Verify by hand + screenshot**

Run: `npm test` (still green), then `npm start`: ⌘N shows ready agents as full rows with a green ● (Claude Code at minimum on this machine), a Terminal row, then an "add an agent to this Mac" card grid holding every not-installed agent from the curated six, and **no** Custom command / AI settings / Web model entries. Clicking an add-card shows the stub toast. Then `npm run shot` and `npx electron . --demo --theme=operator --screenshot shots/operator.png` — look at both images.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/app.js src/renderer/paper.css
git commit -m "feat: detection-driven launcher — only offer agents that will run"
```

---

### Task 4: Guided setup overlay

**Files:**
- Modify: `src/renderer/app.js` (replace the `openAgentSetup` stub; add `renderAgentSetup` to the overlay switch in `renderOverlay`)
- Modify: `src/renderer/paper.css` (setup sheet styles)

**Interfaces:**
- Consumes: `startPanel({kind:'run', command})`, `api.copyText`, `api.openUrl` (Task 2), `overlay()`, `refreshAgents()`.
- Produces: `openAgentSetup(agent)` — a sheet with: what this agent is, the install command in a mono block, buttons **Install it for me** (runs the install inside a terminal tile), **Copy the command**, **Read the guide** (opens docs URL in the browser).

- [ ] **Step 1: Implement the overlay**

```js
function openAgentSetup(agent) { S.overlay = { type: 'agent-setup', agent }; renderOverlay(); }
function renderAgentSetup() {
  const a = S.overlay.agent;
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[hashIdx(a.id)]}">${esc(code2(a.name))}</span>
      <span class="col"><span class="name">${esc(a.name)}</span><span class="desc">${esc(a.sub)}</span></span></div>
    <p class="setup-copy">${esc(a.name)} is not on this Mac yet. One command installs it, and I can run that
      for you in a terminal right here. The first time it starts, it will ask you to sign in, right in the tile.</p>
    <div class="setup-cmd">${esc(a.install)}</div>
    <div class="setup-actions">
      <button id="su-run" class="btn-solid">Install it for me</button>
      <button id="su-copy">Copy the command</button>
      <button id="su-docs">Read the guide</button>
    </div>
    <p class="setup-note">Install it for me opens a terminal tile and runs the line above. Copy puts it on
      your clipboard. Read the guide opens the official ${esc(a.name)} page in your browser.</p>`);
  q('#su-run', modal).onclick = async () => {
    closeOverlay(); if (!(await ensureFolder())) return;
    startPanel({ kind: 'run', title: `install ${a.name}`, code: code2(a.name), tint: TINTS[hashIdx(a.id)], command: a.install });
    toast('When it finishes, press ⌘N. The button will be ready.');
  };
  q('#su-copy', modal).onclick = async () => { await api.copyText(a.install); toast('Copied.'); };
  q('#su-docs', modal).onclick = () => api.openUrl(a.docs);
}
```

Wire `agent-setup` into `renderOverlay`'s switch exactly like the other overlay types (find the `if (S.overlay.type === ...)` chain and add `if (S.overlay.type === 'agent-setup') return renderAgentSetup();`).

- [ ] **Step 2: Style the sheet (paper.css, tokens only)**

```css
.setup-box { width: 440px; padding: 18px 20px; }
.setup-head { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.setup-copy { font-size: 13px; color: var(--ink); margin: 0 0 12px; }
.setup-cmd { font-family: 'Courier Prime', monospace; font-size: 12px; border: 1px dashed var(--dash);
  padding: 8px 10px; background: var(--paper); margin-bottom: 14px; user-select: all; }
.setup-actions { display: flex; gap: 8px; }
.setup-actions button { font-size: 12px; }
.setup-note { font-size: 11px; color: var(--muted); margin: 10px 0 0; }
```

Check `theme-operator.css` after: the sheet uses tokens, so it should flip automatically; add an override only if the screenshot shows a paper literal leaking.

- [ ] **Step 3: Verify the full loop by hand**

Run: `npm start`. ⌘N → click a greyed agent → sheet appears with readable copy → "Copy the command" puts the install line on the clipboard → "Install it for me" opens a terminal tile actually running the command (cancel it — don't install Codex for real unless wanted) → "Read the guide" opens the browser. Re-open ⌘N: still greyed (correct — not installed).

- [ ] **Step 4: Screenshot both themes and look**

Run: `npm run shot` and `npx electron . --demo --theme=operator --screenshot shots/operator.png`. Open both, check the sheet against the paper-design checklist (dashed borders, hard shadows, Caveat heading / mono machine text).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/app.js src/renderer/paper.css src/renderer/theme-operator.css
git commit -m "feat: guided agent setup — install any agent CLI from inside the app"
```

---

### Task 5: Docs + full verification pass

**Files:**
- Modify: `README.md` (feature bullets: replace the launcher description)
- Modify: `docs/superpowers/plans/2026-08-08-non-dev-workbench-roadmap.md` (tick Part 1)

**Interfaces:** none — verification and docs only.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites green (34 existing + 4 new = 38).

- [ ] **Step 2: End-to-end sanity in the real app**

Run: `npm start` and walk the whole Part-1 story once: boot → ⌘N (instant, pre-detected) → launch Claude (works) → launch OpenCode if installed / setup card if not → Terminal row → add-cards present for whatever is missing from the curated six. Confirm restored sessions from `state.json` still mount (persistence untouched, including any saved AI chat tiles).

- [ ] **Step 3: Update README + roadmap, commit**

README launcher bullet becomes: "⌘N shows the agents actually installed on your Mac. Ready ones launch instantly, and missing ones install themselves from a guided card." Tick the Part 1 box in the roadmap file.

```bash
git add README.md docs/superpowers/plans/2026-08-08-non-dev-workbench-roadmap.md
git commit -m "docs: Part 1 launcher — README + roadmap"
```

- [ ] **Step 4: Run the ui-polisher agent over the diff**

Dispatch the `ui-polisher` agent to review the launcher + setup sheet changes against the paper design language; apply anything it flags, re-screenshot, amend or follow-up commit.
