# File Drop + Viewer Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag any file from anywhere on the computer into a session (its path lands in the terminal/chat, shell-quoted), and click/drop any file to view it in-app — images, video, audio, PDF as paper "viewer tiles", with a Finder-fallback card for everything else.

**Architecture:** All new UI lives in the existing vanilla-DOM renderer (`src/renderer/app.js` + `paper.css`). File-type detection and shell-quoting are pure functions in a new shared module `src/renderer/file-kinds.mjs` (unit-testable with `node --test`, no framework). Dropped `File` objects are resolved to absolute paths via `webUtils.getPathForFile` exposed from the preload. Media renders through plain `file://` URLs — the page itself is loaded via `file://` and has no CSP, so `<img>/<video>/<audio>/<iframe>` load local files natively with range-request streaming; no new IPC, no custom protocol, no dependencies.

**Tech Stack:** Electron 43 (CJS main, ESM renderer), vanilla DOM, `node:test` for unit tests.

## Global Constraints

- No new npm dependencies (dependencies stay exactly: `@anthropic-ai/claude-agent-sdk`, `@lydell/node-pty`, `@xterm/addon-fit`, `@xterm/xterm`; devDependencies: `electron`).
- Main process is CommonJS (`require`); renderer is ESM (`import`). `file-kinds.mjs` is ESM (renderer + tests only — never `require`d from main).
- Match existing code style: 2-space indent, single quotes, compact one-line guards (`if (x) return;`), `esc()` for all HTML interpolation, `toast()` for user feedback.
- The paper aesthetic: viewer tiles reuse existing tile chrome (`.tile`, `.tile-head`, `.ed-bar`), cream backgrounds, existing CSS custom properties.
- Existing behavior must not regress: tile drag-reorder (`text/plain` drags), editor tiles, dictation, `npm run shot` demo screenshot.
- `darwin` is the target platform (paths are POSIX; `shellQuote` uses single-quote POSIX quoting).

---

### Task 1: `file-kinds.mjs` pure helpers + unit tests

**Files:**
- Create: `src/renderer/file-kinds.mjs`
- Create: `tests/file-kinds.test.mjs`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 3–5):
  - `fileKind(path: string) -> 'image'|'video'|'audio'|'pdf'|'text'` (no `'other'` here — "other" is decided at open time when the editor read fails)
  - `shellQuote(path: string) -> string` (POSIX single-quoted)
  - `fileUrl(absPath: string) -> string` (percent-encoded `file://` URL)

- [ ] **Step 1: Write the failing tests**

Create `tests/file-kinds.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, shellQuote, fileUrl } from '../src/renderer/file-kinds.mjs';

test('fileKind: images', () => {
  for (const f of ['a.png', 'b.JPG', 'c.jpeg', 'd.gif', 'e.webp', 'f.svg', 'g.bmp', 'h.ico', 'i.avif'])
    assert.equal(fileKind(f), 'image', f);
});
test('fileKind: video', () => {
  for (const f of ['clip.mp4', 'clip.webm', 'clip.MOV', 'clip.m4v']) assert.equal(fileKind(f), 'video', f);
});
test('fileKind: audio', () => {
  for (const f of ['x.mp3', 'x.wav', 'x.m4a', 'x.aac', 'x.ogg', 'x.flac']) assert.equal(fileKind(f), 'audio', f);
});
test('fileKind: pdf', () => { assert.equal(fileKind('doc.PDF'), 'pdf'); });
test('fileKind: everything else is text', () => {
  for (const f of ['a.ts', 'Makefile', 'notes.md', 'x.json', 'no-ext', '/tmp/.hidden'])
    assert.equal(fileKind(f), 'text', f);
});
test('fileKind: full paths use the basename', () => {
  assert.equal(fileKind('/Users/cal/My Movies/demo.mp4'), 'video');
  assert.equal(fileKind('/Users/cal/dir.mp4/readme.txt'), 'text');
});
test('shellQuote: plain path', () => { assert.equal(shellQuote('/tmp/a.txt'), "'/tmp/a.txt'"); });
test('shellQuote: spaces stay inside quotes', () => { assert.equal(shellQuote('/tmp/My File.txt'), "'/tmp/My File.txt'"); });
test('shellQuote: embedded single quote', () => { assert.equal(shellQuote("/tmp/it's.txt"), "'/tmp/it'\\''s.txt'"); });
test('fileUrl: encodes spaces, keeps slashes', () => {
  assert.equal(fileUrl('/Users/cal/My File.png'), 'file:///Users/cal/My%20File.png');
});
test('fileUrl: encodes hash and question mark', () => {
  assert.equal(fileUrl('/tmp/a#b?.png'), 'file:///tmp/a%23b%3F.png');
});
```

- [ ] **Step 2: Add the test script and run to verify failure**

In `package.json` `"scripts"`, add: `"test": "node --test tests/"`.
Run: `npm test`
Expected: FAIL — cannot find module `../src/renderer/file-kinds.mjs`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/file-kinds.mjs`:

```js
// Pure file-type + path helpers shared by the renderer and unit tests. No DOM, no Electron.

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac']);

function extOf(p) {
  const base = String(p || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

// 'image' | 'video' | 'audio' | 'pdf' | 'text' — text is the default; the editor's
// read decides at open time whether it's really editable (binary/huge → fallback card).
export function fileKind(p) {
  const e = extOf(p);
  if (IMAGE_EXT.has(e)) return 'image';
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (e === 'pdf') return 'pdf';
  return 'text';
}

// POSIX single-quoting: safe to paste into a shell or a chat message.
export function shellQuote(p) { return "'" + String(p).replace(/'/g, "'\\''") + "'"; }

// Absolute POSIX path → file:// URL (renderer has no Node pathToFileURL).
export function fileUrl(absPath) {
  return 'file://' + String(absPath).split('/').map(encodeURIComponent).join('/');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/file-kinds.mjs tests/file-kinds.test.mjs package.json
git commit -m "feat: file-kinds helpers (type detection, shell quoting, file URLs) with unit tests"
```

---

### Task 2: Bridge plumbing — dropped-file paths, binary detection, PDF support

**Files:**
- Modify: `src/main/preload.js`
- Modify: `src/main/main.js:208-215` (`file:raw`), `src/main/main.js:134-139` (webPreferences)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 3–5):
  - Renderer API `api.droppedFilePath(file: File) -> string` (absolute path or `''`)
  - `file:raw` result gains `binary: true` on NUL-byte files: `{ ok: false, binary: true, error: 'binary file' }`
  - `plugins: true` in webPreferences so the PDF iframe viewer works.

- [ ] **Step 1: Expose `webUtils.getPathForFile` in the preload**

In `src/main/preload.js` line 1, change the require to:

```js
const { contextBridge, ipcRenderer, webUtils } = require('electron');
```

Inside the `exposeInMainWorld('dainami', { ... })` object, after the `boot:` line add:

```js
  droppedFilePath: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
```

(`File` objects pass through the context bridge; `webUtils.getPathForFile` is the Electron ≥32 replacement for the removed `File.path`.)

- [ ] **Step 2: Binary detection in `file:raw`**

In `src/main/main.js`, replace the body of the `file:raw` handler (lines 208–215) with:

```js
ipcMain.handle('file:raw', (_e, file) => {
  try {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) return { ok: false, error: 'is a directory' };
    if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'file too large to edit (' + fmtSize(stat.size) + ')', size: fmtSize(stat.size) };
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return { ok: false, binary: true, error: 'binary file', size: fmtSize(stat.size) };
    return { ok: true, text: buf.toString('utf8'), path: file, size: fmtSize(stat.size) };
  } catch (e) { return { ok: false, error: e.message }; }
});
```

- [ ] **Step 3: Enable the Chromium PDF viewer**

In `src/main/main.js` `createWindow()`, extend webPreferences:

```js
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, plugins: true },
```

- [ ] **Step 4: Smoke-test the app still boots**

Run: `npm run shot`
Expected: prints `screenshot → …/shots/app.png` and exits 0. Then run `npm test` — still all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/preload.js src/main/main.js
git commit -m "feat: dropped-file path bridge, binary detection in file:raw, PDF viewer pref"
```

---

### Task 3: Drop files into sessions (tiles + command bar)

**Files:**
- Modify: `src/renderer/app.js` (imports, `buildShell`, `mountTile` drag handlers, new `droppedPaths`/`isFileDrag`/`dropFilesOnPanel` helpers)
- Modify: `src/renderer/paper.css` (`.tile.file-hint`, `.cmdbar-box.file-hint`)

**Interfaces:**
- Consumes: `api.droppedFilePath` (Task 2), `shellQuote` from `./file-kinds.mjs` (Task 1), existing `injectToSession(p, text)` at `app.js:467`.
- Produces (used by Task 5): `droppedPaths(e) -> string[]`, `isFileDrag(e) -> boolean`, `openFile(path)` is NOT yet defined — until Task 4, drops on editor tiles call `openEditor` (Task 4 rewires to `openFile`).

- [ ] **Step 1: Import helpers**

At the top of `src/renderer/app.js`, after the xterm imports add:

```js
import { fileKind, shellQuote, fileUrl } from './file-kinds.mjs';
```

- [ ] **Step 2: Add drop helpers + window guards**

Near the other top-level helpers (after `q()`, ~line 55), add:

```js
// ---- OS file drops ---------------------------------------------------------
function isFileDrag(e) { return Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files'); }
function droppedPaths(e) {
  return Array.from((e.dataTransfer && e.dataTransfer.files) || [])
    .map((f) => api.droppedFilePath(f)).filter(Boolean);
}
function dropFilesOnPanel(p, paths) {
  if (p.kind === 'editor') { paths.forEach(openEditor); return; }
  injectToSession(p, paths.map(shellQuote).join(' ') + ' ');
  toast('Dropped ' + (paths.length === 1 ? baseNameOf(paths[0]) : paths.length + ' files') + ' into ' + shorten(p.title, 24));
}
```

At the end of `buildShell()` (just before `applyChrome();`), stop Electron from navigating on stray drops:

```js
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
```

- [ ] **Step 3: Teach tiles to accept file drops (keep reorder working)**

In `mountTile` (`app.js:330-335`), replace the three drag listeners on `root` with:

```js
  root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add(isFileDrag(e) ? 'file-hint' : 'drop-hint'); });
  root.addEventListener('dragleave', () => root.classList.remove('drop-hint', 'file-hint'));
  root.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    root.classList.remove('drop-hint', 'file-hint');
    const paths = droppedPaths(e);
    if (paths.length) return dropFilesOnPanel(p, paths);
    reorderPanels(e.dataTransfer.getData('text/plain'), p.id);
  });
```

- [ ] **Step 4: Command bar accepts drops**

In `buildShell()`, after the existing `els.cmdInput` listeners, add:

```js
  els.cmdInput.addEventListener('dragover', (e) => { if (isFileDrag(e)) { e.preventDefault(); els.cmdbarBox.classList.add('file-hint'); } });
  els.cmdInput.addEventListener('dragleave', () => els.cmdbarBox.classList.remove('file-hint'));
  els.cmdInput.addEventListener('drop', (e) => {
    els.cmdbarBox.classList.remove('file-hint');
    const paths = droppedPaths(e); if (!paths.length) return;
    e.preventDefault(); e.stopPropagation();
    const v = els.cmdInput.value ? els.cmdInput.value.trimEnd() + ' ' : '';
    els.cmdInput.value = v + paths.map(shellQuote).join(' ') + ' ';
    S.draft = els.cmdInput.value; refreshCmdPreview(); els.cmdInput.focus();
  });
```

- [ ] **Step 5: Drop styling**

In `src/renderer/paper.css`, after `.tile.drop-hint` (line 537), add:

```css
.tile.file-hint { outline: 2px dashed var(--amber-line, #c9a94e); outline-offset: 2px; box-shadow: 0 0 0 3px rgba(201, 169, 78, 0.25), 5px 6px 0 var(--shadow-mid); }
.cmdbar-box.file-hint { outline: 2px dashed var(--amber-line, #c9a94e); outline-offset: 2px; }
```

- [ ] **Step 6: Verify**

Run: `npm test` (helpers untouched — PASS) and `npm run shot` (boots, screenshot written, exit 0).
Then run `npm start`, open a folder, start a `/term` session, and drag a file from Finder onto the tile — the quoted path must appear at the shell prompt; drag onto the command bar — the quoted path must appear in the input. (If executing autonomously without a human: verify `npm run shot` passes, grep the diff for the three wired listeners, and leave real-drag confirmation to the final human checkpoint in Task 5.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/app.js src/renderer/paper.css
git commit -m "feat: drag files from anywhere into session tiles and the command bar"
```

---

### Task 4: Viewer tiles — image, video, audio, PDF, fallback card

**Files:**
- Modify: `src/renderer/app.js` (`openFile` dispatcher, `openViewer`, `mountViewer`, wiring in `mountTile`/`statusMeta`/`kindLabel`/`closePanel`, tree + path-link rewire, editor fallback)
- Modify: `src/renderer/paper.css` (viewer styles)

**Interfaces:**
- Consumes: `fileKind`/`fileUrl` (Task 1), `file:raw` `binary` flag (Task 2), existing `openEditor` (`app.js:495`), `api.revealFile`, `esc`, `shortHome`, `baseNameOf`, `TINTS`, `hashIdx`, `focusPanel`.
- Produces (used by Task 5): `openFile(filePath: string)` — the single entry point for opening any path; `openViewer(filePath, sub, note?)` with `sub ∈ 'image'|'video'|'audio'|'pdf'|'other'`.

- [ ] **Step 1: `openFile` dispatcher + `openViewer`**

In `app.js`, directly above `openEditor` (~line 495), add:

```js
const VIEWER_CODES = { image: 'IM', video: 'VI', audio: 'AU', pdf: 'PD', other: 'FI' };
// Open any path the right way: media/pdf → viewer tile, everything else → editor
// (which falls back to an 'other' viewer card when the file is binary or too large).
function openFile(filePath) {
  const kind = fileKind(filePath);
  if (kind === 'text') return openEditor(filePath);
  openViewer(filePath, kind);
}
function openViewer(filePath, sub, note) {
  const existing = S.panels.find((x) => x.kind === 'viewer' && x.filePath === filePath);
  if (existing) { focusPanel(existing.id); return; }
  const p = { id: uid('p_'), kind: 'viewer', sub, note, tint: TINTS[hashIdx(filePath)], code: VIEWER_CODES[sub] || 'VW', title: baseNameOf(filePath), filePath, status: 'live', cwd: S.project && S.project.path };
  S.panels.unshift(p); S.activeId = p.id; S.expandedId = null;
  renderGrid(); renderRail(); renderHeader();
}
```

- [ ] **Step 2: Editor falls back to the 'other' card**

In `openEditor` (`app.js:495-503`), replace the failure line

```js
  if (!res.ok) { toast(res.error || 'Could not open'); return; }
```

with:

```js
  if (!res.ok) { openViewer(filePath, 'other', res.error || 'Could not open'); return; }
```

- [ ] **Step 3: `mountViewer`**

After `mountEditor`/`saveEditor` (~line 424), add:

```js
// ---- viewer tiles (image / video / audio / pdf / fallback) -----------------
function mountViewer(p, rec) {
  const wrap = document.createElement('div'); wrap.className = 'viewer viewer--' + p.sub;
  const url = fileUrl(p.filePath);
  const fallback = `<div class="vw-stage vw-stage--pad"><div class="vw-glyph">▣</div>
      <div class="vw-name">${esc(p.title)}</div>
      <div class="vw-note">${esc(p.note || "Can't preview this file here.")}</div>
      <button class="btn vw-reveal">Reveal in Finder</button></div>`;
  if (p.sub === 'image') wrap.innerHTML = `<div class="vw-stage"><img src="${esc(url)}" alt="${esc(p.title)}" /></div>`;
  else if (p.sub === 'video') wrap.innerHTML = `<div class="vw-stage vw-stage--dark"><video src="${esc(url)}" controls playsinline></video></div>`;
  else if (p.sub === 'audio') wrap.innerHTML = `<div class="vw-stage vw-stage--pad"><div class="vw-glyph">♪</div><div class="vw-name">${esc(p.title)}</div><audio src="${esc(url)}" controls></audio></div>`;
  else if (p.sub === 'pdf') wrap.innerHTML = `<iframe class="vw-pdf" src="${esc(url)}"></iframe>`;
  else wrap.innerHTML = fallback;
  wrap.insertAdjacentHTML('beforeend',
    `<div class="ed-bar"><span class="ed-path">${esc(shortHome(p.filePath))}</span><button class="btn vw-finder">Finder</button></div>`);
  rec.body.appendChild(wrap);
  wrap.querySelectorAll('.vw-reveal, .vw-finder').forEach((b) => { b.onclick = () => api.revealFile(p.filePath); });
  const media = wrap.querySelector('img, video, audio');
  if (media) media.addEventListener('error', () => {
    const stage = wrap.querySelector('.vw-stage, .vw-pdf');
    p.note = 'This format could not be decoded.';
    if (stage) stage.outerHTML = fallback;
    const b = wrap.querySelector('.vw-reveal'); if (b) b.onclick = () => api.revealFile(p.filePath);
  }, { once: true });
}
```

- [ ] **Step 4: Wire the viewer kind through the tile lifecycle**

Four one-line edits in `app.js`:

1. `mountTile` (line 337): `if (p.kind === 'editor') mountEditor(p, rec); else if (p.kind === 'viewer') mountViewer(p, rec); else mountTerminal(p, rec);`
2. `statusMeta` (line 273, add above the editor line): `if (p.kind === 'viewer') return { label: p.sub, color: '#8d8065' };`
3. `kindLabel` (line 279, add above the editor line): `if (p.kind === 'viewer') return 'viewer · ' + baseNameOf(p.filePath);`
4. `closePanel` (line 513) — viewers have no PTY to kill: change `if (p.kind !== 'editor') api.termKill({ id });` to `if (p.kind !== 'editor' && p.kind !== 'viewer') api.termKill({ id });`

- [ ] **Step 5: Route all file-opens through `openFile`**

1. Workspace tree (`app.js:241`): `row.onclick = () => { if (n.kind === 'dir') toggleDir(n.path); else openFile(n.path); };`
2. Terminal path links (`app.js:385`): `if (st.isFile) openFile(st.abs); else api.revealFile(st.abs);`
3. Editor-tile drops (Task 3's `dropFilesOnPanel`): change `paths.forEach(openEditor)` to `paths.forEach(openFile)`.

- [ ] **Step 6: Viewer styles**

In `paper.css`, after the editor styles, add:

```css
/* ---- viewer tiles ---- */
.viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.viewer .vw-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; background: repeating-linear-gradient(0deg, transparent, transparent 23px, rgba(120, 100, 60, 0.05) 24px); }
.viewer .vw-stage--dark { background: #2f2b26; }
.viewer .vw-stage--pad { gap: 10px; padding: 18px; }
.viewer .vw-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid rgba(60, 45, 25, 0.25); background: #fff; box-shadow: 3px 4px 0 var(--shadow-mid, rgba(120, 100, 60, 0.18)); }
.viewer .vw-stage video { max-width: 100%; max-height: 100%; }
.viewer .vw-stage audio { width: 90%; }
.viewer .vw-pdf { flex: 1; min-height: 0; width: 100%; border: 0; }
.viewer .vw-glyph { font-size: 34px; color: var(--muted, #8d8065); }
.viewer .vw-name { font-size: 13px; font-weight: 700; }
.viewer .vw-note { font-size: 11px; color: var(--muted, #8d8065); text-align: center; }
```

- [ ] **Step 7: Verify**

Run: `npm test` (PASS) and `npm run shot` (exit 0).
Then `npm start`: open a folder containing an image and a video (create one if needed: `mkdir -p /tmp/viewer-check && cp shots/app.png /tmp/viewer-check/`), switch the rail to Workspace, click the image → an image viewer tile appears; click a `.js` file → editor tile as before; click a binary (e.g. `cp /bin/ls /tmp/viewer-check/`) → the fallback card with "Reveal in Finder".

- [ ] **Step 8: Commit**

```bash
git add src/renderer/app.js src/renderer/paper.css
git commit -m "feat: viewer tiles — images, video, audio, PDF, and a Finder-fallback card"
```

---

### Task 5: Drop-to-view on empty canvas, docs, screenshot, human checkpoint

**Files:**
- Modify: `src/renderer/app.js` (grid drop handler)
- Modify: `README.md`
- Regenerate: `shots/app.png`

**Interfaces:**
- Consumes: `openFile` (Task 4), `droppedPaths`/`isFileDrag` (Task 3).
- Produces: final user-facing behavior; no code consumers.

- [ ] **Step 1: Dropping on the grid background opens viewers**

In `buildShell()`, with the other window listeners, add (tile drops already `stopPropagation`, so this only fires on empty canvas):

```js
  els.grid.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  els.grid.addEventListener('drop', (e) => {
    const paths = droppedPaths(e); if (!paths.length) return;
    e.preventDefault(); paths.forEach(openFile);
  });
```

- [ ] **Step 2: Document it**

In `README.md`, after the Terminal-sessions bullet (line 18), add:

```markdown
- **Drop files from anywhere** — drag a file from Finder onto a session card and its
  (shell-quoted) path is typed into that session; drop it on the command bar to attach it to
  your next message; drop it on empty canvas to view it.
- **Viewer tiles** — click any file in the Workspace rail (or ⌘-click a path in a terminal):
  images, video, audio and PDFs open as paper viewer cards in-app; anything unviewable gets a
  card with a Reveal-in-Finder button. Text files open in the paper editor as before.
```

- [ ] **Step 3: Full verification sweep**

Run all three, in order, and confirm each:
1. `npm test` → all unit tests PASS.
2. `npm run shot` → screenshot regenerates, exit 0 (this refreshes `shots/app.png`).
3. `npm start` → human checkpoint with Calvin: (a) drag a file from Desktop into a live Claude session tile — the quoted path appears in the session; (b) drag onto the command bar — path lands in the input; (c) drop a video on empty canvas — it plays on a paper card; (d) click a PDF in the Workspace rail — it renders in-app (if the PDF iframe shows a download prompt instead, file a follow-up: switch to `plugins`-dependent embed or PDF.js — do not block the merge on it); (e) ⌘W closes a viewer tile without touching any terminal.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/app.js README.md shots/app.png
git commit -m "feat: drop-to-view on empty canvas; document file drop + viewers"
```
