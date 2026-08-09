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

test('create seed interviews and gets a go-ahead before it writes anything', () => {
  const s = buildCreateSeed({ type: 'agent', platform: 'claude', scope: 'user', name: '', desc: 'keeps the README honest', projectPath: null });
  assert.match(s, /do not write any files yet/i);          // beat 1: hold off
  assert.match(s, /ask me 2 to 4 short numbered questions/i);
  assert.match(s, /show me the plan/i);                     // beat 2: propose
  assert.match(s, /wait for me to say go/i);
  assert.match(s, /only after I say go, write it/i);        // beat 3: write
  // the ask has to come before the write, or the agent one-shots it anyway
  assert.ok(s.indexOf('ask me 2 to 4') < s.indexOf('Only after I say go'));
});

test('the seed stays one line — the pty seeder presses Enter for us', () => {
  const s = buildCreateSeed({ type: 'skill', platform: 'claude', scope: 'user', name: 'x', desc: 'y', projectPath: null });
  assert.equal(s.includes('\n'), false);
  assert.equal(s.includes('\r'), false);
});

test('blank name asks the agent to choose one', () => {
  const s = buildCreateSeed({ type: 'skill', platform: 'claude', scope: 'user', name: '', desc: 'reviews CSS', projectPath: null });
  assert.match(s, /choose a short kebab-case name/i);
  assert.match(s, /~\/\.claude\/skills/);
  assert.match(s, /folder under .* holding a SKILL\.md/);
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
