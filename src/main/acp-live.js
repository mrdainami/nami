// ACP live bridge for the experimental Chat surface.
// Spawns a registered ACP agent process and shuttles
// newline-delimited JSON-RPC between its stdio and the renderer. No protocol
// logic lives here; the renderer is the ACP client.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { resolveSpawnProgram } = require('./bin-cache');
const { userPath } = require('./user-path');
const { spawnPlan } = require('./platform');
const { buildChildEnv, redactChildError } = require('./session-env');

const procs = new Map();

// Launch definitions belong to main, so a caller cannot attach an agent ID
// to an arbitrary command to obtain that agent's keys.
function acpLaunch(agentId) {
  const launches = {
    claude: { command: path.join(__dirname, '../../acp-tools/node_modules/.bin/claude-agent-acp'), args: [] },
    codex: { command: 'npx', args: ['-y', '@zed-industries/codex-acp'], purpose: 'installer' },
    kimi: { command: 'kimi', args: ['acp'] },
    opencode: { command: 'opencode', args: ['acp'] },
    grok: { command: 'grok', args: ['agent', 'stdio'] },
    hermes: { command: 'hermes', args: ['acp'] },
  };
  return Object.prototype.hasOwnProperty.call(launches, agentId) ? launches[agentId] : null;
}

function wireAcpLive(ipcMain, { readSettings = () => ({}), parentEnv = process.env } = {}) {
  ipcMain.handle('acp:start', async (e, { id, cwd, agentId }) => {
    if (procs.has(id)) return { ok: true };
    const launch = acpLaunch(agentId);
    if (!launch) return { ok: false, error: 'Unknown ACP agent.' };
    let cmd = resolveSpawnProgram(launch.command), cmdArgs = launch.args;
    let purpose = launch.purpose || 'agent';
    // The fetch-and-run process is an installer even though it later becomes
    // an agent. It must not receive ambient provider credentials.
    if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) {
      if (agentId === 'claude') { cmd = 'npx'; cmdArgs = ['-y', '@agentclientprotocol/claude-agent-acp']; purpose = 'installer'; }
      else return { ok: false, error: 'Agent is not installed.' };
    }
    const settings = readSettings();
    const runCwd = cwd && fs.existsSync(cwd) ? cwd : (parentEnv.HOME || os.homedir());
    const envPath = await userPath({ settings, env: parentEnv });
    const diagnostic = (err) => redactChildError(err, { parentEnv, settings });
    let proc;
    try {
      // Homebrew's folders are a Mac guess; on Windows the PATH we were started
      // with is the only honest fallback.
      const fallbackPath = process.platform === 'win32' ? (parentEnv.PATH || '') : ('/opt/homebrew/bin:/usr/local/bin:' + (parentEnv.PATH || ''));
      const plan = spawnPlan(cmd, cmdArgs);
      proc = spawn(plan.file, plan.args, {
        cwd: runCwd,
        env: { ...buildChildEnv({ parentEnv, settings, purpose, agentId }), PATH: envPath || fallbackPath },
        stdio: ['pipe', 'pipe', 'pipe'],
        ...plan.options,
      });
    } catch (err) {
      return { ok: false, error: diagnostic(err) };
    }
    procs.set(id, proc);
    const wc = e.sender;
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try { wc.send('acp:msg', { id, msg: JSON.parse(line) }); }
        catch (_) { wc.send('acp:err', { id, text: diagnostic(line) }); }
      }
    });
    proc.stderr.on('data', (d) => wc.send('acp:err', { id, text: diagnostic(d.toString()) }));
    proc.on('exit', (code) => { procs.delete(id); try { wc.send('acp:exit', { id, code }); } catch (_) {} });
    proc.on('error', (err) => { procs.delete(id); try { wc.send('acp:err', { id, text: diagnostic(err) }); } catch (_) {} });
    return { ok: true };
  });
  ipcMain.handle('acp:send', (_e, { id, payload }) => {
    const proc = procs.get(id);
    if (!proc || !proc.stdin.writable) return { ok: false };
    proc.stdin.write(JSON.stringify(payload) + '\n');
    return { ok: true };
  });
  ipcMain.handle('acp:kill', (_e, { id }) => {
    const proc = procs.get(id);
    if (proc) { try { proc.kill(); } catch (_) {} procs.delete(id); }
    return { ok: true };
  });
}

module.exports = { wireAcpLive };
