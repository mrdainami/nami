// What an install will take on this machine, asked before it runs.
//
// One answer for the two installs Nami starts on the user's behalf — a
// connector built from its repo, and an agent's own install command: the line
// to run in this shell (shell-chain.js), where it lands and whether it is built
// already, and anything it needs that is not here yet (prereqs.js).
//
// The renderer asks because it cannot know: it has no home folder, no shell and
// no PATH. It used to guess all three with `~` and `&&`.
//
// Everything that touches the machine is handed in, so both platforms are
// tested from one: exists(path), findBin(bin) -> path or '', and refresh(),
// which drops the remembered PATH so the next findBin reads it again.

const { serviceById } = require('./services-catalog');
const { agentById, installCommand } = require('./agents-detect');
const { connectorInstall } = require('./shell-chain');
const { needsOf, missingPrereqs } = require('./prereqs');

async function installPlan({ connectorId, agentId, platform = process.platform, home = '', shell, exists = () => false, findBin = async () => '', refresh } = {}) {
  let plan = null, steps;
  if (connectorId) {
    const s = serviceById(connectorId);
    plan = s && s.kind === 'install' ? connectorInstall({ repo: s.repo || s.docs, home, platform, shell }) : null;
    if (!plan) return { ok: false };
    steps = plan.steps;
  } else {
    const a = agentById(agentId);
    if (!a) return { ok: false };
    steps = [installCommand(a, platform)];
  }
  // A Mac is not asked at all: it says nothing about prerequisites today, and
  // a question nobody will hear the answer to is not worth a disk walk.
  const needs = platform === 'win32' ? needsOf(steps) : [];
  const look = async () => {
    const found = {};
    for (const bin of needs) { try { found[bin] = await findBin(bin); } catch (_) { found[bin] = ''; } }
    return missingPrereqs({ needs, found, platform });
  };
  let prereq = needs.length ? await look() : null;
  // Missing on the PATH Nami remembered is not the same as missing: the usual
  // reason to be asked twice is that the user just ran the winget line. So
  // before saying it again, the PATH is read again.
  if (prereq && refresh) { refresh(); prereq = await look(); }
  const out = { ok: true, prereq };
  if (plan) Object.assign(out, { command: plan.command, dir: plan.dir, built: !!exists(plan.entry.replace(/^~/, home)) });
  return out;
}

module.exports = { installPlan };
