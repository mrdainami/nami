import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  parseAgentMd, renderCopy, isDelivered, MARKER,
  readAgentMasters, agentDeliveryPlan, deliverAgents, deliveryState, liftToMaster, sweepCopies,
} = require('../src/main/agent-master.js');

function memIo(seed = {}) {
  const files = { ...seed };
  return {
    read: (f) => { if (!(f in files)) throw new Error('ENOENT ' + f); return files[f]; },
    write: (f, t) => { files[f] = t; },
    exists: (f) => f in files,
    remove: (f) => { delete files[f]; },
    list: (dir) => Object.keys(files).filter((f) => f.startsWith(dir + '/')).map((f) => f.slice(dir.length + 1)).filter((r) => !r.includes('/')),
    files,
  };
}

const PROJ = '/proj';
const MASTER_MD = `---
name: release-scribe
description: Turns git history into release notes.
tools: Read, Grep, Bash
model: sonnet
---

You are the release scribe. Keep the README honest.
`;

// ---- parse ------------------------------------------------------------------

test('parseAgentMd reads the superset frontmatter and the body', () => {
  const a = parseAgentMd(MASTER_MD);
  assert.equal(a.name, 'release-scribe');
  assert.equal(a.description, 'Turns git history into release notes.');
  assert.equal(a.tools, 'Read, Grep, Bash');
  assert.equal(a.model, 'sonnet');
  assert.equal(a.mode, '');
  assert.match(a.body, /^You are the release scribe/);
});

test('parseAgentMd tolerates a missing frontmatter block', () => {
  const a = parseAgentMd('just a prompt\n');
  assert.equal(a.name, '');
  assert.match(a.body, /just a prompt/);
});

// ---- dialect copies ---------------------------------------------------------

test('claude copy keeps tools and model, drops mode, and carries the marker', () => {
  const text = renderCopy('claude', 'release-scribe', parseAgentMd(MASTER_MD.replace('---\n\n', 'mode: subagent\n---\n\n')));
  assert.match(text, /^---\nname: release-scribe\n/);
  assert.match(text, /tools: Read, Grep, Bash/);
  assert.match(text, /model: sonnet/);
  assert.ok(!text.includes('mode:'), 'mode is not Claude dialect');
  assert.ok(isDelivered(text));
  assert.match(text, /edit that file/);
});

test('opencode copy speaks its dialect: description + mode, no name key', () => {
  const text = renderCopy('opencode', 'release-scribe', parseAgentMd(MASTER_MD));
  assert.match(text, /description: Turns git history/);
  assert.match(text, /mode: subagent/);
  assert.ok(!/^name:/m.test(text), 'opencode names agents by filename');
  assert.ok(isDelivered(text));
});

test('codex copy is TOML with the prompt as developer_instructions', () => {
  const text = renderCopy('codex', 'release-scribe', parseAgentMd(MASTER_MD));
  assert.match(text, /^# made by Nami from agents\/release-scribe\.md/);
  assert.match(text, /name = "release-scribe"/);
  assert.match(text, /description = "Turns git history into release notes\."/);
  assert.match(text, /developer_instructions = """\nYou are the release scribe/);
});

test('isDelivered is false for a hand-made file', () => {
  assert.equal(isDelivered(MASTER_MD), false);
});

// ---- masters + plan ---------------------------------------------------------

test('readAgentMasters lists agents/ and parses each', () => {
  const io = memIo({ '/proj/agents/release-scribe.md': MASTER_MD, '/proj/agents/notes.txt': 'x' });
  const masters = readAgentMasters({ projectPath: PROJ, io });
  assert.equal(masters.length, 1);
  assert.equal(masters[0].slug, 'release-scribe');
  assert.equal(masters[0].agent.name, 'release-scribe');
});

test('agentDeliveryPlan: one copy per writing tool, cursor rides claude, hermes named', () => {
  const plan = agentDeliveryPlan({
    slug: 'release-scribe',
    agentIds: ['claude', 'codex', 'opencode', 'gemini', 'kimi', 'cursor', 'hermes'],
    projectPath: PROJ,
  });
  const by = Object.fromEntries(plan.map((s) => [s.agent, s]));
  assert.equal(by.claude.file, '/proj/.claude/agents/release-scribe.md');
  assert.equal(by.opencode.file, '/proj/.opencode/agents/release-scribe.md');
  assert.equal(by.gemini.file, '/proj/.gemini/agents/release-scribe.md');
  assert.equal(by.kimi.file, '/proj/.kimi-code/agents/release-scribe.md');
  assert.equal(by.codex.file, '/proj/.codex/agents/release-scribe.toml');
  assert.equal(by.cursor.kind, 'via');
  assert.equal(by.cursor.via, 'claude');
  assert.equal(by.hermes.kind, 'none');
});

// ---- deliver ----------------------------------------------------------------

test('deliverAgents writes marked copies but never overwrites a hand-made file', () => {
  const io = memIo({
    '/proj/agents/release-scribe.md': MASTER_MD,
    '/proj/.claude/agents/release-scribe.md': '---\nname: release-scribe\n---\ntheir own version\n',
  });
  const results = deliverAgents({ projectPath: PROJ, agentIds: ['claude', 'opencode', 'codex'], io });
  assert.match(io.files['/proj/.opencode/agents/release-scribe.md'], /mode: subagent/);
  assert.match(io.files['/proj/.codex/agents/release-scribe.toml'], /developer_instructions/);
  assert.match(io.files['/proj/.claude/agents/release-scribe.md'], /their own version/, 'hand-made wins');
  const claude = results.find((r) => r.agent === 'claude' && r.slug === 'release-scribe');
  assert.equal(claude.ok, false);
  assert.equal(claude.theirs, true);
});

test('deliverAgents regenerates a previously marked copy', () => {
  const io = memIo({ '/proj/agents/release-scribe.md': MASTER_MD });
  deliverAgents({ projectPath: PROJ, agentIds: ['claude'], io });
  io.files['/proj/agents/release-scribe.md'] = MASTER_MD.replace('Keep the README honest.', 'Keep the CHANGELOG honest.');
  deliverAgents({ projectPath: PROJ, agentIds: ['claude'], io });
  assert.match(io.files['/proj/.claude/agents/release-scribe.md'], /CHANGELOG honest/);
});

// ---- adopt ------------------------------------------------------------------

test('liftToMaster raises a claude agent to the drawer and marks the original as a copy', () => {
  const theirs = '---\nname: code-reviewer\ndescription: Reviews diffs.\ntools: Read, Grep\n---\n\nReview carefully.\n';
  const io = memIo({ '/proj/.claude/agents/code-reviewer.md': theirs });
  const res = liftToMaster({ filePath: '/proj/.claude/agents/code-reviewer.md', platform: 'claude', projectPath: PROJ, io });
  assert.equal(res.ok, true);
  assert.equal(res.masterPath, '/proj/agents/code-reviewer.md');
  assert.match(io.files['/proj/agents/code-reviewer.md'], /description: Reviews diffs\./);
  assert.ok(!isDelivered(io.files['/proj/agents/code-reviewer.md']), 'the master is nobody\'s copy');
  assert.ok(isDelivered(io.files['/proj/.claude/agents/code-reviewer.md']), 'original is now a marked copy');
});

test('liftToMaster maps opencode mode into the superset and refuses a name clash', () => {
  const io = memIo({
    '/proj/.opencode/agents/tester.md': '---\ndescription: Runs tests.\nmode: subagent\n---\nRun them.\n',
    '/proj/agents/tester.md': MASTER_MD,
  });
  const res = liftToMaster({ filePath: '/proj/.opencode/agents/tester.md', platform: 'opencode', projectPath: PROJ, io });
  assert.equal(res.ok, false, 'a master already owns this name');
  const io2 = memIo({ '/proj/.opencode/agents/tester.md': '---\ndescription: Runs tests.\nmode: subagent\n---\nRun them.\n' });
  const res2 = liftToMaster({ filePath: '/proj/.opencode/agents/tester.md', platform: 'opencode', projectPath: PROJ, io: io2 });
  assert.equal(res2.ok, true);
  assert.match(io2.files['/proj/agents/tester.md'], /mode: subagent/);
});

// ---- sweep ------------------------------------------------------------------

test('sweepCopies removes marked copies only, and reports what it left', () => {
  const io = memIo({ '/proj/agents/release-scribe.md': MASTER_MD });
  deliverAgents({ projectPath: PROJ, agentIds: ['claude', 'codex'], io });
  io.files['/proj/.opencode/agents/release-scribe.md'] = 'hand-made, same name\n';
  const res = sweepCopies({ projectPath: PROJ, slug: 'release-scribe', io });
  assert.ok(!('/proj/.claude/agents/release-scribe.md' in io.files));
  assert.ok(!('/proj/.codex/agents/release-scribe.toml' in io.files));
  assert.ok('/proj/.opencode/agents/release-scribe.md' in io.files, 'unmarked file survives');
  assert.deepEqual(res.left, ['/proj/.opencode/agents/release-scribe.md']);
});

test('antigravity delivers to the user-scope gemini folder, the only one agy reads', () => {
  const plan = agentDeliveryPlan({ slug: 'x', agentIds: ['antigravity'], projectPath: PROJ, homeDir: '/home/cal' });
  assert.equal(plan[0].file, '/home/cal/.gemini/agents/x.md');
});

// ---- the tool: hint ---------------------------------------------------------
// Which tool a master prefers is Nami's own business. It rides in the superset
// frontmatter so it travels with the repo, and it must never reach a copy — no
// tool has ever heard of the key, and an unknown key in a dialect file is a
// change in somebody else's format.

test('tool: is parsed off the master and is not the same field as tools:', () => {
  const a = parseAgentMd('---\nname: ui-polisher\ntools: Read, Grep\ntool: codex\nmodel: sonnet\n---\nbody\n');
  assert.equal(a.tool, 'codex');
  assert.equal(a.tools, 'Read, Grep');
});

test('tool: never reaches any dialect copy', () => {
  const a = parseAgentMd('---\nname: x\ndescription: d\ntool: codex\nmode: subagent\nmodel: sonnet\n---\nbody\n');
  for (const platform of ['claude', 'opencode', 'gemini', 'kimi', 'codex']) {
    const copy = renderCopy(platform, 'x', a);
    assert.ok(!/^tool[:=]/m.test(copy), `${platform} copy leaked the tool key:\n${copy}`);
  }
});

// ---- delivery state ---------------------------------------------------------
// Four answers per agent × tool, none of them stored: copyTargets knows the
// path, the marker at that path says the rest.

test('deliveryState reports here / soon / theirs / none / via', () => {
  const io = memIo({ '/proj/agents/release-scribe.md': MASTER_MD });
  deliverAgents({ projectPath: PROJ, agentIds: ['claude'], io });
  io.files['/home/cal/.gemini/agents/release-scribe.md'] = 'hand-made, same name\n';
  const rows = deliveryState({
    projectPath: PROJ, slug: 'release-scribe',
    agentIds: ['claude', 'codex', 'antigravity', 'hermes', 'cursor'], io, homeDir: '/home/cal',
  });
  const by = Object.fromEntries(rows.map((r) => [r.agent, r]));
  assert.equal(by.claude.state, 'here');
  assert.equal(by.claude.file, '/proj/.claude/agents/release-scribe.md');
  assert.equal(by.codex.state, 'soon');
  assert.equal(by.codex.file, '/proj/.codex/agents/release-scribe.toml');
  assert.equal(by.antigravity.state, 'theirs');
  assert.equal(by.hermes.state, 'none');
  assert.ok(by.hermes.reason);
  assert.equal(by.cursor.state, 'via');
  assert.equal(by.cursor.via, 'claude');
});

test('deliveryState never writes anything', () => {
  const io = memIo({ '/proj/agents/release-scribe.md': MASTER_MD });
  const before = Object.keys(io.files).length;
  deliveryState({ projectPath: PROJ, slug: 'release-scribe', agentIds: ['claude', 'codex'], io });
  assert.equal(Object.keys(io.files).length, before);
});

test('liftToMaster refuses a TOML agent rather than mangling it', () => {
  const io = memIo({ '/proj/.codex/agents/tomlish.toml': 'name = "tomlish"\ndescription = "d"\n' });
  const res = liftToMaster({ filePath: '/proj/.codex/agents/tomlish.toml', platform: 'codex', projectPath: PROJ, io });
  assert.equal(res.ok, false);
  assert.match(res.error, /markdown/i);
  assert.equal(io.files['/proj/.codex/agents/tomlish.toml'], 'name = "tomlish"\ndescription = "d"\n',
    'the user’s own file is untouched');
  assert.ok(!('/proj/agents/tomlish.md' in io.files), 'and no master was written');
});
