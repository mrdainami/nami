# Nami — the paper agent workbench

Approved design, 2026-08-08. The app now implements it; the screenshots in `docs/media/` are the live article.

## What it is
A lean Electron desktop app: open any folder, run **any of the top agent CLIs**
as paper tiles — 100% in the paper aesthetic of the mockup (cream sheet,
Caveat handwriting, Courier Prime, pastel tints, hard offset shadows, dashed rules).

Paper is the design language and the base stylesheet; the other three desks (operator, glass,
graphite) are layered over it. Since 0.1.8 a **new install opens on glass** — the desk that reads
as a current Mac app to someone who has never seen Nami — and anyone who picks a theme keeps it.

## One session type — a terminal on paper
Every agent runs as its own CLI in a real PTY (node-pty) + xterm.js, skinned to
ink-on-paper: cream paper ground, ink text, Courier Prime, all 16 ANSI colors
remapped to an ink palette drawn from the mockup's tints. Resume after restart
uses each agent's own conversation id (`claude --resume`, `codex resume`, …).
A structured "card view" over those CLIs was tried and retired (2026-08-21).

## Architecture
- Electron, plain JS, no bundler. `src/main/` (app + PTYs + persisted state JSON),
  `src/main/preload.js` (contextBridge IPC), `src/renderer/` (the paper UI, ES modules).
- State persists to `userData/state.json` (projects, sessions) — restart-proof.
- `.claude/` of the open folder is scanned for the **Agents on file** panel (agents + skills).
- `npm start` runs it; `npm run shot` renders a demo-seeded screenshot for visual verification.

## v1 surface (from the mockup)
Header (project switcher, live badge, ⌘K agents, ⌘N new session) · Sessions/Workspace rail on graph
paper · Agents-on-file panel · session-card lane on ruled paper · new-session sheet (job → folder →
who runs it → ground rules → command preview; includes a plain-terminal tile) · open-project sheet ·
agent inspector (read-only) · quick look for files · command bar (`/run /open /agents /term`) ·
shortcuts footer · toasts.

## Cut from v1
Multi-account porting, broadcast, grid layouts, sounds.
