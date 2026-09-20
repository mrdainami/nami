// Which agent CLIs live on this Mac? Curated registry + detection.
// Detection runs `command -v` through the user's login shell so PATH additions
// from .zshrc/.zprofile count; exec is injectable for tests.
// Install commands and docs links verified against official sources 2026-08-08.
const { execFile } = require('node:child_process');
const { buildChildEnv } = require('./session-env');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseAgentStatus } = require('./agent-status.js');
const { loginShell, whichCommand, binSearchDirs, paneShell } = require('./platform.js');
const { chainLine } = require('./shell-chain.js');

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
    installWin: 'irm https://claude.ai/install.ps1 | iex',
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
    // npm.cmd by name: in PowerShell a bare `npm` is npm.ps1, and a stock
    // Windows will not run script files (ExecutionPolicy Restricted).
    installWin: 'npm.cmd install -g @openai/codex',
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
    installWin: 'npm.cmd install -g opencode-ai',
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
    installWin: 'irm https://x.ai/cli/install.ps1 | iex',
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
    installWin: 'irm https://antigravity.google/cli/install.ps1 | iex',
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
    // Its Windows installer runs the first-run setup itself, and the PATH it
    // writes is not visible to the shell that ran it, so nothing is chained.
    installWin: 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)',
    docs: 'https://hermes-agent.nousresearch.com',
    lifecycle: {
      // `hermes auth status` demands a provider argument and `hermes auth list`
      // prints prose, so identity comes from the JSON it already keeps.
      statusFiles: ['~/.hermes/auth.json', '~/.hermes/config.yaml'],
      source: 'reads ~/.hermes',
      // The one agent whose home moves on Windows: install.ps1 sets HERMES_HOME
      // to %LOCALAPPDATA%\hermes, and hermes_constants.py defaults to the same
      // folder, so nothing is ever written to a .hermes under the profile.
      statusFilesWin: ['%LOCALAPPDATA%\\hermes\\auth.json', '%LOCALAPPDATA%\\hermes\\config.yaml'],
      sourceWin: 'reads %LOCALAPPDATA%\\hermes',
      configPathWin: '%LOCALAPPDATA%\\hermes\\config.yaml',
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
    installWin: 'irm https://code.kimi.com/kimi-code/install.ps1 | iex',
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
  const looksAbsolute = platform === 'win32' ? /^([a-zA-Z]:[\\/]|\\\\)/ : /^\//;
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
  // Joined the way the platform being asked about joins, not the way the
  // machine running this does — the two differ in every test of this function.
  const join = (platform === 'win32' ? path.win32 : path.posix).join;
  for (const dir of binSearchDirs({ home, env, platform })) {
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      try { await canRun(p); return p; } catch (_) { /* keep looking */ }
    }
  }
  return '';
}

function runLoginShell(cmd, { settings = {}, env = process.env, purpose = 'probe', agentId } = {}) {
  const sh = loginShell();
  return new Promise((resolve, reject) => {
    // stdin is closed deliberately: an interactive shell that decides to prompt
    // would otherwise sit there until the timeout with the launcher waiting.
    execFile(sh.file, sh.args(cmd), { timeout: 8000, env: buildChildEnv({ parentEnv: env, settings, purpose, agentId }), stdio: ['ignore', 'pipe', 'pipe'] }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || ''));
    });
  });
}

async function shellWhich(bin, options) {
  let out = '';
  try { out = await runLoginShell(whichCommand(bin), options); } catch (_) { out = ''; }
  return pathFromShellOutput(out) || findOnDisk(bin);
}

// The command that installs an agent on the machine being asked about. Every
// `install` above pipes a script into bash, which Windows does not have; each
// vendor ships a PowerShell twin, and that is `installWin`. An agent with no
// twin keeps its one command — npm installs the same way everywhere.
function installCommand(agent, platform = process.platform) {
  return (platform === 'win32' && agent.installWin) || agent.install;
}

// The same idea for everything under `lifecycle`: a field that is different on
// Windows has a `...Win` twin beside it, and this folds the twins in. Checked
// against each CLI's own Windows build, 2026-09-20 — every command is the same
// program with the same arguments, so the only twins are Hermes's file
// locations. Off Windows the registry entry is handed back untouched.
function lifecycleFor(agent, platform = process.platform) {
  const lc = agent && agent.lifecycle;
  if (!lc) return null;
  if (platform !== 'win32') return lc;
  const out = {};
  for (const [k, v] of Object.entries(lc)) if (!k.endsWith('Win')) out[k] = v;
  for (const [k, v] of Object.entries(lc)) if (k.endsWith('Win')) out[k.slice(0, -3)] = v;
  return out;
}

// "Switch account" is sign out, then sign in — and the sign-in only if the
// sign-out worked, or a failed logout leaves the old account quietly in place
// behind a fresh login prompt. On a Mac that is `a && b`. Windows PowerShell
// reads `&&` as a syntax error and runs neither half, so the pair is joined in
// the words of the shell the tile will run (see shell-chain.js). An agent with
// a switch command of its own uses that instead, everywhere.
//
// The shell is asked for with an empty environment on purpose. A Mac has always
// been handed `&&` whatever $SHELL says, and main compares this string with the
// one the sheet sends, so it has to come out the same every time it is built.
function logoutThenLogin(lc, platform) {
  return chainLine([lc.logout, lc.login], paneShell(platform, {}));
}
function switchAccountCommand(agent, platform = process.platform) {
  const lc = lifecycleFor(agent, platform) || {};
  if (lc.switchCmd) return lc.switchCmd;
  if (!lc.logout || !lc.login) return '';
  return logoutThenLogin(lc, platform);
}

// A `statusFiles` or `configPath` entry as a real path on the machine being
// asked about. On Windows that means %NAME% filled in from the environment —
// with the usual place under the profile when the variable is not set, since a
// GUI app is not promised either — and the separators made the platform's own,
// because the result is shown to people and handed to the file viewer.
const WIN_FOLDERS = { LOCALAPPDATA: ['AppData', 'Local'], APPDATA: ['AppData', 'Roaming'] };
function lifecyclePath(p, { home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return expandHome(p, home, platform);
  const filled = String(p || '').replace(/%([A-Za-z_]+)%/g, (whole, name) => {
    const set = env && env[name.toUpperCase()];
    if (set) return set;
    const usual = WIN_FOLDERS[name.toUpperCase()];
    return usual ? path.win32.join(home, ...usual) : whole;
  });
  return path.win32.normalize(expandHome(filled, home, platform));
}

async function detectAgents({ exec = shellWhich, home = os.homedir(), settings = {}, env = process.env, platform = process.platform } = {}) {
  return Promise.all(KNOWN_AGENTS.map(async (a) => {
    let p = '';
    try { p = String((await exec(a.bin, { settings, env })) || '').trim(); } catch (_) { p = ''; }
    // configFile is the ~-expanded twin of lifecycle.configPath, so the renderer
    // can hand it straight to openFile() without knowing where home is.
    const lifecycle = lifecycleFor(a, platform);
    const configFile = lifecycle && lifecycle.configPath
      ? lifecyclePath(lifecycle.configPath, { home, env, platform }) : '';
    // The renderer shows and runs `install` as it finds it, so it is handed the
    // one for this machine and never learns there was a choice. The same goes
    // for the lifecycle commands and the switch-account line built from them.
    return { ...a, lifecycle, install: installCommand(a, platform), switchAccount: switchAccountCommand(a, platform), found: !!p, path: p, pathShort: shortHome(p, home, platform), configFile };
  }));
}

// ---- who is signed in ------------------------------------------------------
// Lazy and per-agent by design: a CLI that hangs must never stall the launcher,
// so every failure path lands on "unknown" rather than throwing. Reading a file
// is preferred over spawning a process wherever the CLI gives us the choice —
// it is faster and cannot hang.

function agentById(id) { return KNOWN_AGENTS.find((a) => a.id === id) || null; }

// On Windows `~\.claude` is as likely as `~/.claude`, and what comes back is
// written the way Windows writes it — this path is shown to people and handed
// to the file viewer, and C:\Users\you/.claude/x reads like a mistake even
// though it opens. A path with no `~` in front is returned untouched.
function expandHome(p, home, platform = process.platform) {
  if (platform !== 'win32') return String(p || '').replace(/^~(?=\/|$)/, home);
  const s = String(p || '');
  return /^~(?=[\\/]|$)/.test(s) ? home + s.slice(1).replace(/\//g, '\\') : s;
}
// The display twin: ~/.local/bin/hermes reads better than /Users/you/.local/...
// Windows ends the home folder at either separator and does not care how it was
// capitalised: `where` answers c:\users\you as readily as C:\Users\You.
function shortHome(p, home, platform = process.platform) {
  const s = String(p || '');
  if (platform !== 'win32') return home && s.startsWith(home + '/') ? '~' + s.slice(home.length) : s;
  const h = String(home || '').replace(/[\\/]+$/, '');
  const same = (a) => a.replace(/\//g, '\\').toLowerCase();
  const under = h && same(s.slice(0, h.length)) === same(h) && /^[\\/]/.test(s.slice(h.length));
  return under ? '~' + s.slice(h.length) : s;
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

async function agentStatus(id, { exec = shellRun, readFile = readIfPresent, home = os.homedir(), envKeys = {}, env = process.env, settings = {}, platform = process.platform } = {}) {
  const blank = { id, signedIn: null, label: '', rows: [], source: '' };
  const agent = agentById(id);
  const lc = lifecycleFor(agent, platform);
  if (!lc) return blank;
  try {
    let payload;
    if (lc.statusCmd) {
      payload = { stdout: await exec(lc.statusCmd, { settings, env, purpose: 'agent', agentId: id }) };
    } else if (lc.statusFiles && lc.statusFiles.length) {
      const files = {};
      await Promise.all(lc.statusFiles.map(async (rel) => {
        const abs = lifecyclePath(rel, { home, env, platform });
        files[abs] = await readFile(abs);
      }));
      payload = { files };
    } else {
      return blank;
    }
    if (id === 'grok') {
      const allowed = buildChildEnv({ parentEnv: env, settings: { ...settings, envKeys: { ...settings.envKeys, ...envKeys } }, purpose: 'agent', agentId: id });
      payload.hasApiKey = grokApiKeyPresent({}, allowed);
    }
    return { id, source: lc.source || '', ...parseAgentStatus(id, payload) };
  } catch (_) {
    return blank;
  }
}

module.exports = { KNOWN_AGENTS, POINTER_FILE, contextFilesFor, detectAgents, installCommand, lifecycleFor, lifecyclePath, switchAccountCommand, agentStatus, agentById, expandHome, pathFromShellOutput, findOnDisk };

// The selected ID comes from launch metadata. Validate its command against
// main's registry before granting credentials; never infer identity from text.
function agentRunCommandAllowed({ agentId, command, args } = {}, platform = process.platform) {
  const agent = agentById(agentId);
  if (!agent || typeof command !== 'string') return false;
  const lc = lifecycleFor(agent, platform) || {};
  const commands = [agent.bin, lc.login, lc.logout, lc.health, lc.setup, lc.switchCmd, lc.uninstall];
  // The logout-then-login pair, spelled for this platform's shell and no other:
  // it must be the very string the sheet was handed (see switchAccountCommand).
  if (lc.logout && lc.login) commands.push(logoutThenLogin(lc, platform));
  if (commands.some((candidate) => typeof candidate === 'string' && command === candidate)) return true;
  if (!['opencode', 'antigravity'].includes(agentId) || !Array.isArray(args)
    || args.length !== 2 || args[0] !== '--agent' || typeof args[1] !== 'string' || args[1].includes('\0')) return false;
  // Match the renderer's always-quoted argv serialization exactly.
  const quoted = args.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'");
  return command === agent.bin + ' ' + quoted.join(' ');
}
module.exports.agentRunCommandAllowed = agentRunCommandAllowed;
