import { test } from 'node:test';
import assert from 'node:assert/strict';

test('isOutsideProject: descendants are inside, siblings and prefixes are outside', async () => {
  const { isOutsideProject } = await import('../src/renderer/path-guard.mjs');
  const root = '/Users/me/proj';
  assert.equal(isOutsideProject(root, '/Users/me/proj/readme.md'), false);
  assert.equal(isOutsideProject(root, '/Users/me/proj'), false);
  assert.equal(isOutsideProject(root, '/Users/me/proj/a/b/c.txt'), false);
  assert.equal(isOutsideProject(root, '/Users/me/.ssh/id_rsa'), true);
  assert.equal(isOutsideProject(root, '/Users/me/proj-evil/x'), true, 'prefix is not containment');
  assert.equal(isOutsideProject(root, '/etc/passwd'), true);
  assert.equal(isOutsideProject(null, '/anything'), false, 'no project open: nothing to confine');
  assert.equal(isOutsideProject('', '/anything'), false);
});
