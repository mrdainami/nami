import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanLibrary, createItem, duplicateItem, extractEdges } from '../src/main/library.js';

// Build one fixture "computer": a project folder and a fake home dir covering all sources.
let home, project;
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

before(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dainami-lib-'));
  home = path.join(root, 'home'); project = path.join(root, 'proj');
  write(path.join(project, '.claude/agents/scraper.md'), '---\nname: scraper\ndescription: Scrapes pages\ntools: browser\n---\nbody\n');
  write(path.join(project, '.claude/skills/deploy/SKILL.md'), '---\nname: deploy\ndescription: Ship it\n---\nsteps\n');
  write(path.join(project, '.opencode/agent/reviewer.md'), '---\ndescription: Reviews diffs\nmode: subagent\n---\nbody\n');
  write(path.join(project, '.opencode/command/lint.md'), '---\ndescription: Lints things\n---\nbody\n');
  write(path.join(home, '.claude/agents/helper.md'), '---\nname: helper\ndescription: User-level helper\n---\nbody\n');
  write(path.join(home, '.claude/skills/notes/SKILL.md'), '---\nname: notes\ndescription: Note taking\n---\nbody\n');
  write(path.join(home, '.config/opencode/agent/globalrev.md'), '---\ndescription: Global reviewer\n---\nbody\n');
  write(path.join(home, '.claude/plugins/cache/market/superpowers/1.0.0/skills/tdd/SKILL.md'), '---\nname: tdd\ndescription: Test first\n---\nbody\n');
  write(path.join(home, '.claude/plugins/cache/market/superpowers/1.0.0/agents/critic.md'), '---\nname: critic\ndescription: Plugin agent\n---\nbody\n');

  // the project's own neutral folder — the only place Nami writes
  write(path.join(project, 'skills/meeting-notes/SKILL.md'), '---\nname: meeting-notes\ndescription: Transcript into decisions\n---\nbody\n');
  // one row per tool that keeps skills of its own
  write(path.join(home, '.agents/skills/hyperframes/SKILL.md'), '---\nname: hyperframes\ndescription: Render video\n---\nbody\n');
  write(path.join(home, '.codex/skills/.system/imagegen/SKILL.md'), '---\nname: imagegen\ndescription: Codex bundled\n---\nbody\n');
  write(path.join(home, '.cursor/skills-cursor/autopilot/SKILL.md'), '---\nname: autopilot\ndescription: Cursor own\n---\nbody\n');
  write(path.join(home, '.config/opencode/skills/oc-thing/SKILL.md'), '---\nname: oc-thing\ndescription: OpenCode skill\n---\nbody\n');
  // Hermes groups skills under categories, so the real SKILL.md is one level deeper
  write(path.join(home, '.hermes/skills/github/github-auth/SKILL.md'), '---\nname: github-auth\ndescription: Signing in\n---\nbody\n');
  write(path.join(home, '.hermes/skills/github/DESCRIPTION.md'), 'the github group\n');
  // a live symlink into the shared store, and one whose target is gone
  fs.mkdirSync(path.join(home, '.gemini/skills'), { recursive: true });
  fs.symlinkSync(path.join(home, '.agents/skills/hyperframes'), path.join(home, '.gemini/skills/hyperframes'));
  fs.symlinkSync(path.join(home, '.claude/skills/deleted-store-item'), path.join(home, '.gemini/skills/media-use'));
  // the same missing folder, linked a second time by another tool
  fs.mkdirSync(path.join(home, '.cursor/skills'), { recursive: true });
  fs.symlinkSync(path.join(home, '.claude/skills/deleted-store-item'), path.join(home, '.cursor/skills/media-use'));
});

function find(items, pred) { return items.filter(pred); }

test('scan finds items from every source with correct type/scope/platform', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const by = (type, platform, scope) => find(items, (i) => i.type === type && i.platform === platform && i.scope === scope);
  assert.equal(by('agent', 'claude', 'project').length, 1);
  assert.equal(by('skill', 'claude', 'project').length, 1);
  assert.equal(by('agent', 'opencode', 'project').length, 1);
  assert.equal(by('command', 'opencode', 'project').length, 1);
  assert.equal(by('agent', 'claude', 'user').length, 1);
  assert.equal(by('skill', 'claude', 'user').length, 1);
  assert.equal(by('agent', 'opencode', 'user').length, 1);
  assert.equal(by('skill', 'claude', 'plugin').length, 1);
  assert.equal(by('agent', 'claude', 'plugin').length, 1);
});

// The bug this fixes: the scanner read one folder, ~/.claude/skills. On a real
// machine that folder had been deleted while 60 skills sat in six others, so
// the rail said "Skills · 0" with total confidence.
test('scan reads every tool\'s skills folder, not just Claude\'s', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const skill = (slug) => items.find((i) => i.type === 'skill' && i.slug === slug);
  for (const slug of ['meeting-notes', 'hyperframes', 'imagegen', 'autopilot', 'oc-thing', 'github-auth']) {
    assert.ok(skill(slug), `missed ${slug}`);
  }
  assert.equal(skill('meeting-notes').platform, 'project');
  assert.equal(skill('imagegen').platform, 'codex');
  assert.equal(skill('autopilot').platform, 'cursor');
  assert.equal(skill('github-auth').platform, 'hermes');   // found one level down
});

test('a skill row says whether a session started here could actually use it', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const av = (slug) => items.find((i) => i.type === 'skill' && i.slug === slug).availability;
  assert.equal(av('meeting-notes'), 'project');  // the pointer names it
  assert.equal(av('deploy'), 'project');         // legacy .claude/skills, still listed
  assert.equal(av('imagegen'), 'agent');         // Codex reads its own folder
  assert.equal(av('hyperframes'), 'unwired');    // ~/.agents/skills: nothing reads it
  assert.equal(av('notes'), 'agent');            // ~/.claude/skills is Claude's
  const owner = (slug) => items.find((i) => i.type === 'skill' && i.slug === slug).ownerAgent;
  assert.equal(owner('imagegen'), 'codex');
  assert.equal(owner('hyperframes'), '');
});

test('a symlinked skill is a real skill, and a dangling one is shown as broken', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const skills = items.filter((i) => i.type === 'skill');
  // the live link resolves to the same folder the store row already claimed, so
  // it is listed once rather than twice
  assert.equal(skills.filter((i) => i.slug === 'hyperframes').length, 1);
  // two tools link the same deleted folder; that is one broken skill, not two
  const deads = skills.filter((i) => i.slug === 'media-use');
  assert.equal(deads.length, 1, 'links to one missing folder collapse to one row');
  const dead = deads[0];
  assert.equal(dead.broken, true);
  assert.equal(dead.availability, 'broken');
  assert.match(dead.linkTarget, /deleted-store-item$/);
  for (const s of skills) if (s.slug !== 'media-use') assert.equal(s.broken, false, s.filePath);
});

test('scan: plugin items are readOnly, others are not; metadata parsed', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  for (const i of items) assert.equal(!!i.readOnly, i.scope === 'plugin', i.filePath);
  const scraper = items.find((i) => i.slug === 'scraper');
  assert.equal(scraper.name, 'scraper');
  assert.equal(scraper.description, 'Scrapes pages');
  assert.equal(scraper.meta.tools, 'browser');
  const reviewer = items.find((i) => i.slug === 'reviewer');
  assert.equal(reviewer.meta.mode, 'subagent');
  const deploy = items.find((i) => i.slug === 'deploy' && i.type === 'skill');
  assert.ok(deploy.filePath.endsWith('SKILL.md'));
});

test('scan without a project still returns user + plugin items', () => {
  const items = scanLibrary({ projectPath: null, homeDir: home });
  assert.ok(items.length >= 5);
  assert.equal(find(items, (i) => i.scope === 'project').length, 0);
});

test('createItem scaffolds a claude project agent and refuses overwrite', () => {
  const res = createItem({ projectPath: project, homeDir: home, type: 'agent', platform: 'claude', scope: 'project', name: 'My New Agent' });
  assert.ok(res.ok);
  assert.ok(res.filePath.endsWith('.claude/agents/my-new-agent.md'));
  const text = fs.readFileSync(res.filePath, 'utf8');
  assert.match(text, /name: my-new-agent/);
  assert.match(text, /description: /);
  const again = createItem({ projectPath: project, homeDir: home, type: 'agent', platform: 'claude', scope: 'project', name: 'My New Agent' });
  assert.equal(again.ok, false);
});

test('createItem scaffolds a claude skill dir and an opencode agent', () => {
  const sk = createItem({ projectPath: project, homeDir: home, type: 'skill', platform: 'claude', scope: 'project', name: 'Cool Skill' });
  assert.ok(sk.ok);
  assert.ok(sk.filePath.endsWith('.claude/skills/cool-skill/SKILL.md'));
  const oc = createItem({ projectPath: project, homeDir: home, type: 'agent', platform: 'opencode', scope: 'user', name: 'OC Agent' });
  assert.ok(oc.ok);
  assert.ok(oc.filePath.endsWith('.config/opencode/agent/oc-agent.md'));
  assert.match(fs.readFileSync(oc.filePath, 'utf8'), /mode: subagent/);
});

test('"Use here" copies a skill into the project\'s own folder, -copy on collision', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const tdd = items.find((i) => i.slug === 'tdd' && i.scope === 'plugin');
  const one = duplicateItem({ filePath: tdd.filePath, type: 'skill', projectPath: project });
  assert.ok(one.ok);
  assert.ok(one.filePath.endsWith('skills/tdd/SKILL.md'), one.filePath);
  assert.ok(!one.filePath.includes('.claude'), 'it lands in the neutral folder, not Claude\'s');
  assert.match(fs.readFileSync(one.filePath, 'utf8'), /Test first/);
  assert.equal(one.item.availability, 'project');
  const two = duplicateItem({ filePath: tdd.filePath, type: 'skill', projectPath: project });
  assert.ok(two.ok);
  assert.ok(two.filePath.endsWith('skills/tdd-copy/SKILL.md'), two.filePath);
});

// Most of these skills are links into a shared store. Copying the link would
// carry the dependency along — and its ability to dangle — so the folder itself
// has to be dereferenced on the way in.
test('"Use here" on a linked skill copies the folder, not the link', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const linked = items.find((i) => i.slug === 'hyperframes');
  const res = duplicateItem({ filePath: linked.filePath, type: 'skill', projectPath: project });
  assert.ok(res.ok, res.error);
  const dest = path.dirname(res.filePath);
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), false, 'the copy must be a real folder');
  assert.match(fs.readFileSync(res.filePath, 'utf8'), /Render video/);
});

test('"Use here" refuses a skill whose files are gone', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const dead = items.find((i) => i.slug === 'media-use');
  const res = duplicateItem({ filePath: dead.filePath, type: 'skill', projectPath: project });
  assert.equal(res.ok, false);
  assert.match(res.error, /missing/i);
});

test('block-scalar descriptions (description: |) are joined, not shown as "|"', () => {
  write(path.join(home, '.claude/agents/blocky.md'), '---\nname: blocky\ndescription: |\n  First line of it.\n  Second line.\ntools: Read\n---\nbody\n');
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const b = items.find((i) => i.slug === 'blocky');
  assert.equal(b.description, 'First line of it. Second line.');
  assert.equal(b.meta.tools, 'Read');
});

test('multiple cached plugin versions collapse to the newest', () => {
  write(path.join(home, '.claude/plugins/cache/market/superpowers/1.9.0/skills/tdd/SKILL.md'), '---\nname: tdd\ndescription: Older-but-lexically-tricky\n---\nbody\n');
  write(path.join(home, '.claude/plugins/cache/market/superpowers/1.10.0/skills/tdd/SKILL.md'), '---\nname: tdd\ndescription: Newest\n---\nbody\n');
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const tdds = items.filter((i) => i.slug === 'tdd' && i.scope === 'plugin');
  assert.equal(tdds.length, 1);
  assert.match(tdds[0].filePath, /1\.10\.0/); // numeric-aware: 1.10.0 > 1.9.0 > 1.0.0
});

test('duplicateItem copies a plugin agent file into the project', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const critic = items.find((i) => i.slug === 'critic' && i.scope === 'plugin');
  const res = duplicateItem({ filePath: critic.filePath, type: 'agent', projectPath: project });
  assert.ok(res.ok);
  assert.ok(res.filePath.endsWith('.claude/agents/critic.md'));
});

test('extractEdges: hyphenated slug and [[wiki-link]] references, no substring noise', () => {
  write(path.join(project, '.claude/skills/paper-craft/SKILL.md'), '---\nname: paper-craft\ndescription: crafting\n---\nRules here.\n');
  write(path.join(project, '.claude/agents/decorator.md'),
    '---\nname: decorator\ndescription: uses skills\n---\nRead the paper-craft skill first. Also see [[deploy]]. Not superpaper-craftish.\n');
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const edges = extractEdges(items);
  const dec = items.find((i) => i.slug === 'decorator');
  const craft = items.find((i) => i.slug === 'paper-craft');
  const deploy = items.find((i) => i.slug === 'deploy');
  assert.ok(edges.some((e) => e.from === dec.id && e.to === craft.id), 'hyphenated slug match');
  assert.ok(edges.some((e) => e.from === dec.id && e.to === deploy.id), 'wiki-link match for single-word slug');
  // single-word slug without [[ ]] must NOT match plain prose
  write(path.join(project, '.claude/agents/prose.md'), '---\nname: prose\ndescription: d\n---\nWe deploy on Fridays.\n');
  const items2 = scanLibrary({ projectPath: project, homeDir: home });
  const edges2 = extractEdges(items2);
  const prose = items2.find((i) => i.slug === 'prose');
  assert.ok(!edges2.some((e) => e.from === prose.id), 'plain word deploy should not create an edge');
});
