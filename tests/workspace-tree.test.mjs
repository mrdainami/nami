import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { listDirectory, readTree } = require('../src/main/workspace-tree.js');

// Windows lets anyone make a junction (a link to a folder), but a link to a
// *file* needs Developer Mode or an admin shell. Asked of the machine rather
// than assumed, so a Windows box that can make them still runs everything.
const canLinkFiles = process.platform !== 'win32' || (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-link-probe-'));
  try { fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'), 'file'); return true; }
  catch (_) { return false; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-workspace-tree-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const root = path.join(base, 'workspace');
  const skill = path.join(base, 'skill-target');
  const file = path.join(base, 'file-target.md');
  fs.mkdirSync(root);
  fs.mkdirSync(skill);
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Skill\n');
  fs.writeFileSync(file, '# File\n');
  fs.writeFileSync(path.join(root, 'ordinary.txt'), 'ordinary\n');
  // 'junction' is what makes the folder links possible on Windows; every other
  // OS ignores the type and makes the same symlink as before
  fs.symlinkSync(skill, path.join(root, 'linked-skill'), 'junction');
  if (canLinkFiles) fs.symlinkSync(file, path.join(root, 'linked-file.md'));
  fs.symlinkSync(path.join(base, 'missing'), path.join(root, 'broken-link'), 'junction');
  return root;
}

const needsFileLink = !canLinkFiles && 'the listing includes a symlink to a file, which this Windows account may not create (no Developer Mode / admin)';

test('directory listing treats a live link to a directory as a folder', { skip: needsFileLink }, (t) => {
  const root = fixture(t);
  const rows = listDirectory(root, true);

  assert.deepEqual(rows.map(({ name, kind }) => ({ name, kind })), [
    { name: 'linked-skill', kind: 'dir' },
    { name: 'broken-link', kind: 'file' },
    { name: 'linked-file.md', kind: 'file' },
    { name: 'ordinary.txt', kind: 'file' },
  ]);
  assert.equal(rows[0].meta, '1 item');
  assert.equal(rows[1].meta, '');
  assert.equal(rows[2].meta, '7 B');
});

test('initial shallow tree expands through a linked directory', (t) => {
  const root = fixture(t);
  const rows = readTree(root, 0, 2);
  const linked = rows.findIndex((row) => row.name === 'linked-skill');

  assert.notEqual(linked, -1);
  assert.deepEqual(rows.slice(linked, linked + 2), [
    { name: 'linked-skill', kind: 'dir', pad: 0, meta: '1 item' },
    { name: 'SKILL.md', kind: 'file', pad: 1, meta: '8 B' },
  ]);
});
