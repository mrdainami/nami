---
name: paper-design
description: Use when adding or changing any UI in Dainami CLI — the paper design language rules that keep new surfaces looking hand-made and consistent.
---

# Paper Design Language

## Overview

Dainami CLI looks like a work desk: a cream paper sheet, washi tape, cards that cast hard
offset shadows. Every new surface must feel hand-made and warm, never like a generic app.

## The rules

1. **Type**: Caveat (cursive) for headings and human labels; Courier Prime for everything
   the machine says — code, paths, terminal text, metadata. **Nothing below 10px** — that
   floor is deliberate, don't reintroduce 9px labels.
2. **Color**: use the CSS custom properties in `paper.css` (`--paper`, `--ink`, `--muted`,
   `--dash`, `--amber-line`, `--shadow-mid`).
3. **Borders**: dashed 1px for resting surfaces; solid on focus. Never rounded corners
   larger than 2px; paper is cut, not extruded.
4. **Shadows**: hard offset (`5px 6px 0`), never blurred drop shadows.
   **Nothing is slanted and there is no washi tape** — every rotation and the tape strips
   were deliberately removed (2026-08) for a sleeker desk; don't reintroduce either.
   If a surface ever needs a *resting* transform again (e.g. a centering translate, like
   `.projects-pop`), put it in `--rest`, not a bare `transform` — `animation: rise … both`
   fills forward and a filled animation outranks the rule that set `transform`, so the
   keyframe silently cancels it until the animation is removed, then it snaps in. Write
   `--rest: translateX(-50%); transform: var(--rest);` and let `rise` restate it.
5. **Texture**: content areas get the ruled-line background
   (`repeating-linear-gradient` — copy an existing one, keep the 21–28px rhythm).
6. **Status colors**: green `#4a7a4a` live, amber `#a8792a` needs-you/unsaved,
   grey `#8d8065` muted/done.
7. **Terminal text** must survive on cream: xterm runs at 13.5px / 1.35 line-height with
   `minimumContrastRatio: 6`. Don't tighten either — both were raised for legibility.

## Colour means kind, never identity

A chip's colour answers exactly one question: **what kind of thing is this?** It is never
derived from an id or a hash — that was the old `TINTS[hashIdx(id)]` and it made every MCP
service a different colour for no reason. Chips carry `data-kind` and take their hue from
`[data-kind]` rules in `paper.css`; nothing sets an inline background.

| kind | token | code |
|---|---|---|
| agent · any CLI session (claude, opencode…) | `--tint-code` | AG |
| skill | `--tint-vision` | SK |
| command | `--tint-research` | CM |
| service · MCP | `--tint-scrape` | SV |
| editor | `--tint-write` | ED |
| viewer | `--tint-ops` | VW |
| shell | `--tint-neutral` | ❯ |
| folder | `--tint-research` | — |

New chip? Use `chipHtml({ key, code, kind })` from `icons.mjs` and add the kind to both
theme files. Never pass a hex.

## Chrome must survive zoom

`⌘+` shrinks the viewport in CSS px, so the topbar and grid have to give ground:
`.topbar` clips as a backstop, `.topbar-center` has `min-width: 0`, and controls drop in
priority order (tagline → ⌘ hints → folder path → wordmark) via the media queries at the
foot of `paper.css`. Grid tracks use `minmax(min(470px, 100%), 1fr)` so a narrow lane
shrinks the tile instead of clipping it. Anything new in the topbar needs a drop rule.

## The second theme: "operator" (dark ops console)

The app now has two themes, switched from the ◐ button in the topbar and persisted
in `settings.json` (`theme`) + `localStorage` (`dainami-theme`).

- **paper** (default) — everything above; `paper.css` is the source of truth.
- **operator** — "instrument grey": `#0d0d0d` ground, `#171717` panels, neutral-warm
  greys with **no blue cast**, borders raised (`#333`) so panel edges read on their own,
  one coral accent `#ef6461`, all-mono uppercase headings. Prefer borders and surface
  steps over glow. Lives entirely in `theme-operator.css`, scoped under
  `body[data-theme="operator"]`.

Rules for new UI now that both exist:

1. Style the paper look in `paper.css` using the tokens; never put operator colors there.
2. `theme-operator.css` remaps the same token names (`--paper`, `--ink`, `--dash`…),
   so token-driven styles flip automatically. Only add an operator override when your
   new CSS hard-codes a paper literal (gradient texture, Caveat, offset shadow, rotation).
3. Colors set from JS must go through `statusColors()` / `xtermTheme()` in `app.js`,
   never a bare hex.
4. Screenshot both: `npm run shot` and
   `npx electron . --demo --theme=operator --screenshot shots/operator.png`.
5. `--zoom <factor>` on a screenshot run reproduces `⌘+` — use `1.5` and `1.75` to check
   nothing runs past the sheet edge.
6. To shoot a surface you'd otherwise have to click to reach, add `--scene=`:
   `npx electron . --scene=agent:3 --theme=operator --screenshot shots/x.png`.
   Scenes live in `showScene()` in `app.js` — `library`, `mcp`, `agent:1..3`,
   `skill:1..3`, `settings[:section]`, `projects`, `theme`, `workspace`. Add a branch there
   when you build a new overlay. Shoot a multi-step surface at **more than one step** — a
   transform bug that only appears on re-render is invisible in a single shot.
   To inspect DOM state at capture time, pass a JS expression via the env var
   `SHOT_DEBUG='(…)'` — main runs it right before capture and logs the JSON result.

## Checklist for new UI

- [ ] Reused tokens, no new hex values without reason
- [ ] Dashed rest / solid focus borders
- [ ] Hard offset shadow if it's a card (paper); operator gets flat/glow via override
- [ ] Cursive headings get an operator override (mono, uppercase, letter-spaced)
- [ ] Chips pass `kind`, never a hex; nothing renders below 10px
- [ ] New topbar control has a drop rule; check `--zoom 1.75` doesn't clip it
- [ ] `npm run shot` and actually look at the screenshot — in both themes
