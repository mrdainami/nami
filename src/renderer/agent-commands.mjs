// The card composer's slash commands, for every agent — and where each one
// actually runs. One rule made this file exist: every `/` keystroke gets
// feedback. A menu, a native control, or an honest "that one lives in the
// terminal" — never silence, and never keystrokes typed into a hidden pty.
//
// Two sources, merged in commandsFor():
//   protocol   what the channel itself published (claude's supportedCommands,
//              ACP's available_commands_update). Executable as text — the
//              channel runs them server-side — so they route 'send'.
//   static     the one-shot channels (codex exec, kimi -p, agy -p) publish
//              nothing; their TUI owns the slash commands. These curated
//              tables keep the menu alive there, each entry carrying the
//              route it honestly has.
//
// Routes:
//   'send'          goes to the channel as an ordinary turn
//   'native-model'  opens the card's own model picker
//   'native-mode'   opens the card's own mode control
//   'terminal'      TUI-only: the card says so and offers a terminal

// Overrides applied to protocol-published commands: a name the card has its
// own control for is intercepted rather than sent as prose — the SDK would
// accept "/model" as text, but the interactive picker is the point, and
// /resume /clear are conversation ops the card performs itself (swap or
// mint the session id) so every agent behaves the same way.
const NATIVE_BY_NAME = {
  model: 'native-model',
  mode: 'native-mode',
  approvals: 'native-mode', // codex vocabulary; elsewhere it opens the same mode picker
  resume: 'native-resume',
  clear: 'native-clear',
  new: 'native-clear',
};

export const STATIC_COMMANDS = {
  // codex exec is headless, but a setting that is a spawn flag is still
  // switchable: /model rides the next turn's --model. Only what genuinely
  // needs the TUI routes to the terminal.
  codex: [
    { name: 'model', description: 'set the model — applies from the next turn', argumentHint: 'model', route: 'native-model' },
    { name: 'approvals', description: 'sandbox & approval mode for the next turn', route: 'native-mode' },
    { name: 'resume', description: 'pick a past conversation to continue', route: 'native-resume' },
    { name: 'new', description: 'start a fresh conversation', route: 'native-clear' },
    { name: 'review', description: 'review the current changes', route: 'terminal' },
    { name: 'compact', description: 'summarise the conversation to save context', route: 'terminal' },
    { name: 'mcp', description: 'list MCP servers', route: 'terminal' },
  ],
  kimi: [
    { name: 'model', description: 'set the model — applies from the next turn', argumentHint: 'model', route: 'native-model' },
    { name: 'resume', description: 'pick a past conversation to continue', route: 'native-resume' },
    { name: 'clear', description: 'start a fresh conversation', route: 'native-clear' },
    { name: 'compact', description: 'compact the context', route: 'terminal' },
    { name: 'init', description: 'generate AGENTS.md for this project', route: 'terminal' },
    { name: 'mcp', description: 'manage MCP servers', route: 'terminal' },
  ],
  agy: [
    // model and mode ride the adapter's own flags on the next turn
    { name: 'model', description: 'set the model — applies from the next turn', argumentHint: 'model', route: 'native-model' },
    { name: 'mode', description: 'switch permission mode', route: 'native-mode' },
    { name: 'resume', description: 'pick a past conversation to continue', route: 'native-resume' },
    { name: 'clear', description: 'start a fresh conversation', route: 'native-clear' },
    { name: 'memory', description: 'manage saved memory', route: 'terminal' },
    { name: 'stats', description: 'session stats', route: 'terminal' },
    { name: 'tools', description: 'list available tools', route: 'terminal' },
    { name: 'mcp', description: 'list MCP servers', route: 'terminal' },
  ],
  // claude and the ACP agents publish their real lists over the channel; the
  // static entries below only keep the menu alive in WATCH mode, where no
  // adapter runs and nothing was published yet.
  claude: [
    { name: 'model', description: 'pick the model', route: 'native-model' },
    { name: 'mode', description: 'switch permission mode', route: 'native-mode' },
    { name: 'resume', description: 'pick a past conversation to continue', route: 'native-resume' },
    { name: 'clear', description: 'start a fresh conversation', route: 'native-clear' },
    { name: 'compact', description: 'compact the conversation', route: 'send' },
    { name: 'review', description: 'review the current changes', route: 'send' },
    { name: 'mcp', description: 'manage MCP servers', route: 'terminal' },
  ],
  // the ACP pair publish their real lists once connected; these keep the
  // menu alive before that, and in watch mode — a `/` must never show nothing
  opencode: [
    { name: 'model', description: 'pick the model', route: 'native-model' },
    { name: 'resume', description: 'pick a past conversation to continue', route: 'native-resume' },
    { name: 'clear', description: 'start a fresh conversation', route: 'native-clear' },
  ],
  hermes: [
    { name: 'model', description: 'pick the model', route: 'native-model' },
    { name: 'resume', description: 'pick a past conversation to continue', route: 'native-resume' },
    { name: 'clear', description: 'start a fresh conversation', route: 'native-clear' },
  ],
};

function norm(c) {
  if (typeof c === 'string') return { name: c, description: '', argumentHint: '' };
  return {
    name: String(c.name || ''),
    description: String(c.description || ''),
    argumentHint: String(c.argumentHint || c.hint || ''),
    route: c.route,
  };
}

// The menu's source of truth: the channel's own list when it has one, the
// static table otherwise — every entry leaves here with a route. The card's
// native entries (model, resume, clear…) are appended even when the channel
// didn't publish them: they run in the card, so the channel doesn't get a
// vote — claude's SDK list has no 'resume', and the menu must still offer it.
export function commandsFor(agent, protocolCommands) {
  const a = String(agent || '');
  const statics = (STATIC_COMMANDS[a] || []).map((c) => ({ ...c, route: c.route || 'send' }));
  const published = (protocolCommands || []).map(norm).filter((c) => c.name);
  if (!published.length) return statics;
  const out = published.map((c) => ({ ...c, route: c.route || NATIVE_BY_NAME[c.name] || 'send' }));
  const have = new Set(out.map((c) => c.name.toLowerCase()));
  for (const s of statics) {
    if (s.route && s.route.startsWith('native') && !have.has(s.name.toLowerCase())) out.push(s);
  }
  return out;
}

// What the composer does with a typed command. `null` means it is not a
// slash command at all — send the text as an ordinary turn. `arg` is
// whatever followed the name ('/model gpt-5.2-codex' → 'gpt-5.2-codex'),
// because on the one-shot channels the argument IS the control.
export function routeCommand(agent, protocolCommands, text) {
  const t = String(text || '');
  if (!t.startsWith('/')) return null;
  const name = t.slice(1).split(/\s/)[0].toLowerCase();
  if (!name) return null;
  const arg = t.slice(1 + name.length).trim();
  const cmd = commandsFor(agent, protocolCommands).find((c) => c.name.toLowerCase() === name);
  // A name the card owns natively is intercepted even when nothing published
  // it — sending '/resume' to a channel that never claimed it just earns
  // "isn't available in this environment." Anything else genuinely unknown
  // still passes through: the channel may know it (custom skills do).
  if (!cmd) return { name, route: NATIVE_BY_NAME[name] || 'send', arg };
  return { name: cmd.name, route: cmd.route, arg };
}
