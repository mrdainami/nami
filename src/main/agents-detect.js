// Which agent CLIs live on this Mac? Curated registry + detection.
// Detection runs `command -v` through the user's login shell so PATH additions
// from .zshrc/.zprofile count; exec is injectable for tests.
// Install commands and docs links verified against official sources 2026-08-08.
const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { parseAgentStatus } = require('./agent-status.js');

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

function shellWhich(bin) {
  return new Promise((resolve, reject) => {
    execFile('/bin/zsh', ['-lc', `command -v ${bin}`], { timeout: 8000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || '').trim());
    });
  });
}

async function detectAgents({ exec = shellWhich } = {}) {
  return Promise.all(KNOWN_AGENTS.map(async (a) => {
    let p = '';
    try { p = String((await exec(a.bin)) || '').trim(); } catch (_) { p = ''; }
    return { ...a, found: !!p, path: p };
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

function shellRun(cmd) {
  return new Promise((resolve, reject) => {
    execFile('/bin/zsh', ['-lc', cmd], { timeout: 8000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || ''));
    });
  });
}
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

module.exports = { KNOWN_AGENTS, detectAgents, agentStatus, agentById, expandHome };
