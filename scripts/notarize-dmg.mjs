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
// Note for Phase 5: stapling rewrites the dmg, so the .blockmap electron-builder
// wrote a moment earlier no longer matches. That only costs electron-updater its
// differential download — it falls back to fetching the whole dmg, which is what
// it does today anyway.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

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
  return [];
}
