import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanLibrary, scanProject, scanMac } from '../src/main/library.js';

function write(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-scan-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'proj');
  write(path.join(project, 'agents/reviewer.md'), '---\nname: reviewer\n---\nbody\n');
  write(path.join(project, '.grok/agents/g-review.md'), '---\nname: g-review\n---\nbody\n');
  write(path.join(project, '.claude/agents/ship.md'), '---\nname: ship\n---\nbody\n');
  write(path.join(home, '.claude/agents/helper.md'), '---\nname: helper\n---\nbody\n');
  write(path.join(home, '.claude/plugins/cache/m/p/1.0.0/agents/critic.md'), '---\nname: critic\n---\nbody\n');
  write(path.join(home, '.claude/plugins/cache/m/p/1.0.0/skills/tdd/SKILL.md'), '---\nname: tdd\n---\nbody\n');
  return { home, project };
}

test('scanProject sees this folder, including .grok/agents, and not the plugin cache', () => {
  const { home, project } = fixture();
  const items = scanProject({ projectPath: project, homeDir: home });
  const slugs = items.filter((i) => i.type === 'agent').map((i) => i.slug).sort();
  assert.deepEqual(slugs, ['g-review', 'reviewer', 'ship']);
  assert.equal(items.filter((i) => i.scope === 'plugin').length, 0);
  assert.equal(items.filter((i) => i.scope === 'user').length, 0);
  const grok = items.find((i) => i.slug === 'g-review');
  assert.equal(grok.platform, 'grok');
  assert.equal(grok.scope, 'project');
});

test('scanMac sees home + plugins and not <project>/agents', () => {
  const { home, project } = fixture();
  const items = scanMac({ homeDir: home });
  assert.ok(items.some((i) => i.slug === 'helper' && i.scope === 'user'));
  assert.ok(items.some((i) => i.slug === 'critic' && i.scope === 'plugin'));
  assert.equal(items.filter((i) => i.slug === 'reviewer').length, 0);
  assert.equal(items.filter((i) => i.filePath && i.filePath.startsWith(project)).length, 0);
});

test('scanLibrary with no scope is still the combined list', () => {
  const { home, project } = fixture();
  const all = scanLibrary({ projectPath: project, homeDir: home });
  const proj = scanProject({ projectPath: project, homeDir: home });
  const mac = scanMac({ homeDir: home });
  assert.equal(all.length, proj.length + mac.length);
  assert.ok(all.some((i) => i.slug === 'reviewer'));
  assert.ok(all.some((i) => i.slug === 'critic'));
});

test('scanLibrary({ scope: "project" }) omits plugins', () => {
  const { home, project } = fixture();
  const items = scanLibrary({ projectPath: project, homeDir: home, scope: 'project' });
  assert.equal(items.filter((i) => i.scope === 'plugin').length, 0);
  assert.ok(items.some((i) => i.slug === 'g-review'));
});

test('scanLibrary({ scope: "mac" }) omits this folder\'s agents/', () => {
  const { home, project } = fixture();
  const items = scanLibrary({ projectPath: project, homeDir: home, scope: 'mac' });
  assert.equal(items.filter((i) => i.slug === 'reviewer').length, 0);
  assert.ok(items.some((i) => i.scope === 'plugin'));
});
