// Fixture recorder — drives real agent adapters through scripted scenarios
// using the SAME client module the app uses, and writes every protocol
// message (both directions) to fixtures/<name>.json for renderer replay
// tests. Usage: node tools/acp-record.mjs [scenario|all] [--adapter cmd]

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAcpClient } from '../src/renderer/acp-client.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ADAPTER = process.argv.includes('--adapter')
  ? process.argv[process.argv.indexOf('--adapter') + 1]
  : path.join(ROOT, 'acp-tools/node_modules/.bin/claude-agent-acp');
const CWD = path.join(ROOT, 'demo-assets');
const OUT = path.join(ROOT, 'fixtures');
mkdirSync(OUT, { recursive: true });

function stdioTransport(cmd, args) {
  const proc = spawn(cmd, args || [], { cwd: CWD, env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:' + process.env.PATH } });
  let buf = '';
  const msgCbs = [], errCbs = [], exitCbs = [];
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try { const m = JSON.parse(line); msgCbs.forEach((cb) => cb(m)); } catch (_) {}
    }
  });
  proc.stderr.on('data', (d) => errCbs.forEach((cb) => cb(d.toString())));
  proc.on('exit', (code) => exitCbs.forEach((cb) => cb(code)));
  return {
    send: (o) => proc.stdin.write(JSON.stringify(o) + '\n'),
    onMessage: (cb) => msgCbs.push(cb),
    onError: (cb) => errCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb),
    kill: () => proc.kill(),
  };
}

async function record(name, run) {
  const tape = [];
  const t0 = Date.now();
  const raw = stdioTransport(ADAPTER);
  const origSend = raw.send;
  raw.send = (o) => { tape.push({ t: Date.now() - t0, dir: 'send', msg: o }); origSend(o); };
  let permAuto = 'first'; // scenarios can flip which option we auto-pick
  const client = createAcpClient(raw, {
    onRaw: (dir, msg) => { if (dir === 'recv') tape.push({ t: Date.now() - t0, dir: 'recv', msg }); },
    onUpdate: () => {},
    onPermission: (params, reply) => {
      const opts = params.options || [];
      const pick = permAuto === 'reject'
        ? opts.find((o) => (o.kind || '').startsWith('reject')) || opts[opts.length - 1]
        : opts.find((o) => (o.kind || '') === 'allow_once') || opts[0];
      setTimeout(() => reply(pick.optionId), 400);
    },
    onStderr: () => {},
  });
  const setPermAuto = (v) => { permAuto = v; };
  try {
    await client.connect(CWD);
    await run(client, setPermAuto);
  } catch (err) {
    tape.push({ t: Date.now() - t0, dir: 'meta', msg: { error: String(err && err.message) } });
  }
  client.kill();
  writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(tape, null, 1));
  const kinds = new Set();
  for (const e of tape) {
    if (e.dir !== 'recv') continue;
    const m = e.msg;
    if (m.method === 'session/update') kinds.add((m.params.update || m.params).sessionUpdate);
    if (m.method === 'session/request_permission') kinds.add('request_permission');
  }
  console.log(name + ':', tape.length, 'events ·', [...kinds].join(', '));
  return kinds;
}

const SCENARIOS = {
  chat: (c) => c.prompt(
    'Think briefly about this first, then answer. In 4 short lines: what is in this folder? '
    + 'Include one markdown link to https://agentclientprotocol.com and one inline `code` span and a **bold** word.'),
  edit: async (c) => {
    await c.prompt(
      'Create a file named waves.txt in this folder containing exactly three lines about ocean waves. '
      + 'Track your work with a todo list plan. Then read the file back and confirm.');
  },
  commands: async (c) => {
    await c.prompt('/cost');
    await c.prompt('/status');
  },
  failure: async (c, setPermAuto) => {
    await c.prompt('Run this exact bash command and show me the result: node -e "console.error(\'boom\'); process.exit(1)"');
    setPermAuto('reject');
    await c.prompt('Now try to delete waves.txt with rm.');
  },
  cancel: async (c) => {
    const p = c.prompt('Count slowly from 1 to 50, one number per line, thinking out loud between each.');
    await new Promise((r) => setTimeout(r, 6000));
    c.cancel();
    await p.catch(() => {});
  },
};

const which = process.argv[2] && !process.argv[2].startsWith('--') ? [process.argv[2]] : Object.keys(SCENARIOS);
const all = new Set();
for (const name of which) {
  const kinds = await record(name, SCENARIOS[name]);
  kinds.forEach((k) => all.add(k));
}
const NEED = ['agent_message_chunk', 'tool_call', 'tool_call_update', 'available_commands_update', 'request_permission', 'plan'];
const missing = NEED.filter((k) => !all.has(k));
console.log(missing.length ? 'MISSING: ' + missing.join(', ') : 'COVERAGE OK — ' + [...all].join(', '));
process.exit(missing.length ? 1 : 0);
