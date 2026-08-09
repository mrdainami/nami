import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { refreshUpdateMetadata } from '../scripts/notarize-dmg.mjs';

// Stapling rewrites the dmg after electron-builder has already recorded its
// hash, and an auto-updater checks a download against that record. A stale
// entry does not slow an update down, it stops one working at all — so these
// tests are about the file that decides whether Nami can ever update itself.

function fixture(bytes, { url = 'Nami-1.0.0-arm64.dmg', recordedSha = 'stale', recordedSize = 1 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-staple-'));
  const dmg = path.join(dir, url);
  fs.writeFileSync(dmg, bytes);
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), yaml.dump({
    version: '1.0.0',
    files: [{ url, sha512: recordedSha, size: recordedSize }],
    path: url,
    sha512: recordedSha,
    releaseDate: '2026-01-01T00:00:00.000Z',
  }));
  return { dir, dmg, read: () => yaml.load(fs.readFileSync(path.join(dir, 'latest-mac.yml'), 'utf8')) };
}

const sha512 = (b) => createHash('sha512').update(b).digest('base64');

test('the recorded hash is corrected to the bytes that shipped', () => {
  const bytes = Buffer.from('pretend this is a stapled disk image');
  const f = fixture(bytes);
  refreshUpdateMetadata([f.dmg]);
  assert.equal(f.read().files[0].sha512, sha512(bytes));
});

test('the recorded size is corrected too', () => {
  const bytes = Buffer.alloc(4096, 7);
  const f = fixture(bytes);
  refreshUpdateMetadata([f.dmg]);
  assert.equal(f.read().files[0].size, 4096);
});

test('the top-level hash follows the file that `path` names', () => {
  // electron-updater reads the top-level pair, not just the files list; fixing
  // one and not the other would look right and still fail every download.
  const bytes = Buffer.from('top level matters');
  const f = fixture(bytes);
  refreshUpdateMetadata([f.dmg]);
  assert.equal(f.read().sha512, sha512(bytes));
});

test('everything else in the file is left alone', () => {
  const f = fixture(Buffer.from('x'));
  refreshUpdateMetadata([f.dmg]);
  const doc = f.read();
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.releaseDate, '2026-01-01T00:00:00.000Z');
  assert.equal(doc.path, 'Nami-1.0.0-arm64.dmg');
});

test('an entry for a dmg we did not staple is untouched', () => {
  const bytes = Buffer.from('only one of these was stapled');
  const f = fixture(bytes);
  const doc = yaml.load(fs.readFileSync(path.join(f.dir, 'latest-mac.yml'), 'utf8'));
  doc.files.push({ url: 'Nami-1.0.0.dmg', sha512: 'someone-elses', size: 99 });
  fs.writeFileSync(path.join(f.dir, 'latest-mac.yml'), yaml.dump(doc));

  refreshUpdateMetadata([f.dmg]);
  const after = f.read();
  assert.equal(after.files[0].sha512, sha512(bytes));
  assert.equal(after.files[1].sha512, 'someone-elses');
  assert.equal(after.files[1].size, 99);
});

test('a missing latest-mac.yml is not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-staple-'));
  const dmg = path.join(dir, 'Nami-1.0.0-arm64.dmg');
  fs.writeFileSync(dmg, 'no metadata beside me');
  assert.doesNotThrow(() => refreshUpdateMetadata([dmg]));
});

test('already-correct metadata is left exactly as it was', () => {
  const bytes = Buffer.from('already right');
  const f = fixture(bytes, { recordedSha: sha512(bytes), recordedSize: bytes.length });
  const before = fs.readFileSync(path.join(f.dir, 'latest-mac.yml'), 'utf8');
  refreshUpdateMetadata([f.dmg]);
  assert.equal(fs.readFileSync(path.join(f.dir, 'latest-mac.yml'), 'utf8'), before);
});
