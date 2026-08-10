# Agent-Built Library: create, improve, delete

**Date:** 2026-08-08
**Status:** approved by Calvin (verbally, this session)

## Problem

The Library's ＋ new flow scaffolds an empty markdown template and stops. Real result on
Calvin's Mac: an agent file literally named
`i-want-to-create-a-new-agent-that-helps-me-look-at-the-design-of-this-page-....md`
(the whole spoken sentence kebab-cased into a filename) and a `design-agent.md` still
carrying the template's placeholder description. There is also no way to delete an agent
or skill from the app at all.

Part 3 already proved the right pattern: the app is the landing pad, the user's own
agent is the factory (built-for-you connectors, guided setups). Creation and editing of
agents and skills should work the same way.

## Decisions (Calvin, 2026-08-08)

1. ＋ new defaults to the agent building the item; an empty-template path survives as a
   quiet link.
2. The ＋ new sheet has BOTH fields: **Name it** (short, optional) and **Describe it**
   (plain words). The name decides the file name; the description is the brief. Blank
   name = the agent picks a sensible short name from the description.
3. Every handoff sheet gets a session selector: copy says "a new session will create it
   for you" and a dropdown lists the agents actually installed (first detected one
   preselected). No copy names a specific agent unless the user picked it. This
   retrofits onto Part 3's built-for-you and guided-setup sheets too.
4. Delete moves to the macOS Trash after one confirm click. Plugin items stay
   read-only: no delete.

## Design

### 1. Shared session selector

A small helper in `app.js` renders the selector used by every handoff sheet:

- Copy line: "A new session will create it for you." / task-appropriate variant.
- `<select class="agent-pick">` listing `S.agents.filter(a => a.found)` by name,
  first preselected. Selection is per-sheet state (`o.workerId`), not persisted.
- No agents installed: selector replaced by the existing note "No agent is installed
  yet. Press ⌘N to add one first." and the Go button disabled.
- `chosenAgent(o)` resolves `o.workerId` against `S.agents`, falling back to
  `bestAgent()`.

Retrofit: `renderConnectCustom` (built-for-you) and the guided branch of
`renderConnectForm` (Gmail / Google Drive) use the selector instead of silently taking
`bestAgent()`. `agentSession(worker, opts)` stays the single spawn path
(claude kind spawns claude, run kinds spawn the agent's bin in a shell; seeds now type
into both, shipped in Part 3).

### 2. ＋ new: describe it, agent builds it

`renderNewItemSheet` keeps: kind rows (Claude agent / Claude skill / OpenCode agent)
and scope chips (this project / your machine). It changes to:

- **Name it** input (existing field, now explicitly optional, placeholder
  "name it (or leave blank, your agent will)").
- **Describe it** input (new, the brief: placeholder like
  "turns git history into release notes people actually read").
- Session selector (piece 1).
- Primary button **Create it for me**: closes the sheet, seeds a session with the
  chosen agent. Seed carries: type + platform + scope target directory, the name (or
  "choose a short kebab-case name yourself"), the description, the platform's format
  rules pointer (frontmatter for Claude agents/skills, OpenCode's shape for its
  agents), and "when it is written, say what you made and where". Toast: "Your agent
  is writing it. It appears in the Library when it lands."
- Quiet link **just give me an empty file**: today's `api.libraryCreate` scaffold
  path, needs a name (toast if blank), opens the card as before.
- Describe empty + Create it for me: toast "Describe what it should do first."

Library freshness: switching the rail to the Library tab always rescans
(`loadLibrary(true)` on tab activation) so items the agent just wrote appear without
restarting. The scan is cheap (local directory walk).

### 3. Improve an existing item

Editable cards (scope project/user; NOT plugin) gain an **Improve with my agent**
button beside the existing card actions. It opens a small overlay
(`type: 'improve-item'`): one input "what should change?", the session selector, Go.
Seed: "Edit the {platform} {type} at {filePath}. {user's ask}. Keep the file's format
valid, and keep its name unless asked to rename." Dirty-card guard: if the card has
unsaved edits, toast "Save the card first so your agent sees your latest." and stop.

### 4. Delete to Trash

- Main: `library:delete` IPC → validates the path is inside one of the known library
  roots (project `.claude/` or `.opencode/`, user `~/.claude/` or
  `~/.config/opencode/`; NEVER the plugin cache) and that it exists, then
  `shell.trashItem(path)`. For skills the target is the skill's folder, for agents and
  commands the markdown file. Returns `{ ok }` or `{ ok: false, error }`.
- Preload: `libraryDelete(args)`.
- Renderer: editable cards get a **Delete** button; first click flips it to
  "Really move to Trash?", second click deletes, closes the tile or peek,
  `loadLibrary(true)`, toast "Moved to Trash." Plugin cards keep no delete button.

### 5. Workspace file actions (added by Calvin, same day)

The Workspace tree is read-only today: rows only open files, and an expanded editor
tile gives no way to reach the file in Finder. Decision: a right-click context menu on
tree rows unifies the file verbs; drag stays reserved for what it already means
(drag onto canvas pins a tile, drag onto a session types the path), so MOVE is a menu
action with a folder dialog, never a tree drag.

- Context menu (paper-styled, closes on click-away or Esc):
  - File row: Reveal in Finder · Move to… · Move to Trash.
  - Folder row: Reveal in Finder · New file · New folder · Move to… · Move to Trash.
  - Tree head (project path row): Reveal in Finder · New file · New folder.
- Editor and viewer tiles: the file path in the bottom bar becomes clickable and
  reveals the file in Finder (tooltip says so). Viewer cards keep their existing
  Reveal button.
- Main process: a new `src/main/fs-actions.js` module with injectable fs so guards are
  unit-tested: `newFile({ dir, name })`, `newFolder({ dir, name })`,
  `movePath({ src, destDir })` (refuses when the destination exists),
  `trashPath({ path })`. Every op requires the path inside the open project root;
  outside-root and existing-destination cases return `{ ok: false, error }` and never
  touch the disk. Trash uses `shell.trashItem` (recoverable), wired in main.js.
- Move's destination comes from a plain directory dialog (`folder:choose`) that does
  NOT remember the folder as a recent project (the existing `folder:pick` does; that
  side effect is wrong here).
- New file / New folder names come from a small overlay prompt in the launcher idiom.
- After any op the affected tree levels rescan and the rail re-renders. Deleting or
  moving a file that is open in a tile leaves the tile alone (its buffer is intact;
  save will recreate the file, which is honest and predictable).

## Not doing (YAGNI)

- No progress tracking of the building session; the session tile IS the progress.
- No rename UI; renaming is an "improve" ask or a delete + recreate. Same for
  workspace files: no rename menu item for now, and no drag-to-move.
- No confirm dialog component; the two-click button matches the app's quiet idiom.
- No persistence of the chosen agent per user; default is first detected, every time.

## Testing

- `library:delete` guard: inside-root accepted, outside-root rejected, plugin-cache
  rejected, missing path rejected (inject trash + exists fns; no real Trash in tests).
- Seed-text builder for creation extracted as a pure function
  (`buildCreateSeed({ type, platform, scope, name, desc, projectPath })` in a small
  module `src/renderer/seed-text.mjs`) so its shape is unit-tested (name given vs
  blank, project vs user scope, opencode vs claude target paths).
- Existing suite stays green (54 baseline); both themes screenshot-verified for the
  new sheet states; TEMP-SHOT lines reverted before staging.

## Constraints carried forward

- Shared dirty tree: `app.js`, `paper.css`, `main.js`, `preload.js` need surgical
  index staging; `theme-operator.css` additive only, never committed by this session.
- No em dashes anywhere; copy never assumes Claude.
- Screenshot both themes and look at them.
