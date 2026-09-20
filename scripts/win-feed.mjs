// Joins the two Windows update feeds into the one a release can carry.
//
// The x64 installer and the arm64 installer are built on two machines, and each
// machine writes a latest.yml that names only its own. A release holds one file
// called latest.yml. electron-updater reads that file and takes, from the
// installers listed, the one whose name contains the arch it is running on — so
// the file that ships lists both, and an Intel PC and an ARM PC each find theirs.
//
// Nothing is trusted on the way through. Every installer is hashed again and
// compared with what its build wrote down, and the version has to be the one
// being released. A feed that is wrong installs perfectly today and fails every
// update after it, which is the one kind of broken nobody sees in time.
//
//   node scripts/win-feed.mjs <x64 folder> <arm64 folder> [--out release/latest.yml]
//
// The first half is pure: plain objects in, a plain object out.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// x64 first. The top-level path/sha512 pair is what an updater too old to read
// `files` falls back to, and a PC that old is not an ARM one.
export const ARCHES = ['x64', 'arm64'];

const setupName = (arch) => `Nami-Setup-${arch}.exe`;

export function mergeFeeds(docs) {
  const versions = [...new Set(docs.map((d) => d && d.version))];
  if (versions.length !== 1 || !versions[0]) throw new Error(`the builds disagree about the version: ${versions.join(', ') || '(none)'}`);

  const files = ARCHES.map((arch) => {
    const found = [];
    for (const d of docs) {
      if (!Array.isArray(d.files) || d.files.length !== 1) throw new Error('each build must list exactly one installer under files');
      if (d.files[0].url === setupName(arch)) found.push(d.files[0]);
    }
    if (found.length !== 1) throw new Error(`expected one feed for ${setupName(arch)}, found ${found.length}`);
    const { url, sha512, size } = found[0];
    return { url, sha512, size };
  });

  const dates = docs.map((d) => d.releaseDate).filter(Boolean).sort();
  return { version: versions[0], files, path: files[0].url, sha512: files[0].sha512, releaseDate: dates[dates.length - 1] };
}

// Every reason this feed must not be uploaded, or none.
export function checkFeed(doc, dirs, version) {
  const problems = [];
  if (doc.version !== version) problems.push(`the feed is for ${doc.version} and the release is ${version}`);
  for (const entry of doc.files) {
    const file = dirs.map((d) => path.join(d, entry.url)).find((f) => fs.existsSync(f));
    if (!file) { problems.push(`${entry.url}: listed but not built`); continue; }
    const sha512 = createHash('sha512').update(fs.readFileSync(file)).digest('base64');
    const size = fs.statSync(file).size;
    if (entry.sha512 !== sha512) problems.push(`${entry.url}: sha512 does not match the built file`);
    if (entry.size !== size) problems.push(`${entry.url}: size ${entry.size} but the file is ${size}`);
  }
  if (doc.path !== doc.files[0].url || doc.sha512 !== doc.files[0].sha512) problems.push('the top-level pair does not describe the first installer');
  return problems;
}

export function mergeFolders({ dirs, out, version }) {
  const doc = mergeFeeds(dirs.map((d) => yaml.load(fs.readFileSync(path.join(d, 'latest.yml'), 'utf8'))));
  const problems = checkFeed(doc, dirs, version);
  if (problems.length) throw new Error('the Windows update feed is wrong — refusing to write it:\n  ' + problems.join('\n  '));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, yaml.dump(doc, { lineWidth: -1 }));
  return doc;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const out = path.resolve(at === -1 ? path.join(root, 'release', 'latest.yml') : args[at + 1]);
  const dirs = (at === -1 ? args : args.filter((_, i) => i !== at && i !== at + 1)).map((d) => path.resolve(d));
  if (dirs.length !== ARCHES.length) { console.error('usage: node scripts/win-feed.mjs <x64 folder> <arm64 folder> [--out file]'); process.exit(1); }
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  try {
    const doc = mergeFolders({ dirs, out, version });
    for (const f of doc.files) console.log(`  ${f.url}  sha512 + size correct`);
    console.log(`one feed for ${doc.version}, both arches -> ${out}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
