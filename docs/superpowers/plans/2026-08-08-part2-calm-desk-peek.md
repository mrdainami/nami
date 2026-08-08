# Part 2 Calm Desk (Peek Overlays) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Looking at a file or an agent/skill card floats it above the desk as a peek overlay; running session tiles never reshuffle. A "Pin to desk" button promotes the peek to a real tile with its edits intact.

**Architecture:** A new `S.overlay = { type: 'peek', panel }` overlay type renders a `.peek-box` sheet and reuses the existing `mountEditor` / `mountViewer` / `mountCard` functions unchanged (they only need a `{ body }` rec, and `refreshTileHead` already no-ops for panels without tiles). Open paths (workspace rail click, cmd-click in terminal, library click, card link chips, board nodes) build the panel object but hand it to `openPeek` instead of unshifting into `S.panels`. Pinning moves the same live object into `S.panels`, so text, dirty state, and form edits carry over. Drag-and-drop onto the canvas keeps creating tiles (dropping paper on the desk is deliberate placement); restore-on-boot keeps creating tiles. Peeks are ephemeral: `savePanels` only walks `S.panels`, so nothing changes there.

**Tech Stack:** Vanilla DOM in `src/renderer/app.js` (ESM), tokens-only CSS in `paper.css`, operator overrides only in `theme-operator.css`, `node --test` for the pure decision module.

## Global Constraints

- No em dashes anywhere: not in UI copy, code comments, docs, commit messages, or anything Calvin reads (his standing rule).
- Do NOT touch `src/renderer/index.html`, any asset/branding/logo file, or header markup: a separate session is doing the logo work and we merge later.
- The working tree is shared and dirty (theme session's uncommitted diff in `package.json`, `main.js`, `openai-driver.js`, `preload.js`, `app.js`, `index.html`, `paper.css`, plus untracked `theme-operator.css`). Every commit MUST use the surgical index-staging pattern: `git show :file` as the base, apply only your exact hunks with a python exact-string script, `git hash-object -w --stdin`, `git update-index --cacheinfo 100644,<hash>,<path>`. Never `git add` a shared file whole. `node --check` every staged blob. See `stage-task3.py` / `stage-task4.py` in the session scratchpad for the pattern.
- `theme-operator.css` is untracked (owned by the theme session). Only ADD lines to it; never commit it; the additions ride along when that session commits.
- `src/main/main.js` has a stray byte; use `grep -a` when grepping it (not needed this plan, main process is untouched).
- Dual themes: paper styles via tokens in `paper.css`; operator overrides only in `theme-operator.css` scoped `body[data-theme="operator"]`. Screenshot BOTH themes for any visual change and actually look at the images (`.claude/skills/paper-design/SKILL.md`).
- Screenshots use the TEMP-SHOT pattern: a temporary boot line in demo mode that opens the state you need, reverted before staging.
- Verification: `npm test` (42 tests after this plan: 38 existing + 4 new), `npm run shot`, plus a detached-worktree boot check of committed master at the end.
- Existing code style: no semicolon-free lines, `q()` helper for querySelector, `esc()` for all interpolated HTML, single-quote strings.

---

### Task 1: Pure open-decision module (`peek-core.mjs`)

The one piece of real logic that deserves a unit test: given the tiles already on the desk, does opening a path focus an existing tile or float a new peek? This also merges the old editor/viewer dedup checks into one place (a binary file that fell back to a viewer tile is found again without re-reading it).

**Files:**
- Create: `src/renderer/peek-core.mjs`
- Test: `tests/peek-core.test.mjs`

**Interfaces:**
- Produces: `resolveOpen(panels, kind, filePath)` where `panels` is an array of `{ id, kind, filePath }`-shaped objects, `kind` is `'file'` or `'card'`, and the return is `{ action: 'focus', id }` when a matching tile exists, else `{ action: 'peek' }`. A `'file'` open matches tiles of kind `'editor'` OR `'viewer'` with the same `filePath`; a `'card'` open matches only kind `'card'`.

- [ ] **Step 1: Write the failing test**

Create `tests/peek-core.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpen } from '../src/renderer/peek-core.mjs';

const desk = [
  { id: 'p_1', kind: 'editor', filePath: '/w/notes.md' },
  { id: 'p_2', kind: 'viewer', filePath: '/w/logo.png' },
  { id: 'p_3', kind: 'card', filePath: '/w/.claude/agents/collector.md' },
  { id: 'p_4', kind: 'claude' },
];

test('a file already open as an editor tile is focused, not re-opened', () => {
  assert.deepEqual(resolveOpen(desk, 'file', '/w/notes.md'), { action: 'focus', id: 'p_1' });
});
test('a file already open as a viewer tile is focused too', () => {
  assert.deepEqual(resolveOpen(desk, 'file', '/w/logo.png'), { action: 'focus', id: 'p_2' });
});
test('a card matches only card tiles, and file opens never match cards', () => {
  assert.deepEqual(resolveOpen(desk, 'card', '/w/.claude/agents/collector.md'), { action: 'focus', id: 'p_3' });
  assert.deepEqual(resolveOpen(desk, 'file', '/w/.claude/agents/collector.md'), { action: 'peek' });
});
test('nothing on the desk matches: peek (and empty or missing lists are safe)', () => {
  assert.deepEqual(resolveOpen(desk, 'file', '/w/other.md'), { action: 'peek' });
  assert.deepEqual(resolveOpen([], 'file', '/w/notes.md'), { action: 'peek' });
  assert.deepEqual(resolveOpen(null, 'card', '/w/x.md'), { action: 'peek' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: the 4 new tests FAIL with a module-not-found error for `peek-core.mjs`; the existing 38 still pass.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/peek-core.mjs`:

```js
// Decide what opening something should do given the tiles already on the desk.
// 'file' opens match editor OR viewer tiles (a binary that fell back to a
// viewer tile must be found again without a re-read); 'card' matches cards only.
export function resolveOpen(panels, kind, filePath) {
  const kinds = kind === 'card' ? ['card'] : ['editor', 'viewer'];
  const hit = (panels || []).find((p) => kinds.includes(p.kind) && p.filePath === filePath);
  return hit ? { action: 'focus', id: hit.id } : { action: 'peek' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: 42/42 PASS.

- [ ] **Step 5: Commit (surgical staging not needed: both files are new and untracked by the theme session)**

```bash
git add src/renderer/peek-core.mjs tests/peek-core.test.mjs
git commit -m "feat: open-decision core for peek overlays (focus existing tile or float)"
```

---

### Task 2: The peek overlay itself (render, pin, guarded close, keyboard)

**Files:**
- Modify: `src/renderer/app.js` (import; new functions after `closeOverlay` in the overlays section around line 1199; one branch in `renderOverlay`; one guard branch in `refreshTileHead`; three lines in `onGlobalKey`)
- Modify: `src/renderer/paper.css` (append `.peek-box` block after the `.setup-note` rule, around line 519)

**Interfaces:**
- Consumes: `resolveOpen` from Task 1 (imported but first used in Task 3), existing `mountEditor(p, rec)` / `mountViewer(p, rec)` / `mountCard(p, rec)` which only need `rec = { body }`, existing `overlay` root wiring in `renderOverlay`.
- Produces: `openPeek(p)` (floats a panel object, guarding a dirty current peek), `renderPeek()` (called from `renderOverlay`), `pinPeek()` (moves `S.overlay.panel` into `S.panels`), `requestClosePeek()` (confirm-guarded close). Task 3 calls `openPeek`.

- [ ] **Step 1: Import the core module**

In `src/renderer/app.js`, find the existing top-of-file imports (there is an import of `file-kinds.mjs` and `frontmatter.mjs`) and add alongside them:

```js
import { resolveOpen } from './peek-core.mjs';
```

- [ ] **Step 2: Add the peek functions**

In the overlays section of `app.js`, directly after `function closeOverlay() { ... }` (line ~1199), add:

```js
// ---- peek: float a file or card above the desk without touching the tiles --
function openPeek(p) {
  const cur = S.overlay && S.overlay.type === 'peek' && S.overlay.panel;
  if (cur && (cur.kind === 'editor' || cur.kind === 'card') && cur.dirty
      && !confirm(`Discard unsaved changes to ${baseNameOf(cur.filePath)}?`)) return;
  S.overlay = { type: 'peek', panel: p }; renderOverlay();
}
function renderPeek() {
  const p = S.overlay.panel;
  const wrap = document.createElement('div'); wrap.className = 'overlay'; wrap.onclick = requestClosePeek;
  const box = document.createElement('div'); box.className = 'peek-box'; box.onclick = (e) => e.stopPropagation();
  box.innerHTML = `<div class="peek-head">
      <span class="code" style="background:${p.tint}">${esc(p.code)}</span>
      <span class="col"><span class="pk-title">${esc(p.title)}${p.dirty ? ' •' : ''}</span><span class="pk-sub">${esc(shortHome(p.filePath))}</span></span>
      <button class="btn btn--go pk-pin" title="Keep it open as a tile on the desk">Pin to desk</button>
      <button class="t-btn pk-x" title="Close">✕</button>
    </div><div class="peek-body"></div>`;
  wrap.appendChild(box); els.overlayRoot.appendChild(wrap);
  const rec = { body: q('.peek-body', box) };
  if (p.kind === 'editor') mountEditor(p, rec);
  else if (p.kind === 'card') mountCard(p, rec);
  else mountViewer(p, rec);
  q('.pk-pin', box).onclick = pinPeek;
  q('.pk-x', box).onclick = requestClosePeek;
}
function pinPeek() {
  const o = S.overlay; if (!o || o.type !== 'peek') return;
  const p = o.panel;
  S.overlay = null;
  S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
  renderOverlay(); renderGrid(); renderRail(); renderHeader(); savePanels();
}
function requestClosePeek() {
  const o = S.overlay; if (!o || o.type !== 'peek') { closeOverlay(); return; }
  const p = o.panel;
  if ((p.kind === 'editor' || p.kind === 'card') && p.dirty
      && !confirm(`Discard unsaved changes to ${baseNameOf(p.filePath)}?`)) return;
  closeOverlay();
}
```

- [ ] **Step 3: Route the overlay renderer and keyboard through the peek**

In `renderOverlay` (line ~1191), add the branch after the `'launcher'` line:

```js
  if (o.type === 'peek') return renderPeek();
```

In `onGlobalKey` (line ~221), the peek must own ⌘W, ⌘S, and Escape while it is open. Change the ⌘W line to check the peek first, add a peek branch at the top of the ⌘S handler, and route Escape through the guard. The three edited lines become:

```js
  if (meta && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); if (S.overlay && S.overlay.type === 'peek') requestClosePeek(); else if (S.activeId) closePanel(S.activeId); return; }
  if (meta && (e.key === 's' || e.key === 'S')) { const pk = S.overlay && S.overlay.type === 'peek' && S.overlay.panel; if (pk && pk.kind === 'editor') { e.preventDefault(); saveEditor(pk); return; } if (pk && pk.kind === 'card') { e.preventDefault(); saveCard(pk); return; } const p = S.panels.find((x) => x.id === S.activeId); if (p && p.kind === 'editor') { e.preventDefault(); saveEditor(p); } else if (p && p.kind === 'card') { e.preventDefault(); saveCard(p); } return; }
  if (e.key === 'Escape') { if (S.overlay && S.overlay.type === 'peek') { requestClosePeek(); } else if (S.overlay) { S.overlay = null; renderOverlay(); } else if (S.expandedId) { S.expandedId = null; renderGrid(); } }
```

- [ ] **Step 4: Let the dirty dot reach the peek title**

`mountEditor` and `mountCard` mark dirty through `refreshTileHead(p)`, which currently returns early when the panel has no tile. Change its first line (line ~487) from:

```js
  const t = tileEls.get(p.id); if (!t) return;
```

to:

```js
  const t = tileEls.get(p.id);
  if (!t) {
    if (S.overlay && S.overlay.type === 'peek' && S.overlay.panel === p) {
      const el = q('.pk-title'); if (el) el.textContent = p.title + (p.dirty ? ' •' : '');
    }
    return;
  }
```

- [ ] **Step 5: Add the paper CSS**

In `src/renderer/paper.css`, directly after the `.setup-note` rule (line ~519), add:

```css
/* peek: a sheet held above the desk; pinning drops it onto the grid */
.peek-box { width: min(860px, calc(100vw - 120px)); display: flex; flex-direction: column;
  background: repeating-linear-gradient(0deg, rgba(120, 95, 60, 0.02) 0 1px, transparent 1px 4px), var(--paper);
  border: 1px solid var(--dash-dark); box-shadow: 10px 12px 0 rgba(60, 45, 25, 0.25);
  transform: rotate(-0.4deg); animation: rise 0.18s ease both; }
.peek-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 2px dashed var(--dash); }
.peek-head .code { width: 26px; height: 26px; flex: none; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; border: 1px solid rgba(60, 45, 25, 0.3); }
.peek-head .col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.peek-head .pk-title { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.peek-head .pk-sub { font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.peek-head .pk-pin { font-size: 11px; padding: 6px 12px; }
.peek-body { position: relative; height: min(560px, calc(100vh - 220px)); }
```

(`.editor`, `.viewer`, and `.card-ed` are all `position: absolute; inset: 0`, so a relatively positioned, height-bounded `.peek-body` is all they need.)

- [ ] **Step 6: Syntax-check and test**

Run: `node --check src/renderer/app.js` is not valid for ESM; instead run `node -e "import('./src/renderer/app.js').catch(e => { console.error(e.message); process.exit(1); })"` and expect it to fail ONLY on browser globals (`document is not defined`), never on a SyntaxError. Then `npm test`.
Expected: no syntax errors; 42/42 PASS.

- [ ] **Step 7: Smoke it visually (TEMP-SHOT)**

Add a temporary line at the end of the demo branch of `boot()` (the `S.demo` path used by `npm run shot`):

```js
  openPeek({ id: 'pk_1', kind: 'editor', tint: TINTS[1], code: 'ED', title: 'passkey.ts', filePath: '/Users/calvin/work/atlas/src/auth/passkey.ts', text: 'export async function register(user) {\n  return verifyRegistration(user)\n}\n', dirty: false, status: 'live' });
```

Run `npm run shot`, open `shots/app.png`, and LOOK: the peek sheet floats over the demo tiles, head shows chip, title, path, Pin to desk, ✕; the editor body renders with its gutter and Save bar. Repeat with the operator theme (the shot harness takes a theme, or temporarily set `document.body.dataset.theme = 'operator'` in the same temp block). Keep the temp line for Task 4's screenshots or re-add it there; it must be reverted before any staging.

- [ ] **Step 8: Commit with surgical staging**

`app.js` and `paper.css` carry the theme session's uncommitted diff. Write a `stage-part2-task2.py` in the scratchpad following the `stage-task3.py` pattern: for each file, take `git show :src/renderer/app.js` (and `:src/renderer/paper.css`) as the base, apply ONLY the exact hunks from Steps 1 to 5 with unique-anchor exact-string replacement, hash and `update-index`. Verify each anchor appears exactly once in the INDEX version before replacing. `node --check` the staged app.js blob after converting is not possible (ESM); instead stage it and run `git show :src/renderer/app.js | npx acorn --ecma2022 --module --silent` or a `new Function`-free parse via `node --input-type=module -e` on the blob text to confirm it parses. Then:

```bash
git commit -m "feat: peek overlay floats files and cards above the desk, pin to promote"
```

Confirm `git status` afterwards still shows exactly the theme session's diff (plus untracked files) and nothing of theirs was committed.

---

### Task 3: Rewire every open path through the peek

**Files:**
- Modify: `src/renderer/app.js` (`openFile` / `openViewer` / `openEditor` region lines ~878-901, `openCard` line ~667, `restorePanels` line ~854, the card `dup` handler line ~757)

**Interfaces:**
- Consumes: `openPeek(p)` from Task 2, `resolveOpen` from Task 1.
- Produces: `openFile(filePath)` now peeks by default; `openFile(filePath, { pin: true })` builds a tile (restore + canvas drop); `openCard(item)` peeks; `openCard(item, { pin: true })` builds a tile (restore). All existing callers of `openFile(path)` and `openCard(item)` keep their one-argument form and get peek behavior for free.

- [ ] **Step 1: Rebuild the file-open path**

Replace the whole block from `const VIEWER_CODES = ...` (line ~878) through the end of `openEditor` (line ~901) with:

```js
const VIEWER_CODES = { image: 'IM', video: 'VI', audio: 'AU', pdf: 'PD', other: 'FI' };
function viewerPanel(filePath, sub, note) {
  return { id: uid('p_'), kind: 'viewer', sub, note, tint: TINTS[hashIdx(filePath)], code: VIEWER_CODES[sub] || 'VW', title: baseNameOf(filePath), filePath, status: 'live', cwd: S.project && S.project.path };
}
// Build the right panel for any path: media/pdf → viewer, text → editor,
// unreadable/binary → an 'other' viewer card with the reason.
async function buildFilePanel(filePath) {
  const kind = fileKind(filePath);
  if (kind !== 'text') return viewerPanel(filePath, kind);
  const res = await api.rawFile(filePath);
  if (!res.ok) return viewerPanel(filePath, 'other', res.error || 'Could not open');
  return { id: uid('p_'), kind: 'editor', tint: TINTS[hashIdx(filePath)], code: 'ED', title: baseNameOf(filePath), filePath, text: res.text, dirty: false, status: 'live', cwd: S.project && S.project.path };
}
// Looking at a file floats it above the desk; only pinning (or an explicit
// drop on the canvas, or restore-on-boot) makes it a tile.
async function openFile(filePath, opts) {
  const r = resolveOpen(S.panels, 'file', filePath);
  if (r.action === 'focus') { focusPanel(r.id); return; }
  const p = await buildFilePanel(filePath);
  if (opts && opts.pin) {
    S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
    renderGrid(); renderRail(); renderHeader(); savePanels();
  } else openPeek(p);
}
```

`openViewer` and `openEditor` are deleted. Grep for remaining callers: `openViewer(` and `openEditor(` must have zero call sites left after Step 2 and Step 3 (line ~531 `openFile(st.abs)` in `registerPathLinks`, line ~330 tree row, both already call `openFile` and now peek for free).

- [ ] **Step 2: Canvas drops stay tiles**

In `buildShell` (line ~207), change the grid drop handler line from `paths.forEach(openFile);` to:

```js
    paths.forEach((f) => openFile(f, { pin: true }));
```

- [ ] **Step 3: Cards peek, with a pin option**

Rewrite `openCard` (line ~667):

```js
async function openCard(item, opts) {
  await loadLibrary();
  const r = resolveOpen(S.panels, 'card', item.filePath);
  if (r.action === 'focus') { focusPanel(r.id); return; }
  const res = await api.rawFile(item.filePath);
  if (!res.ok) { toast(res.error || 'Could not open'); loadLibrary(true); return; }
  const doc = parseDoc(res.text);
  const chip = TYPE_CHIP[item.type] || TYPE_CHIP.agent;
  const p = {
    id: uid('p_'), kind: 'card', item, filePath: item.filePath, doc, raw: res.text,
    mode: doc.hasFrontmatter ? 'form' : 'raw', dirty: false, status: 'live',
    tint: chip.tint, code: chip.code, title: item.name, cwd: S.project && S.project.path,
  };
  if (doc.malformed) toast('Frontmatter looks malformed. Raw view only.');
  if (opts && opts.pin) {
    S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
    renderGrid(); renderRail(); renderHeader(); savePanels();
  } else openPeek(p);
}
```

(The malformed toast also loses its em dash while we are here.)

- [ ] **Step 4: Restore-on-boot pins**

In `restorePanels` (line ~854), the three open calls become:

```js
      if (s.kind === 'editor') await openFile(s.filePath, { pin: true });
      else if (s.kind === 'viewer') await openFile(s.filePath, { pin: true });
      else if (s.kind === 'card' && s.item) await openCard(s.item, { pin: true });
```

(A restored 'viewer' snap is safe through `openFile`: media routes to a viewer panel by extension, and an old binary-fallback viewer re-falls back inside `buildFilePanel`.)

- [ ] **Step 5: The card Duplicate button opens the copy as a peek**

No code change needed (`openCard(res.item)` at line ~763 now peeks), but VERIFY the flow reads right: duplicate from a peeked read-only plugin card replaces the peek with the editable copy. Also verify the `Use` button on a peeked Claude agent card: check `useAgent` (line ~1037); if it does not already call `closeOverlay()`, add `closeOverlay();` as its first line so using an agent from a peek (or from the ⌘K picker) drops the sheet and shows the new session.

- [ ] **Step 6: Test and smoke**

Run `npm test` (42/42). Then `npm start` against the real repo folder and walk every entry point once:
1. Workspace rail: click a text file. Expect a floating editor peek; tiles behind do not move. Esc closes. Reopen, type a character, Esc: expect a discard confirm. Pin to desk: expect a tile with the edit still there and the dirty dot in the tile head.
2. Workspace rail: click an image or PDF. Expect a viewer peek.
3. Click the same file again after pinning: expect the existing tile focused, no peek.
4. Library rail: click an agent. Expect a card peek; link chips swap the peek to the referenced card; Map opens the corkboard; clicking a board node opens that card as a peek.
5. Terminal tile: ⌘-click a path. Expect a peek, not a tile.
6. Drag a file from Finder onto empty canvas. Expect a TILE (deliberate placement).
7. Quit and relaunch: pinned tiles restore; peeks do not.

- [ ] **Step 7: Commit with surgical staging**

Same pattern as Task 2 (`app.js` only this time). Verify staged blob parses, then:

```bash
git commit -m "feat: calm desk, every look-at-a-file path floats a peek instead of reshuffling tiles"
```

---

### Task 4: Operator theme, screenshots of both themes, polish review

**Files:**
- Modify: `src/renderer/theme-operator.css` (ADDITIVE lines only; file is untracked and owned by the theme session, do not commit it)
- Possibly modify: `src/renderer/paper.css` (whatever the ui-polisher review finds)

**Interfaces:**
- Consumes: `.peek-box` / `.peek-head` / `.peek-body` classes from Task 2.

- [ ] **Step 1: Add operator overrides**

Read `theme-operator.css` and extend the existing grouped selectors the same way `.setup-box` was added in Part 1: add `.peek-box` to the flat-shadow modal group (the rule that flattens `10px 12px` paper shadows and squares corners for `.picker-box, .setup-box, .modal`), and add any `.peek-head .code` chip line to the dark chip group if the file styles `.code` chips per-container. Match the file's exact existing patterns; only append or extend selector lists, never reorder or rewrite the theme session's lines.

- [ ] **Step 2: Screenshot both themes**

Re-add the Task 2 Step 7 TEMP-SHOT line (editor peek), run `npm run shot`, inspect the paper image. Flip to operator (temp `document.body.dataset.theme = 'operator'` in the same block), shot again, inspect: flat shadow, dark paper, readable chip, no light-theme bleed. Also shot a CARD peek once (swap the temp panel for a demo card is not possible without library data; instead peek a viewer: `openPeek(viewerPanel('/Users/calvin/work/atlas/logo.png', 'other', 'Demo file'))`) to confirm the fallback viewer centers in the peek body. Revert every temp line.

- [ ] **Step 3: ui-polisher review**

Dispatch the `ui-polisher` agent over the Task 2 CSS and the screenshots' findings; apply what it flags (focus styles, spacing, dashed-vs-solid consistency). Re-shot after fixes and look again.

- [ ] **Step 4: Verify clean master boots alone**

```bash
git worktree add --detach /tmp/verify-p2 master
ln -s ~/Desktop/dainami-cli/node_modules /tmp/verify-p2/node_modules
cd /tmp/verify-p2 && npm test
```

Expected: 42/42 in the worktree (peek code must not reference anything uncommitted, especially nothing from `theme-operator.css` or the theme session's JS helpers). Then remove the worktree.

- [ ] **Step 5: Commit polish (paper.css only, surgical staging; theme-operator.css stays uncommitted)**

```bash
git commit -m "polish: peek overlay, operator overrides ride with theme session"
```

(If Step 3 produced no `paper.css` changes, skip the commit; the operator lines land with the theme session either way.)

---

### Task 5: Docs

**Files:**
- Modify: `README.md` (the feature bullets)
- Modify: `docs/superpowers/plans/2026-08-08-non-dev-workbench-roadmap.md` (tick Part 2)

- [ ] **Step 1: README**

Replace the "Viewer tiles" bullet's opening so it describes peek-then-pin. New text for the bullet (keep the media-type detail that follows):

```markdown
- **Peek, then pin**: click any file in the Workspace rail (or ⌘-click a path in a terminal)
  and it floats above the desk as a paper sheet; your running sessions never move. One click
  on **Pin to desk** keeps it as a tile. Images, video, audio and PDFs preview in the peek;
  text opens in the paper editor; drag a file from Finder onto the canvas to pin it directly.
```

Also update the Library bullet's "Click one to edit it as a paper card" to "Click one to peek at it as a paper card (pin it to keep it on the desk)".

- [ ] **Step 2: Roadmap**

Tick Part 2's checkbox and append a status line naming the commits and the test count, in the same voice as Part 1's.

- [ ] **Step 3: Commit (README is clean of theme-session diff? verify with `git diff README.md` first; roadmap file is ours alone)**

```bash
git add README.md docs/superpowers/plans/2026-08-08-non-dev-workbench-roadmap.md
git commit -m "docs: calm desk shipped, peek then pin"
```

---

## Self-review notes

- Spec coverage: overlays by default (Tasks 2+3), pin to board (Task 2 `pinPeek`), never reshuffles sessions (peek never touches `S.panels`; verified in Task 3 Step 6 walk), corkboard-like float (same `.overlay` root and paper-sheet styling).
- Deliberate scope decisions: canvas drag-and-drop keeps making tiles (physical placement gesture, matches README); peeks are ephemeral across restarts (a peek is a glance, not layout); AI chat and terminals never peek (sessions are always tiles).
- Type consistency: `resolveOpen(panels, kind, filePath)` used identically in Tasks 1 and 3; `openFile(filePath, opts)` / `openCard(item, opts)` with `{ pin: true }` used in Tasks 3 only; `openPeek(p)` produced in Task 2, consumed in Task 3.
