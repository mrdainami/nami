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
  const s = buildCreateSeed({ type: 'skill', scope: 'project', name: '', desc: 'reviews CSS', projectPath: '/p' });
  assert.match(s, /choose a short kebab-case name/i);
  assert.match(s, /\/p\/skills/);
  assert.match(s, /folder under .* holding a SKILL\.md/);
});

test('opencode agents land in the opencode folders per scope', () => {
  assert.equal(targetDirFor({ type: 'agent', platform: 'opencode', scope: 'project', projectPath: '/p' }), '/p/.opencode/agent');
  assert.equal(targetDirFor({ type: 'agent', platform: 'opencode', scope: 'user', projectPath: '/p' }), '~/.config/opencode/agent');
});

// A skill goes in the project's own folder with no agent's name on it. There is
// no per-platform variant, and no machine-wide one — the pointer only reaches
// agents that open this folder.
test('skills land in the project\'s neutral folder, whatever platform is passed', () => {
  assert.equal(targetDirFor({ type: 'skill', platform: 'claude', scope: 'project', projectPath: '/p' }), '/p/skills');
  assert.equal(targetDirFor({ type: 'skill', platform: 'codex', scope: 'project', projectPath: '/p' }), '/p/skills');
  assert.equal(targetDirFor({ type: 'skill', scope: 'project', projectPath: '/p' }), '/p/skills');
  // even asked for user scope, a skill belongs to the project it was made in
  assert.equal(targetDirFor({ type: 'skill', platform: 'claude', scope: 'user', projectPath: '/p' }), '/p/skills');
});

test('the skill seed never names a platform, so the agent writes something portable', () => {
  const s = buildCreateSeed({ type: 'skill', scope: 'project', name: 'meeting notes', desc: 'transcript into decisions', projectPath: '/p' });
  assert.ok(!/\bclaude\b/i.test(s), 'no agent is named');
  assert.ok(!/\bcodex\b/i.test(s));
  assert.match(s, /agent-agnostic/i);
  assert.match(s, /do not write any files yet/i);   // the interview beats survive
  assert.match(s, /only after I say go, write it/i);
  assert.equal(s.includes('\n'), false);            // still one line for the pty seeder
});

test('improve seed points at the exact file and keeps the format honest', () => {
  const s = buildImproveSeed({ platform: 'claude', type: 'agent', filePath: '/p/.claude/agents/x.md', ask: 'Give it a real description.' });
  assert.match(s, /\/p\/\.claude\/agents\/x\.md/);
  assert.match(s, /Give it a real description\./);
  assert.match(s, /format valid/i);
});
