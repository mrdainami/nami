// The agents drawer: one master markdown per agent in `<project>/agents/`,
// copies written into each tool's own folder in its own dialect. Pure fs
// through an injectable io — the connections.js discipline.
//
// The master carries the superset frontmatter (name, description, tools,
// model, mode); each dialect renderer takes the subset its tool reads. Every
// copy opens with a marker naming the master, which buys three behaviours at
// once: the scanner can hide copies (one agent, one row), delivery can
// regenerate them without fear, and the sweep can delete them and nothing
// else. A file without the marker is somebody's hand work and is never
// touched — same merge-don't-clobber rule the notebooks follow.

const fs = require('fs');
const path = require('path');

const fsIo = {
  read: (f) => fs.readFileSync(f, 'utf8'),
  write: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); },
  exists: (f) => fs.existsSync(f),
  remove: (f) => fs.rmSync(f, { force: true }),
  list: (dir) => { try { return fs.readdirSync(dir); } catch (_) { return []; } },
};

const MARKER_HEAD = 'made by Nami from agents/';
const marker = (slug, ext) => (ext === 'toml' ? '# ' : '<!-- ')
  + MARKER_HEAD + slug + '.md — edit that file; this copy is regenerated'
  + (ext === 'toml' ? '' : ' -->');

function isDelivered(text) { return String(text || '').slice(0, 4000).includes(MARKER_HEAD); }

// ---- parse ------------------------------------------------------------------
// The same forgiving frontmatter read library.js uses, plus the body — kept
// local so this module stays main-process-pure and testable.
const FIELDS = ['name', 'description', 'tools', 'model', 'mode'];
function parseAgentMd(text) {
  const out = { name: '', description: '', tools: '', model: '', mode: '', body: String(text || '') };
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return out;
  out.body = String(text).slice(m[0].length).replace(/^\r?\n/, '');
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (mm && FIELDS.includes(mm[1])) out[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// ---- dialect renderers ------------------------------------------------------

function fmBlock(pairs) {
  const rows = pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return '---\n' + rows.join('\n') + '\n---\n';
}
function tomlStr(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

function renderCopy(platform, slug, a) {
  const body = (a.body || '').trim() + '\n';
  if (platform === 'codex') {
    // Codex agents are TOML; the prompt rides as a multi-line basic string.
    const safe = body.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
    return [
      marker(slug, 'toml'),
      `name = ${tomlStr(a.name || slug)}`,
      `description = ${tomlStr(a.description || '')}`,
      'developer_instructions = """',
      safe.trimEnd(),
      '"""',
      '',
    ].join('\n');
  }
  if (platform === 'opencode') {
    // OpenCode names agents by filename and requires a mode.
    return fmBlock([['description', a.description], ['mode', a.mode || 'subagent'], ['model', a.model]])
      + '\n' + marker(slug) + '\n\n' + body;
  }
  // claude / gemini / kimi read the same core four; mode is nobody's here.
  return fmBlock([['name', a.name || slug], ['description', a.description], ['tools', a.tools], ['model', a.model]])
    + '\n' + marker(slug) + '\n\n' + body;
}

// ---- masters ----------------------------------------------------------------

function mastersDir(projectPath) { return path.join(projectPath, 'agents'); }

function readAgentMasters({ projectPath, io = fsIo }) {
  if (!projectPath) return [];
  const dir = mastersDir(projectPath);
  return io.list(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = path.join(dir, f);
      try { return { slug: path.basename(f, '.md'), file, agent: parseAgentMd(io.read(file)) }; }
      catch (_) { return null; }
    })
    .filter(Boolean);
}

// ---- where each tool's copy lands ------------------------------------------

function copyTargets(projectPath, slug) {
  const p = (rel) => path.join(projectPath, rel);
  return {
    claude: { kind: 'copy', file: p(`.claude/agents/${slug}.md`) },
    opencode: { kind: 'copy', file: p(`.opencode/agents/${slug}.md`) },
    gemini: { kind: 'copy', file: p(`.gemini/agents/${slug}.md`) },
    kimi: { kind: 'copy', file: p(`.kimi-code/agents/${slug}.md`) },
    codex: { kind: 'copy', file: p(`.codex/agents/${slug}.toml`) },
    cursor: { kind: 'via', via: 'claude' }, // reads .claude/agents natively
    hermes: { kind: 'none', reason: 'Hermes has no custom agents' },
  };
}

function agentDeliveryPlan({ slug, agentIds, projectPath }) {
  const targets = copyTargets(projectPath, slug);
  return agentIds.map((agent) => ({ agent, slug, ...targets[agent] })).filter((s) => s.kind);
}

// One pass for every master × every installed tool. A hand-made file with the
// same name is reported as theirs and left alone.
function deliverAgents({ projectPath, agentIds, io = fsIo }) {
  const results = [];
  for (const { slug, agent } of readAgentMasters({ projectPath, io })) {
    for (const step of agentDeliveryPlan({ slug, agentIds, projectPath })) {
      if (step.kind === 'via') { results.push({ agent: step.agent, slug, ok: true, via: step.via }); continue; }
      if (step.kind === 'none') { results.push({ agent: step.agent, slug, ok: false, none: true, reason: step.reason }); continue; }
      if (io.exists(step.file) && !isDelivered(io.read(step.file))) {
        results.push({ agent: step.agent, slug, ok: false, theirs: true, file: step.file });
        continue;
      }
      io.write(step.file, renderCopy(step.agent, slug, agent));
      results.push({ agent: step.agent, slug, ok: true, file: step.file });
    }
  }
  return results;
}

// ---- adopt: make a platform agent everyone's --------------------------------
// The original file becomes the marked copy for its own platform in the same
// breath — leaving it unmarked would make delivery skip it forever, and the
// "everyone's" promise would silently exclude the tool it came from.
function liftToMaster({ filePath, platform, projectPath, io = fsIo }) {
  if (!projectPath) return { ok: false, error: 'Open a folder first — masters live in the project.' };
  let text;
  try { text = io.read(filePath); } catch (_) { return { ok: false, error: 'That agent\'s file is missing.' }; }
  if (isDelivered(text)) return { ok: false, error: 'Already a delivered copy — edit its master instead.' };
  const slug = path.basename(filePath, path.extname(filePath));
  const masterPath = path.join(mastersDir(projectPath), slug + '.md');
  if (io.exists(masterPath)) return { ok: false, error: `agents/${slug}.md already exists — rename one of them first.` };
  const a = parseAgentMd(text);
  const master = fmBlock([
    ['name', a.name || slug], ['description', a.description], ['tools', a.tools],
    ['model', a.model], ['mode', a.mode],
  ]) + '\n' + (a.body || '').trim() + '\n';
  io.write(masterPath, master);
  if (platform && copyTargets(projectPath, slug)[platform] && copyTargets(projectPath, slug)[platform].kind === 'copy') {
    io.write(filePath, renderCopy(platform, slug, parseAgentMd(master)));
  }
  return { ok: true, masterPath, slug };
}

// ---- sweep: a deleted master takes its copies with it -----------------------
function sweepCopies({ projectPath, slug, io = fsIo }) {
  const removed = [], left = [];
  for (const t of Object.values(copyTargets(projectPath, slug))) {
    if (t.kind !== 'copy' || !io.exists(t.file)) continue;
    if (isDelivered(io.read(t.file))) { io.remove(t.file); removed.push(t.file); }
    else left.push(t.file);
  }
  return { removed, left };
}

module.exports = {
  fsIo, MARKER_HEAD, isDelivered, parseAgentMd, renderCopy,
  readAgentMasters, agentDeliveryPlan, deliverAgents, liftToMaster, sweepCopies,
};
