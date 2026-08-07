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
   the machine says — code, paths, terminal text, metadata.
2. **Color**: use the CSS custom properties in `paper.css` (`--paper`, `--ink`, `--muted`,
   `--dash`, `--amber-line`, `--shadow-mid`). The pastel chip palette is `TINTS` in `app.js`.
3. **Borders**: dashed 1px for resting surfaces; solid on focus. Never rounded corners
   larger than 2px; paper is cut, not extruded.
4. **Shadows**: hard offset (`5px 6px 0`), never blurred drop shadows.
5. **Texture**: content areas get the ruled-line background
   (`repeating-linear-gradient` — copy an existing one, keep the 21–28px rhythm).
6. **Status colors**: green `#4a7a4a` live, amber `#a8792a` needs-you/unsaved,
   grey `#8d8065` muted/done.
7. **Terminal text** must survive on cream: xterm runs with `minimumContrastRatio: 4.5`.

## Checklist for new UI

- [ ] Reused tokens, no new hex values without reason
- [ ] Dashed rest / solid focus borders
- [ ] Hard offset shadow if it's a card
- [ ] `npm run shot` and actually look at the screenshot
