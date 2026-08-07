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
- Auth: it uses your **logged-in `claude`** (subscription), found at `~/.local/bin/claude`. No API
  key is set. If your `claude` lives elsewhere, set `CLAUDE_CODE_EXECUTABLE=/path/to/claude`.

## Keys
⌘N new session · ⌘O open folder · ⌘K agents · ⌘⏎ run · esc close · space quick-look

## Preview
`npm run shot` renders a demo-seeded screenshot to `shots/app.png` (no live sessions).

## Layout
- `src/main/main.js` — Electron main: window, PTYs, folder + `.claude` scan, state, IPC
- `src/main/claude-driver.js` — one Claude Code session → paper-card events
- `src/main/preload.js` — contextBridge IPC surface
- `src/renderer/` — the paper UI (`app.js`, `paper.css`, vendored xterm)
- `docs/design.md` — the approved design · `docs/reference/` — the source mockup

Skeleton pattern borrowed from HNA-Code (MIT). UI is 100% from the Dainami CLI mockup.
