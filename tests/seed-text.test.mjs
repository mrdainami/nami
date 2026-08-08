import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateSeed, buildImproveSeed, targetDirFor } from '../src/renderer/seed-text.mjs';

test('create seed carries the description, the given name, and the right target', () => {
  const s = buildCreateSeed({ type: 'agent', platform: 'claude', scope: 'project', name: 'release scribe', desc: 'turns git history into notes', projectPath: '/p' });
  assert.match(s, /turns git history into notes/);
  assert.match(s, /"release scribe"/);
  assert.match(s, /\/p\/\.claude\/agents/);
  assert.match(s, /no placeholder text/i);
});

test('blank name asks the agent to choose one', () => {
  const s = buildCreateSeed({ type: 'skill', platform: 'claude', scope: 'user', name: '', desc: 'reviews CSS', projectPath: null });
  assert.match(s, /choose a short kebab-case name/i);
  assert.match(s, /~\/\.claude\/skills/);
});

test('opencode agents land in the opencode folders per scope', () => {
  assert.equal(targetDirFor({ type: 'agent', platform: 'opencode', scope: 'project', projectPath: '/p' }), '/p/.opencode/agent');
  assert.equal(targetDirFor({ type: 'agent', platform: 'opencode', scope: 'user', projectPath: '/p' }), '~/.config/opencode/agent');
});

test('improve seed points at the exact file and keeps the format honest', () => {
  const s = buildImproveSeed({ platform: 'claude', type: 'agent', filePath: '/p/.claude/agents/x.md', ask: 'Give it a real description.' });
  assert.match(s, /\/p\/\.claude\/agents\/x\.md/);
  assert.match(s, /Give it a real description\./);
  assert.match(s, /format valid/i);
});
