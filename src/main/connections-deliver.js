// The dumb half of delivery: runs a deliveryPlan. Every decision — which file,
// which dialect, which command — was made in connections.js where it is tested;
// this file only merges JSON, writes the codex block, and spawns CLIs.
// A failed step never fails the delivery: the result rows carry what happened,
// and the coverage pills tell the user the truth afterwards.

const { upsertMcpJson, upsertOpencode } = require('./mcp-config');
const { writeCodexBlock, fsIo } = require('./connections');

// execCmd(argv) -> Promise<{ok, error?}> — injected so tests never spawn.
async function runPlan({ plan, io = fsIo, execCmd }) {
  const results = [];
  for (const step of plan) {
    try {
      if (step.kind === 'json') {
        for (const id of Object.keys(step.entries)) {
          if (step.section === 'mcp') upsertOpencode({ file: step.file, id, entry: step.entries[id], io });
          else upsertMcpJson({ file: step.file, id, entry: step.entries[id], io });
        }
        results.push({ agent: step.agent, ok: true, wrote: step.file });
      } else if (step.kind === 'block') {
        const res = writeCodexBlock({ file: step.file, masters: step.masters, io });
        results.push({ agent: step.agent, ok: res.ok, wrote: res.ok ? step.file : undefined, error: res.error, skipped: res.skipped });
      } else if (step.kind === 'cli') {
        const res = await execCmd(step.argv);
        results.push({ agent: step.agent, ok: res.ok, via: 'cli', id: step.id, error: res.error });
      } else {
        results.push({ agent: step.agent, ok: false, manual: true, reason: step.reason });
      }
    } catch (e) {
      results.push({ agent: step.agent, ok: false, error: e.message });
    }
  }
  return results;
}

module.exports = { runPlan };
