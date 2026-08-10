# Nami — the agent workbench: rebrand + mascot design

Date: 2026-08-08 · Status: approved by Calvin

## Identity

- The app is renamed **Nami** (波, "wave" — derived from Dainami, 大波 "big wave").
- Category line: **the agent workbench**. Human line: "the desk where your AI agents work."
- Dainami remains the company/brand behind it ("Nami, by Dainami").

## Mascot

A small hand-drawn wave-blob creature in brand coral (sampled from `dainami-mark.png`):

- Soft cresting-wave silhouette with a foam curl on top
- Two dot eyes, no mouth; cute proportions — body ~70% of mass, low center of gravity
- Wobbly ink linework so it reads as drawn on the paper of the UI
- Distinct from Clawd (Claude Code): Clawd is pixel/geometric, Nami is organic/ink

## Generation pipeline

1. KIE GPT-Image-2 with `dainami-mark.png` uploaded as style/color reference.
2. Round 1: character sheet of 4–6 wave-blob variations (foam curl size, eye placement, crest angle). Pick the best.
3. Round 2: two finals — (a) neutral standing pose (canonical marketing master), (b) draped pose lying over the top edge of the wordmark like a cat on a bookshelf.
4. Masters saved as transparent PNGs to Dropbox `content/brand-assets/logos/` as `nami-mascot.png` and `nami-draped.png`.

## Theme adaptability

- Shipped in-app asset is an **SVG traced/redrawn from the draped-pose winner**.
- Fill/stroke bound to CSS theme tokens: paper theme → coral fill + ink outline; operator dark → operator accent, mono lineart, hollow fill.
- One shape file; themes handle color. No per-theme PNGs in the app.

## Header integration

- Top-left wordmark text "Nami" in the existing paper display type.
- SVG creature overlaps the top of the letters — draped over the title, slightly clipped so it reads as *on* it, not floating.
- Sized for header height without crowding.

## Rename scope

- Window title, `index.html` `<title>`, `package.json` name/productName, header wordmark, "Dainami CLI" strings in renderer/main, docs note, memory files updated.
- Repo folder name stays as-is.

## Not doing (YAGNI)

Animated mascot, per-theme poses, app icon redesign (separate task), renaming the git repo/remote.

## Addendum (same day): flat redesign

Calvin reviewed the ink-style mascot and pivoted the style: **flat Clawd-grammar** — no outlines, no keyline, one continuous coral silhouette (teardrop body → leftward spiral curl, cream foam swirl in the notch, dark rounded-square eyes, two connected feet). Flat icon designed FIRST, header/scene variants derive from it. Sub line is "AI agent workbench". The in-app SVG is potrace-traced from the master PNG per color layer and token-bound; the mascot sits beside the wordmark (baseline-aligned, cap-height), not draped over it. App icon composed at `build/icon.png`.
