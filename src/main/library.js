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
    if (!m) return out;
    const lines = m[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const mm = lines[i].match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
      if (!mm) continue;
      let val = mm[2].trim();
      if (/^[>|][+-]?$/.test(val)) {
        // block scalar: join the indented lines that follow
        const parts = [];
        while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) { i++; parts.push(lines[i].trim()); }
        val = parts.filter(Boolean).join(' ');
      }
      out[mm[1]] = val.replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch (_) { return {}; }
}

function listMd(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f)); }
  catch (_) { return []; }
}

const { isDelivered } = require('./agent-master');
function isDeliveredFile(file) {
  try { return isDelivered(fs.readFileSync(file, 'utf8').slice(0, 4000)); } catch (_) { return false; }
}

// Skills are folders, and installers routinely place them as symlinks into a
// shared store — so `isDirectory()` alone silently drops every linked skill,
// live ones included. A link to a folder that still holds a SKILL.md is a real
// skill; a link whose target has gone is worth surfacing as broken rather than
// vanishing, which is exactly how 60 dead links went unnoticed on one machine.
// Some tools group skills a level deeper (Hermes files them under categories),
// so a folder with no SKILL.md of its own is searched one level down.
// Dotted names are not skipped wholesale: Codex files its own bundled skills
// under `.system`, so a blanket dot-rule would hide them. Only genuine noise is
// named, and plain files fall out anyway on the directory-or-link test.
const SKIP_SKILL_DIRS = new Set(['.git', 'node_modules']);
function listSkillDirs(dir, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  const out = [];
  for (const e of entries) {
    if (SKIP_SKILL_DIRS.has(e.name)) continue;
    const isLink = e.isSymbolicLink();
    if (!e.isDirectory() && !isLink) continue;
    const full = path.join(dir, e.name);
    if (fs.existsSync(path.join(full, 'SKILL.md'))) { out.push({ dir: full, link: isLink ? readLink(full) : '', broken: false }); continue; }
    if (isLink) { out.push({ dir: full, link: readLink(full), broken: true }); continue; }
    if (depth < 1) out.push(...listSkillDirs(full, depth + 1));
  }
  return out;
}
function readLink(p) { try { return fs.readlinkSync(p); } catch (_) { return ''; } }
// What a skill folder *is*, for the purpose of listing it once. A live link and
// its target share a real path. A dangling link has none, so it is identified by
// what it meant to point at — which is why one deleted store folder referenced
// by four tools reads as one broken skill and not four.
function skillIdentity(entry) {
  try { return fs.realpathSync(entry.dir); } catch (_) { /* dangling */ }
  if (entry.link) return path.resolve(path.dirname(entry.dir), entry.link);
  return entry.dir;
}

function mkItem(type, platform, scope, filePath, readOnly, extra) {
  const meta = readMeta(filePath);
  const slug = type === 'skill' ? path.basename(path.dirname(filePath)) : path.basename(filePath, '.md');
  return {
    id: filePath, type, platform, scope, slug,
    name: meta.name || slug,
    description: meta.description || '',
    filePath,
    meta: { tools: meta.tools || '', model: meta.model || '', mode: meta.mode || '', agent: meta.agent || '' },
    readOnly: !!readOnly,
    ...(extra || {}),
  };
}

// A skill row has to answer one question honestly: can a session started from
// this project use it? Only two things make that true — the project's own
// pointer names it, or the agent that owns this folder reads it natively.
// Everything else is a file on disk that happens to be a skill, and saying so
// is what keeps `Use here` from looking redundant.
function mkSkillItem(source, scope, entry) {
  const availability = entry.broken ? 'broken'
    : scope === 'project' ? 'project'
    : source.owner ? 'agent'
    : 'unwired';
  return mkItem('skill', source.platform, scope, path.join(entry.dir, 'SKILL.md'), source.readOnly, {
    dirPath: entry.dir,
    linkTarget: entry.link || '',
    broken: !!entry.broken,
    availability,
    ownerAgent: source.owner || '',
    sourceLabel: source.label,
  });
}

// Where skills live, per tool. Nami reads every row and writes to exactly one
// of them — `<project>/skills`, the only location with no agent's name on it.
// `owner` is the agent that reads the folder natively; null means nothing does,
// which is the honest state of ~/.agents/skills on a real machine.
const PROJECT_SKILL_SOURCES = [
  { rel: 'skills', platform: 'project', owner: null, label: 'this project' },
  { rel: '.claude/skills', platform: 'claude', owner: 'claude', label: 'this project · Claude' },
];
const USER_SKILL_SOURCES = [
  { rel: '.claude/skills', platform: 'claude', owner: 'claude', label: 'Claude' },
  { rel: '.agents/skills', platform: 'agents', owner: null, label: 'shared store' },
  { rel: '.codex/skills', platform: 'codex', owner: 'codex', label: 'Codex' },
  { rel: '.gemini/skills', platform: 'gemini', owner: 'gemini', label: 'Antigravity' },
  { rel: '.cursor/skills', platform: 'cursor', owner: 'cursor', label: 'Cursor' },
  { rel: '.cursor/skills-cursor', platform: 'cursor', owner: 'cursor', label: "Cursor's own" },
  { rel: '.hermes/skills', platform: 'hermes', owner: 'hermes', label: 'Hermes' },
  { rel: '.config/opencode/skills', platform: 'opencode', owner: 'opencode', label: 'OpenCode' },
];

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
        const src = { platform: 'claude', owner: 'claude', label: 'a plugin', readOnly: true };
        for (const d of listSkillDirs(full)) items.push(mkSkillItem(src, 'plugin', d));
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
  // One row per skill, keyed on where the files really are: a link and the
  // folder it points at are the same skill seen twice, and listing both is how
  // 20 skills would read as 80. First source wins, so the store is described as
  // the store rather than as whichever agent happened to link it.
  const seen = new Set();
  const addSkills = (root, sources, scope) => {
    for (const source of sources) {
      for (const entry of listSkillDirs(path.join(root, source.rel))) {
        const key = skillIdentity(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(mkSkillItem(source, scope, entry));
      }
    }
  };
  if (projectPath) {
    // Masters first: one agent, one row. Copies Nami delivered into the
    // platform folders carry the marker and are hidden — listing them too
    // would turn one agent into six rows the moment it works everywhere.
    for (const f of listMd(path.join(projectPath, 'agents'))) items.push(mkItem('agent', 'project', 'project', f));
    for (const f of listMd(path.join(projectPath, '.claude/agents'))) if (!isDeliveredFile(f)) items.push(mkItem('agent', 'claude', 'project', f));
    addSkills(projectPath, PROJECT_SKILL_SOURCES, 'project');
    for (const f of listMd(path.join(projectPath, '.opencode/agent'))) if (!isDeliveredFile(f)) items.push(mkItem('agent', 'opencode', 'project', f));
    for (const f of listMd(path.join(projectPath, '.opencode/agents'))) if (!isDeliveredFile(f)) items.push(mkItem('agent', 'opencode', 'project', f));
    for (const f of listMd(path.join(projectPath, '.gemini/agents'))) if (!isDeliveredFile(f)) items.push(mkItem('agent', 'gemini', 'project', f));
    for (const f of listMd(path.join(projectPath, '.kimi-code/agents'))) if (!isDeliveredFile(f)) items.push(mkItem('agent', 'kimi', 'project', f));
    for (const f of listMd(path.join(projectPath, '.opencode/command'))) items.push(mkItem('command', 'opencode', 'project', f));
  }
  for (const f of listMd(path.join(home, '.claude/agents'))) items.push(mkItem('agent', 'claude', 'user', f));
  addSkills(home, USER_SKILL_SOURCES, 'user');
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
  // The master: superset frontmatter, no tool's name on it. Copies are
  // delivered from this file; agent-master.js owns the dialects.
  'project:agent': (name, slug) => `---
name: ${slug}
description: ${name} — describe when to use this agent.
tools: Read, Grep, Glob
---

You are ${name}.

Describe the job this agent does, how it should work, and what a good
result looks like. Keep it specific — vague agents drift.
`,
  'claude:agent': (name, slug) => `---
name: ${slug}
description: ${name} — describe when to use this agent.
tools: Read, Grep, Glob
---

You are ${name}.

Describe the job this agent does, how it should work, and what a good
result looks like. Keep it specific — vague agents drift.
`,
  // One skill template, not one per platform: the file is identical whichever
  // agent ends up following it, which is the whole premise of the pointer.
  skill: (name, slug) => `---
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
  // Skills are project-scoped and platform-agnostic — one neutral folder that
  // the pointer announces. See targetDirFor in seed-text.mjs, the same table.
  if (type === 'skill') return projectPath ? path.join(projectPath, 'skills', slug, 'SKILL.md') : null;
  // The master agent is project-scoped like a skill: the drawer is the project's.
  if (platform === 'project' && type === 'agent') return projectPath ? path.join(projectPath, 'agents', slug + '.md') : null;
  if (platform === 'claude' && type === 'agent') return path.join(root, scope === 'project' ? '.claude/agents' : '.claude/agents', slug + '.md');
  if (platform === 'opencode' && type === 'agent') {
    return scope === 'project' ? path.join(root, '.opencode/agent', slug + '.md') : path.join(home, '.config/opencode/agent', slug + '.md');
  }
  return null;
}

function createItem({ projectPath, homeDir, type, platform, scope, name }) {
  const tpl = type === 'skill' ? TEMPLATES.skill : TEMPLATES[platform + ':' + type];
  if (!tpl) return { ok: false, error: `No template for ${platform} ${type}` };
  const slug = kebab(name);
  const filePath = targetPath({ projectPath, homeDir, type, platform, scope, slug });
  if (!filePath) {
    return { ok: false, error: type === 'skill' ? 'Open a folder first — skills live in the project.' : 'No folder open for a project-scoped item' };
  }
  if (fs.existsSync(filePath)) return { ok: false, error: `Already exists: ${filePath}` };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, tpl(String(name || slug).trim() || slug, slug));
    const item = type === 'skill'
      ? mkSkillItem(PROJECT_SKILL_SOURCES[0], 'project', { dir: path.dirname(filePath), link: '', broken: false })
      : mkItem(type, platform, scope, filePath);
    return { ok: true, filePath, item };
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

// "Use here": bring someone else's skill into this project, where the pointer
// can announce it. Skills copy their whole folder, and `dereference` matters —
// most of these are symlinks into a shared store, and copying the link instead
// of the folder would carry the dependency (and its ability to dangle) along.
function duplicateItem({ filePath, type, projectPath }) {
  if (!projectPath) return { ok: false, error: 'Open a folder first — a copy lands in the project.' };
  try {
    if (type === 'skill') {
      const srcDir = path.dirname(filePath);
      if (!fs.existsSync(filePath)) return { ok: false, error: 'That skill\'s files are missing — nothing to copy.' };
      const base = path.basename(srcDir);
      const { dest } = freeDest(base, (s) => path.join(projectPath, 'skills', s));
      fs.cpSync(srcDir, dest, { recursive: true, dereference: true });
      const src = PROJECT_SKILL_SOURCES[0];
      return { ok: true, filePath: path.join(dest, 'SKILL.md'), item: mkSkillItem(src, 'project', { dir: dest, link: '', broken: false }) };
    }
    const base = path.basename(filePath, '.md');
    const { dest } = freeDest(base, (s) => path.join(projectPath, '.claude/agents', s + '.md'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(filePath, dest);
    return { ok: true, filePath: dest, item: mkItem('agent', 'claude', 'project', dest) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ---- edges: who references whom --------------------------------------------
// An item references another when its file mentions the target's slug. To keep noise out,
// a plain mention only counts for hyphenated slugs (distinctive); single-word slugs need an
// explicit [[wiki-link]]. Self and same-slug (other scopes/versions) never link.
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function extractEdges(items, { maxBytes = 65536 } = {}) {
  const edges = [];
  const targets = items.map((t) => ({
    t,
    wiki: '[[' + t.slug + ']]',
    re: t.slug.includes('-') ? new RegExp('(^|[^\\w-])' + escapeRe(t.slug) + '($|[^\\w-])') : null,
  }));
  for (const src of items) {
    let body = '';
    try { body = fs.readFileSync(src.filePath, 'utf8').slice(0, maxBytes); } catch (_) { continue; }
    for (const { t, wiki, re } of targets) {
      if (t.id === src.id || t.slug === src.slug) continue;
      if (!body.includes(t.slug)) continue; // cheap guard before regex
      if (body.includes(wiki) || (re && re.test(body))) edges.push({ from: src.id, to: t.id });
    }
  }
  return edges;
}

// ---- delete to Trash --------------------------------------------------------
// Guarded: only real library locations, never the plugin cache. Skills are
// folders, so their SKILL.md maps to the folder that holds it.
// existsFn uses lstat, not existsSync: a dangling symlink is exactly the thing a
// user most wants to delete, and existsSync follows the link and reports the dead
// target as "already gone" — refusing to remove the entry that is still there.
function entryExists(p) { try { fs.lstatSync(p); return true; } catch (_) { return false; } }
async function deleteItem({ filePath, projectPath, homeDir, trashFn, existsFn = entryExists }) {
  const home = homeDir || os.homedir();
  const abs = path.resolve(String(filePath || ''));
  // Built from the same source tables the scan uses, so anything Nami is willing
  // to list it is willing to clean up — which is what makes the broken-links
  // group actionable instead of just a shelf of other tools' rot.
  const roots = [];
  if (projectPath) {
    for (const s of PROJECT_SKILL_SOURCES) roots.push(path.join(projectPath, s.rel));
    roots.push(path.join(projectPath, '.claude'), path.join(projectPath, '.opencode'));
    roots.push(path.join(projectPath, 'agents'), path.join(projectPath, '.gemini'), path.join(projectPath, '.kimi-code'), path.join(projectPath, '.codex'));
  }
  for (const s of USER_SKILL_SOURCES) roots.push(path.join(home, s.rel));
  roots.push(path.join(home, '.claude', 'agents'), path.join(home, '.config', 'opencode'));
  const inRoot = roots.some((r) => abs.startsWith(r + path.sep));
  const inPluginCache = abs.includes(path.sep + path.join('.claude', 'plugins') + path.sep);
  if (!inRoot || inPluginCache) return { ok: false, error: 'Not a deletable library item' };
  const target = path.basename(abs) === 'SKILL.md' ? path.dirname(abs) : abs;
  if (!existsFn(target)) return { ok: false, error: 'Already gone' };
  try { await trashFn(target); return { ok: true, target }; }
  catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { scanLibrary, createItem, duplicateItem, deleteItem, extractEdges };
