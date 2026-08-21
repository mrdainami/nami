// The connections drawer: one master list of MCP servers, delivered to every
// installed agent's own config. Pure fs through an injectable io — the
// library.js discipline — so every decision below is unit-testable.
//
// The master file IS the standard `mcpServers` shape, not a Nami format:
// Claude, Cursor, Gemini and Kimi read that block word for word, so delivery to
// them is a plain merge, and the file keeps working by copy-paste even without
// Nami. Only OpenCode (its own JSON dialect) and Codex (TOML) need translating;
// Hermes is detected but not written — its YAML is hand-owned and its CLI is
// interactive, so honesty ("add it in Hermes") beats a risky write.
//
// Two rules carried over from the pointer and mcp-config:
//   - merge, never clobber: hand-made entries in any notebook are never touched.
//   - never re-serialize a hand-formatted file: Codex TOML is managed as a
//     marker block (the AGENTS.md contract), regenerated whole each delivery.

const fs = require('fs');
const path = require('path');

const fsIo = {
  read: (f) => fs.readFileSync(f, 'utf8'),
  write: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); },
  exists: (f) => fs.existsSync(f),
};

// A connected service id is a bare identifier by contract (a JSON key in an MCP
// config, or a name the user typed). Anything else is refused, never quoted:
// these ids reach the `claude` CLI as argv, and a leading '-' or a shell
// metacharacter must never be able to change what runs.
function validServiceId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

function readJson(file, io) {
  if (!io.exists(file)) return null;
  try { return JSON.parse(io.read(file)); } catch (_) { return null; }
}
function writeJson(file, obj, io) { io.write(file, JSON.stringify(obj, null, 2) + '\n'); }

// ---- masters ----------------------------------------------------------------

function masterPath({ scope, projectPath, homeDir }) {
  if (scope === 'project') return projectPath ? path.join(projectPath, 'connections.json') : null;
  return path.join(homeDir, '.nami', 'connections.json');
}

function readMaster({ scope, projectPath, homeDir, io = fsIo }) {
  const file = masterPath({ scope, projectPath, homeDir });
  if (!file) return {};
  const doc = readJson(file, io);
  return (doc && doc.mcpServers) || {};
}

// Keys ride inside entries — the same place every platform's own config keeps
// them — so a project master must never reach a remote. Appending to .gitignore
// is done once, only when a repo is present, and only if the line is absent.
function guardIgnore({ projectPath, io }) {
  if (!io.exists(path.join(projectPath, '.git'))) return;
  const ignoreFile = path.join(projectPath, '.gitignore');
  const cur = io.exists(ignoreFile) ? io.read(ignoreFile) : '';
  const has = cur.split(/\r?\n/).some((l) => l.trim() === 'connections.json');
  if (has) return;
  io.write(ignoreFile, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + 'connections.json\n');
}

function upsertMaster({ scope, projectPath, homeDir, id, entry, io = fsIo }) {
  const file = masterPath({ scope, projectPath, homeDir });
  if (!file) return { ok: false, error: 'Open a folder first — a project connection lives in the project.' };
  const doc = readJson(file, io) || {};
  doc.mcpServers = doc.mcpServers || {};
  doc.mcpServers[id] = entry;
  writeJson(file, doc, io);
  if (scope === 'project') guardIgnore({ projectPath, io });
  return { ok: true, file };
}

function removeMaster({ scope, projectPath, homeDir, id, io = fsIo }) {
  const file = masterPath({ scope, projectPath, homeDir });
  const doc = file && readJson(file, io);
  if (!doc || !doc.mcpServers || !doc.mcpServers[id]) return { ok: false, error: 'not in the master' };
  delete doc.mcpServers[id];
  writeJson(file, doc, io);
  return { ok: true, file };
}

// ---- dialect translation ----------------------------------------------------

function toOpencode(entry) {
  if (entry.url) {
    const out = { type: 'remote', url: entry.url, enabled: true };
    if (entry.headers && Object.keys(entry.headers).length) out.headers = entry.headers;
    return out;
  }
  const out = { type: 'local', command: [entry.command, ...(entry.args || [])], enabled: true };
  if (entry.env && Object.keys(entry.env).length) out.environment = entry.env;
  return out;
}

// ---- codex: TOML rendered by hand, managed as a marker block ----------------
// Rendering only these three shapes (command/args, env table, url) keeps this a
// formatter, not a TOML library — and everything it emits is round-trippable.

const CODEX_START = '# nami:connections start';
const CODEX_END = '# nami:connections end';

function tomlStr(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

function codexBlock(masters, { skip = new Set() } = {}) {
  const parts = [];
  for (const id of Object.keys(masters).sort()) {
    if (skip.has(id)) continue;
    const e = masters[id];
    parts.push(`[mcp_servers.${id}]`);
    if (e.url) parts.push(`url = ${tomlStr(e.url)}`);
    else {
      parts.push(`command = ${tomlStr(e.command)}`);
      parts.push(`args = [${(e.args || []).map(tomlStr).join(', ')}]`);
    }
    if (e.env && Object.keys(e.env).length) {
      parts.push('', `[mcp_servers.${id}.env]`);
      for (const k of Object.keys(e.env).sort()) parts.push(`${k} = ${tomlStr(e.env[k])}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

// The pointer contract, verbatim: no markers → append once; markers → replace
// only between them; two start markers → refuse. Ids the user already defined
// outside our block are skipped — a duplicate TOML table is a parse error in
// Codex, which would break every server they have, not just ours.
function writeCodexBlock({ file, masters, io = fsIo }) {
  const cur = io.exists(file) ? io.read(file) : '';
  const starts = cur.split(CODEX_START).length - 1;
  if (starts > 1) return { ok: false, error: 'two start markers — refusing to guess which is live' };
  const before = starts ? cur.slice(0, cur.indexOf(CODEX_START)) : cur;
  const after = starts ? cur.slice(cur.indexOf(CODEX_END) + CODEX_END.length) : '';
  const outside = before + after;
  const skip = new Set(Object.keys(masters).filter((id) => presentInToml(outside, id)));
  const body = codexBlock(masters, { skip });
  const block = body.trim() ? CODEX_START + '\n' + body.trimEnd() + '\n' + CODEX_END + '\n' : '';
  let next;
  if (starts) next = before + (block || '') + after.replace(/^\n/, block ? '\n' : '');
  else if (block) next = cur + (cur && !cur.endsWith('\n') ? '\n' : '') + (cur ? '\n' : '') + block;
  else next = cur;
  if (next !== cur) io.write(file, next);
  return { ok: true, file, skipped: [...skip] };
}

// ---- presence detection: read-only, regex on structure, no parser deps ------

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function presentInToml(text, id) {
  return new RegExp('^\\s*\\[mcp_servers\\.' + escapeRe(id) + '[\\].]', 'm').test(text || '');
}

function presentInYaml(text, id) {
  const m = (text || '').match(/^mcp_servers:\s*$([\s\S]*?)(?=^\S|(?![\s\S]))/m);
  if (!m) return false;
  return new RegExp('^\\s+' + escapeRe(id) + ':', 'm').test(m[1]);
}

// ---- where each agent keeps its notebook, per scope -------------------------
// json: merge into `section`; block: the codex marker block; cli: the tool's
// own command owns the write; manual: we won't write it, and we say so.
// Antigravity replaced Gemini CLI and reads the same ~/.gemini files, so both
// ids alias one notebook. An agent with no entry here is skipped everywhere —
// including coverage, where counting it would mean a permanent false "missing".

function notebookTargets({ scope, projectPath, homeDir }) {
  const p = (rel) => (projectPath ? path.join(projectPath, rel) : null);
  const h = (rel) => path.join(homeDir, rel);
  if (scope === 'project') {
    return {
      claude: { kind: 'json', file: p('.mcp.json'), section: 'mcpServers' },
      cursor: { kind: 'json', file: p('.cursor/mcp.json'), section: 'mcpServers' },
      gemini: { kind: 'json', file: p('.gemini/settings.json'), section: 'mcpServers' },
      antigravity: { kind: 'json', file: p('.gemini/settings.json'), section: 'mcpServers' },
      kimi: { kind: 'json', file: p('.kimi-code/mcp.json'), section: 'mcpServers' },
      opencode: { kind: 'json', file: p('opencode.json'), section: 'mcp', translate: true },
      codex: { kind: 'block', file: p('.codex/config.toml') },
      grok: { kind: 'block', file: p('.grok/config.toml') },
      hermes: { kind: 'manual', reason: 'Hermes keeps its list machine-wide — add it once with `hermes mcp`' },
    };
  }
  return {
    // argv, never a shell string: the id and the JSON entry are discrete argv
    // elements, so nothing in them can be parsed as a command. The program name
    // is supplied by the executor (which resolves the real claude binary).
    claude: { kind: 'cli', argvFor: (id, entry) => ['mcp', 'add-json', '--scope', 'user', id, JSON.stringify(entry)] },
    cursor: { kind: 'json', file: h('.cursor/mcp.json'), section: 'mcpServers' },
    gemini: { kind: 'json', file: h('.gemini/settings.json'), section: 'mcpServers' },
    antigravity: { kind: 'json', file: h('.gemini/settings.json'), section: 'mcpServers' },
    kimi: { kind: 'json', file: h('.kimi-code/mcp.json'), section: 'mcpServers' },
    opencode: { kind: 'json', file: h('.config/opencode/opencode.json'), section: 'mcp', translate: true },
    codex: { kind: 'block', file: h('.codex/config.toml') },
    grok: { kind: 'block', file: h('.grok/config.toml') },
    hermes: { kind: 'manual', reason: 'Hermes’s config.yaml is hand-owned — add it once with `hermes mcp`' },
  };
}

// One step per agent (json/block/manual), or one per entry (cli). Pure: the
// executor that touches disk or spawns commands lives in connections-deliver.
function deliveryPlan({ masters, scope, agentIds, projectPath, homeDir }) {
  const targets = notebookTargets({ scope, projectPath, homeDir });
  const plan = [];
  for (const agent of agentIds) {
    const t = targets[agent];
    if (!t) continue;
    if (t.kind === 'cli') {
      for (const id of Object.keys(masters)) {
        if (!validServiceId(id)) continue; // refuse ids that could smuggle a flag/command
        plan.push({ agent, kind: 'cli', id, argv: t.argvFor(id, masters[id]) });
      }
    } else if (t.kind === 'json') {
      if (!t.file) continue;
      const entries = {};
      for (const id of Object.keys(masters)) entries[id] = t.translate ? toOpencode(masters[id]) : masters[id];
      plan.push({ agent, kind: 'json', file: t.file, section: t.section, entries });
    } else if (t.kind === 'block') {
      if (!t.file) continue;
      plan.push({ agent, kind: 'block', file: t.file, masters });
    } else {
      plan.push({ agent, kind: 'manual', reason: t.reason });
    }
  }
  return plan;
}

// ---- who already has what ---------------------------------------------------
// Reads both scopes per agent: a session in this project can use an entry from
// either, so coverage is the union — same honesty rule as the skills rail.

function readNotebooks({ projectPath, homeDir, agentIds, io = fsIo }) {
  const both = [
    notebookTargets({ scope: 'project', projectPath, homeDir }),
    notebookTargets({ scope: 'user', projectPath, homeDir }),
  ];
  // user-scope claude writes via CLI but reads from ~/.claude.json
  const reads = {
    claude: [projectPath && path.join(projectPath, '.mcp.json'), path.join(homeDir, '.claude.json')],
  };
  const out = {};
  for (const agent of agentIds) {
    // No reader for this tool → leave it out entirely, never report "missing".
    if (!reads[agent] && !both.some((t) => t[agent]) && agent !== 'hermes') continue;
    const ids = new Set();
    const files = reads[agent]
      ? reads[agent].filter(Boolean).map((file) => ({ kind: 'json', file, section: 'mcpServers' }))
      : both.map((t) => t[agent]).filter((t) => t && t.file);
    for (const t of files) {
      if (!io.exists(t.file)) continue;
      if (t.kind === 'json') {
        const doc = readJson(t.file, io);
        for (const id of Object.keys((doc && doc[t.section]) || {})) ids.add(id);
      } else if (t.kind === 'block') {
        const text = io.read(t.file);
        for (const m of text.matchAll(/^\s*\[mcp_servers\.([\w.-]+?)\]/gm)) ids.add(m[1].split('.')[0]);
      }
    }
    if (agent === 'hermes') {
      const f = path.join(homeDir, '.hermes', 'config.yaml');
      if (io.exists(f)) {
        const text = io.read(f);
        const m = text.match(/^mcp_servers:\s*$([\s\S]*?)(?=^\S|(?![\s\S]))/m);
        if (m) for (const mm of m[1].matchAll(/^ {2}([\w-]+):/gm)) ids.add(mm[1]);
      }
    }
    out[agent] = ids;
  }
  return out;
}

function coverage({ masters, notebooks }) {
  const out = {};
  for (const id of Object.keys(masters)) {
    const have = [], missing = [];
    for (const agent of Object.keys(notebooks)) (notebooks[agent].has(id) ? have : missing).push(agent);
    out[id] = { have, missing };
  }
  return out;
}

module.exports = {
  fsIo, masterPath, readMaster, upsertMaster, removeMaster,
  validServiceId,
  toOpencode, codexBlock, writeCodexBlock, presentInToml, presentInYaml,
  deliveryPlan, notebookTargets, readNotebooks, coverage,
  CODEX_START, CODEX_END,
};
