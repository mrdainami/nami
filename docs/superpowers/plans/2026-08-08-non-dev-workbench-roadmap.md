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

- [ ] **Part 2 — Calm desk: viewers & cards open as overlays**
  Sessions stay as tiles pinned to the desk. File viewers and agent/skill cards open
  as floating overlays above the desk by default (like the corkboard already does),
  with a "pin to board" button to promote one to a tile. Peeking at a file must never
  reshuffle running sessions. **Status: not planned yet — plan when Part 1 ships.**

- [ ] **Part 3 — Connect-a-service: MCP picker for non-developers**
  A small catalog of popular MCP servers (Gmail, Notion, filesystem, database…) plus
  a form-style "connect" flow that writes the right settings entry for each platform
  (Claude `.mcp.json`, OpenCode config). Creating brand-new MCPs stays the agent's
  job ("ask Claude to build you a connector") — the app is the landing pad, not the
  factory. **Status: not planned yet.**

- [ ] **Part 4 — Graph repointed at real structure**
  Keep the corkboard rendering; change what a connection *means* — from "one file's
  text mentions another's name" to structural wiring: agent → allowed tools/skills,
  project → connected agents/MCPs, skill → parent plugin. The map becomes "here is
  your setup and how it fits together." Only start after Parts 1–3; it's the dessert,
  not the meal. **Status: not planned yet.**

## Standing decisions (don't re-litigate)

- We are **not** competing with OpenCode/Claude Code — the terminal experience of the
  real CLIs *is* the product; we make it warm and non-scary.
- The custom OpenAI-compatible chat tile is parked: no launcher entry for now (its
  code stays so restored sessions work). Hermes enters through its real CLI. Revisit
  only if users ask for CLI-less models (e.g. raw Ollama).
- Plugin-cache items stay read-only + Duplicate-to-project.
- Dual themes: paper styles in `paper.css` via tokens; operator overrides only in
  `theme-operator.css`; JS colors via `statusColors()` / `xtermTheme()`. Screenshot
  both themes for any visual change (see `.claude/skills/paper-design/SKILL.md`).
- Verification pattern: `npm test`, `npm run shot`, and actually look at the screenshot.

## Sequencing constraint (multi-session)

The operator-theme session's work must be committed before anything else moves master;
then vault-tiles re-rebases; then fast-forward. Part 1 implementation starts only after
that landing sequence completes (or on Calvin's explicit go if he wants it on top of
the current tree).
