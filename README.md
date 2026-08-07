# Dainami CLI — the paper agent workbench

Open a folder, run **Claude Code** and **terminal** sessions as paper session cards.
Everything is in the paper aesthetic: cream sheet, washi tape, Caveat handwriting, Courier Prime,
pastel-tinted cards, hard offset shadows.

## Run

```bash
cd ~/Desktop/dainami-cli
npm install        # already done
npm start          # opens the app
```

- **Claude sessions** are driven through the Claude Agent SDK and render as cards — the goal in
  handwriting, tool calls as steps that strike through as they finish, todos as a checklist, the
  yellow **Needs your OK** card for real permission prompts, produced files in **Pasted in**.
- **Terminal sessions** run a real shell (node-pty) inside an ink-on-paper xterm.
- **Drop files from anywhere** — drag a file from Finder onto a session card and its
  (shell-quoted) path is typed into that session; drop it on empty canvas to view it.
- **Viewer tiles** — click any file in the Workspace rail (or ⌘-click a path in a terminal):
  images, video, audio and PDFs open as paper viewer cards in-app; anything unviewable gets a
  card with a Reveal-in-Finder button. Text files open in the paper editor as before.
- **Library** — the third rail tab finds every agent and skill on your machine: this
  project's `.claude/` and `.opencode/`, your user-level `~/.claude/` and
  `~/.config/opencode/`, and installed Claude plugins. Click one to edit it as a paper card —
  a **Form** view (name, description, tools, instructions; no frontmatter syntax needed) with
  a **Markdown** toggle for the raw file. Plugin items are read-only (their cache is
  overwritten on updates) with one-click **Duplicate to project**. ＋ new scaffolds a Claude
  agent, Claude skill, or OpenCode agent from a template.
- Auth: it uses your **logged-in `claude`** (subscription), found at `~/.local/bin/claude`. No API
  key is set. If your `claude` lives elsewhere, set `CLAUDE_CODE_EXECUTABLE=/path/to/claude`.

- **Any AI model** — ⌘N → "Any AI model" runs a session against any OpenAI-compatible
  endpoint (Ollama, LM Studio, vLLM, OpenRouter, Hermes…): the model gets real tools
  (run commands, read/write files), risky actions show the yellow **Needs your OK** card,
  and the transcript renders as a paper chat. "AI model settings…" in ⌘N reconfigures the
  endpoint.
- **Sessions survive restarts** — the layout is restored on launch: editors, viewers and
  cards reopen, terminals restart in their folder, and Claude sessions pick their
  conversation back up via `claude --continue`.
- **Connections** — agents and skills that reference each other are linked: cards show
  references/referenced-by chips, and **Map** opens a corkboard of the item's neighborhood,
  cards joined by red yarn.

## Keys
⌘N new session · ⌘O open folder · ⌘K agents · ⌘W close pane · ⌘S save · esc close

## Preview
`npm run shot` renders a demo-seeded screenshot to `shots/app.png` (no live sessions).

## Layout
- `src/main/main.js` — Electron main: window, PTYs, folder + `.claude` scan, state, IPC
- `src/main/claude-driver.js` — one Claude Code session → paper-card events
- `src/main/preload.js` — contextBridge IPC surface
- `src/renderer/` — the paper UI (`app.js`, `paper.css`, vendored xterm)
- `docs/design.md` — the approved design · `docs/reference/` — the source mockup

Skeleton pattern borrowed from HNA-Code (MIT). UI is 100% from the Dainami CLI mockup.
