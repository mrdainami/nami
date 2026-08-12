// .mcpb bundles: the official one-click MCP packaging — a zip holding the
// server and a manifest.json that describes how to run it. Nami reads the
// manifest and turns it into an ordinary master entry, so a bundle is just a
// third door into the same drawer: what lands in connections.json is
// indistinguishable from a catalog or hand-typed connection.
//
// Pure functions only — the unzip and dialogs live in main.js, so everything
// here is unit-testable. Substitution handles the two placeholders the format
// leans on: ${__dirname} (the extracted bundle folder) and ${user_config.*}
// (values the manifest asks the user for, with declared defaults honoured).

function parseManifest(text) {
  let m;
  try { m = JSON.parse(String(text || '')); } catch (_) { return { ok: false, error: 'manifest.json is not valid JSON' }; }
  const cfg = m && m.server && m.server.mcp_config;
  if (!cfg || (!cfg.command && !cfg.url)) return { ok: false, error: 'manifest has no server.mcp_config — not a runnable bundle' };
  if (!m.name) return { ok: false, error: 'manifest has no name' };
  return { ok: true, manifest: m };
}

function userConfigFields(manifest) {
  const uc = (manifest && manifest.user_config) || {};
  return Object.keys(uc).map((id) => ({
    id,
    label: uc[id].title || id,
    description: uc[id].description || '',
    required: !!uc[id].required,
    sensitive: !!uc[id].sensitive,
    default: uc[id].default !== undefined ? uc[id].default : '',
  }));
}

function substitute(str, dir, values, defaults) {
  return String(str)
    .replace(/\$\{__dirname\}/g, dir)
    .replace(/\$\{user_config\.([\w-]+)\}/g, (_, key) => {
      if (values[key] !== undefined && values[key] !== '') return values[key];
      return defaults[key] !== undefined ? defaults[key] : '';
    });
}

function buildEntry({ manifest, dir, values = {} }) {
  const cfg = manifest.server.mcp_config;
  const defaults = {};
  for (const f of userConfigFields(manifest)) if (f.default !== '') defaults[f.id] = f.default;
  if (cfg.url) {
    const out = { url: substitute(cfg.url, dir, values, defaults) };
    return out;
  }
  const out = {
    command: substitute(cfg.command, dir, values, defaults),
    args: (cfg.args || []).map((a) => substitute(a, dir, values, defaults)),
  };
  const env = {};
  for (const k of Object.keys(cfg.env || {})) env[k] = substitute(cfg.env[k], dir, values, defaults);
  if (Object.keys(env).length) out.env = env;
  return out;
}

function bundleSlug(manifest) {
  const base = String(manifest.name || 'bundle').trim().toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  const v = String(manifest.version || '').trim().toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  return v ? base + '-' + v : base;
}

// The paste-a-command door: a README's command line, split like a shell would
// (double and single quotes only — no expansions, this is data not code).
function parseCommandLine(str) {
  const parts = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(str || '')))) parts.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  if (!parts.length) return null;
  return { command: parts[0], args: parts.slice(1) };
}

module.exports = { parseManifest, userConfigFields, buildEntry, bundleSlug, parseCommandLine };
