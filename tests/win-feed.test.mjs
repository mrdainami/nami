// One latest.yml for two kinds of PC.
//
// Each Windows build machine writes its own latest.yml, and each one names only
// the installer that machine made. A release has room for one file called
// latest.yml. Upload either as it is and half the PCs are told their update is
// an installer for a processor they do not have.
//
// electron-updater picks, from the files listed, the one whose name contains
// the arch it is running on. So the feed a release carries lists both, and
// these tests hold that file to what the updater will read out of it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { mergeFeeds, checkFeed, mergeFolders } from '../scripts/win-feed.mjs';

const feed = (arch, over = {}) => ({
  version: '0.6.0',
  files: [{ url: `Nami-Setup-${arch}.exe`, sha512: `hash-of-${arch}`, size: arch === 'x64' ? 111 : 222 }],
  path: `Nami-Setup-${arch}.exe`,
  sha512: `hash-of-${arch}`,
  releaseDate: arch === 'x64' ? '2026-09-21T10:00:00.000Z' : '2026-09-21T10:07:00.000Z',
  ...over,
});

test('both installers are listed, each with the numbers its own build wrote', () => {
  const out = mergeFeeds([feed('arm64'), feed('x64')]);
  assert.deepEqual(out.files, [
    { url: 'Nami-Setup-x64.exe', sha512: 'hash-of-x64', size: 111 },
    { url: 'Nami-Setup-arm64.exe', sha512: 'hash-of-arm64', size: 222 },
  ]);
  assert.equal(out.version, '0.6.0');
});

test('the top-level pair is the x64 installer, whichever order the builds finished in', () => {
  // An updater too old to read `files` reads this pair, and a PC that old is x64.
  for (const order of [[feed('x64'), feed('arm64')], [feed('arm64'), feed('x64')]]) {
    const out = mergeFeeds(order);
    assert.equal(out.path, 'Nami-Setup-x64.exe');
    assert.equal(out.sha512, 'hash-of-x64');
  }
});

test('the release date is the later of the two', () => {
  assert.equal(mergeFeeds([feed('x64'), feed('arm64')]).releaseDate, '2026-09-21T10:07:00.000Z');
});

test('two builds of different versions are never joined', () => {
  assert.throws(() => mergeFeeds([feed('x64'), feed('arm64', { version: '0.5.3' })]), /version/);
});

test('a missing arch stops the merge rather than shipping half a feed', () => {
  assert.throws(() => mergeFeeds([feed('x64')]), /arm64/);
  assert.throws(() => mergeFeeds([feed('arm64'), feed('arm64')]), /x64/);
});

test('a feed that names anything but one setup installer is refused', () => {
  assert.throws(() => mergeFeeds([feed('x64', { files: [] }), feed('arm64')]), /files/);
  const portable = feed('x64'); portable.files[0].url = 'Nami-Portable-x64.exe';
  assert.throws(() => mergeFeeds([portable, feed('arm64')]), /x64/);
});

test('every name in the merged feed says which arch it is for', () => {
  // This is the whole of how electron-updater chooses: url.includes(process.arch).
  const out = mergeFeeds([feed('x64'), feed('arm64')]);
  for (const arch of ['x64', 'arm64']) assert.equal(out.files.filter((f) => f.url.includes(arch)).length, 1);
});

// --- against real bytes ------------------------------------------------------

const sha512 = (buf) => createHash('sha512').update(buf).digest('base64');

function built(root, arch, bytes, version = '0.6.0') {
  const dir = path.join(root, arch);
  fs.mkdirSync(dir, { recursive: true });
  const name = `Nami-Setup-${arch}.exe`;
  fs.writeFileSync(path.join(dir, name), bytes);
  fs.writeFileSync(path.join(dir, 'latest.yml'), yaml.dump({
    version, files: [{ url: name, sha512: sha512(bytes), size: bytes.length }], path: name, sha512: sha512(bytes), releaseDate: '2026-09-21T10:00:00.000Z',
  }));
  return dir;
}

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nami-feed-'));

test('two build folders become one feed that matches the installers beside it', () => {
  const root = scratch();
  const dirs = [built(root, 'x64', Buffer.from('intel installer')), built(root, 'arm64', Buffer.from('arm installer, longer'))];
  const out = path.join(root, 'latest.yml');
  mergeFolders({ dirs, out, version: '0.6.0' });
  const doc = yaml.load(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(doc.files.map((f) => f.url), ['Nami-Setup-x64.exe', 'Nami-Setup-arm64.exe']);
  assert.deepEqual(checkFeed(doc, dirs, '0.6.0'), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('an installer that changed after its hash was written is caught', () => {
  const root = scratch();
  const dirs = [built(root, 'x64', Buffer.from('intel installer')), built(root, 'arm64', Buffer.from('arm installer'))];
  fs.appendFileSync(path.join(dirs[1], 'Nami-Setup-arm64.exe'), 'signed afterwards');
  assert.throws(() => mergeFolders({ dirs, out: path.join(root, 'latest.yml'), version: '0.6.0' }), /Nami-Setup-arm64\.exe/);
  assert.equal(fs.existsSync(path.join(root, 'latest.yml')), false, 'nothing is written when the check fails');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a feed for a version other than the one being released is caught', () => {
  const root = scratch();
  const dirs = [built(root, 'x64', Buffer.from('a'), '0.5.3'), built(root, 'arm64', Buffer.from('b'), '0.5.3')];
  assert.throws(() => mergeFolders({ dirs, out: path.join(root, 'latest.yml'), version: '0.6.0' }), /0\.5\.3/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a listed installer that is not there is caught', () => {
  const root = scratch();
  const dirs = [built(root, 'x64', Buffer.from('a')), built(root, 'arm64', Buffer.from('b'))];
  const doc = mergeFeeds(dirs.map((d) => yaml.load(fs.readFileSync(path.join(d, 'latest.yml'), 'utf8'))));
  fs.rmSync(path.join(dirs[0], 'Nami-Setup-x64.exe'));
  assert.match(checkFeed(doc, dirs, '0.6.0').join('\n'), /Nami-Setup-x64\.exe.*not/);
  fs.rmSync(root, { recursive: true, force: true });
});
