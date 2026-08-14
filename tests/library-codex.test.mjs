// Codex was write-only: agent-master.js has written `.codex/agents/<slug>.toml`
// since the masters landed, but the scanner never read that folder back. So a
// Codex agent somebody wrote by hand was invisible to Nami, and Codex was the
// one installed tool whose own agents could never appear in any list.
//
// Reading it back is the same three rules every other folder follows: the
// marker hides Nami's own copies, a hand-made file is theirs, and the slug is
// the filename.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { scanLibrary } from '../src/main/library.js';
const require = createRequire(import.meta.url);
const { deliverAgents } = require('../src/main/agent-master.js');

let home, project;
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
const agents = (items, slug) => items.filter((i) => i.type === 'agent' && i.slug === slug);

before(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-codex-'));
  home = path.join(root, 'home'); project = path.join(root, 'proj');

  // Somebody's own Codex agent — Codex's own TOML shape, no marker.
  write(path.join(project, '.codex/agents/toml-critic.toml'),
    'name = "toml-critic"\ndescription = "Reads the TOML nobody else reads."\n'
    + 'developer_instructions = """\nBe exacting.\n"""\n');

  // A master, delivered everywhere including Codex — its copies must stay hidden.
  write(path.join(project, 'agents/release-scribe.md'),
    '---\nname: release-scribe\ndescription: Release notes.\n---\n\nWrite the notes.\n');
  deliverAgents({ projectPath: project, agentIds: ['claude', 'codex', 'opencode', 'kimi'] });

  // A user-scope Claude agent, and a delivered-looking file beside it. Every
  // other scan skips delivered copies; ~/.claude/agents was the one that did not.
  write(path.join(home, '.claude/agents/mine.md'), '---\nname: mine\ndescription: Yours.\n---\nbody\n');
  write(path.join(home, '.claude/agents/copied.md'),
    '---\nname: copied\ndescription: A copy.\n---\n\n<!-- made by Nami from agents/copied.md — edit that file; this copy is regenerated -->\n\nbody\n');
});

test('a hand-made Codex agent is listed, as Codex, with its filename as the slug', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const rows = agents(items, 'toml-critic');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'codex');
  assert.equal(rows[0].scope, 'project');
  assert.match(rows[0].filePath, /\.codex\/agents\/toml-critic\.toml$/);
});

test('its name and description come out of the TOML, not the filename', () => {
  const [row] = agents(scanLibrary({ projectPath: project, homeDir: home }), 'toml-critic');
  assert.equal(row.name, 'toml-critic');
  assert.equal(row.description, 'Reads the TOML nobody else reads.');
});

test('the Codex copy of a master stays hidden — one agent, one row', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  const rows = agents(items, 'release-scribe');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'project');
  assert.ok(fs.existsSync(path.join(project, '.codex/agents/release-scribe.toml')),
    'the copy really is on disk — the scanner is hiding it, not missing it');
});

test('user-scope Claude agents skip delivered copies like every other scan', () => {
  const items = scanLibrary({ projectPath: project, homeDir: home });
  assert.equal(agents(items, 'mine').length, 1);
  assert.equal(agents(items, 'copied').length, 0);
});

test('a master’s tool: reaches the renderer — the picker resolves from meta', () => {
  write(path.join(project, 'agents/scribe-two.md'),
    '---\nname: scribe-two\ndescription: d\ntools: Read\ntool: codex\nmodel: gpt-5.4\nmode: acceptEdits\n---\nbody\n');
  const [row] = agents(scanLibrary({ projectPath: project, homeDir: home }), 'scribe-two');
  assert.equal(row.meta.tool, 'codex', 'tool: (singular) is the launch hint');
  assert.equal(row.meta.tools, 'Read', 'tools: (plural) is still the permission list');
  assert.equal(row.meta.model, 'gpt-5.4');
  assert.equal(row.meta.mode, 'acceptEdits');
});

// ---- shadowing is a path, not a name ---------------------------------------
// A file where a master's copy lands is that master shadowed on one tool. A
// file that merely shares the name, in a folder the master never writes to, is
// a different agent — and OpenCode makes that distinction real: it reads both
// `.opencode/agent` and `.opencode/agents`, delivery writes the plural, and
// Nami's own create writes the singular.

test('a hand-made file at a master’s copy target is marked as its shadow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-shadow-'));
  const proj = path.join(root, 'proj');
  write(path.join(proj, 'agents/twin.md'), '---\nname: twin\ndescription: The master.\n---\nbody\n');
  write(path.join(proj, '.gemini/agents/twin.md'), '---\nname: twin\ndescription: Mine.\n---\nmine\n');
  const items = scanLibrary({ projectPath: proj, homeDir: path.join(root, 'home') });
  const shadow = items.find((i) => i.type === 'agent' && i.platform === 'gemini' && i.slug === 'twin');
  assert.equal(shadow.shadows, 'twin', 'that is exactly where the master would land');
  assert.equal(items.find((i) => i.platform === 'project' && i.slug === 'twin').shadows, undefined);
});

test('a same-named agent in a folder the master never writes to keeps its own row', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-noshadow-'));
  const proj = path.join(root, 'proj');
  write(path.join(proj, 'agents/twin.md'), '---\nname: twin\ndescription: The master.\n---\nbody\n');
  // delivery writes .opencode/agents (plural); this is the singular folder
  write(path.join(proj, '.opencode/agent/twin.md'), '---\ndescription: Mine.\nmode: subagent\n---\nmine\n');
  const items = scanLibrary({ projectPath: proj, homeDir: path.join(root, 'home') });
  const own = items.find((i) => i.type === 'agent' && i.platform === 'opencode' && i.slug === 'twin');
  assert.ok(own, 'it is still listed');
  assert.equal(own.shadows, undefined, 'no master copy lands here, so it is not a shadow');
});

test('a prompt that talks about frontmatter does not rename the agent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-toml-'));
  const proj = path.join(root, 'proj');
  write(path.join(proj, '.codex/agents/careful.toml'),
    'name = "careful"\ndescription = "The real one."\n'
    + 'developer_instructions = """\nEvery agent file opens with\nname = "not-the-agent"\ndescription = "nor this"\n"""\n');
  const [row] = scanLibrary({ projectPath: proj, homeDir: path.join(root, 'home') })
    .filter((i) => i.type === 'agent' && i.slug === 'careful');
  assert.equal(row.name, 'careful');
  assert.equal(row.description, 'The real one.');
});

test('shadow detection covers every copy target, not just the two already tested', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-targets-'));
  const proj = path.join(root, 'proj');
  for (const slug of ['oc-twin', 'cx-twin', 'km-twin']) {
    write(path.join(proj, `agents/${slug}.md`), `---\nname: ${slug}\ndescription: The master.\n---\nbody\n`);
  }
  // exactly where deliverAgents would put each one
  write(path.join(proj, '.opencode/agents/oc-twin.md'), '---\ndescription: Mine.\n---\nmine\n');
  write(path.join(proj, '.codex/agents/cx-twin.toml'), 'name = "cx-twin"\ndescription = "Mine."\n');
  write(path.join(proj, '.kimi-code/agents/km-twin.md'), '---\nname: km-twin\ndescription: Mine.\n---\nmine\n');
  const items = scanLibrary({ projectPath: proj, homeDir: path.join(root, 'home') });
  for (const [slug, platform] of [['oc-twin', 'opencode'], ['cx-twin', 'codex'], ['km-twin', 'kimi']]) {
    const row = items.find((i) => i.type === 'agent' && i.platform === platform && i.slug === slug);
    assert.equal(row.shadows, slug, `${platform} copy target should be marked a shadow`);
  }
});

test('readTomlMeta stops at the other fence too', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-fence-'));
  const proj = path.join(root, 'proj');
  write(path.join(proj, '.codex/agents/prompt-first.toml'),
    "developer_instructions = '''\nname = \"inside\"\ndescription = \"fake\"\n'''\nname = \"prompt-first\"\n");
  const [row] = scanLibrary({ projectPath: proj, homeDir: path.join(root, 'home') })
    .filter((i) => i.type === 'agent' && i.slug === 'prompt-first');
  assert.ok(row, 'listed');
  assert.notEqual(row.name, 'inside', 'the prompt cannot name the agent');
  assert.notEqual(row.description, 'fake');
});
