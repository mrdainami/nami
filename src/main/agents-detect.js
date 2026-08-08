// Which agent CLIs live on this Mac? Curated registry + detection.
// Detection runs `command -v` through the user's login shell so PATH additions
// from .zshrc/.zprofile count; exec is injectable for tests.
// Install commands and docs links verified against official sources 2026-08-08.
const { execFile } = require('node:child_process');

const KNOWN_AGENTS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', kind: 'claude',
    sub: 'your subscription · slash commands work',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://docs.anthropic.com/en/docs/claude-code' },
  { id: 'codex', name: 'Codex', bin: 'codex', kind: 'run',
    sub: "OpenAI's coding agent",
    install: 'npm install -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli' },
  { id: 'opencode', name: 'OpenCode', bin: 'opencode', kind: 'run',
    sub: 'open-source agent · bring any model',
    install: 'curl -fsSL https://opencode.ai/install | bash',
    docs: 'https://opencode.ai/docs' },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', kind: 'run',
    sub: "Google's coding agent",
    install: 'npm install -g @google/gemini-cli',
    docs: 'https://github.com/google-gemini/gemini-cli' },
  { id: 'hermes', name: 'Hermes', bin: 'hermes', kind: 'run',
    sub: "Nous Research's agent, learns as it works",
    // chain the guided first-run wizard so the install tile walks the user all the way in
    install: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash && hermes setup --portal',
    docs: 'https://hermes-agent.nousresearch.com' },
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

module.exports = { KNOWN_AGENTS, detectAgents };
