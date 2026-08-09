import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planRemoval, isSafeRemovePath, removeAgent } = require('../src/main/agent-remove.js');

const HOME = '/Users/dev';

test('a CLI with its own uninstaller gets used instead of deleting files', () => {
  const p = planRemoval({ id: 'hermes', binPath: '/Users/dev/.local/bin/hermes', home: HOME });
  assert.equal(p.mode, 'uninstall');
  assert.equal(p.command, 'hermes uninstall');
});

test('without an uninstaller, the program and the auth file go', () => {
  const p = planRemoval({ id: 'opencode', binPath: '/Users/dev/.opencode/bin/opencode', home: HOME });
  assert.equal(p.mode, 'delete');
  assert.deepEqual(p.paths, ['/Users/dev/.opencode/bin/opencode', '/Users/dev/.local/share/opencode/auth.json']);
});

test("claude removes the program only — ~/.claude is the user's own work", () => {
  const p = planRemoval({ id: 'claude', binPath: '/Users/dev/.local/bin/claude', home: HOME });
  assert.equal(p.mode, 'delete');
  assert.deepEqual(p.paths, ['/Users/dev/.local/bin/claude']);
  assert.ok(p.describe.some((d) => /settings|skills|history/i.test(d)), 'must say what survives');
});

test('an agent with no lifecycle cannot be removed', () => {
  assert.equal(planRemoval({ id: 'gemini', binPath: '/usr/local/bin/gemini', home: HOME }).mode, 'none');
});

test('an agent that was never detected cannot be removed', () => {
  assert.equal(planRemoval({ id: 'opencode', binPath: '', home: HOME }).mode, 'none');
});

test('paths outside home are refused', () => {
  assert.equal(isSafeRemovePath('/usr/local/bin/opencode', HOME), false);
  assert.equal(isSafeRemovePath('/etc/passwd', HOME), false);
  assert.equal(isSafeRemovePath('relative/path', HOME), false);
});

test('home itself and traversal are refused', () => {
  assert.equal(isSafeRemovePath(HOME, HOME), false);
  assert.equal(isSafeRemovePath(HOME + '/', HOME), false);
  assert.equal(isSafeRemovePath(HOME + '/../root/x', HOME), false);
  assert.equal(isSafeRemovePath('/Users/develop/x', HOME), false, 'prefix match must not pass');
});

test('a normal path under home is allowed', () => {
  assert.equal(isSafeRemovePath(HOME + '/.local/bin/opencode', HOME), true);
});

test('a system-installed CLI is refused rather than deleted', () => {
  const p = planRemoval({ id: 'opencode', binPath: '/usr/local/bin/opencode', home: HOME });
  assert.equal(p.mode, 'none');
  assert.match(p.reason, /outside your home folder/i);
});

test('removeAgent deletes exactly the planned paths', async () => {
  const gone = [];
  const out = await removeAgent({ id: 'claude', binPath: HOME + '/.local/bin/claude', home: HOME, rm: async (p) => { gone.push(p); } });
  assert.equal(out.ok, true);
  assert.deepEqual(gone, [HOME + '/.local/bin/claude']);
  assert.deepEqual(out.removed, [HOME + '/.local/bin/claude']);
});

test('removeAgent refuses an uninstall-mode agent — that runs in a tile', async () => {
  const out = await removeAgent({ id: 'hermes', binPath: HOME + '/.local/bin/hermes', home: HOME, rm: async () => { throw new Error('must not delete'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /uninstall/i);
});

test('removeAgent reports a delete that failed instead of claiming success', async () => {
  const out = await removeAgent({ id: 'claude', binPath: HOME + '/.local/bin/claude', home: HOME, rm: async () => { throw new Error('EACCES'); } });
  assert.equal(out.ok, false);
  assert.match(out.error, /EACCES/);
  assert.deepEqual(out.removed, []);
});
