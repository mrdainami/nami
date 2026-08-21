// Which agent CLIs live on this Mac? Curated registry + detection.
// Detection runs `command -v` through the user's login shell so PATH additions
// from .zshrc/.zprofile count; exec is injectable for tests.
// Install commands and docs links verified against official sources 2026-08-08.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseAgentStatus } = require('./agent-status.js');
const { loginShell, whichCommand, binSearchDirs } = require('./platform.js');

// Every one of these keeps skills somewhere of its own — ~/.claude/skills,
// ~/.codex/skills, ~/.hermes/skills and so on — so writing a skill into all of
// them would mean one copy per agent, drifting apart on the first edit. Instead
// each agent gets *told* where the project's single copy lives, in the file it
// already opens on startup. That filename is `contextFile`, and it is the whole
// mechanism: five of the seven read AGENTS.md, so only two need a stub.
//
// `projectSkillsDir` is the optional second route. Where an agent's own
// project-level skills folder is verified, a relative symlink into `skills/`
// earns native registration — the description lands in context automatically
// instead of being read as prose. Left unset means pointer-only, which works.
const KNOWN_AGENTS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', kind: 'claude',
    sub: 'your subscription · slash commands work',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://docs.anthropic.com/en/docs/claude-code',
    contextFile: 'CLAUDE.md',
    projectSkillsDir: '.claude/skills',
    lifecycle: {
      statusCmd: 'claude auth status --json',
      source: 'claude auth status',
      login: 'claude auth login',
      logout: 'claude auth logout',
      health: 'claude doctor',
      configPath: '~/.claude.json',
      accountUrl: 'https://claude.ai/settings/profile',
      // No uninstall: ~/.claude holds the user's own skills, agents and
      // history. Removal takes the program only — see agent-remove.js.
      removePaths: [],
    } },
  { id: 'codex', name: 'Codex', bin: 'codex', kind: 'run',
    sub: "OpenAI's coding agent",
    install: 'npm install -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli',
    contextFile: 'AGENTS.md',
    // File-verified only. Its login/logout commands are unconfirmed, so the
    // sheet shows identity and no buttons.
    lifecycle: {
      statusFiles: ['~/.codex/auth.json'],
      source: 'reads ~/.codex',
      configPath: '~/.codex/config.toml',
    } },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', kind: 'run',
    sub: 'open-source agent · bring any model',
    install: 'curl -fsSL https://opencode.ai/install | bash',
    docs: 'https://opencode.ai/docs',
    contextFile: 'AGENTS.md',
    lifecycle: {
      statusFiles: ['~/.local/share/opencode/auth.json'],
      source: 'reads its auth file',
      login: 'opencode auth login',
      logout: 'opencode auth logout',
      configPath: '~/.config/opencode/opencode.json',
      removePaths: ['~/.local/share/opencode/auth.json'],
    } },
  { id: 'grok', name: 'Grok', bin: 'grok', kind: 'run',
    sub: "xAI's coding agent",
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    docs: 'https://grok.com/build',
    contextFile: 'AGENTS.md',
    lifecycle: {
      // ~/.grok/auth.json is a map keyed issuer::client_id; parseGrok picks the
      // newest sign-in. Reading it beats `grok auth`, which has no status verb.
      statusFiles: ['~/.grok/auth.json'],
      source: 'reads ~/.grok',
      login: 'grok login',
      logout: 'grok logout',
      health: 'grok doctor',
      configPath: '~/.grok/config.toml',
      // Env-only path: Grok reads XAI_API_KEY when no session token is in
      // auth.json. Named here so the sheet can offer it without a hard-coded id.
      apiKeyEnv: 'XAI_API_KEY',
      // No uninstall path: ~/.grok holds the user's own sessions, skills and
      // memory, same reasoning as claude above.
      removePaths: [],
    } },
  // Gemini CLI is gone — Google shut it down 2026-06-18; Antigravity (agy)
  // is its replacement and lives in the same ~/.gemini home, GEMINI.md
  // context file included.
  { id: 'antigravity', name: 'Antigravity', bin: 'agy', kind: 'run',
    sub: "Google's coding agent (replaced Gemini CLI)",
    install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    docs: 'https://antigravity.google/docs/cli',
    contextFile: 'GEMINI.md',
    lifecycle: {
      // First run opens a Google sign-in; identity lands in these files.
      statusFiles: ['~/.gemini/oauth_creds.json', '~/.gemini/google_accounts.json'],
      source: 'reads ~/.gemini',
      configPath: '~/.gemini/settings.json',
    } },
  { id: 'hermes', name: 'Hermes', bin: 'hermes', kind: 'run',
    contextFile: 'AGENTS.md',
    sub: "Nous Research's agent, learns as it works",
    // chain the guided first-run wizard so the install tile walks the user all the way in
    install: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash && hermes setup --portal',
    docs: 'https://hermes-agent.nousresearch.com',
    lifecycle: {
      // `hermes auth status` demands a provider argument and `hermes auth list`
      // prints prose, so identity comes from the JSON it already keeps.
      statusFiles: ['~/.hermes/auth.json', '~/.hermes/config.yaml'],
      source: 'reads ~/.hermes',
      // Hermes holds several sign-ins at once, so switching is its own picker
      // rather than a logout/login pair.
      login: 'hermes login',
      logout: 'hermes auth logout',
      switchCmd: 'hermes auth',
      switchLabel: 'Switch provider',
      setup: 'hermes setup --portal',
      health: 'hermes doctor',
      configPath: '~/.hermes/config.yaml',
      uninstall: 'hermes uninstall',
    } },
  { id: 'kimi', name: 'Kimi Code', bin: 'kimi', kind: 'run',
    sub: "Moonshot's coding agent",
    install: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
    docs: 'https://moonshotai.github.io/kimi-code/en/',
    contextFile: 'AGENTS.md',
    // `kimi login` exists but the CLI has no logout, and a sheet that can
    // sign you in but never out strands people — so neither button shows.
    lifecycle: {
      statusFiles: ['~/.kimi-code/config.toml'],
      source: 'reads ~/.kimi-code',
      health: 'kimi doctor',
      configPath: '~/.kimi-code/config.toml',
    } },
];

// The files a project needs so that every installed agent can see its skills.
// AGENTS.md always carries the block; the other two are three-line redirects to
// it, which is why one block plus two stubs covers the whole registry.
const POINTER_FILE = 'AGENTS.md';
function contextFilesFor(agentIds) {
  const ids = new Set(agentIds || []);
  const files = new Set([POINTER_FILE]);
  for (const a of KNOWN_AGENTS) if (ids.has(a.id) && a.contextFile) files.add(a.contextFile);
  return [...files];
}

// An interactive shell reads the user's rc file — which is the point — but that
// also means anything the rc file prints lands on stdout before our answer.
// `command -v` runs last, so the last path-shaped line is the one we asked for.
function pathFromShellOutput(stdout, platform = process.platform) {
  const looksAbsolute = platform === 'win32' ? /^[a-zA-Z]:\\/ : /^\//;
  const lines = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (looksAbsolute.test(lines[i])) return lines[i];
  return '';
}

// Last resort. The shell probe is better — it knows about PATH edits we could
// never guess — but it can come back empty for reasons that have nothing to do
// with whether the agent is installed: an rc file that needs a tty, a shell we
// mis-guessed, a timeout. Walking the known install directories is a worse
// answer that is still far better than telling someone their agent is missing.
async function findOnDisk(bin, { home = os.homedir(), env = process.env, platform = process.platform, access } = {}) {
  const canRun = access || ((p) => fsp.access(p, fs.constants.X_OK));
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of binSearchDirs({ home, env, platform })) {
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try { await canRun(p); return p; } catch (_) { /* keep looking */ }
    }
  }
  return '';
}

function runLoginShell(cmd) {
  const sh = loginShell();
  return new Promise((resolve, reject) => {
    // stdin is closed deliberately: an interactive shell that decides to prompt
    // would otherwise sit there until the timeout with the launcher waiting.
    execFile(sh.file, sh.args(cmd), { timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || ''));
    });
  });
}

async function shellWhich(bin) {
  let out = '';
  try { out = await runLoginShell(whichCommand(bin)); } catch (_) { out = ''; }
  return pathFromShellOutput(out) || findOnDisk(bin);
}

async function detectAgents({ exec = shellWhich, home = os.homedir() } = {}) {
  return Promise.all(KNOWN_AGENTS.map(async (a) => {
    let p = '';
    try { p = String((await exec(a.bin)) || '').trim(); } catch (_) { p = ''; }
    // configFile is the ~-expanded twin of lifecycle.configPath, so the renderer
    // can hand it straight to openFile() without knowing where home is.
    const configFile = a.lifecycle && a.lifecycle.configPath
      ? expandHome(a.lifecycle.configPath, home) : '';
    return { ...a, found: !!p, path: p, pathShort: shortHome(p, home), configFile };
  }));
}

// ---- who is signed in ------------------------------------------------------
// Lazy and per-agent by design: a CLI that hangs must never stall the launcher,
// so every failure path lands on "unknown" rather than throwing. Reading a file
// is preferred over spawning a process wherever the CLI gives us the choice —
// it is faster and cannot hang.

function agentById(id) { return KNOWN_AGENTS.find((a) => a.id === id) || null; }

function expandHome(p, home) {
  return String(p || '').replace(/^~(?=\/|$)/, home);
}
// The display twin: ~/.local/bin/hermes reads better than /Users/you/.local/...
function shortHome(p, home) {
  const s = String(p || '');
  return home && s.startsWith(home + '/') ? '~' + s.slice(home.length) : s;
}

const shellRun = runLoginShell;
async function readIfPresent(p) {
  try { return await fsp.readFile(p, 'utf8'); } catch (_) { return null; }
}

function nonemptyEnv(bag, name) {
  return !!(bag && typeof bag[name] === 'string' && bag[name].trim());
}
// Presence only — the value never leaves this function. Grok also accepts the
// older GROK_CODE_XAI_API_KEY name; either counts.
function grokApiKeyPresent(envKeys, env) {
  return nonemptyEnv(envKeys, 'XAI_API_KEY') || nonemptyEnv(envKeys, 'GROK_CODE_XAI_API_KEY')
    || nonemptyEnv(env, 'XAI_API_KEY') || nonemptyEnv(env, 'GROK_CODE_XAI_API_KEY');
}

async function agentStatus(id, { exec = shellRun, readFile = readIfPresent, home = os.homedir(), envKeys = {}, env = process.env } = {}) {
  const blank = { id, signedIn: null, label: '', rows: [], source: '' };
  const agent = agentById(id);
  const lc = agent && agent.lifecycle;
  if (!lc) return blank;
  try {
    let payload;
    if (lc.statusCmd) {
      payload = { stdout: await exec(lc.statusCmd) };
    } else if (lc.statusFiles && lc.statusFiles.length) {
      const files = {};
      await Promise.all(lc.statusFiles.map(async (rel) => {
        const abs = expandHome(rel, home);
        files[abs] = await readFile(abs);
      }));
      payload = { files };
    } else {
      return blank;
    }
    if (id === 'grok') payload.hasApiKey = grokApiKeyPresent(envKeys, env);
    return { id, source: lc.source || '', ...parseAgentStatus(id, payload) };
  } catch (_) {
    return blank;
  }
}

module.exports = { KNOWN_AGENTS, POINTER_FILE, contextFilesFor, detectAgents, agentStatus, agentById, expandHome, pathFromShellOutput, findOnDisk };
