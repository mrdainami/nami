import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanLibrary, createItem, duplicateItem } from '../src/main/library.js';

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

test('duplicateItem copies a plugin skill dir into the project, -copy on collision', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const tdd = items.find((i) => i.slug === 'tdd' && i.scope === 'plugin');
  const one = duplicateItem({ filePath: tdd.filePath, type: 'skill', projectPath: project });
  assert.ok(one.ok);
  assert.ok(one.filePath.endsWith('.claude/skills/tdd/SKILL.md'));
  assert.match(fs.readFileSync(one.filePath, 'utf8'), /Test first/);
  const two = duplicateItem({ filePath: tdd.filePath, type: 'skill', projectPath: project });
  assert.ok(two.ok);
  assert.ok(two.filePath.endsWith('.claude/skills/tdd-copy/SKILL.md'));
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
