---
name: new-viewer
description: Use when adding support for viewing a new file type in Dainami CLI — the steps to add a viewer tile without touching the architecture.
---

# Adding a New Viewer Tile

## Overview

Viewer tiles render files in-app (image, video, audio, PDF today). Adding a type is a
three-file change; the dispatcher and tile lifecycle already exist.

## Steps

1. **Classify** — `src/renderer/file-kinds.mjs`: add the extension(s) to a Set, or a new
   Set + branch in `fileKind()` returning your new kind string. Add a test case in
   `tests/file-kinds.test.mjs` and run `npm test`.
2. **Route** — `src/renderer/app.js` `openFile()`: non-text kinds go to
   `openViewer(filePath, kind)`. If you added a new kind string, give it a chip code in
   `VIEWER_CODES`.
3. **Render** — `mountViewer()`: add a branch building the DOM for your kind. Local files
   load via `fileUrl(p.filePath)` (`file://` URLs work natively — no libraries). Always
   keep the `.ed-bar` footer with the path + Finder button, and wire the media `error`
   fallback to the "can't preview" card.
4. **Style** — `paper.css` under `/* ---- viewer tiles ---- */`, following the
   paper-design skill.
5. **Verify** — `npm test`, `npm run shot`, then open a real file of that type.
