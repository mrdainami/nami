// Is there a newer Nami than the one running?
//
// Notify-only on purpose: this asks GitHub what the latest release is, and if
// it is newer, main tells the renderer to show a bar. Clicking opens the dmg in
// a browser — the user installs it themselves. Nothing here downloads, unpacks
// or replaces anything.
//
// That restraint is deliberate. Replacing a running app in place is the step
// that needs Apple's blessing (a notarized build, verified before it is swapped
// in), and doing it wrong bricks the install. When notarization is live,
// electron-updater takes over and the only thing that changes is what happens
// on click — the deciding logic below stays exactly as it is, which is why it
// lives in its own file with the IO injected.
//
// The whole module is built to fail quietly. An update check is the app's own
// business: offline, rate-limited, behind a captive portal, or handed something
// that is not a release at all — every one of those ends as "no update", never
// as an error the user has to read.

// A dotted version as numbers, plus whether it carries a -prerelease tail.
// Anything unparseable comes back null so callers can treat it as "no answer".
function parseVersion(v) {
  const text = String(v == null ? '' : v).trim().replace(/^v/i, '');
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/.exec(text);
  if (!m) return null;
  return {
    parts: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)],
    pre: m[4] || '',
  };
}

// True when `candidate` is a version worth telling the user about.
function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }
  // Same numbers: a prerelease is the run-up to the release, so it loses to it.
  if (a.pre && !b.pre) return false;
  if (!a.pre && b.pre) return true;
  return false;
}

// GitHub's release JSON → { version, url }, or null if it is not something a
// user should be offered: a draft, a prerelease, or not a release at all.
function releaseFromApi(doc, arch = process.arch) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.draft || doc.prerelease) return null;
  const version = String(doc.tag_name || '').trim().replace(/^v/i, '');
  if (!parseVersion(version)) return null;

  // Hand the user the dmg for the machine they are on. electron-builder names
  // the arm64 one with the arch in it and leaves x64 bare, so match on that and
  // fall back to the release page rather than guessing wrong.
  const assets = Array.isArray(doc.assets) ? doc.assets : [];
  const dmgs = assets.filter((a) => a && typeof a.name === 'string' && a.name.endsWith('.dmg'));
  const wantsArm = String(arch) === 'arm64';
  const pick = dmgs.find((a) => (/arm64/i.test(a.name)) === wantsArm) || null;
  const url = (pick && pick.browser_download_url) || doc.html_url || '';
  if (!url) return null;
  return { version, url };
}

const LATEST = 'https://api.github.com/repos/mrdainami/nami/releases/latest';

async function fetchLatest(url = LATEST) {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nami' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// The whole question, answered once: { version, url } or null. Never throws.
async function checkForUpdate({ currentVersion, arch = process.arch, fetchJson = fetchLatest } = {}) {
  let doc = null;
  try {
    doc = await fetchJson();
  } catch (_) {
    return null; // offline, timed out, rate-limited — none of it is news
  }
  const rel = releaseFromApi(doc, arch);
  if (!rel) return null;
  return isNewer(rel.version, currentVersion) ? rel : null;
}

module.exports = { isNewer, releaseFromApi, checkForUpdate, parseVersion, LATEST };
