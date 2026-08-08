// Read and merge-write the MCP settings files each platform already reads.
// All IO goes through an injectable io so tests never touch the disk.
const fs = require('fs');
const path = require('path');
const { serviceById } = require('./services-catalog');

const fsIo = {
  read: (f) => fs.readFileSync(f, 'utf8'),
  write: (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); },
  exists: (f) => fs.existsSync(f),
};

function readJson(file, io) {
  if (!io.exists(file)) return null;
  try { return JSON.parse(io.read(file)); } catch (_) { return null; }
}
function writeJson(file, obj, io) { io.write(file, JSON.stringify(obj, null, 2) + '\n'); }

function upsertMcpJson({ file, id, entry, io = fsIo }) {
  const doc = readJson(file, io) || {};
  doc.mcpServers = doc.mcpServers || {};
  doc.mcpServers[id] = entry;
  writeJson(file, doc, io);
  return { ok: true, file };
}
function upsertOpencode({ file, id, entry, io = fsIo }) {
  const doc = readJson(file, io) || { $schema: 'https://opencode.ai/config.json' };
  doc.mcp = doc.mcp || {};
  doc.mcp[id] = entry;
  writeJson(file, doc, io);
  return { ok: true, file };
}
function removeService({ files, id, io = fsIo }) {
  const changed = [];
  for (const file of files) {
    const doc = readJson(file, io);
    if (!doc) continue;
    let hit = false;
    if (doc.mcpServers && doc.mcpServers[id]) { delete doc.mcpServers[id]; hit = true; }
    if (doc.mcp && doc.mcp[id]) { delete doc.mcp[id]; hit = true; }
    if (hit) { writeJson(file, doc, io); changed.push(file); }
  }
  return changed;
}

// Every place a connection can already live: [file, scope, platform, section]
function knownFiles(projectPath, home) {
  const out = [];
  if (projectPath) {
    out.push([path.join(projectPath, '.mcp.json'), 'project', 'claude', 'mcpServers']);
    out.push([path.join(projectPath, 'opencode.json'), 'project', 'opencode', 'mcp']);
  }
  if (home) {
    out.push([path.join(home, '.claude.json'), 'user', 'claude', 'mcpServers']);
    out.push([path.join(home, '.config', 'opencode', 'opencode.json'), 'user', 'opencode', 'mcp']);
  }
  return out;
}
function detectServices({ projectPath, home, io = fsIo }) {
  const found = new Map();
  for (const [file, scope, platform, section] of knownFiles(projectPath, home)) {
    const doc = readJson(file, io);
    const entries = doc && doc[section];
    if (!entries) continue;
    for (const id of Object.keys(entries)) {
      if (!found.has(id)) {
        const cat = serviceById(id);
        found.set(id, { id, name: cat ? cat.name : id, custom: !cat, scopes: [], platforms: [], files: [] });
      }
      const rec = found.get(id);
      if (!rec.scopes.includes(scope)) rec.scopes.push(scope);
      if (!rec.platforms.includes(platform)) rec.platforms.push(platform);
      rec.files.push(file);
    }
  }
  return [...found.values()];
}

module.exports = { fsIo, readJson, upsertMcpJson, upsertOpencode, removeService, detectServices, knownFiles };
