import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { scanLibrary, createItem } from '../src/main/library.js';
const require = createRequire(import.meta.url);
const { deliverAgents } = require('../src/main/agent-master.js');

let home, project;
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

before(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dainami-masters-'));
  home = path.join(root, 'home'); project = path.join(root, 'proj');
  write(path.join(project, 'agents/release-scribe.md'),
    '---\nname: release-scribe\ndescription: Release notes.\ntools: Read\n---\n\nWrite the notes.\n');
  write(path.join(project, '.claude/agents/hand-made.md'),
    '---\nname: hand-made\ndescription: Theirs.\n---\nbody\n');
  deliverAgents({ projectPath: project, agentIds: ['claude', 'opencode', 'gemini', 'kimi', 'codex'] });
});

test('a delivered master is one row — the master — never six', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const rows = items.filter((i) => i.type === 'agent' && i.slug === 'release-scribe');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'project');
  assert.match(rows[0].filePath, /agents\/release-scribe\.md$/);
});

test('the copies really landed, marker and all', () => {
  for (const rel of ['.claude/agents/release-scribe.md', '.opencode/agents/release-scribe.md', '.gemini/agents/release-scribe.md', '.kimi-code/agents/release-scribe.md']) {
    const text = fs.readFileSync(path.join(project, rel), 'utf8');
    assert.match(text, /made by Nami from agents\/release-scribe\.md/, rel);
  }
  assert.match(fs.readFileSync(path.join(project, '.codex/agents/release-scribe.toml'), 'utf8'), /developer_instructions/);
});

test('a hand-made platform agent still shows, on its own platform', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const row = items.find((i) => i.slug === 'hand-made');
  assert.ok(row);
  assert.equal(row.platform, 'claude');
});

test('createItem writes a neutral master for platform project', () => {
  const res = createItem({ projectPath: project, homeDir: home, type: 'agent', platform: 'project', scope: 'project', name: 'Fact Checker' });
  assert.equal(res.ok, true);
  assert.match(res.filePath, /agents\/fact-checker\.md$/);
  const text = fs.readFileSync(res.filePath, 'utf8');
  assert.match(text, /name: fact-checker/);
  assert.ok(!text.includes('made by Nami'), 'a master is nobody\'s copy');
});
