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

  // POSIX: backslash is a legal filename character, not a separator
  assert.equal(isOutsideProject('/proj', '/proj\\evil'), true, 'POSIX: backslash is not a separator');

  // Windows paths with backslash separators
  const winRoot = 'C:\\proj';
  assert.equal(isOutsideProject(winRoot, 'C:\\proj\\file.txt'), false, 'Windows: descendant inside');
  assert.equal(isOutsideProject(winRoot, 'C:\\proj'), false, 'Windows: root equals root');
  assert.equal(isOutsideProject(winRoot, 'C:\\proj\\a\\b'), false, 'Windows: nested descendant inside');
  assert.equal(isOutsideProject(winRoot, 'C:\\proj-evil\\x'), true, 'Windows: prefix is not containment');
  assert.equal(isOutsideProject('C:\\proj\\', 'C:\\proj\\a\\b'), false, 'Windows: trailing backslash on root');

  // Windows paths with forward slashes
  assert.equal(isOutsideProject('C:/proj', 'C:/proj/file'), false, 'Windows: forward slashes inside');
});
