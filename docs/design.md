# Nami — the paper agent workbench

Approved design, 2026-08-08. The app now implements it; the screenshots in `docs/media/` are the live article.

## What it is
A lean Electron desktop app: open any folder, run **Claude Code sessions** and **terminal sessions**
as paper session cards — 100% in the paper aesthetic of the mockup (cream sheet, washi tape,
Caveat handwriting, Courier Prime, pastel tints, hard offset shadows, dashed rules).

Paper is the design language and the base stylesheet; the other three desks (operator, glass,
graphite) are layered over it. Since 0.1.8 a **new install opens on glass** — the desk that reads
as a current Mac app to someone who has never seen Nami — and anyone who picks a theme keeps it.

## The two session types — both paper
1. **Claude sessions** — no terminal emulator at all. Driven headless through the Claude Agent SDK
   (structured events). Every event renders as paper: goal in handwriting on the card, tool calls as
   step lines that strike through on completion, TodoWrite as the friendly step list, permission
   requests as the yellow **"Needs your OK"** card (Go ahead / Not now answer the real callback),
   errors as **"Stopped early"** with Try again, produced files in the **"Pasted in"** grid.
   Follow-ups go through a paper reply row on the card; resume after restart uses real session ids.
2. **Terminal sessions** — any other CLI. Real PTY (node-pty) + xterm.js skinned to ink-on-paper:
   cream paper ground, ink text, Courier Prime, all 16 ANSI colors remapped to an ink palette drawn
   from the mockup's tints.

## Architecture
- Electron, plain JS, no bundler. `src/main/` (app + PTYs + Claude driver + persisted state JSON),
  `src/main/preload.js` (contextBridge IPC), `src/renderer/` (the paper UI, ES modules).
- State persists to `userData/state.json` (projects, sessions, card content) — restart-proof.
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
