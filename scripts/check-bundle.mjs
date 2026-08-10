// Look inside the app that was actually built, not at the config that was
// meant to produce it.
//
// tests/repo-shape.test.mjs checks the rule: electron-builder.yml still says
// only src and package.json. This checks the result. They are not the same
// claim — a glob can behave differently from how it reads, a future
// electron-builder can change what a pattern means, and an extraResources or
// afterPack step can put a file in the bundle without going near files: at all.
//
// Run after packaging:  node scripts/check-bundle.mjs
// The release workflow runs it before publishing, so nothing a user can
// download has ever gone unexamined.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything the app needs to run, and nothing that merely helped build it.
const ALLOWED_TOP = new Set(['src', 'package.json', 'node_modules']);
// Named rather than inferred: these are the ones that would actually hurt or
// embarrass, so a failure can say which and why.
const MUST_NOT_SHIP = ['docs', 'tests', 'scripts', '.claude', '.opencode', '.github', 'assets', 'build'];
// A bundle can be wrong by being empty as easily as by being fat.
const MUST_SHIP = ['src/main/main.js', 'src/renderer/index.html', 'package.json'];

function bundles() {
  const rel = path.join(ROOT, 'release');
  if (!fs.existsSync(rel)) return [];
  return fs.readdirSync(rel)
    .filter((d) => d.startsWith('mac'))
    .map((d) => path.join(rel, d, 'Nami.app', 'Contents', 'Resources', 'app.asar'))
    .filter((p) => fs.existsSync(p));
}

const found = bundles();
if (!found.length) {
  console.error('No packaged app under release/. Run `npm run pack` first.');
  process.exit(1);
}

let asar;
try { asar = require('@electron/asar'); } catch (_) {
  console.error('@electron/asar is not installed. It ships with electron-builder; run `npm ci`.');
  process.exit(1);
}

let bad = 0;
for (const file of found) {
  const arch = file.split(path.sep).slice(-5)[0];
  console.log(`\n== ${arch}`);

  // listPackage returns every path inside, each leading with a separator
  const entries = asar.listPackage(file).map((e) => e.replace(/^[/\\]/, ''));
  const top = [...new Set(entries.map((e) => e.split(/[/\\]/)[0]))].sort();
  console.log(`   ${entries.length} entries, top level: ${top.join(', ')}`);

  const strays = top.filter((t) => !ALLOWED_TOP.has(t));
  if (strays.length) { console.error(`   FAIL  should not be in the app: ${strays.join(', ')}`); bad++; }

  const named = MUST_NOT_SHIP.filter((d) => top.includes(d));
  if (named.length) { console.error(`   FAIL  private or build-only, now shipping: ${named.join(', ')}`); bad++; }

  const missing = MUST_SHIP.filter((f) => !entries.includes(f));
  if (missing.length) { console.error(`   FAIL  the app cannot run without: ${missing.join(', ')}`); bad++; }

  if (!strays.length && !named.length && !missing.length) console.log('   ok    only what it needs to run');
}

if (bad) {
  console.error(`\n${bad} problem${bad > 1 ? 's' : ''}. Not fit to publish.`);
  process.exit(1);
}
console.log(`\n${found.length} bundle${found.length > 1 ? 's' : ''} checked, both boundaries hold.`);
