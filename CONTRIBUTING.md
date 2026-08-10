# Contributing to Nami

Nami is an Electron app in plain JavaScript. No bundler, no framework, no build
step for the UI — you edit a file and restart.

## Run it

```bash
git clone https://github.com/mrdainami/nami.git
cd nami
npm install
npm start
```

```bash
npm test        # node --test, no network and no model download needed
npm run shot    # renders a demo-seeded screenshot to shots/app.png
```

Building a `.app` or `.dmg` (`npm run pack` / `npm run dist`) first runs
`npm run fetch-model`, which pulls `whisper-tiny.en` (~44 MB) into `build/models`
so the shipped app can transcribe offline. Packaging config lives in
`electron-builder.yml`.

## Layout

- `src/main/main.js` — Electron main: window, PTYs, folder + `.claude` scan, state, IPC
- `src/main/claude-driver.js` — one Claude Code session → paper-card events
- `src/main/settings.js` — settings.json, read-merge-rename so writers can't clobber
- `src/main/stt.js` — transcription providers as one registry (local, openai, elevenlabs, custom)
- `src/main/stt-local.js` / `stt-model.js` — Whisper on onnxruntime-node, and its weights
- `src/main/preload.js` — contextBridge IPC surface
- `src/renderer/` — the paper UI (`app.js`, `paper.css`, vendored xterm)
- `docs/design.md` — the approved design · `docs/reference/` — the source mockup

State persists to `userData/state.json` (projects, sessions, card content), so a
restart restores the desk.

## How the pieces behave

- **Claude sessions** are driven through the Claude Agent SDK and render as cards —
  the goal in handwriting, tool calls as steps that strike through as they finish,
  todos as a checklist, the yellow **Needs your OK** card for real permission
  prompts, produced files in **Pasted in**.
- **Terminal sessions** run a real shell (node-pty) inside an ink-on-paper xterm.
- **Sessions survive restarts** — editors, viewers and cards reopen, terminals
  restart in their folder, and Claude sessions pick their conversation back up
  via `claude --continue`.
- **The launcher** (⌘N) shows the agents actually installed on your Mac, checked
  through your own shell at startup: Claude Code, Codex, OpenCode, Gemini CLI,
  Hermes, Kimi Code. Missing ones open a guided setup sheet with the verified
  official install command, run for you inside a terminal tile.
- **Library** — the third rail tab, grouped into Agents / Skills / Services /
  Plugins, reading this project's `.claude/` and `.opencode/`, your user-level
  `~/.claude/` and `~/.config/opencode/`, and installed Claude plugins. Each item
  peeks as a paper card with a **Form** view and a **Markdown** toggle. Plugin
  items are read-only (their cache is overwritten on updates) with one-click
  **Duplicate to project**.
- **Services** writes each connection where the agent already looks — `.mcp.json`
  for Claude Code, OpenCode's config for OpenCode — and proves it by starting it
  once.
- **Connections** — agents and skills that reference each other show
  references/referenced-by chips, and **Map** opens a corkboard of the item's
  neighbourhood.
- **Voice** — Whisper runs on the local machine via onnxruntime-node, so dictation
  works on a fresh install with no account, key or network. Settings › Voice can
  point it at OpenAI Whisper, ElevenLabs Scribe, or an OpenAI-shaped server
  (Speaches or faster-whisper-server; **not** Ollama, which has no speech-to-text).

## Auth

Nami uses your logged-in `claude` (subscription), found at `~/.local/bin/claude`.
No API key is set. If your `claude` lives elsewhere, set
`CLAUDE_CODE_EXECUTABLE=/path/to/claude`.

## Settings

⌘, or the ⚙ in the topbar. **Voice** picks how Nami hears you, **Look** switches
desks, **Models** configures the OpenAI-compatible endpoint behind "any AI model"
sessions. Everything lands in `settings.json` under the app's userData, on that
Mac only — nothing syncs. API keys typed there beat `OPENAI_API_KEY` /
`ELEVENLABS_API_KEY` from the shell; a key that came from the environment is
shown as read-only.

## Keys

⌘N new session · ⌘O open folder · ⌘K agents · ⌘W close pane · ⌘S save ·
⌘, settings · esc close

## Design

Everything is in the paper aesthetic: cream sheet, washi tape, Caveat
handwriting, Courier Prime, pastel-tinted cards, hard offset shadows. There are
four desks — paper, operator, glass, graphite — and a new surface has to work in
all four. Read `docs/design.md` before changing anything visual.

## Releasing

Tagging a version is the only thing that produces an installer:

```bash
npm version patch && git push --follow-tags
```

That builds from a clean checkout, signs and notarises, and creates a **draft**
release. Publishing it is a deliberate human step — the moment it goes live is
the moment every installed Nami starts offering it.
