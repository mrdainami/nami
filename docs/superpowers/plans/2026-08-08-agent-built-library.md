# Agent-Built Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Library items are born and raised by the user's own agent: ＋ new takes a name plus plain-words description and seeds a session that writes the real thing, every editable card gains Improve-with-my-agent and Delete-to-Trash, and every handoff sheet gets a session selector listing the agents actually installed.

**Architecture:** One small addition to `src/main/library.js` (`deleteItem` with injectable trash/exists so tests never touch the real Trash) plus one IPC + preload line. A new pure module `src/renderer/seed-text.mjs` builds the seed prompts (unit-tested like `peek-core.mjs`). Everything else is renderer work in the existing overlay idiom: a shared `agentOptionsHtml`/`chosenAgent` selector pair, the reworked ＋ new sheet, an `improve-item` overlay, card-foot buttons, and retrofits of the Part 3 built-for-you and guided sheets to use the selector. Spec: `docs/superpowers/specs/2026-08-08-agent-built-library-design.md`.

**Tech Stack:** Electron 43 (CJS main / ESM renderer), vanilla DOM, `node --test` with `createRequire` for CJS modules and direct import for `.mjs`.

## Global Constraints

- No em dashes anywhere: UI copy, code comments, docs, commit messages.
- Copy never assumes Claude: "a new session will create it for you"; an agent is named only when the user picked it in the selector (showing the selected agent's name in a dropdown the user controls is fine).
- Do NOT touch `src/renderer/index.html`, assets, or header markup (logo session). Only ADD lines to `src/renderer/theme-operator.css` (theme session's uncommitted file; never commit it).
- Shared dirty tree: `src/renderer/app.js`, `src/renderer/paper.css`, `src/main/main.js`, `src/main/preload.js` carry peer diffs. Every commit touching them uses the surgical index-staging pattern: apply exact-string replaces to the WORKING TREE and separately to the INDEX base (`git show :file`), assert each anchor appears exactly once in each, `git hash-object -w --stdin` the new index blob, `git update-index --cacheinfo 100644,<hash>,<path>`. Anchors can differ between worktree and index (peer edits); when an assert fails, read both versions and adjust that side's anchor only. `src/main/main.js` has a stray byte: grep with `grep -a`, python reads/writes with `errors='surrogateescape'`. `src/main/library.js` and all new files are clean: plain edits and `git add`.
- Dual themes: paper styles via tokens in `paper.css`; operator overrides only in `theme-operator.css` scoped `body[data-theme="operator"]`, appended to the existing "Part 3, additive" region or a new appended block. Screenshot BOTH themes (`npx electron . --demo --theme=paper|operator --screenshot shots/x.png`, capture fires ~1400ms after boot) and actually look at the images. TEMP-SHOT seed lines are reverted before staging.
- Verification: `npm test` (baseline 54 tests; this plan adds ~8, ending ~62), a boot screenshot after main-process changes, ui-polisher for visual work, and a final detached-worktree check of committed master.
- Existing code style: `q()` helper, `esc()` for all interpolated HTML, single quotes, semicolons, toasts for feedback.

## File Structure

- Modify `src/main/library.js`: add `deleteItem` (path-guarded trash) and export it.
- Create `src/renderer/seed-text.mjs`: pure seed-prompt builders, no DOM.
- Create `tests/library-delete.test.mjs`, `tests/seed-text.test.mjs`.
- Modify `src/main/main.js` (one IPC handler), `src/main/preload.js` (one line).
- Modify `src/renderer/app.js`: selector helpers, ＋ new rework, improve overlay, card buttons, connect-sheet retrofits, library rescan on tab switch.
- Modify `src/renderer/paper.css` (selector + row styles), `src/renderer/theme-operator.css` (additive).
- Modify `README.md` (surgical: logo session holds a rewrite in the worktree).

---

### Task 1: `deleteItem` in library.js + IPC + preload

**Files:**
- Modify: `src/main/library.js` (add function before `module.exports`, extend exports)
- Modify: `src/main/main.js` (after the `library:duplicate` handler, line ~374, `grep -an "library:duplicate" src/main/main.js`)
- Modify: `src/main/preload.js` (after `libraryCreate:`)
- Test: `tests/library-delete.test.mjs`

**Interfaces:**
- Produces: `deleteItem({ filePath, projectPath, homeDir, trashFn, existsFn })` → Promise of `{ ok: true, target }` or `{ ok: false, error }`. `filePath` is the item's file (for skills the `SKILL.md`; the deleted target becomes its folder). `trashFn` defaults are wired in main.js (`shell.trashItem`); tests inject fakes. Renderer-visible: `api.libraryDelete({ filePath, projectPath })`.
- Consumed by: Task 5's card Delete button.

- [ ] **Step 1: Write the failing test**

Create `tests/library-delete.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { deleteItem } = require('../src/main/library.js');

const H = '/home/u', P = '/proj';
function fakes(existing) {
  const trashed = [];
  return {
    trashed,
    trashFn: (p) => { trashed.push(p); return Promise.resolve(); },
    existsFn: (p) => existing.includes(p),
  };
}

test('agent file inside the project .claude root goes to trash', async () => {
  const f = fakes([P + '/.claude/agents/scribe.md']);
  const out = await deleteItem({ filePath: P + '/.claude/agents/scribe.md', projectPath: P, homeDir: H, ...f });
  assert.deepEqual(out, { ok: true, target: P + '/.claude/agents/scribe.md' });
  assert.deepEqual(f.trashed, [P + '/.claude/agents/scribe.md']);
});

test('a skill SKILL.md trashes the whole skill folder', async () => {
  const f = fakes([H + '/.claude/skills/paper-design']);
  const out = await deleteItem({ filePath: H + '/.claude/skills/paper-design/SKILL.md', projectPath: null, homeDir: H, ...f });
  assert.equal(out.ok, true);
  assert.deepEqual(f.trashed, [H + '/.claude/skills/paper-design']);
});

test('paths outside the library roots and the plugin cache are refused', async () => {
  const f = fakes(['/etc/passwd', H + '/.claude/plugins/cache/x/agents/a.md']);
  const a = await deleteItem({ filePath: '/etc/passwd', projectPath: P, homeDir: H, ...f });
  assert.equal(a.ok, false);
  const b = await deleteItem({ filePath: H + '/.claude/plugins/cache/x/agents/a.md', projectPath: P, homeDir: H, ...f });
  assert.equal(b.ok, false);
  assert.deepEqual(f.trashed, []);
});

test('a path that no longer exists reports instead of throwing', async () => {
  const f = fakes([]);
  const out = await deleteItem({ filePath: P + '/.claude/agents/gone.md', projectPath: P, homeDir: H, ...f });
  assert.equal(out.ok, false);
  assert.match(out.error, /gone|Already/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`. Expected: the new file errors (deleteItem is not a function); existing 54 pass.

- [ ] **Step 3: Implement `deleteItem`**

In `src/main/library.js`, before `module.exports`, add:

```js
// ---- delete to Trash --------------------------------------------------------
// Guarded: only real library locations, never the plugin cache. Skills are
// folders, so their SKILL.md maps to the folder that holds it.
async function deleteItem({ filePath, projectPath, homeDir, trashFn, existsFn = fs.existsSync }) {
  const home = homeDir || os.homedir();
  const abs = path.resolve(String(filePath || ''));
  const roots = [];
  if (projectPath) roots.push(path.join(projectPath, '.claude'), path.join(projectPath, '.opencode'));
  roots.push(path.join(home, '.claude', 'agents'), path.join(home, '.claude', 'skills'), path.join(home, '.config', 'opencode'));
  const inRoot = roots.some((r) => abs.startsWith(r + path.sep));
  const inPluginCache = abs.includes(path.sep + path.join('.claude', 'plugins') + path.sep);
  if (!inRoot || inPluginCache) return { ok: false, error: 'Not a deletable library item' };
  const target = path.basename(abs) === 'SKILL.md' ? path.dirname(abs) : abs;
  if (!existsFn(target)) return { ok: false, error: 'Already gone' };
  try { await trashFn(target); return { ok: true, target }; }
  catch (e) { return { ok: false, error: e.message }; }
}
```

Extend the exports line to:

```js
module.exports = { scanLibrary, createItem, duplicateItem, deleteItem, extractEdges };
```

- [ ] **Step 4: Run to verify pass** (`npm test`: 58/58)

- [ ] **Step 5: Wire IPC + preload (surgical staging)**

main.js: find the require of library helpers at the top (`grep -an "require('./library')" src/main/main.js`) and add `deleteItem` to its destructuring. After the line `ipcMain.handle('library:duplicate', (_e, args) => duplicateItem(args || {}));` add:

```js
ipcMain.handle('library:delete', (_e, args) => deleteItem({ ...(args || {}), trashFn: (p) => shell.trashItem(p) }));
```

preload.js: after `libraryDuplicate:` (or `libraryCreate:` if ordering differs) add:

```js
  libraryDelete: (args) => ipcRenderer.invoke('library:delete', args),
```

Stage with a python script following the Global Constraints pattern (worktree + index, byte-safe for main.js). `library.js` and the test are clean files: plain `git add`.

- [ ] **Step 6: Verify + commit**

`npm test` (58/58), boot shot (`npx electron . --demo --screenshot shots/boot-t1.png`, look, delete it), `git diff --cached` shows only these hunks, then:

```bash
git commit -m "feat: library delete to trash, guarded to real library paths"
```

---

### Task 2: Seed-text builders (`seed-text.mjs`)

**Files:**
- Create: `src/renderer/seed-text.mjs`
- Test: `tests/seed-text.test.mjs`

**Interfaces:**
- Produces:
  - `buildCreateSeed({ type, platform, scope, name, desc, projectPath })` → string. `type` is `'agent' | 'skill'`, `platform` `'claude' | 'opencode'`, `scope` `'project' | 'user'`, `name` may be `''`.
  - `targetDirFor({ type, platform, scope, projectPath })` → string path hint used inside the seed.
  - `buildImproveSeed({ platform, type, filePath, ask })` → string.
- Consumed by: Task 4 (＋ new) and Task 5 (improve overlay).

- [ ] **Step 1: Write the failing test**

Create `tests/seed-text.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateSeed, buildImproveSeed, targetDirFor } from '../src/renderer/seed-text.mjs';

test('create seed carries the description, the given name, and the right target', () => {
  const s = buildCreateSeed({ type: 'agent', platform: 'claude', scope: 'project', name: 'release scribe', desc: 'turns git history into notes', projectPath: '/p' });
  assert.match(s, /turns git history into notes/);
  assert.match(s, /"release scribe"/);
  assert.match(s, /\/p\/\.claude\/agents/);
  assert.match(s, /no placeholder text/i);
});

test('blank name asks the agent to choose one', () => {
  const s = buildCreateSeed({ type: 'skill', platform: 'claude', scope: 'user', name: '', desc: 'reviews CSS', projectPath: null });
  assert.match(s, /choose a short kebab-case name/i);
  assert.match(s, /~\/\.claude\/skills/);
});

test('opencode agents land in the opencode folders per scope', () => {
  assert.equal(targetDirFor({ type: 'agent', platform: 'opencode', scope: 'project', projectPath: '/p' }), '/p/.opencode/agent');
  assert.equal(targetDirFor({ type: 'agent', platform: 'opencode', scope: 'user', projectPath: '/p' }), '~/.config/opencode/agent');
});

test('improve seed points at the exact file and keeps the format honest', () => {
  const s = buildImproveSeed({ platform: 'claude', type: 'agent', filePath: '/p/.claude/agents/x.md', ask: 'Give it a real description.' });
  assert.match(s, /\/p\/\.claude\/agents\/x\.md/);
  assert.match(s, /Give it a real description\./);
  assert.match(s, /format valid/i);
});
```

- [ ] **Step 2: Run to verify failure** (`npm test`)

- [ ] **Step 3: Implement**

Create `src/renderer/seed-text.mjs`:

```js
// Seed prompts for sessions that build or improve library items.
// Pure strings, no DOM: unit-tested in tests/seed-text.test.mjs.
export function targetDirFor({ type, platform, scope, projectPath }) {
  const root = scope === 'project' ? (projectPath || '.') : '~';
  if (platform === 'claude' && type === 'agent') return root + '/.claude/agents';
  if (platform === 'claude' && type === 'skill') return root + '/.claude/skills';
  if (platform === 'opencode' && type === 'agent') {
    return scope === 'project' ? root + '/.opencode/agent' : '~/.config/opencode/agent';
  }
  return root;
}

export function buildCreateSeed({ type, platform, scope, name, desc, projectPath }) {
  const dir = targetDirFor({ type, platform, scope, projectPath });
  const naming = name && name.trim()
    ? `Name it "${name.trim()}".`
    : 'Choose a short kebab-case name for it yourself, two or three words, from the description.';
  const shape = type === 'skill'
    ? `Create the skill as a folder under ${dir} holding a SKILL.md`
    : `Create the ${platform} ${type} as a markdown file in ${dir}`;
  return `${shape} that does this: ${desc.trim()}. ${naming} Write real frontmatter and real instructions, no placeholder text. When it is written, tell me its final name and where it landed.`;
}

export function buildImproveSeed({ platform, type, filePath, ask }) {
  return `Edit the ${platform} ${type} at ${filePath}. ${ask.trim()} Keep the file's format valid, and keep its name unless I asked you to rename it.`;
}
```

- [ ] **Step 4: Run to verify pass** (`npm test`: 62/62)

- [ ] **Step 5: Commit (clean new files)**

```bash
git add src/renderer/seed-text.mjs tests/seed-text.test.mjs
git commit -m "feat: seed prompts for agent-built library items"
```

---

### Task 3: Shared session selector + retrofit the Part 3 sheets

**Files:**
- Modify: `src/renderer/app.js` (selector helpers next to `bestAgent`; edits inside `renderConnectCustom`, `renderConnectForm`, `startGuidedSetup`, `openConnect`, `refreshAgents`)
- Modify: `src/renderer/paper.css` (append after the connect-a-service block)
- Modify: `src/renderer/theme-operator.css` (ADDITIVE only)

**Interfaces:**
- Consumes: `S.agents` (Part 1 detection), `bestAgent()`, `agentSession(worker, opts)` (both shipped in Part 3, next to the connect functions).
- Produces (used by Tasks 4 and 5): `agentOptionsHtml(selectedId)` → `<option>` list HTML of found agents; `chosenAgent(o)` → the agent whose `id === o.workerId`, else the first found, else `null`. Sheets store the selection as `o.workerId` on their overlay state.

- [ ] **Step 1: Add the helpers (surgical staging)**

Anchor: the `bestAgent` function shipped in Part 3. Directly after its closing brace add:

```js
// Session selector shared by every handoff sheet: the user picks which
// installed agent does the work; default is the first detected.
function agentOptionsHtml(selectedId) {
  const ready = (S.agents || []).filter((a) => a.found);
  return ready.map((a) => `<option value="${esc(a.id)}"${a.id === selectedId ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
}
function chosenAgent(o) {
  const ready = (S.agents || []).filter((a) => a.found);
  return ready.find((a) => a.id === (o && o.workerId)) || ready[0] || null;
}
```

- [ ] **Step 2: Retrofit the built-for-you sheet**

In `renderConnectCustom`, replace `const worker = bestAgent();` with `const worker = chosenAgent(o);`. Replace the setup-actions + note block:

```js
    <div class="setup-actions" style="margin-top:12px"><button class="btn btn--go" id="svc-go" ${worker ? '' : 'disabled'}>Go</button></div>
    <p class="setup-note">${worker
      ? `A new session opens with the job written out, using ${esc(worker.name)}. Watch it work, talk to it if you want.`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</p>`);
```

with:

```js
    <div class="ni-agent">${worker
      ? `a new session with <select class="agent-pick" id="svc-agent">${agentOptionsHtml(worker.id)}</select> builds it for you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="setup-actions" style="margin-top:12px"><button class="btn btn--go" id="svc-go" ${worker ? '' : 'disabled'}>Go</button></div>
    <p class="setup-note">Watch it work, talk to it if you want. The service appears under Library when it lands.</p>`);
  const agentSel = q('#svc-agent', modal);
  if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
```

In its `#svc-go` handler, replace `if (!o.text.trim() || !worker) return;` with `const w = chosenAgent(o); if (!o.text.trim() || !w) return;` and use `agentSession(w, ...)` (the existing call passes `worker`; change it to `w`).

- [ ] **Step 3: Retrofit the guided form**

In `renderConnectForm`, the guided branch copy `` ? `<p class="setup-copy">${esc(svc.guide)}</p>` `` becomes:

```js
      ? `<p class="setup-copy">${esc(svc.guide)}</p><div class="ni-agent">${chosenAgent(o)
          ? `a new session with <select class="agent-pick" id="sv-agent">${agentOptionsHtml(o.workerId)}</select> walks you through it`
          : 'No agent is installed yet. Press ⌘N to add one first.'}</div>`
```

After the existing `.sv-help` wiring lines add:

```js
  const guidedSel = q('#sv-agent', modal);
  if (guidedSel) guidedSel.onchange = () => { o.workerId = guidedSel.value; };
```

Change the connect click's guided line from `if (guided) return startGuidedSetup(svc);` to `if (guided) return startGuidedSetup(svc, chosenAgent(o));`, and change `startGuidedSetup`'s signature to `function startGuidedSetup(svc, worker)` with its first line becoming `worker = worker || bestAgent();` (drop the old `const worker = bestAgent();`).

- [ ] **Step 4: Keep the agent list fresh**

`openConnect()` gains `refreshAgents();` alongside its `refreshServices();`. In `refreshAgents`, replace:

```js
  if (S.overlay && S.overlay.type === 'launcher') renderOverlay();
```

with:

```js
  const t = S.overlay && S.overlay.type;
  if (['launcher', 'connect-form', 'connect-custom', 'newitem', 'improve-item'].includes(t)) renderOverlay();
```

(Re-rendering `connect-form` is safe: key values live in `o.values` and are re-seeded on render, Part 3's re-render rule.)

- [ ] **Step 5: CSS**

paper.css, appended at the end of the connect-a-service block (anchor: the `.setup-head .desc .ok` line added in the Part 3 polish commit):

```css
.ni-agent { font-size: 11.5px; color: var(--muted); margin: 10px 0 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.agent-pick { font-family: 'Courier Prime', monospace; font-size: 11.5px; color: var(--ink);
  background: var(--paper); border: 1px dashed var(--dash); border-radius: 2px; padding: 3px 6px; cursor: pointer; }
.agent-pick:hover, .agent-pick:focus-visible { border-style: solid; outline: none; }
```

theme-operator.css, ADD inside the appended Part 3 block:

```css
body[data-theme="operator"] .agent-pick { border-radius: 5px; background: var(--paper-2); }
body[data-theme="operator"] .agent-pick:focus-visible { border-color: var(--op-accent); }
```

- [ ] **Step 6: Verify + commit**

`npm test` (62/62), ESM parse check (`node --input-type=module -e "import('./src/renderer/app.js')..."`, SyntaxError = fail), TEMP-SHOT the built-for-you sheet and the guided Gmail form in BOTH themes with `S.agents` seeded to two found agents (block real detection with `S.agentsLoading = true`); LOOK: dropdown lists both names, guided sheet shows the selector line. Revert temp lines. Surgical staging, then:

```bash
git commit -m "feat: pick which agent does the work, on every handoff sheet"
```

---

### Task 4: ＋ new becomes describe-it

**Files:**
- Modify: `src/renderer/app.js` (`openNewItem`, `renderNewItemSheet`; import from seed-text.mjs at the top, anchored on the existing `peek-core.mjs` import line which exists in both worktree and index)

**Interfaces:**
- Consumes: `buildCreateSeed` (Task 2), `agentOptionsHtml`/`chosenAgent` (Task 3), `agentSession`, `api.libraryCreate`, `refreshAgents`.
- Produces: the reworked sheet; overlay state `{ type: 'newitem', kindKey, scope, name, desc, workerId }`.

- [ ] **Step 1: Import**

Top of app.js, after the `peek-core.mjs` import line, add:

```js
import { buildCreateSeed, buildImproveSeed } from './seed-text.mjs';
```

(`buildImproveSeed` is used in Task 5; importing both here keeps this the only import edit.)

- [ ] **Step 2: Rework the sheet**

`openNewItem` becomes:

```js
function openNewItem() { S.overlay = { type: 'newitem', kindKey: 'claude:agent', scope: S.project ? 'project' : 'user', name: '', desc: '' }; renderOverlay(); if (!S.agents) refreshAgents(); }
```

Replace `renderNewItemSheet` wholesale (current version renders name input + Create button; keep the kind rows and scope buttons exactly as they are, shown here in full so the replacement is complete):

```js
function renderNewItemSheet() {
  const o = S.overlay;
  const worker = chosenAgent(o);
  const modal = overlay('picker-box', `
    <div class="picker-input"><span class="prompt-mark">＋</span><span style="font-weight:700">New agent or skill</span></div>
    <div class="picker-list" id="ni-kinds"></div>
    <div class="ni-row">
      <span class="card-lbl" style="margin:0">Scope</span>
      <button class="btn ni-scope" data-s="project" ${S.project ? '' : 'disabled'}>this project</button>
      <button class="btn ni-scope" data-s="user">your machine</button>
    </div>
    <div class="ni-row"><input id="ni-name" placeholder="name it (or leave blank, your agent will)…" value="${esc(o.name)}" /></div>
    <div class="ni-row"><input id="ni-desc" placeholder="what should it do? e.g. turns git history into release notes people read" value="${esc(o.desc)}" /></div>
    <div class="ni-agent" style="margin:2px 12px 8px">${worker
      ? `a new session with <select class="agent-pick" id="ni-agent-sel">${agentOptionsHtml(worker.id)}</select> creates it for you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="ni-row"><button class="btn btn--go" id="ni-create" ${worker ? '' : 'disabled'}>Create it for me</button>
      <span class="action" id="ni-blank">just give me an empty file</span></div>`, { top: true });
  const kinds = q('#ni-kinds', modal);
  const nameInput = q('#ni-name', modal), descInput = q('#ni-desc', modal);
  const keep = () => { o.name = nameInput.value; o.desc = descInput.value; };
  for (const k of NEW_KINDS) {
    const row = document.createElement('div'); row.className = 'picker-row' + (o.kindKey === k.key ? ' hilite' : '');
    row.innerHTML = `<span class="code" style="background:${k.chip.tint}">${k.chip.code}</span>
      <span class="col"><span class="name">${esc(k.name)}</span><span class="desc">${esc(k.sub)}</span></span>`;
    row.onclick = () => { keep(); o.kindKey = k.key; renderOverlay(); };
    kinds.appendChild(row);
  }
  modal.querySelectorAll('.ni-scope').forEach((b) => {
    b.classList.toggle('btn--go', b.dataset.s === o.scope);
    b.onclick = () => { keep(); o.scope = b.dataset.s; renderOverlay(); };
  });
  const agentSel = q('#ni-agent-sel', modal);
  if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
  setTimeout(() => descInput.focus(), 30);
  q('#ni-create', modal).onclick = () => {
    keep();
    const w = chosenAgent(o);
    if (!o.desc.trim()) { toast('Describe what it should do first.'); return; }
    if (!w) { toast('No agent is installed yet. Press ⌘N to add one first.'); return; }
    const [platform, type] = o.kindKey.split(':');
    const seed = buildCreateSeed({ type, platform, scope: o.scope, name: o.name, desc: o.desc, projectPath: S.project && S.project.path });
    closeOverlay();
    agentSession(w, { title: 'build: ' + (o.name.trim() || type), code: 'BD', seed });
    toast('Your agent is writing it. It appears in the Library when it lands.');
  };
  q('#ni-blank', modal).onclick = async () => {
    keep();
    if (!o.name.trim()) { toast('Give it a name first.'); return; }
    const [platform, type] = o.kindKey.split(':');
    const res = await api.libraryCreate({ projectPath: S.project && S.project.path, type, platform, scope: o.scope, name: o.name.trim() });
    if (!res.ok) { toast(res.error || 'Could not create'); return; }
    closeOverlay(); toast('Created ' + o.name.trim());
    S.railTab = 'library'; loadLibrary(true).then(() => renderRail());
    openCard(res.item);
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); descInput.focus(); } });
  descInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); q('#ni-create', modal).onclick(); } });
}
```

Note: the old Enter-to-create on the name field now moves focus to the describe field; Enter there fires Create it for me. The `.action` class is the existing quiet-link idiom from the rail head.

- [ ] **Step 3: Library rescan on tab switch**

Find the rail-tab click wiring (`grep -n "rail-tab" src/renderer/app.js`, the `.onclick` that sets `S.railTab`). Change:

```js
  document.querySelectorAll('.rail-tab').forEach((t) => { t.onclick = () => { S.railTab = t.dataset.tab; renderAll(); }; });
```

to:

```js
  document.querySelectorAll('.rail-tab').forEach((t) => { t.onclick = () => { S.railTab = t.dataset.tab; if (t.dataset.tab === 'library') loadLibrary(true); renderAll(); }; });
```

(`loadLibrary(true)` re-renders the rail itself when the scan lands; agent-written items appear without a restart.)

- [ ] **Step 4: Verify + commit**

`npm test` (62/62), parse check, TEMP-SHOT the new sheet in BOTH themes (seed `S.agents` with two found agents, `S.agentsLoading = true`, open `{ type: 'newitem' ... }` at 700ms); LOOK: name + describe fields, selector line, Create it for me + quiet link. Revert temp lines. Surgical staging, commit:

```bash
git commit -m "feat: plus-new describes it and your agent builds it, blank file kept as quiet path"
```

---

### Task 5: Card buttons: Improve with my agent + Delete to Trash

**Files:**
- Modify: `src/renderer/app.js` (`mountCard`'s `ed-bar` template and handler block; new `openImproveItem`/`renderImproveItem` next to the connect functions; one branch in `renderOverlay`)
- Modify: `src/renderer/paper.css` (one rule for the delete button's armed state)

**Interfaces:**
- Consumes: `api.libraryDelete` (Task 1), `buildImproveSeed` (Task 2, already imported in Task 4), `agentOptionsHtml`/`chosenAgent` (Task 3), `agentSession`, `closePanel`, `closeOverlay`, `loadLibrary`.
- Produces: overlay state `{ type: 'improve-item', item, text: '', workerId }`.

- [ ] **Step 1: Card foot buttons**

In `mountCard`'s template, the `ed-bar` line:

```js
      ${ro ? '<button class="btn btn--go card-dup">Duplicate to project</button>' : '<button class="btn btn--go card-save">Save ⌘S</button>'}
```

becomes:

```js
      ${ro ? '<button class="btn btn--go card-dup">Duplicate to project</button>'
           : '<button class="btn card-del">Delete</button><button class="btn card-improve">Improve with my agent</button><button class="btn btn--go card-save">Save ⌘S</button>'}
```

After the existing `dupBtn` handler block add:

```js
  const impBtn = q('.card-improve', wrap);
  if (impBtn) impBtn.onclick = () => {
    if (p.dirty) { toast('Save the card first so your agent sees your latest.'); return; }
    openImproveItem(p.item);
  };
  const delBtn = q('.card-del', wrap);
  if (delBtn) delBtn.onclick = async () => {
    if (!delBtn.dataset.armed) { delBtn.dataset.armed = '1'; delBtn.textContent = 'Really move to Trash?'; delBtn.classList.add('armed'); return; }
    const res = await api.libraryDelete({ filePath: p.item.filePath, projectPath: S.project && S.project.path });
    if (!res.ok) { toast(res.error || 'Could not delete'); return; }
    if (S.panels.includes(p)) closePanel(p.id); else closeOverlay();
    loadLibrary(true); toast('Moved to Trash.');
  };
```

(Cards open both as pinned tiles and as peeks; `S.panels.includes(p)` picks the right close.)

- [ ] **Step 2: Improve overlay**

Next to the connect functions add:

```js
// ---- improve an existing library item with the user's own agent ------------
function openImproveItem(item) { S.overlay = { type: 'improve-item', item, text: '' }; renderOverlay(); if (!S.agents) refreshAgents(); }
function renderImproveItem() {
  const o = S.overlay, item = o.item;
  const worker = chosenAgent(o);
  const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" style="background:${TINTS[hashIdx(item.slug)]}">${esc(code2(item.name))}</span>
      <span class="col"><span class="name">Improve ${esc(item.name)}</span><span class="desc">${esc(item.platform + ' ' + item.type)}</span></span></div>
    <input class="text-input" id="imp-ask" placeholder="what should change? e.g. give it a real description and sharper instructions" spellcheck="false" />
    <div class="ni-agent">${worker
      ? `a new session with <select class="agent-pick" id="imp-agent">${agentOptionsHtml(worker.id)}</select> edits it for you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="setup-actions" style="margin-top:12px"><button class="btn btn--go" id="imp-go" ${worker ? '' : 'disabled'}>Go</button></div>`);
  const input = q('#imp-ask', modal); input.value = o.text; setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.text = input.value; };
  const agentSel = q('#imp-agent', modal);
  if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
  const go = () => {
    const w = chosenAgent(o);
    if (!o.text.trim() || !w) { if (!o.text.trim()) toast('Say what should change first.'); return; }
    closeOverlay();
    agentSession(w, { title: 'improve: ' + item.slug, code: 'IM', seed:
      buildImproveSeed({ platform: item.platform, type: item.type, filePath: item.filePath, ask: o.text }) });
    toast('Your agent is on it. Reopen the card when it finishes.');
  };
  q('#imp-go', modal).onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}
```

`renderOverlay` gains, after the `connect-custom` branch:

```js
  if (o.type === 'improve-item') return renderImproveItem();
```

- [ ] **Step 3: CSS**

paper.css, after the `.ni-agent`/`.agent-pick` rules from Task 3:

```css
.card-del.armed { color: #fff; background: var(--red-warn, #a04545); border-color: transparent; }
```

Check first whether paper.css defines a red token (`grep -n "red" src/renderer/paper.css`); if a warn/red token exists, use it instead of the fallback literal and drop the `var(..., fallback)` form.

- [ ] **Step 4: Verify + commit**

`npm test`, parse check, TEMP-SHOT a card tile showing the three buttons plus the improve sheet, BOTH themes; LOOK (armed delete state too: temp-set `delBtn.dataset.armed` path by clicking is not possible in a shot, so temp-add the `armed` class in the seed for one shot and revert). Revert temp lines. Surgical staging paper.css + app.js, commit:

```bash
git commit -m "feat: improve with your agent and delete to trash on every editable card"
```

---

### Task 6: Screenshots, polish review, end-to-end, standalone verify

- [ ] **Step 1:** TEMP-SHOT the full set in BOTH themes: reworked ＋ new sheet, improve sheet, card foot with the three buttons, retrofitted built-for-you and guided sheets. Look at every image. Revert temp lines.
- [ ] **Step 2:** Dispatch `ui-polisher` over the new CSS + screenshots; apply must-fixes; re-shot and look again.
- [ ] **Step 3:** Real end-to-end on this Mac, headless where possible:
  - Delete: call `deleteItem` via node against a scratch dir shaped like a project (create `/tmp-ish scratch/.claude/agents/junk.md`, real `trashFn` from a fake that records, or use Electron's shell in the running app for one real Trash round-trip on a throwaway file). Confirm refusal for a path outside the roots.
  - Create-blank path still works: `api.libraryCreate` round-trip via `npm start` demo or direct `createItem` call; file appears, card opens.
  - Agent-build path: in the real app, ＋ new with a description and Create it for me opens a session tile whose terminal receives the seed text (visible in the tile) addressed to the SELECTED agent, not silently the first.
- [ ] **Step 4:** `git worktree add --detach /tmp/verify-abl master`, symlink node_modules, `npm test` (expect ~62), demo-shot boot, remove worktree.
- [ ] **Step 5:** Commit any polish with surgical staging:

```bash
git commit -m "polish: agent-built library after review, both themes verified"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md` (surgical staging; mirror the edit into the worktree so the logo session's later commit keeps it)
- Modify: `docs/superpowers/plans/2026-08-08-non-dev-workbench-roadmap.md` (clean file, plain add)

- [ ] **Step 1:** README: extend the Library bullet's ＋ new sentence. Current committed text ends the Library bullet with: `＋ new scaffolds a Claude agent, Claude skill, or OpenCode agent from a template.` Replace that sentence with:

```markdown
  ＋ new takes a name and a plain-words description and hands them to a session with
  whichever agent you choose, which writes the real thing (a quiet link still gives you
  an empty template). Every editable card can be improved by your agent or moved to the
  Trash from the app.
```

- [ ] **Step 2:** Roadmap: under Standing decisions, add one line:

```markdown
- Library items are agent-built (Calvin, 2026-08-08): ＋ new seeds a session with the
  user's chosen agent (session selector on every handoff sheet); empty-template and
  delete-to-Trash round it out. Spec: specs/2026-08-08-agent-built-library-design.md.
```

- [ ] **Step 3:** Commit:

```bash
git commit -m "docs: agent-built library shipped"
```

---

## Self-review notes

- Spec coverage: session selector everywhere including Part 3 retrofits (Task 3), name + describe with agent-build default and blank-file quiet link (Task 4), improve-with-agent on editable cards with dirty guard (Task 5), delete to Trash with root guard and plugin exclusion (Tasks 1, 5), library rescan on tab switch (Task 4), no-agent fallbacks on every sheet (Tasks 3, 4, 5).
- Type consistency: `o.workerId` + `chosenAgent(o)` shape flows Task 3 → 4 → 5; `deleteItem` result `{ ok, target }` flows Task 1 → 5; seed builders' signatures flow Task 2 → 4/5; overlay types `newitem` (reused) and `improve-item` (new) wired in `renderOverlay` and `refreshAgents`.
- Known risks named: re-render of connect-form on `refreshAgents` relies on Part 3's save-keys-before-re-render rule (safe); `startGuidedSetup` keeps a `bestAgent()` fallback so old call sites cannot break; the red armed-delete color checks for an existing token before inventing one.
