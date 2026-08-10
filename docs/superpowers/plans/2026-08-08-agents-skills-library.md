# Agents & Skills Library Implementation Plan

> Executed inline in-session (user-approved autonomous run). Spec:
> `docs/superpowers/specs/2026-08-08-agents-skills-library-design.md`

**Goal:** Library rail tab that discovers Claude + OpenCode agents/skills across project,
user, and plugin scopes; card tiles that edit them in a form view or raw markdown; templates
in this repo; agents panel retired.

**Global constraints:** no new deps; CJS main / ESM renderer; `library.js` imports fs/path/os
only (no electron) so tests can import it; frontmatter edits must never destroy unrecognized
YAML or the body; every task ends green (`npm test`, `npm run shot`) and committed.

### Task 1: frontmatter.mjs + tests (TDD)
- Create `src/renderer/frontmatter.mjs`: `parseDoc(text)` → `{ hasFrontmatter, malformed,
  entries: [{key?, value?, complex?, lines[]}], body }`; `getField(doc,key)`;
  `setField(doc,key,value)` (single quoted line replaces entry; appends if missing; creates
  frontmatter block on demand); `serializeDoc(doc)`.
- Create `tests/frontmatter.test.mjs`: round-trip identity; unknown-key + body preservation
  after setField; complex (multiline/list) value collapse; quoting of `:`/quotes; no-frontmatter
  file; malformed (unterminated `---`) flags malformed; setField on missing key appends;
  setField on no-frontmatter doc creates the block.
- `npm test` green → commit.

### Task 2: library.js + tests + IPC + preload
- Create `src/main/library.js` (CJS): `scanLibrary({projectPath, homeDir})`,
  `createItem({projectPath, homeDir, type, platform, scope, name})`,
  `duplicateItem({filePath, type, projectPath})`, plus internal template strings and a
  bounded plugin walk (depth ≤ 7, ≤ 4000 dirs, skips node_modules/.git).
- Create `tests/library.test.mjs` with `fs.mkdtempSync` fixture trees covering all five
  sources, readOnly flags, create + overwrite-refusal, duplicate + `-copy` collision.
- main.js: `library:scan`/`library:create`/`library:duplicate` handlers; preload:
  `libraryScan/libraryCreate/libraryDuplicate`.
- `npm test` + `npm run shot` green → commit.

### Task 3: Library rail tab, retire agents panel, ⌘K from library
- app.js: third rail tab `library`; `S.library = {items, q, loaded}`; `loadLibrary(force)`;
  grouped render with filter + ＋ New; remove `#agents-panel` DOM, `renderAgentsPanel`,
  `S.agentsCollapsed`, and their references; `openAgentPicker` awaits `loadLibrary` and reads
  claude agents (project+user).
- paper.css: library row/group styles; drop dead agents-panel rules.
- Verify shot renders, tests green → commit.

### Task 4: Card tiles (form/raw toggle, save, readOnly/duplicate, Use)
- app.js: `openCard(item)` (rawFile → parseDoc → panel kind `card`), `mountCard` (tabs,
  per-type field map, body area, raw textarea, ed-bar with Use / Duplicate / Save),
  `saveCard`; wire `card` through statusMeta/kindLabel/closePanel/⌘S/dirty-confirm.
- FIELD_MAP: claude:agent name/description/tools/model · claude:skill name/description ·
  opencode:agent description/mode/model · opencode:command description/agent/model.
- paper.css: card editor styles.
- Verify + commit.

### Task 5: ＋ New flow, repo templates, docs, sweep
- New overlay: type (Agent claude / Agent opencode / Skill claude) + scope (project/user) +
  name → `libraryCreate` → rescan → openCard.
- Create the five template files in this repo; README + design doc note.
- Full sweep: `npm test`, `npm run shot`, screenshot inspection (Library tab seeded in demo
  or manual run), commit, merge to master per standing approval.
