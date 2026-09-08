import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReviewProfile } from '../src/main/review-profile.js';

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
