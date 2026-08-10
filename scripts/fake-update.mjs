// Serve a pretend newer Nami from this machine, so the updater can be tested
// without publishing anything.
//
// The loop this replaces is: tag, wait nine minutes for CI, publish, install,
// watch. That is too slow to run the tests that matter — and the test that
// matters most is the one where the download is corrupt, because that is the
// path between a user and a broken install.
//
// Two moving parts, because a real update has two:
//
//   --serve <app>    zip the .app, hash it, write latest-mac.yml beside it and
//                    serve the lot over http on localhost.
//   --point <app>    rewrite that installed app's Contents/Resources/app-update.yml
//                    so it asks localhost instead of GitHub. This is the file
//                    electron-updater reads inside a packaged app; there is no
//                    other way to aim a real build somewhere else.
//
// The signature is the part people trip on. Squirrel refuses to swap in an app
// whose code signature does not match the one running, so the served app must
// be a genuinely signed build — bumping the version inside an existing .app
// breaks its signature and the update fails for a reason that has nothing to do
// with your code. So both builds come from `npm run pack`:
//
//   1. npm run pack                      → release/mac-arm64/Nami.app  (the old one)
//   2. cp -R release/mac-arm64/Nami.app /Applications/Nami-test.app
//   3. bump version in package.json, npm run pack   → the new one
//   4. node scripts/fake-update.mjs --serve release/mac-arm64/Nami.app \
//                                   --point /Applications/Nami-test.app
//   5. open /Applications/Nami-test.app, click download, quit, reopen
//
// Then put package.json back.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release', 'fake-update');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const PORT = Number(arg('--port') || 8788);
const serveApp = arg('--serve');
const pointApp = arg('--point');
const corrupt = process.argv.includes('--corrupt');

if (!serveApp && !pointApp) {
  console.error('usage: node scripts/fake-update.mjs --serve <Nami.app> [--point <installed Nami.app>] [--corrupt]');
  process.exit(1);
}

// The version the .app actually declares. Read from its own Info.plist rather
// than from package.json, because what is served has to agree with what was
// built — they diverge the moment you forget to re-pack.
function versionOf(app) {
  const plist = path.join(app, 'Contents', 'Info.plist');
  const out = execFileSync('/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', plist], { encoding: 'utf8' });
  return out.trim();
}

function sha512(file) {
  return createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

if (serveApp) {
  const app = path.resolve(serveApp);
  if (!fs.existsSync(app)) { console.error(`no app at ${app} — run npm run pack first`); process.exit(1); }

  const version = versionOf(app);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // ditto, not zip: it is what electron-builder uses and the only one that
  // preserves the symlinks and extended attributes a signed bundle needs.
  const zip = path.join(OUT, `Nami-${process.arch}.zip`);
  console.log(`zipping ${path.basename(app)} (${version})…`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);

  const size = fs.statSync(zip).size;
  const hash = sha512(zip);

  if (corrupt) {
    // The point of the exercise: the metadata stays honest and the bytes do
    // not. A correct updater refuses this and leaves the installed app alone.
    const bytes = fs.readFileSync(zip);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(zip, bytes);
    console.log('  ✗ zip deliberately corrupted — the update must now REFUSE to install');
  }

  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${path.basename(zip)}`,
    `    sha512: ${hash}`,
    `    size: ${size}`,
    `path: ${path.basename(zip)}`,
    `sha512: ${hash}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'latest-mac.yml'), yml);
  console.log(`  served version ${version}, ${(size / 1e6).toFixed(0)} MB`);
}

if (pointApp) {
  const target = path.resolve(pointApp);
  const res = path.join(target, 'Contents', 'Resources');
  if (!fs.existsSync(res)) {
    console.error(`no Contents/Resources inside ${target} — is that a packaged Nami?`);
    process.exit(1);
  }
  const feed = path.join(res, 'app-update.yml');

  // A `--dir` build has no app-update.yml at all: electron-builder only writes
  // one when it builds a real target. So this creates the file as often as it
  // replaces one, and only keeps a copy when there was something to keep.
  const backup = feed + '.real';
  if (fs.existsSync(feed) && !fs.existsSync(backup)) fs.copyFileSync(feed, backup);
  fs.writeFileSync(feed, `provider: generic\nurl: http://localhost:${PORT}\nupdaterCacheDirName: nami-updater\n`);

  // Writing into Resources breaks the seal — codesign records what is in there,
  // and Squirrel will not swap an app whose signature does not verify. Re-sign
  // the outer bundle so the copy under test is as real as the one users get.
  // Only the top level: the frameworks and helpers inside keep the signatures
  // electron-builder already gave them, which is what --deep would trample.
  const identity = arg('--sign') || defaultIdentity();
  if (identity) {
    const ents = path.join(ROOT, 'build', 'entitlements.mac.plist');
    execFileSync('codesign', ['--force', '--sign', identity, '--options', 'runtime',
      ...(fs.existsSync(ents) ? ['--entitlements', ents] : []), target]);
    execFileSync('codesign', ['--verify', '--strict', target]);
    console.log(`  re-signed ${path.basename(target)} as ${identity}`);
  } else {
    console.log('  ! no signing identity found — Squirrel will refuse the swap, so the');
    console.log('    happy path cannot be tested. Pass --sign "Developer ID Application: …".');
  }
  console.log(`  ${path.basename(target)} now asks localhost:${PORT}`);
}

// The one Developer ID on this machine, if there is exactly one to be sure about.
function defaultIdentity() {
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    const names = [...out.matchAll(/"(Developer ID Application: [^"]+)"/g)].map((m) => m[1]);
    return names.length === 1 ? names[0] : null;
  } catch (_) { return null; }
}

if (serveApp) {
  http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent((req.url || '').split('?')[0]));
    const file = path.join(OUT, name);
    // Misses are logged too, and loudly. A request that 404s silently is how an
    // updater looks like it is doing nothing when it is in fact asking for
    // something that was never served — a blockmap, a differently named zip.
    if (!name || !fs.existsSync(file)) {
      console.log(`  ✗ 404 ${name || '(root)'}`);
      res.writeHead(404).end('no');
      return;
    }
    console.log(`  → ${name}${req.headers.range ? ` [range ${req.headers.range}]` : ''}`);
    res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, () => {
    console.log(`\nserving ${OUT} on http://localhost:${PORT}`);
    console.log('open the installed copy, click download in the update bar, then quit it.\n');
  });
}
