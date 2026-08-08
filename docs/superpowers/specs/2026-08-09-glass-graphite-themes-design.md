# Glass + Graphite themes — design spec

**Date:** 2026-08-09 · **Status:** approved by Calvin from the interactive mockup
(`docs/reference/glass-graphite-mockup.html`, screenshot `glass-graphite-mockup.png`).

Nami gains two more themes: **glass** (light liquid-glass, aurora desk) and
**graphite** (the same system in dark grey — not black). They join paper (default)
and operator, switched from the ◐ popover, persisted in `settings.json` + localStorage.

## The material

Apple Liquid Glass adapted to Nami: every surface is a translucent slab over a
luminous desk, and it *reacts* — no painted-on reflections.

- **Desk (aurora / ember).** Glass is only alive with light behind it.
  - glass: `#e8e9ee` field with soft radial blobs — coral `rgba(255,158,140,.55)`
    top-left, wave-teal `rgba(140,205,220,.5)` top-right, peach + periwinkle low.
  - graphite: `#26272c` field, same blobs dimmed to embers (coral `.22`, teal `.18`).
- **Slab recipe** (every pane): translucent bg + `backdrop-filter: blur(~26px)
  saturate(1.7)` + hairline rim + slab shading (bright top lip, curved inner light,
  shaded lower body) + feather drop shadow tinted `rgb(45 52 90 / …)` (light) or
  near-black (dark). Radii: tiles 22px, frame/sheet ~26px, controls full capsule.
  - glass pane `rgba(255,255,255,.48)`, rim `rgba(255,255,255,.75)`
  - graphite pane `rgba(78,80,93,.44)`, rim `rgba(255,255,255,.16)`
- **3D physics.** Panes tilt toward the cursor in true perspective
  (max ~5°/7°, CSS vars `--rx`/`--ry` fed by a pointermove helper, active only in
  these two themes) and lift on hover (`translateY(-4..6px) translateZ(…)`).
  Press compresses (`scale(.96)`); spring curve `cubic-bezier(.22,1.28,.36,1)`.
  `prefers-reduced-motion` disables all of it.
- **One pigment.** Coral `#ef6461` is the only saturated color: status, active ring,
  progress, primary buttons, prompt, cursor glow. Graphite uses the brighter
  `#ff8b88` variant where coral sits on grey.

## Type — the Nothing thread on Apple's material

- **Identity — Doto** (dot-matrix, bundled locally, weights 600–900): wordmark
  NAMI, tile/session titles, all buttons, rail tabs, status pills, banners,
  micro-labels, footer shortcuts. Uppercase + tracked for micro type.
- **Reading — SF Pro** (system stack): documents, prose, questions, descriptions.
- **Data — SF Mono**: terminal, paths, meta. xterm switches `fontFamily` with the
  theme (Courier Prime stays for paper/operator).
- Nothing below 10px (Doto at 9.5px is used only for uppercase micro-labels in the
  mockup; implementation floors at 10px per the paper rule).

## Dot language details

- **Cursor:** pixel arrow (SVG data-URI) — ink at rest, coral over clickables.
- **Icons:** chrome glyphs (◐ ⚙ ⤢ ✕ ＋ ⚑) get 7×7 pixel-glyph SVG twins; CSS shows
  the pixel set only in glass/graphite (`.uni-i` / `.pix-i` visibility swap).
- **Mascot:** exact silhouette, body filled by a dot lattice (SVG `<pattern>`,
  ~140-unit grid, coral dots); eyes solid (ink on glass, `#ececf1` on graphite).
- **Progress:** segmented ticks — `repeating-linear-gradient(90deg, accent 0 6px,
  transparent 6px 9px)` with a soft coral glow.

## Terminal — frosted well (approved recommendation)

Not dark grey: the terminal is the same glass, sunk as an inset well
(`inset 0 2px 8px` + lip), so any CLI inherits the look.

- glass well `rgba(255,255,255,.44)`, fg `#34353d`, cursor coral
- graphite well `rgba(25,26,32,.42)`, fg `#dcdde6`, cursor `#ff8b88`
- ANSI 16 tuned per side — deepened for frost, brightened for graphite:

| slot | glass | graphite |
|---|---|---|
| red | `#d6423e` | `#ff6b67` |
| green | `#2e7d4f` | `#5fca8b` |
| yellow | `#b07c10` | `#e8b33e` |
| blue | `#3763c9` | `#6f9dff` |
| magenta | `#a4499d` | `#d580cc` |
| cyan | `#1f7f86` | `#4fc2cc` |

(brights: one step lighter each side; black/white anchored to the theme ink ramp.)

## Status colors

- glass: ok `#2e7d4f`, warn `#b07c10`, muted `#8f9094`
- graphite: ok `#63c68a`, warn `#e6c05c`, muted `#9a9ba6`

## Wiring (mirrors the paper/operator pattern)

1. `theme-glass.css` — @font-face Doto (vendored woff2) + glass token remap under
   `body[data-theme="glass"]` + ALL structural glass-system overrides scoped under
   `body[data-glass]` (an attribute `setTheme()` sets for both glass-family themes,
   so the system is written once).
2. `theme-graphite.css` — graphite token remap under `body[data-theme="graphite"]`
   only; it inherits the whole system from the `body[data-glass]` rules.
3. `app.js` — THEME_OPTIONS + settings sheet gain both; `currentTheme()` recognises
   all four; `statusColors()` / `xtermTheme()` gain the two palettes; `setTheme()`
   toggles `data-glass`; a pointer-tilt helper (delegated, throttled by rAF,
   glass-family only) feeds `--rx/--ry`; xterm `fontFamily` follows the theme.
4. `main.js` — `theme:set` whitelist becomes the four names (via a shared
   `normalizeTheme()` in settings.js, unit-tested); window `backgroundColor` map:
   glass `#e8e9ee`, graphite `#26272c`.
5. `index.html` — two stylesheet links; no external font requests (Doto vendored).
6. Verification: `npm test`; screenshots in all four themes plus `--zoom 1.75` and
   `--scene=` passes; compare against `docs/reference/glass-graphite-mockup.png`.

## Out of scope

Pixel-icon replacement beyond the chrome set (tree glyphs, launcher marks stay
text); an in-app aurora animation; theme-specific app icon.
