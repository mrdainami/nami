// Agents & skills discovery across platforms and scopes. Pure fs — no Electron imports —
// so tests can drive it against fixture trees. Each source adapter reads one location/format
// and normalizes to the common item shape; adding a platform later = one more adapter here.

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- frontmatter peek (read-only; editing round-trips live in the renderer) ----
function readMeta(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const out = {};
    if (m) {
      for (const line of m[1].split(/\r?\n/)) {
        const mm = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
        if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '').trim();
      }
    }
    return out;
  } catch (_) { return {}; }
}

function listMd(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f)); }
  catch (_) { return []; }
}
function listSkillDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name))
      .filter((d) => fs.existsSync(path.join(d, 'SKILL.md')));
  } catch (_) { return []; }
}

function mkItem(type, platform, scope, filePath, readOnly) {
  const meta = readMeta(filePath);
  const slug = type === 'skill' ? path.basename(path.dirname(filePath)) : path.basename(filePath, '.md');
  return {
    id: filePath, type, platform, scope, slug,
    name: meta.name || slug,
    description: meta.description || '',
    filePath,
    meta: { tools: meta.tools || '', model: meta.model || '', mode: meta.mode || '', agent: meta.agent || '' },
    readOnly: !!readOnly,
  };
}

// Bounded walk of ~/.claude/plugins for agents/ and skills/ dirs (cache layout varies by
// marketplace/plugin/version, so we search rather than assume depth).
const SKIP_DIRS = new Set(['node_modules', '.git', 'references', 'assets', 'vendor']);
function walkPlugins(root, items) {
  let visited = 0;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 7 || ++visited > 4000) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.name === 'skills') {
        for (const d of listSkillDirs(full)) items.push(mkItem('skill', 'claude', 'plugin', path.join(d, 'SKILL.md'), true));
      } else if (e.name === 'agents') {
        for (const f of listMd(full)) items.push(mkItem('agent', 'claude', 'plugin', f, true));
      } else {
        stack.push({ dir: full, depth: depth + 1 });
      }
    }
  }
}

function scanLibrary({ projectPath, homeDir } = {}) {
  const home = homeDir || os.homedir();
  const items = [];
  if (projectPath) {
    for (const f of listMd(path.join(projectPath, '.claude/agents'))) items.push(mkItem('agent', 'claude', 'project', f));
    for (const d of listSkillDirs(path.join(projectPath, '.claude/skills'))) items.push(mkItem('skill', 'claude', 'project', path.join(d, 'SKILL.md')));
    for (const f of listMd(path.join(projectPath, '.opencode/agent'))) items.push(mkItem('agent', 'opencode', 'project', f));
    for (const f of listMd(path.join(projectPath, '.opencode/command'))) items.push(mkItem('command', 'opencode', 'project', f));
  }
  for (const f of listMd(path.join(home, '.claude/agents'))) items.push(mkItem('agent', 'claude', 'user', f));
  for (const d of listSkillDirs(path.join(home, '.claude/skills'))) items.push(mkItem('skill', 'claude', 'user', path.join(d, 'SKILL.md')));
  for (const f of listMd(path.join(home, '.config/opencode/agent'))) items.push(mkItem('agent', 'opencode', 'user', f));
  for (const f of listMd(path.join(home, '.config/opencode/command'))) items.push(mkItem('command', 'opencode', 'user', f));
  const plugin = [];
  walkPlugins(path.join(home, '.claude/plugins'), plugin);
  return items.concat(dedupePluginVersions(plugin));
}

// Plugin caches keep multiple versions of the same plugin side by side; show each
// agent/skill once, from the newest version (numeric-aware compare: 6.10.0 > 6.2.0).
function dedupePluginVersions(items) {
  const best = new Map();
  for (const i of items) {
    const key = i.type + ':' + i.slug;
    const prev = best.get(key);
    if (!prev || i.filePath.localeCompare(prev.filePath, undefined, { numeric: true }) > 0) best.set(key, i);
  }
  return [...best.values()];
}

// ---- create from template ---------------------------------------------------
function kebab(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
}

const TEMPLATES = {
  'claude:agent': (name, slug) => `---
name: ${slug}
description: ${name} — describe when to use this agent.
tools: Read, Grep, Glob
---

You are ${name}.

Describe the job this agent does, how it should work, and what a good
result looks like. Keep it specific — vague agents drift.
`,
  'claude:skill': (name, slug) => `---
name: ${slug}
description: Use when — describe the exact trigger for this skill.
---

# ${name}

## Overview

What this skill teaches, in one or two sentences.

## Steps

1. First step.
2. Second step.
`,
  'opencode:agent': (name, slug) => `---
description: ${name} — describe when to use this agent.
mode: subagent
---

You are ${name}.

Describe the job this agent does and what a good result looks like.
`,
};

function targetPath({ projectPath, homeDir, type, platform, scope, slug }) {
  const home = homeDir || os.homedir();
  const root = scope === 'project' ? projectPath : home;
  if (!root) return null;
  if (platform === 'claude' && type === 'agent') return path.join(root, scope === 'project' ? '.claude/agents' : '.claude/agents', slug + '.md');
  if (platform === 'claude' && type === 'skill') return path.join(root, '.claude/skills', slug, 'SKILL.md');
  if (platform === 'opencode' && type === 'agent') {
    return scope === 'project' ? path.join(root, '.opencode/agent', slug + '.md') : path.join(home, '.config/opencode/agent', slug + '.md');
  }
  return null;
}

function createItem({ projectPath, homeDir, type, platform, scope, name }) {
  const tpl = TEMPLATES[platform + ':' + type];
  if (!tpl) return { ok: false, error: `No template for ${platform} ${type}` };
  const slug = kebab(name);
  const filePath = targetPath({ projectPath, homeDir, type, platform, scope, slug });
  if (!filePath) return { ok: false, error: 'No folder open for a project-scoped item' };
  if (fs.existsSync(filePath)) return { ok: false, error: `Already exists: ${filePath}` };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, tpl(String(name || slug).trim() || slug, slug));
    return { ok: true, filePath, item: mkItem(type, platform, scope, filePath) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- duplicate into the project's .claude ----------------------------------
function freeDest(base, makePath) {
  let dest = makePath(base);
  if (!fs.existsSync(dest)) return { slug: base, dest };
  let n = 0;
  let slug = base + '-copy';
  dest = makePath(slug);
  while (fs.existsSync(dest)) { n += 1; slug = base + '-copy-' + n; dest = makePath(slug); }
  return { slug, dest };
}

function duplicateItem({ filePath, type, projectPath }) {
  if (!projectPath) return { ok: false, error: 'Open a folder first — duplicates land in the project.' };
  try {
    if (type === 'skill') {
      const srcDir = path.dirname(filePath);
      const base = path.basename(srcDir);
      const { dest } = freeDest(base, (s) => path.join(projectPath, '.claude/skills', s));
      fs.cpSync(srcDir, dest, { recursive: true });
      return { ok: true, filePath: path.join(dest, 'SKILL.md'), item: mkItem('skill', 'claude', 'project', path.join(dest, 'SKILL.md')) };
    }
    const base = path.basename(filePath, '.md');
    const { dest } = freeDest(base, (s) => path.join(projectPath, '.claude/agents', s + '.md'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(filePath, dest);
    return { ok: true, filePath: dest, item: mkItem('agent', 'claude', 'project', dest) };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { scanLibrary, createItem, duplicateItem };
