// Make latest-mac.yml describe the dmgs as they actually shipped.
//
// Stapling a notarization ticket to a dmg adds 2110 bytes, and electron-builder
// records each file's sha512 and size before that happens. An auto-updater
// checks every download against those numbers, so a stale entry does not slow an
// update down — it stops one ever working.
//
// This lived inside the afterAllArtifactBuild hook first, where it correctly
// rewrote the file and was then silently overwritten: electron-builder writes
// latest-mac.yml after the hook returns. Ordering you cannot see is ordering you
// cannot rely on, so the correction now runs as its own step once the build has
// exited and nothing else is going to touch the file.
//
//   npm run dist    →  electron-builder && node scripts/fix-update-metadata.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshUpdateMetadata } from './notarize-dmg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'release');

if (!fs.existsSync(dir)) process.exit(0);
const dmgs = fs.readdirSync(dir).filter((f) => f.endsWith('.dmg')).map((f) => path.join(dir, f));
if (!dmgs.length) process.exit(0);

refreshUpdateMetadata(dmgs);

// Say so either way. A silent pass here reads the same as a build that never
// needed fixing, and those two cases must not look alike.
const yml = path.join(dir, 'latest-mac.yml');
if (!fs.existsSync(yml)) {
  console.log('update metadata: no latest-mac.yml in release/, nothing to correct');
  process.exit(0);
}
console.log('update metadata: checked ' + dmgs.length + ' dmg(s) against latest-mac.yml');
