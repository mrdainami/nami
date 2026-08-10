// Notarize and staple the dmg itself, not just the app inside it.
//
// electron-builder notarizes the .app and staples it, then builds the dmg from
// the result — so the app is clean but the container it arrives in is not. That
// distinction is invisible here and decisive on someone else's Mac: the dmg is
// what carries the quarantine flag, so it is what Gatekeeper judges first.
// Measured on the first signed build:
//
//   Nami.app                  accepted   source=Notarized Developer ID
//   Nami-0.1.0-arm64.dmg      rejected   source=no usable signature
//
// A rejected dmg is a warning dialog before anyone has seen the app at all.
//
// Runs as afterAllArtifactBuild. No credentials → skipped in silence, because
// an unsigned local build is a normal thing to want and must not fail here.
//
// Stapling rewrites the dmg — it grew by 2110 bytes when measured — and
// electron-builder has already written latest-mac.yml describing the file as it
// was a moment earlier. That file is what an auto-updater checks a download
// against, so leaving it stale does not degrade the update, it breaks it: every
// download fails its checksum and the app can never update itself. So the
// entries are rewritten here from the bytes that actually shipped.
//
// The .blockmap is left stale on purpose. It only drives differential downloads,
// and a mismatch there costs a full download rather than a broken one.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const KEY = process.env.APPLE_API_KEY;
const KEY_ID = process.env.APPLE_API_KEY_ID;
const ISSUER = process.env.APPLE_API_ISSUER;

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export default async function notarizeDmg(buildResult) {
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (!dmgs.length) return [];
  if (!KEY || !KEY_ID || !ISSUER) {
    console.log('  • dmg notarization skipped — no App Store Connect key in the environment');
    return [];
  }

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    console.log(`  • notarizing ${name} (this waits on Apple, several minutes)`);
    try {
      run('xcrun', ['notarytool', 'submit', dmg,
        '--key', KEY, '--key-id', KEY_ID, '--issuer', ISSUER,
        '--wait', '--timeout', '30m']);
      run('xcrun', ['stapler', 'staple', dmg]);
      console.log(`  • ${name} notarized and stapled`);
    } catch (e) {
      // Loud on purpose. Everything else in this build fails quietly and gets
      // fixed later; a dmg that ships unnotarized is the one failure the user
      // finds for you.
      const detail = String(e.stderr || e.stdout || e.message || '').trim().split('\n').slice(-4).join('\n');
      throw new Error(`notarizing ${name} failed:\n${detail}`);
    }
  }
  // Deliberately does NOT fix latest-mac.yml here: electron-builder writes that
  // file after this hook returns, so a correction made now is overwritten and
  // looks like it worked. scripts/fix-update-metadata.mjs runs after the build.
  return [];
}

// sha512-base64 over the file, which is the shape electron-updater compares
// against. Verified by recomputing electron-builder's own value for an
// un-stapled dmg and getting a byte-identical string back.
function digest(file) {
  return createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

export function refreshUpdateMetadata(dmgs) {
  const byName = new Map(dmgs.map((p) => [path.basename(p), p]));
  const dirs = new Set(dmgs.map((p) => path.dirname(p)));
  for (const dir of dirs) {
    const ymlPath = path.join(dir, 'latest-mac.yml');
    let doc;
    try { doc = yaml.load(fs.readFileSync(ymlPath, 'utf8')); } catch (_) { continue; }
    if (!doc || !Array.isArray(doc.files)) continue;

    let changed = false;
    for (const entry of doc.files) {
      const file = byName.get(entry.url);
      if (!file) continue;
      const sha512 = digest(file);
      const size = fs.statSync(file).size;
      if (entry.sha512 === sha512 && entry.size === size) continue;
      // the top-level path/sha512 mirror whichever file `path` names
      if (doc.path === entry.url) { doc.sha512 = sha512; }
      entry.sha512 = sha512;
      entry.size = size;
      changed = true;
    }
    if (!changed) continue;
    fs.writeFileSync(ymlPath, yaml.dump(doc, { lineWidth: -1 }));
    console.log(`  • ${path.basename(ymlPath)} rewritten for the stapled dmg(s)`);
  }
}
