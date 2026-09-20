// Use each CLI's interactive initial-message interface. These options keep
// startup questions and subsequent conversation under the CLI's control.
const { KNOWN_AGENTS, agentRunCommandAllowed } = require('./agents-detect');
const { reachesCmd } = require('./cmd-shim');
const { isPowerShell, psNativeArg, PS_NATIVE_HEAD } = require('./platform');

function seedAgentForLaunch({ kind, command, agentId, args, watchDone, oneShot } = {}) {
  if (watchDone || oneShot) return null;
  if (kind === 'claude') return 'claude';
  if (kind !== 'run') return null;
  const bare = KNOWN_AGENTS.find(a => a.bin === command);
  if (bare) return bare.id;
  // Library-agent launches have a quoted --agent argument. Lifecycle commands
  // also pass the credential check, but must never receive an initial message.
  if (['opencode', 'antigravity'].includes(agentId) && Array.isArray(args)
    && args.length === 2 && args[0] === '--agent'
    && agentRunCommandAllowed({ agentId, command, args })) return agentId;
  return null;
}

// `program` is what the agent found by the scan really is (real-program.js). On
// Windows an agent installed by npm is a .cmd shim, and an argument to one is
// read by cmd.exe as a command (cmd-shim.js): a first message is other people's
// text as often as not — a connector's description, an agent's name — so to a
// shim that could not be gone round it is not sent as an argument at all, and
// main falls back to what it does for an agent with no such option. A real
// .exe, node.exe in a shim's place, and every Mac get it exactly as before.
function initialPromptArgs(agentId, seed, { program = '', platform = process.platform } = {}) {
  if (reachesCmd(program, platform)) return [];
  return nativePromptArgs(agentId, seed);
}

// True when this agent would have been handed `seed` as an argument and was
// not, because it is a shim. Nothing else can carry it: typing a message in
// (seed-gate.js) needs to know what the agent's empty input box looks like, and
// that is known for Kimi and Hermes only. So main says so, and the renderer
// puts the message on the clipboard instead of letting it vanish.
function seedHeld(agentId, seed, { program = '', platform = process.platform } = {}) {
  return reachesCmd(program, platform) && nativePromptArgs(agentId, seed).length > 0;
}

function nativePromptArgs(agentId, seed) {
  if (typeof seed !== 'string' || !seed || seed.includes('\0')) return [];
  switch (agentId) {
    case 'claude': case 'codex': case 'grok': return ['--', seed];
    case 'opencode': return ['--prompt=' + seed];
    case 'antigravity': return ['--prompt-interactive=' + seed];
    // Their --prompt / --query options exit after one reply, so these agents
    // use the one-time terminal sender instead of being made non-interactive.
    default: return [];
  }
}

// A run tile's line with the message on the end of it. `quote` is the pane's
// own, and on a POSIX shell that is all there is to do. PowerShell delivers a
// single-quoted string to a program whole unless it has a quote in it or ends
// in a backslash; those two are written the way each PowerShell needs them,
// and the line opens by finding out which one it is (psNativeArg in
// platform.js has the measurements).
function withPromptArgs(line, promptArgs, { quote, shell = '' } = {}) {
  if (!promptArgs.length) return line;
  const awkward = (a) => isPowerShell(shell) && /"|\\$/.test(a);
  return (promptArgs.some(awkward) ? PS_NATIVE_HEAD : '') + line + ' ' + promptArgs.map((a) => (awkward(a) ? psNativeArg(a) : quote(a))).join(' ');
}

// Hermes's modern TUI accepts a startup query through this environment key;
// its classic REPL ignores it and uses the terminal sender. Do not force the
// user's interface with --tui or turn the conversation into a one-shot query.
function initialPromptEnv(env, agentId, seed) {
  const out = { ...env };
  // A first message belongs to this launch, never to a restored session or a
  // Nami instance opened from inside another Hermes conversation.
  delete out.HERMES_TUI_QUERY;
  if (agentId === 'hermes' && typeof seed === 'string' && seed && !seed.includes('\0')) out.HERMES_TUI_QUERY = seed;
  return out;
}

module.exports = { seedAgentForLaunch, initialPromptArgs, initialPromptEnv, seedHeld, withPromptArgs };
