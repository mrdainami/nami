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
// Pure and process-local: no I/O, no electron, no persistence across launches.

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

module.exports = { rememberBins, knownBin, forgetBins, resolveRunCommand };
