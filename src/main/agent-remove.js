// Taking an agent CLI off this Mac. The rules here exist because this is the
// only action in the feature that destroys something:
//
//   1. If the CLI ships its own uninstaller, use it. We are not better at
//      removing someone else's program than they are.
//   2. Otherwise delete the program and the agent's own auth file — never a
//      directory that can hold the user's own work. ~/.claude holds their
//      skills, agents and history; removing Claude Code must not touch it.
//   3. Every deleted path must be absolute and inside $HOME. A CLI installed
//      to /usr/local by a package manager is refused, not force-deleted.
//
// Rule 2 is why removePaths is enumerated per agent rather than derived:
// "under $HOME" alone would authorise destroying the user's work.

const fsp = require('node:fs/promises');
const path = require('node:path');
const { agentById, lifecycleFor, lifecyclePath } = require('./agents-detect.js');

// Windows changes the spelling and none of the rules. Every vendor's Windows
// installer puts its program inside the profile — %USERPROFILE%\.local\bin,
// .grok\bin, .kimi-code\bin, %LOCALAPPDATA%\agy\bin, %LOCALAPPDATA%\hermes,
// %APPDATA%\npm — so rule 3 needs no exception there, only the platform's own
// idea of what "inside" means: backslashes, a drive letter, and names that do
// not differ by case. Platform is a parameter, as in platform.js, so the
// Windows answers are tested from a Mac.
const libFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);

function isSafeRemovePath(p, home, platform = process.platform) {
  const lib = libFor(platform);
  const win = platform === 'win32';
  if (typeof p !== 'string' || !p || !lib.isAbsolute(p)) return false;
  if (typeof home !== 'string' || !home || !lib.isAbsolute(home)) return false;
  let norm = lib.normalize(p).replace(/[\\/]+$/, '');
  let base = lib.normalize(home).replace(/[\\/]+$/, '');
  // A home that is the top of a disk would make the whole disk "inside home".
  if (!base || (win && /^[a-zA-Z]:$/.test(base))) return false;
  // `\Users\dev` is absolute to Windows and still names no drive: it means
  // whichever one is current. Only a path that says where it is can be checked.
  if (win && !/^[a-zA-Z]:\\/.test(norm)) return false;
  if (win) { norm = norm.toLowerCase(); base = base.toLowerCase(); }
  if (norm === base) return false;
  return norm.startsWith(base + lib.sep);
}

// ~ for the home folder, for the confirm sheet. Windows compares the front of
// the path without regard to case, because the scan and os.homedir() do not
// always agree on it; what follows the ~ is shown as it really is.
function shortenHome(p, home, platform) {
  if (platform !== 'win32') return p.replace(home, '~');
  const base = path.win32.normalize(home).replace(/\\+$/, '');
  return p.toLowerCase().startsWith(base.toLowerCase() + '\\') ? '~' + p.slice(base.length) : p;
}

// npm writes three files for every command it installs on Windows: `codex` for
// sh, `codex.cmd` for cmd.exe and `codex.ps1` for PowerShell. The scan reports
// whichever it met first. Deleting that one alone leaves the other two on PATH,
// so the agent would still run, and still be found, after being "removed".
// Only inside npm's own folder — a .cmd anywhere else is somebody's single file.
function programFiles(binPath, { home, env, platform }) {
  if (platform !== 'win32') return [binPath];
  const bin = path.win32.normalize(binPath);
  const npmDir = lifecyclePath('%APPDATA%\\npm', { home, env, platform });
  if (path.win32.dirname(bin).toLowerCase() !== npmDir.toLowerCase()) return [bin];
  const stem = bin.replace(/\.(cmd|ps1)$/i, '');
  return [stem, stem + '.cmd', stem + '.ps1'];
}

function planRemoval({ id, binPath, home, platform = process.platform, env = process.env }) {
  const agent = agentById(id);
  const lc = lifecycleFor(agent, platform);
  if (!lc) return { mode: 'none', reason: 'Nami does not know how to remove this one.' };

  if (lc.uninstall) {
    return {
      mode: 'uninstall',
      command: lc.uninstall,
      // The sheet prefixes this with "This runs:", so don't repeat the verb.
      describe: [`${lc.uninstall} — the uninstaller ${agent.name} ships for exactly this`],
    };
  }

  if (!binPath) return { mode: 'none', reason: 'It is not installed.' };

  const where = { home, env, platform };
  const paths = [...programFiles(binPath, where), ...(lc.removePaths || []).map((p) => lifecyclePath(p, where))];
  for (const p of paths) {
    if (!isSafeRemovePath(p, home, platform)) {
      return { mode: 'none', reason: `${agent.name} lives at ${p}, outside your home folder — remove it the way you installed it.` };
    }
  }
  const describe = paths.map((p) => shortenHome(p, home, platform));
  const settings = platform === 'win32' && lc.configPath ? shortenHome(lifecyclePath(lc.configPath, where), home, platform) : lc.configPath;
  if (settings) describe.push(`your settings at ${settings} stay, along with anything you wrote — skills, agents, history`);
  return { mode: 'delete', paths, describe };
}

async function removeAgent({ id, binPath, home, platform = process.platform, env = process.env, rm = (p) => fsp.rm(p, { recursive: true, force: true }) }) {
  const plan = planRemoval({ id, binPath, home, platform, env });
  if (plan.mode === 'uninstall') return { ok: false, removed: [], error: `${id} has its own uninstall command — run it in a tile.` };
  if (plan.mode !== 'delete') return { ok: false, removed: [], error: plan.reason };
  const removed = [];
  try {
    for (const p of plan.paths) { await rm(p); removed.push(p); }
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, removed, error: e.message };
  }
}

module.exports = { planRemoval, isSafeRemovePath, removeAgent };
