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

  // Windows paths with backslash separators. The platform is named: a path's
  // shape is never what decides which rules it is read by.
  const winRoot = 'C:\\proj';
  assert.equal(isOutsideProject(winRoot, 'C:\\proj\\file.txt', 'win32'), false, 'Windows: descendant inside');
  assert.equal(isOutsideProject(winRoot, 'C:\\proj', 'win32'), false, 'Windows: root equals root');
  assert.equal(isOutsideProject(winRoot, 'C:\\proj\\a\\b', 'win32'), false, 'Windows: nested descendant inside');
  assert.equal(isOutsideProject(winRoot, 'C:\\proj-evil\\x', 'win32'), true, 'Windows: prefix is not containment');
  assert.equal(isOutsideProject('C:\\proj\\', 'C:\\proj\\a\\b', 'win32'), false, 'Windows: trailing backslash on root');

  // Windows paths with forward slashes
  assert.equal(isOutsideProject('C:/proj', 'C:/proj/file', 'win32'), false, 'Windows: forward slashes inside');

  // Windows: the same folder in another case is still the same folder
  assert.equal(isOutsideProject('C:\\Proj', 'c:\\proj\\a.txt', 'win32'), false, 'Windows: case does not make an outsider');
  assert.equal(isOutsideProject('C:\\proj', 'D:\\proj\\a.txt', 'win32'), true, 'Windows: another drive is outside');
  assert.equal(isOutsideProject('\\\\nas\\work', '\\\\nas\\work\\a.txt', 'win32'), false, 'Windows: a share is a root like any other');
  assert.equal(isOutsideProject('\\\\nas\\work', '\\\\nas\\work2\\a.txt', 'win32'), true);

  // and read as POSIX, a drive path is just an odd file name: nothing is inside it
  assert.equal(isOutsideProject('C:\\proj', 'C:\\proj\\file.txt', 'darwin'), true, 'POSIX: a backslash never separates');
});
