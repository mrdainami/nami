// Everything Nami runs or reads on behalf of an agent CLI, asked about as
// Windows. The registry was written on a Mac, so each entry is a zsh line and a
// `~/` path until something says otherwise; these tests are that something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  KNOWN_AGENTS, installCommand, lifecycleFor, lifecyclePath, switchAccountCommand,
  agentRunCommandAllowed, detectAgents, agentStatus,
} = require('../src/main/agents-detect.js');
const { planRemoval } = require('../src/main/agent-remove.js');

const WIN = 'win32', MAC = 'darwin';
const HOME = 'C:\\Users\\dev';
const ENV = { USERPROFILE: HOME, APPDATA: HOME + '\\AppData\\Roaming', LOCALAPPDATA: HOME + '\\AppData\\Local' };

// Every command string the app can hand a shell for one agent on one platform:
// the install, each lifecycle button, the switch-account pair, and whatever a
// removal plan would run.
function commandsFor(agent, platform) {
  const lc = lifecycleFor(agent, platform) || {};
  const plan = planRemoval({ id: agent.id, binPath: '', home: HOME, platform, env: ENV });
  return [
    ['install', installCommand(agent, platform)],
    ['status', lc.statusCmd], ['login', lc.login], ['logout', lc.logout], ['health', lc.health],
    ['setup', lc.setup], ['switchCmd', lc.switchCmd], ['uninstall', lc.uninstall],
    ['switch account', switchAccountCommand(agent, platform)],
    ['removal', plan.command],
  ].filter(([, cmd]) => cmd);
}

// The pane shell on Windows is Windows PowerShell 5.1. `&&` and `||` are syntax
// errors there and stop the whole line before any of it runs; there is no bash
// and no curl that means curl (it is an alias for Invoke-WebRequest, with other
// arguments); and nothing expands a `~/` handed to a program.
test('windows: no command Nami runs is a zsh line', () => {
  let walked = 0;
  for (const agent of KNOWN_AGENTS) {
    for (const [what, cmd] of commandsFor(agent, WIN)) {
      walked++;
      const where = `${agent.id} ${what}: ${cmd}`;
      assert.equal(typeof cmd, 'string', where);
      assert.ok(!cmd.includes('&&'), `&& in ${where}`);
      assert.ok(!cmd.includes('||'), `|| in ${where}`);
      assert.ok(!/\bbash\b/.test(cmd), `bash in ${where}`);
      assert.ok(!/\bcurl /.test(cmd), `curl in ${where}`);
      assert.ok(!cmd.includes('~/'), `a ~/ path in ${where}`);
    }
  }
  // Seven agents, and every one has at least an install: a walk that found
  // nothing to check would pass for the wrong reason.
  assert.ok(walked >= 25, `only ${walked} commands were checked`);
  for (const agent of KNOWN_AGENTS) assert.ok(commandsFor(agent, WIN).length >= 1, agent.id);
});

test('windows: every command the sheet can send is one main will give the keys to', () => {
  for (const agent of KNOWN_AGENTS) {
    const lc = lifecycleFor(agent, WIN) || {};
    const sent = [lc.login, lc.logout, lc.health, lc.setup, lc.uninstall, switchAccountCommand(agent, WIN)].filter(Boolean);
    for (const command of sent) {
      assert.equal(agentRunCommandAllowed({ agentId: agent.id, command }, WIN), true, `${agent.id}: ${command}`);
    }
  }
});

test('switch account is sign out, then sign in only if that worked — in the words of the shell that runs it', () => {
  const claude = KNOWN_AGENTS.find((a) => a.id === 'claude');
  assert.equal(switchAccountCommand(claude, MAC), 'claude auth logout && claude auth login');
  assert.equal(switchAccountCommand(claude, WIN), 'claude auth logout; if ($?) { claude auth login }');
  const opencode = KNOWN_AGENTS.find((a) => a.id === 'opencode');
  assert.equal(switchAccountCommand(opencode, MAC), 'opencode auth logout && opencode auth login');
  assert.equal(switchAccountCommand(opencode, WIN), 'opencode auth logout; if ($?) { opencode auth login }');
});

test('an agent with its own switch command keeps it, and one that cannot sign out has none', () => {
  const hermes = KNOWN_AGENTS.find((a) => a.id === 'hermes');
  for (const platform of [MAC, WIN]) assert.equal(switchAccountCommand(hermes, platform), 'hermes auth');
  const kimi = KNOWN_AGENTS.find((a) => a.id === 'kimi');
  for (const platform of [MAC, WIN]) assert.equal(switchAccountCommand(kimi, platform), '');
  assert.equal(switchAccountCommand(null, WIN), '');
});

// The credentials follow the allowed list, so each platform allows its own
// spelling and not the other's. The Mac line is the one that has always run.
test('main allows the switch line of the platform it is on, and only that one', () => {
  const mac = 'claude auth logout && claude auth login';
  const win = 'claude auth logout; if ($?) { claude auth login }';
  assert.equal(agentRunCommandAllowed({ agentId: 'claude', command: mac }, MAC), true);
  assert.equal(agentRunCommandAllowed({ agentId: 'claude', command: win }, WIN), true);
  assert.equal(agentRunCommandAllowed({ agentId: 'claude', command: win }, MAC), false);
  assert.equal(agentRunCommandAllowed({ agentId: 'claude', command: mac }, WIN), false);
  assert.equal(agentRunCommandAllowed({ agentId: 'claude', command: 'claude auth logout; if ($?) { calc }' }, WIN), false);
});

test('the renderer is handed the switch line for this machine, ready to run', async () => {
  const on = async (platform) => Object.fromEntries((await detectAgents({ exec: async () => '', home: HOME, platform })).map((a) => [a.id, a]));
  const w = await on(WIN), m = await on(MAC);
  assert.equal(w.claude.switchAccount, 'claude auth logout; if ($?) { claude auth login }');
  assert.equal(m.claude.switchAccount, 'claude auth logout && claude auth login');
  assert.equal(w.hermes.switchAccount, 'hermes auth');
  assert.equal(w.codex.switchAccount, '');
});

// ---- where each tool keeps its files ---------------------------------------
// Checked against each vendor's Windows installer and source, 2026-09-20.
// Six of the seven use the same folder under the user's profile as they do
// under $HOME — opencode included, whose xdg-basedir is not platform-aware and
// lands in %USERPROFILE%\.local\share. Hermes is the exception: its installer
// sets HERMES_HOME to %LOCALAPPDATA%\hermes and everything lives there.
test('windows: sign-in files resolve to real Windows paths', () => {
  const files = (id) => (lifecycleFor(KNOWN_AGENTS.find((a) => a.id === id), WIN).statusFiles || [])
    .map((p) => lifecyclePath(p, { home: HOME, env: ENV, platform: WIN }));
  assert.deepEqual(files('codex'), ['C:\\Users\\dev\\.codex\\auth.json']);
  assert.deepEqual(files('opencode'), ['C:\\Users\\dev\\.local\\share\\opencode\\auth.json']);
  assert.deepEqual(files('grok'), ['C:\\Users\\dev\\.grok\\auth.json']);
  assert.deepEqual(files('kimi'), ['C:\\Users\\dev\\.kimi-code\\config.toml']);
  assert.deepEqual(files('antigravity'), ['C:\\Users\\dev\\.gemini\\oauth_creds.json', 'C:\\Users\\dev\\.gemini\\google_accounts.json']);
  assert.deepEqual(files('hermes'), ['C:\\Users\\dev\\AppData\\Local\\hermes\\auth.json', 'C:\\Users\\dev\\AppData\\Local\\hermes\\config.yaml']);
});

test('windows: a settings file opens from where the tool really keeps it', async () => {
  const agents = await detectAgents({ exec: async () => '', home: HOME, env: ENV, platform: WIN });
  const file = Object.fromEntries(agents.map((a) => [a.id, a.configFile]));
  assert.equal(file.claude, 'C:\\Users\\dev\\.claude.json');
  assert.equal(file.codex, 'C:\\Users\\dev\\.codex\\config.toml');
  assert.equal(file.opencode, 'C:\\Users\\dev\\.config\\opencode\\opencode.json');
  assert.equal(file.hermes, 'C:\\Users\\dev\\AppData\\Local\\hermes\\config.yaml');
  for (const a of agents) assert.ok(!/[/~]/.test(a.configFile), `${a.id}: ${a.configFile}`);
});

test('windows: %LOCALAPPDATA% falls back to its usual place when the variable is missing', () => {
  assert.equal(lifecyclePath('%LOCALAPPDATA%\\hermes\\auth.json', { home: HOME, env: {}, platform: WIN }), 'C:\\Users\\dev\\AppData\\Local\\hermes\\auth.json');
  assert.equal(lifecyclePath('%APPDATA%\\npm', { home: HOME, env: {}, platform: WIN }), 'C:\\Users\\dev\\AppData\\Roaming\\npm');
  // A folder moved off C: is believed over the guess.
  assert.equal(lifecyclePath('%LOCALAPPDATA%\\hermes', { home: HOME, env: { LOCALAPPDATA: 'D:\\Local' }, platform: WIN }), 'D:\\Local\\hermes');
});

test('windows: the status read asks for the Windows files', async () => {
  const asked = [];
  await agentStatus('hermes', { readFile: async (p) => { asked.push(p); return null; }, home: HOME, env: ENV, platform: WIN });
  assert.deepEqual(asked.sort(), ['C:\\Users\\dev\\AppData\\Local\\hermes\\auth.json', 'C:\\Users\\dev\\AppData\\Local\\hermes\\config.yaml']);
});

// The Mac column, pinned: a Windows twin must never leak into it.
test('mac: lifecycle, paths and the status read are what they have always been', async () => {
  for (const a of KNOWN_AGENTS) assert.equal(lifecycleFor(a, MAC), a.lifecycle, a.id);
  assert.equal(lifecyclePath('~/.hermes/auth.json', { home: '/Users/dev', env: {}, platform: MAC }), '/Users/dev/.hermes/auth.json');
  const asked = [];
  await agentStatus('hermes', { readFile: async (p) => { asked.push(p); return null; }, home: '/Users/dev', platform: MAC });
  assert.deepEqual(asked.sort(), ['/Users/dev/.hermes/auth.json', '/Users/dev/.hermes/config.yaml']);
  const agents = await detectAgents({ exec: async () => '', home: '/Users/dev', platform: MAC });
  assert.equal(agents.find((a) => a.id === 'hermes').configFile, '/Users/dev/.hermes/config.yaml');
  assert.equal(agents.find((a) => a.id === 'hermes').lifecycle.source, 'reads ~/.hermes');
});

test('windows: a twin replaces its field and is not itself handed on', () => {
  const lc = lifecycleFor(KNOWN_AGENTS.find((a) => a.id === 'hermes'), WIN);
  assert.equal(lc.source, 'reads %LOCALAPPDATA%\\hermes');
  assert.equal(lc.login, 'hermes login');   // no twin, so the one command
  assert.ok(!Object.keys(lc).some((k) => k.endsWith('Win')), 'a ...Win key reached the renderer');
  assert.equal(lifecycleFor({ id: 'x' }, WIN), null);
});

// The sheet used to join the pair itself, with `&&`. It must run the line main
// built instead, or Windows is back to a syntax error with the keys attached.
test('the agent sheet runs the switch line it was handed, and joins nothing itself', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
  const line = app.split('\n').find((l) => l.includes("on('ag-switch'"));
  assert.ok(line, 'no ag-switch handler in app.js');
  assert.ok(line.includes('a.switchAccount'), line.trim());
  assert.ok(!line.includes('&&'), line.trim());
});
