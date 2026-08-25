// Capability probe — points the shared client at each agent's ACP mode and
// records what actually works on this machine. Output: a row per agent.
// Usage: node tools/acp-probe.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAcpClient } from '../src/renderer/acp-client.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CWD = path.join(ROOT, 'demo-assets');

const AGENTS = [
  { id: 'claude', cmd: path.join(ROOT, 'acp-tools/node_modules/.bin/claude-agent-acp'), args: [] },
  { id: 'kimi', cmd: 'kimi', args: ['acp'] },
  { id: 'codex', cmd: 'npx', args: ['-y', '@zed-industries/codex-acp'] },
  { id: 'opencode', cmd: 'opencode', args: ['acp'] },
  { id: 'grok', cmd: 'grok', args: ['agent', 'stdio'] },
  { id: 'hermes', cmd: 'hermes', args: ['acp'] },
];

function transportFor(cmd, args) {
  const proc = spawn(cmd, args, { cwd: CWD, env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:' + process.env.PATH } });
  let buf = '';
  const cbs = { m: [], e: [], x: [] };
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!l.trim()) continue;
      try { const j = JSON.parse(l); cbs.m.forEach((c) => c(j)); } catch (_) {}
    }
  });
  proc.stderr.on('data', (d) => cbs.e.forEach((c) => c(d.toString())));
  proc.on('exit', (c) => cbs.x.forEach((f) => f(c)));
  proc.on('error', (err) => cbs.e.forEach((c) => c('SPAWN: ' + err.message)));
  return {
    send: (o) => { try { proc.stdin.write(JSON.stringify(o) + '\n'); } catch (_) {} },
    onMessage: (c) => cbs.m.push(c),
    onError: (c) => cbs.e.push(c),
    onExit: (c) => cbs.x.push(c),
    kill: () => { try { proc.kill(); } catch (_) {} },
  };
}

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

async function probe(a) {
  const row = { id: a.id, spawn: false, init: false, session: false, modes: 0, config: [], commands: 0, prompt: false, err: '' };
  const t = transportFor(a.cmd, a.args);
  let stderrTail = '';
  let commands = 0;
  const client = createAcpClient(t, {
    onUpdate: (u) => { if (u.sessionUpdate === 'available_commands_update') commands = (u.availableCommands || []).length; },
    onPermission: (p, reply) => reply(((p.options || []).find((o) => o.kind === 'allow_once') || (p.options || [])[0] || {}).optionId),
    onStderr: (x) => { stderrTail = (stderrTail + x).slice(-200); },
  });
  try {
    row.spawn = true;
    const { init, session } = await Promise.race([client.connect(CWD), timeout(30000)]);
    row.init = true; row.session = true;
    row.modes = session.modes && session.modes.availableModes ? session.modes.availableModes.length : 0;
    row.config = (session.configOptions || []).map((c) => c.id);
    const r = await Promise.race([client.prompt('Reply with exactly: OK'), timeout(60000)]);
    row.prompt = !!(r && r.stopReason);
    row.commands = commands;
  } catch (err) {
    row.err = ((err && err.message) || '') + (stderrTail ? ' · ' + stderrTail.replace(/\n/g, ' ').slice(-120) : '');
  }
  client.kill();
  return row;
}

for (const a of AGENTS) {
  const row = await probe(a);
  console.log(JSON.stringify(row));
}
process.exit(0);
