# Agents & Skills Library — Design

Approved by Calvin 2026-08-08 (conversation). Decisions: Claude (project/user/plugins) + OpenCode
detection; form + raw-markdown toggle editing; third rail tab "Library"; retire the bottom
"Agents on file" panel; template agents/skills created in this repo; plugin items are
**view-only with Duplicate-to-project** (plugin cache dirs are overwritten on plugin updates,
so in-place edits would be silently lost; a project copy is durable and takes precedence).

## Discovery: source adapters

`src/main/library.js` (CJS, fs-only — no Electron imports, so it is unit-testable). One scan
function walks all sources and returns a flat item list:

| Source | Reads | Scope | readOnly |
|---|---|---|---|
| Claude project | `<folder>/.claude/agents/*.md`, `.claude/skills/*/SKILL.md` | project | no |
| Claude user | `~/.claude/agents/*.md`, `~/.claude/skills/*/SKILL.md` | user | no |
| Claude plugins | `~/.claude/plugins/**/{agents/*.md, skills/*/SKILL.md}` (bounded walk) | plugin | **yes** |
| OpenCode project | `<folder>/.opencode/agent/*.md`, `.opencode/command/*.md` | project | no |
| OpenCode user | `~/.config/opencode/agent/*.md`, `~/.config/opencode/command/*.md` | user | no |

Item shape: `{ type: 'agent'|'skill'|'command', platform: 'claude'|'opencode', scope:
'project'|'user'|'plugin', slug, name, description, filePath, meta: {tools, model, mode},
readOnly }`. `scanLibrary({ projectPath, homeDir })` takes explicit roots for testability.
Also in library.js: `createItem` (scaffolds from a template; refuses to overwrite) and
`duplicateItem` (copies a plugin/other item into the project's `.claude/`; `-copy` suffix on
collision; skills copy their whole directory).

IPC: `library:scan`, `library:create`, `library:duplicate` (thin wrappers in main.js;
read/save reuse the existing `file:raw` / `file:save`).

## Frontmatter round-tripper (the safety-critical piece)

`src/renderer/frontmatter.mjs` (ESM, pure, unit-tested). Line-preserving model: the
frontmatter block is a list of entries; each entry is either a recognized `key: value` line
(possibly with indented/list continuation lines, flagged `complex`) or an opaque raw line.
`setField` replaces only that entry's lines with a single properly-quoted line; every other
byte of the file — unknown keys, comments, the entire body — round-trips verbatim.
Files with no or malformed frontmatter still open, raw-mode only.

## UI

**Library rail tab** (third tab, after Workspace): filter box, ＋ New action, items grouped
by source (This project · Claude / This project · OpenCode / Your machine / Plugins
(read-only)); rows show a type chip (AG/SK/CMD), name, description. Loaded lazily on first
tab open; rescanned after create/duplicate/save.

**Card tiles** (new panel kind `card`): Form view (default) with per-type fields —
claude agent: name/description/tools/model; claude skill: name/description; opencode agent:
description/mode/model; opencode command: description/agent/model — plus the markdown body in
a ruled writing area. Markdown view shows the raw file. Toggle syncs both ways (raw → form
re-parses; parse failure keeps you in raw with a toast). ⌘S saves. Read-only items disable
inputs and swap Save for **Duplicate to project**. Claude agents get a **Use** button that
starts a session seeded `Use the <slug> agent.`

**Retired:** the bottom "Agents on file" panel (and its collapse state). The ⌘K agent picker
stays, now fed by the library scan (claude agents, project + user scopes).

## Templates created in this repo

`.claude/agents/ui-polisher.md`, `.claude/agents/release-scribe.md`,
`.claude/skills/paper-design/SKILL.md`, `.claude/skills/new-viewer/SKILL.md`,
`.opencode/agent/reviewer.md` — real usable content, and they make both platforms visible in
the Library immediately.

## Out of scope (v1)

Deleting items from the UI, live file-watching, WYSIWYG body rendering, OpenCode skills
(not a concept there), renaming files/dirs from the name field (name edits touch frontmatter
only).

## Testing

`tests/frontmatter.test.mjs`: round-trip identity, unknown-key preservation, complex-value
collapse, quoting, no-frontmatter and malformed files. `tests/library.test.mjs`: fixture
trees in temp dirs — scan finds all five sources with correct type/scope/readOnly; create
scaffolds and refuses overwrite; duplicate copies skill dirs and suffixes collisions.
UI verified via `npm run shot` + hands-on checkpoint.
