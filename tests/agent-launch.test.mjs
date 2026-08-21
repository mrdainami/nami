import test from 'node:test';
import assert from 'node:assert/strict';
import { agentLaunch } from '../src/renderer/agent-launch.mjs';

// The launch table is the single source of truth for "click an agent on tool
// X → what runs". Every assertion here mirrors a probe transcript in
// specs/2026-08-13-agents-universal.md Appendix A; a change that fails one of
// these tests needs new probe evidence, not a better-sounding sentence.

test('claude launches as the agent with its native flag (A.1)', () => {
  const l = agentLaunch('claude', 'ui-polisher');
  assert.equal(l.kind, 'flag');
  assert.deepEqual(l.argv, ['--agent', 'ui-polisher']);
  assert.equal(l.status, 'verified');
  assert.equal(l.seed, '');
});

test('opencode launches as the agent with its native flag (A.2)', () => {
  const l = agentLaunch('opencode', 'release-scribe');
  assert.equal(l.kind, 'flag');
  assert.deepEqual(l.argv, ['--agent', 'release-scribe']);
  assert.equal(l.status, 'verified');
});

test('antigravity launches as the agent with its native flag (A.4)', () => {
  const l = agentLaunch('antigravity', 'pr-triage');
  assert.equal(l.kind, 'flag');
  assert.deepEqual(l.argv, ['--agent', 'pr-triage']);
  assert.equal(l.status, 'verified');
});

test('codex is seeded with its Spawn sentence — no flag exists (A.5)', () => {
  const l = agentLaunch('codex', 'release-scribe');
  assert.equal(l.kind, 'seed');
  assert.deepEqual(l.argv, []);
  assert.equal(l.seed, 'Spawn release-scribe to take the task I describe next.');
  assert.equal(l.status, 'seeded');
});

test('kimi is seeded to read its delivered copy — the TUI ignores its flags (A.3)', () => {
  const l = agentLaunch('kimi', 'ui-polisher');
  assert.equal(l.kind, 'seed');
  assert.equal(l.seed,
    'Read .kimi-code/agents/ui-polisher.md and adopt it as your role for this entire session.');
  assert.equal(l.status, 'seeded');
});

test('hermes cannot launch agents and the table says so', () => {
  const l = agentLaunch('hermes', 'x');
  assert.equal(l.kind, 'none');
  assert.equal(l.status, 'none');
});

test('an unknown tool gets a safe none, never a crash', () => {
  for (const tool of ['gemini', 'cursor', '', null, undefined, 'not-a-tool']) {
    const l = agentLaunch(tool, 'x');
    assert.equal(l.kind, 'none');
    assert.deepEqual(l.argv, []);
    assert.equal(l.seed, '');
  }
});

test('awkward slugs survive intact', () => {
  for (const slug of ['pr-triage', 'My.Agent', 'a_b', 'x2']) {
    assert.deepEqual(agentLaunch('claude', slug).argv, ['--agent', slug]);
    assert.ok(agentLaunch('kimi', slug).seed.includes(`.kimi-code/agents/${slug}.md`));
    assert.ok(agentLaunch('codex', slug).seed.startsWith(`Spawn ${slug} `));
  }
});

test('no flag tool claims a seed and no seeded tool claims a flag', () => {
  for (const tool of ['claude', 'opencode', 'antigravity']) {
    const l = agentLaunch(tool, 's');
    assert.equal(l.seed, '', `${tool} should not type anything`);
  }
  for (const tool of ['codex', 'kimi']) {
    const l = agentLaunch(tool, 's');
    assert.deepEqual(l.argv, [], `${tool} has no launch flag`);
    assert.ok(l.seed.length > 0);
  }
});

// grok's TUI ignores --agent, exactly as kimi's does. Both probed the same
// way and both landed on a seed; see specs/2026-08-21-grok.md Appendix A for
// the transcript (headless honours the flag, the TUI answers as plain Grok).
test('grok is seeded, because its TUI ignores --agent', () => {
  const l = agentLaunch('grok', 'release-scribe');
  assert.equal(l.kind, 'seed');
  assert.equal(l.status, 'seeded');
  assert.deepEqual(l.argv, []);
  assert.match(l.seed, /\.grok\/agents\/release-scribe\.md/);
});
