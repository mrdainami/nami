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
const { agentById, expandHome } = require('./agents-detect.js');

function isSafeRemovePath(p, home) {
  if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return false;
  const norm = path.normalize(p).replace(/\/+$/, '');
  const base = path.normalize(home).replace(/\/+$/, '');
  if (norm === base) return false;
  return norm.startsWith(base + path.sep);
}

function planRemoval({ id, binPath, home }) {
  const agent = agentById(id);
  const lc = agent && agent.lifecycle;
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

  const paths = [binPath, ...(lc.removePaths || []).map((p) => expandHome(p, home))];
  for (const p of paths) {
    if (!isSafeRemovePath(p, home)) {
      return { mode: 'none', reason: `${agent.name} lives at ${p}, outside your home folder — remove it the way you installed it.` };
    }
  }
  const describe = paths.map((p) => p.replace(home, '~'));
  if (lc.configPath) describe.push(`your settings at ${lc.configPath} stay, along with anything you wrote — skills, agents, history`);
  return { mode: 'delete', paths, describe };
}

async function removeAgent({ id, binPath, home, rm = (p) => fsp.rm(p, { recursive: true, force: true }) }) {
  const plan = planRemoval({ id, binPath, home });
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
