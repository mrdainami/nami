// One JSON file holds everything the app remembers about *how it behaves* —
// theme, the any-model config, transcription provider + keys. Several writers
// touch it (theme:set, ai:config:set, settings:set) and more than one window can
// be open, so every write is read-merge-rename: never clobber a sibling key, and
// never leave a half-written file behind if we die mid-save.
// The path is passed in rather than imported from electron so tests can load this.
const fs = require('fs');
const path = require('path');

const fsIo = {
  read: (f) => fs.readFileSync(f, 'utf8'),
  exists: (f) => fs.existsSync(f),
  write: (f, t) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // 600: the file can hold API keys (envKeys) — owner-only, like ~/.ssh config
    fs.writeFileSync(f + '.tmp', t, { mode: 0o600 });
    fs.renameSync(f + '.tmp', f);
  },
};

function readSettings({ file, io = fsIo }) {
  if (!io.exists(file)) return {};
  try {
    const doc = JSON.parse(io.read(file));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  } catch (_) {
    // A corrupt file must not brick the app; it gets replaced on the next write.
    return {};
  }
}

// Shallow-merges `patch` over what is on disk. A key set to `null` is deleted —
// that is how the UI clears an API key without having to know the whole document.
function writeSettings({ file, patch, io = fsIo }) {
  try {
    const doc = readSettings({ file, io });
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === null) delete doc[k]; else doc[k] = v;
    }
    io.write(file, JSON.stringify(doc, null, 2) + '\n');
    return { ok: true, settings: doc };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// The four themes the app ships; anything else falls back to the default, so a
// stale or hand-edited settings.json can never paint the window an unknown
// color.
const THEMES = ['paper', 'operator', 'glass', 'graphite'];
// What a new install opens on. Paper is the design language and still the base
// stylesheet everything else is layered over — this is only which desk you are
// handed first, and glass is the one that reads as a current Mac app to
// somebody who has never seen Nami before. Anyone who has chosen a theme keeps
// it: this is consulted only when nothing has been chosen.
const DEFAULT_THEME = 'glass';
// First-paint window background per theme (renderer CSS takes over on load).
const THEME_BG = { paper: '#cfc3ac', operator: '#0d0d0d', glass: '#e8e9ee', graphite: '#26272c' };
function normalizeTheme(name) { return THEMES.includes(name) ? name : DEFAULT_THEME; }
function themeBackground(name) { return THEME_BG[normalizeTheme(name)]; }

module.exports = { readSettings, writeSettings, fsIo, normalizeTheme, themeBackground, THEMES, DEFAULT_THEME };
