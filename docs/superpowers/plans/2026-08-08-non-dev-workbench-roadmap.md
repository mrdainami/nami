# Non-Developer Agent Workbench — Roadmap

**Goal:** Make Dainami CLI the friendly front-of-house where a non-developer can set up,
run, and equip any AI agent — without ever feeling like they're using a developer tool.

This is the master tracker for the four parts agreed with Calvin on 2026-08-08.
Each part gets its own detailed implementation plan when its turn comes (one plan per
subsystem, each shipping working software on its own). Check parts off here as they land.

## The four parts, in order

- [x] **Part 1 — Honest launcher: agent detection + guided setup** ✅ shipped 2026-08-08
  Plan: `2026-08-08-part1-agent-setup-launcher.md`
  The launcher only shows session buttons that will actually work. On open, the app
  detects which of the curated six agent CLIs are installed: Claude Code, Codex,
  OpenCode, Gemini CLI, Hermes (Nous Research's hermes-agent), Kimi Code (Moonshot).
  Each registry entry carries a verified official install command and docs link
  (verified 2026-08-08). Layout rule from the approved mockup: big rows are agents
  that run right now (green dot); missing agents shrink to small "add an agent to
  this Mac" cards whose guided install runs inside a terminal tile. Cut entirely:
  Custom command…, standalone AI settings row, and (per Calvin, to avoid confusion)
  any launcher entry for the OpenAI-compatible "Web model" chat — the code stays for
  restored sessions, parked until users ask. Detection is CLI-only: IDE extensions
  and CLIs share one engine and one login, so finding the command on the shell PATH
  is sufficient. **Status: shipped — commits ac4070e, bef5ff1, fee838e, 4d9c2c3;
  38/38 tests green; both themes screenshot-verified; clean-master boot verified
  in an isolated worktree.**

- [x] **Part 2 — Calm desk: viewers & cards open as overlays** ✅ shipped 2026-08-08
  Plan: `2026-08-08-part2-calm-desk-peek.md`
  Sessions stay as tiles pinned to the desk. Every look-at-a-file path (Workspace rail
  click, ⌘-click in a terminal, Library click, card link chips, corkboard nodes) now
  floats a peek sheet above the desk; tiles never reshuffle. "Pin to desk" promotes the
  live panel (edits, dirty state, form mode intact) to a tile. Deliberate scope: canvas
  drag-and-drop still makes tiles (placing paper on the desk), peeks are ephemeral
  across restarts, sessions never peek. **Status: shipped — commits 42f8cee, ce31aef,
  d9b2dc3, 3ec778b; 42/42 tests green; both themes screenshot-verified incl. corner
  clipping; clean-master boot verified in an isolated worktree. Operator overrides for
  .peek-box ride with the theme session's uncommitted theme-operator.css.**

- [x] **Part 3 — Connect-a-service: MCP picker for non-developers** ✅ shipped 2026-08-08
  Plan: `2026-08-08-part3-connect-a-service.md`
  A small catalog of popular MCP servers (Gmail, Notion, filesystem, database…) plus
  a form-style "connect" flow that writes the right settings entry for each platform
  (Claude `.mcp.json`, OpenCode config). Scope grown by Calvin's calls (2026-08-08):
  (a) the Library rail regroups by TYPE — Agents / Skills / Services / Plugins —
  with scope ("this project" vs "your Mac") as a tag on each row, replacing today's
  scope+platform groups; (b) a "build a custom connector" door in the catalog that
  hands off to a session with WHICHEVER agent the user has (never assume Claude;
  pick from the detected agents) carrying a seed prompt, exactly like ＋ new does
  for agents and skills — the agent is the factory, the app is the landing pad and
  the shelf it lands on; (c) catalog reordered to everyday apps (Notion, Gmail,
  Slack, Telegram, Google Drive) plus Creative models via Calvin's kie-mcp
  (github.com/mrdainami/kie-mcp, KIE_API_KEY, images/video/music); (d) the
  "what got written" receipt folds behind a disclosure, not its own screen.
  Mockup approved: parts-3-4 artifact v3.
  **Status: shipped. Commits 4c010ec, 3bc7964, 4560df0, f19e464, d029023, 950b9fe,
  7c6fe77; 54/54 tests green; catalog re-verified against live registries at build time
  (Slack corrected to the real `slack-mcp-server` package, single-token mode); all five
  sheets screenshot-verified in both themes; real end-to-end proven with the folder
  service (config written to `.mcp.json` + `opencode.json`, live MCP handshake counted
  14 tools, disconnect cleaned both files); clean-master boot and tests verified in an
  isolated worktree. Seeded prompts now type into any agent's session, not just Claude.**

- [x] **Part 4 — Graph: REMOVED, not rebuilt** (Calvin's call, 2026-08-08)
  The name-matching corkboard was an honestly worse Obsidian graph, so it is gone
  from the app (commit 824b574: Map button, board overlay, board CSS all removed;
  the references/referenced-by chips on cards stay for hopping between cards).
  The "structural wiring map" idea from the parts-3-4 mockup is PARKED, not
  scheduled: revisit only after Part 3 has created real wiring worth drawing, and
  only if users ask for it. Dead corkboard overrides still sit in the theme
  session's uncommitted theme-operator.css; that session should drop them when it
  commits.

## Standing decisions (don't re-litigate)

- We are **not** competing with OpenCode/Claude Code — the terminal experience of the
  real CLIs *is* the product; we make it warm and non-scary.
- The custom OpenAI-compatible chat tile is parked: no launcher entry for now (its
  code stays so restored sessions work). Hermes enters through its real CLI. Revisit
  only if users ask for CLI-less models (e.g. raw Ollama).
- Plugin-cache items stay read-only + Duplicate-to-project.
- Copy never assumes Claude (Calvin, 2026-08-08): users may run Codex, OpenCode,
  Gemini, Hermes, Kimi. UI text says "agent" / "a new session"; only name a
  specific agent where it is technically true (e.g. which config file gets
  written for which platform).
- Dual themes: paper styles in `paper.css` via tokens; operator overrides only in
  `theme-operator.css`; JS colors via `statusColors()` / `xtermTheme()`. Screenshot
  both themes for any visual change (see `.claude/skills/paper-design/SKILL.md`).
- Verification pattern: `npm test`, `npm run shot`, and actually look at the screenshot.

- Library items are agent-built (Calvin, 2026-08-08): ＋ new seeds a session with the
  user's chosen agent (session selector on every handoff sheet); empty-template and
  delete-to-Trash round it out. The Workspace tree carries the file verbs (right-click:
  reveal, new, move, trash), guarded to the project root. Spec:
  `../specs/2026-08-08-agent-built-library-design.md`.

## Sequencing constraint (multi-session)

The operator-theme session's work must be committed before anything else moves master;
then vault-tiles re-rebases; then fast-forward. Part 1 implementation starts only after
that landing sequence completes (or on Calvin's explicit go if he wants it on top of
the current tree).
