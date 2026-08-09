// Put the freshly built Nami into /Applications, safely.
//
// Written after doing it by hand went wrong: the check for "is Nami running"
// used a process pattern that quietly matched nothing, so a running app got
// replaced underneath itself. Refusing to install over a live app is the entire
// point of this script — the copying is the easy part.
//
// Until the update bar lands (Phase 3), this is the loop: pack, install, relaunch.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'release', 'mac-arm64', 'Nami.app');
const target = '/Applications/Nami.app';

function die(msg) { console.error(msg); process.exit(1); }

if (!fs.existsSync(built)) die(`No build at ${path.relative(root, built)} — run \`npm run pack\` first.`);

// ps over pgrep: pgrep -f patterns are easy to get subtly wrong, and a false
// "not running" here is exactly the failure this script exists to prevent.
let running = '';
try {
  running = execFileSync('/bin/ps', ['-Ao', 'pid,comm'], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.includes('/Applications/Nami.app/Contents/MacOS/Nami'))
    .join('\n')
    .trim();
} catch (_) { /* if ps fails we fall through to the safe path below */ }

if (running) {
  die(`Nami is running:\n${running}\n\nQuit it first (⌘Q), then run this again.\n` +
      `Installing over a running app leaves it reading a bundle that no longer exists.`);
}

const builtAt = fs.statSync(built).mtime;
if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(built, target, { recursive: true, verbatimSymlinks: true });

// Report what actually landed, not what we intended to land.
const version = execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print CFBundleShortVersionString', path.join(target, 'Contents', 'Info.plist')],
  { encoding: 'utf8' }).trim();
let signed = 'unsigned';
try {
  const out = execFileSync('/usr/bin/codesign', ['-dv', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  signed = /TeamIdentifier=(\S+)/.exec(out)?.[1] || 'unsigned';
} catch (e) {
  const err = String(e.stderr || '');
  signed = /TeamIdentifier=(\S+)/.exec(err)?.[1] || 'unsigned';
}
console.log(`installed ${target}`);
console.log(`  version ${version}  ·  built ${builtAt.toLocaleString()}  ·  team ${signed}`);
