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

const KNOWN_AGENTS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', kind: 'claude',
    sub: 'your subscription · slash commands work',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://docs.anthropic.com/en/docs/claude-code',
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
    lifecycle: {
      statusFiles: ['~/.local/share/opencode/auth.json'],
      source: 'reads its auth file',
      login: 'opencode auth login',
      logout: 'opencode auth logout',
      configPath: '~/.config/opencode/opencode.json',
      removePaths: ['~/.local/share/opencode/auth.json'],
    } },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', kind: 'run',
    sub: "Google's coding agent",
    install: 'npm install -g @google/gemini-cli',
    docs: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'hermes', name: 'Hermes', bin: 'hermes', kind: 'run',
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
    docs: 'https://moonshotai.github.io/kimi-code/en/' },
];

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

async function agentStatus(id, { exec = shellRun, readFile = readIfPresent, home = os.homedir() } = {}) {
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
    return { id, source: lc.source || '', ...parseAgentStatus(id, payload) };
  } catch (_) {
    return blank;
  }
}

module.exports = { KNOWN_AGENTS, detectAgents, agentStatus, agentById, expandHome, pathFromShellOutput, findOnDisk };
