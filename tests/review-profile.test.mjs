import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReviewProfile } from '../src/main/review-profile.js';

// A home folder the way os.homedir() reports one: absolute for this machine, so
// on a PC it carries a drive letter and compares equal to a resolved --user-data.
const HOME = path.resolve('/Users/reviewer');
// The persistent profile is ~/Library/Application Support, which only a Mac has.
const MAC_ONLY = process.platform === 'win32' && 'the persistent review profile is ~/Library/Application Support, a folder only macOS has';

test('normal launches retain packaged and development profile paths', () => {
  for (const packaged of [true, false]) {
    const profile = createReviewProfile({ argv: [], normalPath: '/normal', packaged });
    assert.equal(profile.review, false);
    assert.equal(profile.path, packaged ? '/normal' : '/normal-dev');
    profile.cleanup();
  }
});
test('every review flag gets a fresh disposable profile', () => {
  for (const flag of ['--demo', '--screenshot', '--scene=settings:look', '--theme=paper']) {
    const args = { argv: [flag], normalPath: '/normal', packaged: true };
    const first = createReviewProfile(args);
    const second = createReviewProfile(args);
    try {
      assert.equal(first.review, true);
      assert.notEqual(first.path, second.path);
      assert.ok(fs.statSync(first.path).isDirectory());
      fs.writeFileSync(path.join(first.path, 'settings.json'), '{}');
    } finally { first.cleanup(); second.cleanup(); }
    assert.equal(fs.existsSync(first.path), false);
    first.cleanup();
  }
});
test('explicit profiles are respected and never deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-profile-test-'));
  try {
    for (const argv of [['--user-data', dir], ['--demo', '--user-data', dir]]) {
      const profile = createReviewProfile({ argv, normalPath: '/normal', packaged: false });
      assert.equal(profile.path, dir);
      assert.equal(profile.review, argv.includes('--demo'));
      profile.cleanup();
      assert.ok(fs.existsSync(dir));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('persistent review storage is outside protected folders and survives cleanup', { skip: MAC_ONLY }, () => {
  const args={argv:['--review'],normalPath:'/normal',packaged:true,homePath:'/Users/reviewer'};
  const first=createReviewProfile(args),second=createReviewProfile(args);
  assert.equal(first.review,true);
  assert.equal(first.path,'/Users/reviewer/Library/Application Support/Nami Review');
  assert.equal(second.path,first.path);
  first.cleanup();
});
test('review launch refuses protected storage before touching it', () => {
  for (const folder of ['Desktop','Documents','Downloads']) {
    assert.throws(()=>createReviewProfile({argv:['--scene=browser','--user-data',`/Users/reviewer/${folder}/review`],normalPath:'/normal',packaged:true,homePath:HOME}),/Review data must be outside/);
  }
  const allowed=createReviewProfile({argv:['--review','--user-data','/Users/reviewer/Desktop-copy/review'],normalPath:'/normal',packaged:true,homePath:HOME});
  assert.equal(allowed.path,path.resolve('/Users/reviewer/Desktop-copy/review'));
});
test('double-clicking the review package remains isolated without flags', { skip: MAC_ONLY }, () => {
  const profile=createReviewProfile({argv:[],normalPath:'/normal',packaged:true,reviewBuild:true,homePath:'/Users/reviewer'});
  assert.equal(profile.review,true);
  assert.equal(profile.path,'/Users/reviewer/Library/Application Support/Nami Review');
  profile.cleanup();
});
