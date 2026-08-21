// Where each agent's program actually lives, according to the last scan.
//
// Nami answers "is this agent installed" properly in exactly one place:
// agents-detect asks the user's interactive login shell (`command -v claude`)
// and, if that comes back empty, walks the documented install folders. That
// answer knows about nvm, volta, asdf, mise, bun and any PATH line the user
// wrote themselves.
//
// Nothing else could read it. The SDK adapter re-derived the location from a
// hardcoded list of five paths, so a claude installed through a version manager
// was "ready" in the launcher and "isn't installed on this Mac yet" one click
// later in the card view. The one-shot adapters spawned a bare name against the
// login PATH captured once at app start, so an agent installed *inside* Nami
// stayed unspawnable until the app was restarted.
//
// So the scan writes here, and everything that spawns reads here. Deliberately
// a memo and not a source of truth: it holds only what a real scan reported,
// every reader falls back to what it did before, and a scan that stops finding
// an agent clears it rather than leaving a path that would ENOENT forever.
//
// The memo itself is process-local and has no I/O. resolveClaudeExecutable
// is the one reader that stats the disk, so Term spawn and the (retired)
// card adapter ask the same question.

const fs = require('fs');
const os = require('os');
const { claudeCandidates } = require('./platform.js');

const bins = new Map();

// Take a whole detectAgents() result. Anything that is not a list is ignored
// rather than treated as "nothing is installed" — a failed scan must not wipe
// what a good scan found a moment ago.
//
// Filed under the registry id AND the program name, because the two halves of
// the app know an agent by different names: the registry calls Google's agent
// `antigravity`, its adapter and every tile command call it `agy`. Indexing one
// of them would make the other silently miss and fall back to the bare name —
// the exact failure this module exists to remove.
function rememberBins(list) {
  if (!Array.isArray(list)) return;
  for (const a of list) {
    if (!a || !a.id) continue;
    const p = a.found && typeof a.path === 'string' ? a.path.trim() : '';
    bins.set(String(a.id), p);
    if (a.bin) bins.set(String(a.bin), p);
  }
}

// Always a string, so callers can write `knownBin(id) || 'agy'` and get the old
// bare-name behaviour whenever the scan has not run or came back empty.
function knownBin(id) {
  if (!id) return '';
  return bins.get(String(id)) || '';
}

function forgetBins() { bins.clear(); }

// Find the user's logged-in claude binary so a terminal tile runs on their
// subscription, not an API key. No fallback on purpose: packaged builds drop
// the SDK's own 265 MB copy of Claude Code (see electron-builder.yml).
//
// The scan goes first. A claude installed through nvm, volta, asdf, mise or
// bun used to read as "ready" in the launcher and missing at spawn, because
// spawn walked a hardcoded list of five paths. The list stays as the floor:
// it answers before the first scan lands, and on a machine where the shell
// probe fails entirely.
function resolveClaudeExecutable({ home = os.homedir(), env = process.env, exists, detected } = {}) {
  const there = exists || ((p) => fs.existsSync(p));
  const scanned = detected === undefined ? knownBin('claude') : detected;
  const candidates = [
    env.CLAUDE_CODE_EXECUTABLE,
    scanned,
    ...claudeCandidates({ home, env }),
  ];
  for (const c of candidates) {
    try { if (c && there(c)) return c; } catch (_) {}
  }
  return null;
}

// A run tile types its command into the user's *interactive* shell, and that
// shell's PATH is not the scan's: an nvm/npm-prefix conflict in .zshrc makes
// nvm bail before it adds the npm-global dir, so bare `codex` reads as
// command-not-found in a tile while the launcher says ready. When the scan
// already knows where the binary lives, the command is typed by that
// absolute path instead. Anything the scan doesn't know passes untouched.
function resolveRunCommand(command) {
  const s = String(command || '');
  const m = /^([A-Za-z][\w.-]*)(\s[\s\S]*)?$/.exec(s);
  if (!m) return s;
  const found = knownBin(m[1]);
  if (!found || found === m[1]) return s;
  const head = /[^\w@%+=:,./-]/.test(found) ? `'${found.replace(/'/g, `'\\''`)}'` : found;
  return head + (m[2] || '');
}

// ---- spawn flags -----------------------------------------------------------
// Flags Nami always adds when it spawns a given agent, as opposed to anything
// the user or the resume path asked for.
//
// grok is the only entry and --minimal is the reason the table exists: without
// it grok paints a full-screen TUI over the Nami theme instead of printing
// into the tile's own scrollback the way claude does. It is session-scoped,
// so nothing is written to the user's ~/.grok/config.toml.
//
// Why here and not on the panel: two identity checks — agentForCommand
// (agent-resume.js) and cardAgentFor (app.js) — match a tile's `command`
// against BARE binary names, and they gate resume, session discovery and the
// Term/Cards switch. Relaxing them to compare only the first word looks free
// and is not: moveToSurface already assigns resume lines as commands
// (`codex resume <id>`, `opencode -s <id>`, `hermes --resume <id>`,
// `agy --conversation <id>`), so first-word matching would start matching all
// four where it does not today. Keeping `command` exactly 'grok' and adding
// the flag here, at the moment of spawn, leaves every one of those untouched.
//
// --minimal is marked Experimental in `grok --help` (1.0.5). If a release
// drops it grok falls back to its full-screen TUI: uglier against the theme,
// never broken.
const SPAWN_FLAGS = { grok: ['--minimal'] };

// Applied to the BARE command, before resolveRunCommand swaps in a scanned
// absolute path — at this point the head is still the binary's name, which is
// what the table is keyed by. Flags land ahead of the agent's own arguments so
// a resume line stays minimal too.
function withSpawnFlags(command) {
  const s = String(command || '');
  const m = /^([A-Za-z][\w.-]*)(\s[\s\S]*)?$/.exec(s);
  if (!m) return s;
  const flags = SPAWN_FLAGS[m[1]];
  if (!flags || !flags.length) return s;
  const tail = m[2] || '';
  const missing = flags.filter((fl) => !new RegExp(`(^|\\s)${fl}(\\s|$)`).test(tail));
  return missing.length ? m[1] + ' ' + missing.join(' ') + tail : s;
}

module.exports = { rememberBins, knownBin, forgetBins, resolveClaudeExecutable, resolveRunCommand, withSpawnFlags, SPAWN_FLAGS };
