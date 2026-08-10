// Refuse to publish a release whose update metadata is a lie.
//
// latest-mac.yml records a sha512 and size for each dmg, and an auto-updater
// rejects any download that does not match. The staple applied during
// notarization changes the dmg after those numbers are written, so this has
// already been wrong twice — once silently, in a way that looked completely
// healthy right up until the first real update failed.
//
// Exits non-zero so CI stops before uploading. Correctness of this file is not
// visible in the artifact, only months later when nobody can update.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'release');
const ymlPath = path.join(dir, 'latest-mac.yml');

if (!fs.existsSync(ymlPath)) {
  console.error('no release/latest-mac.yml — nothing to check, and nothing to update from');
  process.exit(1);
}

const doc = yaml.load(fs.readFileSync(ymlPath, 'utf8'));
const problems = [];

if (!doc || !Array.isArray(doc.files) || !doc.files.length) {
  console.error('latest-mac.yml lists no files');
  process.exit(1);
}

for (const entry of doc.files) {
  const file = path.join(dir, entry.url);
  if (!fs.existsSync(file)) { problems.push(`${entry.url}: listed but not built`); continue; }
  const sha512 = createHash('sha512').update(fs.readFileSync(file)).digest('base64');
  const size = fs.statSync(file).size;
  if (entry.sha512 !== sha512) problems.push(`${entry.url}: sha512 does not match the built file`);
  if (entry.size !== size) problems.push(`${entry.url}: size ${entry.size} but the file is ${size}`);
  if (!problems.length) console.log(`  ${entry.url}  sha512 + size correct`);
}

// The top-level pair is what electron-updater reads first; fixing the list and
// forgetting this looks right and still fails every download.
if (doc.path) {
  const file = path.join(dir, doc.path);
  if (fs.existsSync(file)) {
    const sha512 = createHash('sha512').update(fs.readFileSync(file)).digest('base64');
    if (doc.sha512 !== sha512) problems.push(`top-level sha512 does not match ${doc.path}`);
    else console.log(`  top-level pair points at ${doc.path} and matches`);
  }
}

if (problems.length) {
  console.error('\nupdate metadata is wrong — refusing to publish:');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('update metadata describes exactly what will be uploaded');
