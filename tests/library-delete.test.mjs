import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { deleteItem } = require('../src/main/library.js');

const H = '/home/u', P = '/proj';
function fakes(existing) {
  const trashed = [];
  return {
    trashed,
    trashFn: (p) => { trashed.push(p); return Promise.resolve(); },
    existsFn: (p) => existing.includes(p),
  };
}

test('agent file inside the project .claude root goes to trash', async () => {
  const f = fakes([P + '/.claude/agents/scribe.md']);
  const out = await deleteItem({ filePath: P + '/.claude/agents/scribe.md', projectPath: P, homeDir: H, ...f });
  assert.deepEqual(out, { ok: true, target: P + '/.claude/agents/scribe.md' });
  assert.deepEqual(f.trashed, [P + '/.claude/agents/scribe.md']);
});

test('a skill SKILL.md trashes the whole skill folder', async () => {
  const f = fakes([H + '/.claude/skills/paper-design']);
  const out = await deleteItem({ filePath: H + '/.claude/skills/paper-design/SKILL.md', projectPath: null, homeDir: H, ...f });
  assert.equal(out.ok, true);
  assert.deepEqual(f.trashed, [H + '/.claude/skills/paper-design']);
});

test('paths outside the library roots and the plugin cache are refused', async () => {
  const f = fakes(['/etc/passwd', H + '/.claude/plugins/cache/x/agents/a.md']);
  const a = await deleteItem({ filePath: '/etc/passwd', projectPath: P, homeDir: H, ...f });
  assert.equal(a.ok, false);
  const b = await deleteItem({ filePath: H + '/.claude/plugins/cache/x/agents/a.md', projectPath: P, homeDir: H, ...f });
  assert.equal(b.ok, false);
  assert.deepEqual(f.trashed, []);
});

test('a path that no longer exists reports instead of throwing', async () => {
  const f = fakes([]);
  const out = await deleteItem({ filePath: P + '/.claude/agents/gone.md', projectPath: P, homeDir: H, ...f });
  assert.equal(out.ok, false);
  assert.match(out.error, /gone|Already/i);
});
