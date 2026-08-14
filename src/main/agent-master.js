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
const os = require('os');

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
// `tool` (singular) is Nami's own: which tool this agent was written for. It is
// a hint the picker reads, never a lock, and no dialect renderer touches it —
// putting an unknown key in somebody else's format is a change to their format.
// It sits next to `tools` (plural, the permission list) and the exact-match
// lookup below is what keeps the two apart.
const FIELDS = ['name', 'description', 'tools', 'model', 'mode', 'tool'];
function parseAgentMd(text) {
  const out = { name: '', description: '', tools: '', model: '', mode: '', tool: '', body: String(text || '') };
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
    // OpenCode names agents by filename and requires a mode. The default is
    // `all`, probe-proven both ways: `subagent` makes `opencode --agent x`
    // silently fall back to the build agent, and a ⌘K launch as the agent is
    // this copy's first job; `all` keeps it @-mentionable inside sessions too.
    return fmBlock([['description', a.description], ['mode', a.mode || 'all'], ['model', a.model]])
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

function copyTargets(projectPath, slug, homeDir) {
  const p = (rel) => path.join(projectPath, rel);
  const home = homeDir || os.homedir();
  return {
    claude: { kind: 'copy', file: p(`.claude/agents/${slug}.md`) },
    opencode: { kind: 'copy', file: p(`.opencode/agents/${slug}.md`) },
    gemini: { kind: 'copy', file: p(`.gemini/agents/${slug}.md`) },
    // agy discovers user scope only; a project copy is a copy it never reads
    antigravity: { kind: 'copy', file: path.join(home, `.gemini/agents/${slug}.md`) },
    kimi: { kind: 'copy', file: p(`.kimi-code/agents/${slug}.md`) },
    codex: { kind: 'copy', file: p(`.codex/agents/${slug}.toml`) },
    cursor: { kind: 'via', via: 'claude' }, // reads .claude/agents natively
    hermes: { kind: 'none', reason: 'Hermes has no custom agents' },
  };
}

function agentDeliveryPlan({ slug, agentIds, projectPath, homeDir }) {
  const targets = copyTargets(projectPath, slug, homeDir);
  return agentIds.map((agent) => ({ agent, slug, ...targets[agent] })).filter((s) => s.kind);
}

// What is true right now for one agent across a set of tools, without changing
// any of it. Five answers, none of them stored anywhere: copyTargets knows the
// path for every pair, and the marker at that path says the rest.
//
//   here   — the copy is on disk
//   soon   — nothing there; delivery writes it
//   theirs — a file of that name exists without the marker. It is somebody's
//            hand work, it wins, and the master stays out.
//   via    — this tool reads another tool's copy (Cursor reads Claude's)
//   none   — this tool has no custom agents at all (Hermes)
//
// Read-only by construction: it never calls io.write.
function deliveryState({ projectPath, slug, agentIds, io = fsIo, homeDir }) {
  const targets = copyTargets(projectPath, slug, homeDir);
  return (agentIds || []).map((agent) => {
    const t = targets[agent];
    if (!t) return { agent, slug, state: 'none', reason: `Nami has no agent format for ${agent}` };
    if (t.kind === 'via') return { agent, slug, state: 'via', via: t.via };
    if (t.kind === 'none') return { agent, slug, state: 'none', reason: t.reason };
    if (!io.exists(t.file)) return { agent, slug, state: 'soon', file: t.file };
    let text = '';
    try { text = io.read(t.file); } catch (_) { /* unreadable reads as theirs */ }
    return { agent, slug, state: isDelivered(text) ? 'here' : 'theirs', file: t.file };
  });
}

// One pass for every master × every installed tool. A hand-made file with the
// same name is reported as theirs and left alone.
function deliverAgents({ projectPath, agentIds, io = fsIo, homeDir }) {
  const results = [];
  for (const { slug, agent } of readAgentMasters({ projectPath, io })) {
    for (const step of agentDeliveryPlan({ slug, agentIds, projectPath, homeDir })) {
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
// ---- importing an agent that lives elsewhere --------------------------------
// The copy-over drawer's mechanic. Unlike liftToMaster below — which converts a
// file inside the project and replaces it with a delivered copy — the source
// here is the user's personal file in a home folder. It is read, never written:
// their ~/.codex/agents is theirs, and the project gets its own master.
//
// Codex sources are TOML, so this needs the read half of the dialect renderCopy
// writes: name, description, and the developer_instructions block as the body.
function parseAgentToml(text) {
  const src = String(text || '');
  const out = { name: '', description: '', tools: '', model: '', mode: '', tool: '', body: '' };
  // the prompt block first, so a key inside it can never win
  const bodyM = src.match(/^developer_instructions\s*=\s*"""\r?\n?([\s\S]*?)"""/m)
    || src.match(/^developer_instructions\s*=\s*'''\r?\n?([\s\S]*?)'''/m);
  if (bodyM) out.body = bodyM[1].replace(/\\(["\\])/g, '$1').trim();
  const head = bodyM ? src.slice(0, src.indexOf(bodyM[0])) : src;
  for (const key of ['name', 'description', 'model']) {
    const m = head.match(new RegExp('^' + key + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"', 'm'));
    if (m) out[key] = m[1].replace(/\\(["\\])/g, '$1');
  }
  return out;
}

function importToMaster({ filePath, projectPath, io = fsIo }) {
  if (!filePath || !projectPath) return { ok: false, error: 'Open a folder first — the master lands in it.' };
  let text;
  try { text = io.read(filePath); } catch (_) { return { ok: false, error: 'That file is missing.' }; }
  const slug = path.basename(filePath, path.extname(filePath));
  const masterPath = path.join(mastersDir(projectPath), slug + '.md');
  if (io.exists(masterPath)) return { ok: false, error: `agents/${slug}.md already exists — rename one of them first.` };
  const a = filePath.endsWith('.toml') ? parseAgentToml(text) : parseAgentMd(text);
  const master = fmBlock([
    ['name', a.name || slug], ['description', a.description], ['tools', a.tools],
    ['model', a.model], ['mode', a.mode],
  ]) + '\n' + (a.body || '').trim() + '\n';
  io.write(masterPath, master);
  return { ok: true, masterPath, slug };
}

function liftToMaster({ filePath, platform, projectPath, io = fsIo }) {
  if (!projectPath) return { ok: false, error: 'Open a folder first — masters live in the project.' };
  let text;
  try { text = io.read(filePath); } catch (_) { return { ok: false, error: 'That agent\'s file is missing.' }; }
  if (isDelivered(text)) return { ok: false, error: 'Already a delivered copy — edit its master instead.' };
  // Masters are markdown with frontmatter. Handed a TOML agent, parseAgentMd
  // finds no fence, returns the whole file as the body, and the write-back
  // below would then overwrite the user's own file with a copy of itself
  // nested inside developer_instructions. Refuse rather than mangle.
  if (!filePath.endsWith('.md')) return { ok: false, error: 'Only markdown agents can be lifted into agents/ — this one is ' + path.extname(filePath) + '.' };
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
function sweepCopies({ projectPath, slug, io = fsIo, homeDir }) {
  const removed = [], left = [];
  for (const t of Object.values(copyTargets(projectPath, slug, homeDir))) {
    if (t.kind !== 'copy' || !io.exists(t.file)) continue;
    if (isDelivered(io.read(t.file))) { io.remove(t.file); removed.push(t.file); }
    else left.push(t.file);
  }
  return { removed, left };
}

module.exports = {
  fsIo, MARKER_HEAD, isDelivered, parseAgentMd, renderCopy,
  readAgentMasters, agentDeliveryPlan, deliverAgents, deliveryState, liftToMaster, importToMaster, sweepCopies, copyTargets,
};
