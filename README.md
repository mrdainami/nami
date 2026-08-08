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
- **Peek, then pin**: click any file in the Workspace rail (or ⌘-click a path in a terminal)
  and it floats above the desk as a paper sheet; your running sessions never move. One click
  on **Pin to desk** keeps it as a tile. Images, video, audio and PDFs preview in the peek;
  anything unviewable gets a card with a Reveal-in-Finder button; text opens in the paper
  editor. Drag a file from Finder onto the canvas to pin it directly.
- **Files are yours to handle**: right-click anything in the Workspace tree to reveal
  it in Finder, make a file or folder, move it somewhere else in the project, or send
  it to the Trash. The path at the bottom of an open file reveals it in Finder too.
- **Library** — the third rail tab reads like an inventory, grouped into Agents /
  Skills / Services / Plugins with a this-project or your-Mac tag on each row: this
  project's `.claude/` and `.opencode/`, your user-level `~/.claude/` and
  `~/.config/opencode/`, and installed Claude plugins. Click one to peek at it as a paper
  card (pin to desk to keep it): a **Form** view (name, description, tools, instructions; no frontmatter syntax needed) with
  a **Markdown** toggle for the raw file. Plugin items are read-only (their cache is
  overwritten on updates) with one-click **Duplicate to project**. ＋ new takes a name and a plain-words description and hands them
  to a session with whichever agent you choose, which writes the real thing (a quiet
  link still gives you an empty template). Every editable card can be improved by your
  agent or moved to the Trash from the app.
- Auth: it uses your **logged-in `claude`** (subscription), found at `~/.local/bin/claude`. No API
  key is set. If your `claude` lives elsewhere, set `CLAUDE_CODE_EXECUTABLE=/path/to/claude`.

- **The honest launcher** — ⌘N shows the agents actually installed on your Mac (checked
  through your own shell at startup: Claude Code, Codex, OpenCode, Gemini CLI, Hermes,
  Kimi Code). Ready ones launch instantly as big rows with a green dot; missing ones are
  small "add an agent to this Mac" cards that open a guided setup sheet: the verified
  official install command, run for you inside a terminal tile, plus copy and an official
  guide link. Nothing in the sheet can dead-end.
- **Connect a service**: the Library's Services section plugs Notion, Slack, Telegram,
  Creative models, a folder, and (guided) Gmail or Google Drive into your agents. Pick a
  card, paste one key, done: the app writes the settings where each agent already looks
  (`.mcp.json` for Claude Code, OpenCode's config for OpenCode) and proves the connection
  by starting it once. Anything else, describe in plain words and a session with your own
  agent builds and registers it.
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
