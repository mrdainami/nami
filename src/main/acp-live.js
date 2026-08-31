// ACP live bridge — PROTOTYPE (demo mode only).
// Spawns an ACP agent process (the official claude adapter) and shuttles
// newline-delimited JSON-RPC between its stdio and the renderer. No protocol
// logic lives here; the renderer is the ACP client.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { resolveSpawnProgram } = require('./bin-cache');
const { userPath } = require('./user-path');

const procs = new Map();

function wireAcpLive(ipcMain) {
  ipcMain.handle('acp:start', async (e, { id, cwd, command, args }) => {
    if (procs.has(id)) return { ok: true };
    let cmd = resolveSpawnProgram(command), cmdArgs = args || [];
    // the claude bridge may not be installed locally — fetch-and-run instead
    if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) {
      if (cmd.includes('claude-agent-acp')) { cmd = 'npx'; cmdArgs = ['-y', '@agentclientprotocol/claude-agent-acp']; }
      else return { ok: false, error: 'not installed: ' + path.basename(cmd) };
    }
    const runCwd = cwd && fs.existsSync(cwd) ? cwd : process.env.HOME;
    const envPath = await userPath();
    let proc;
    try {
      proc = spawn(cmd, cmdArgs, {
        cwd: runCwd,
        env: { ...process.env, PATH: envPath || ('/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || '')) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return { ok: false, error: String(err && err.message) };
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
        catch (_) { wc.send('acp:err', { id, text: line }); }
      }
    });
    proc.stderr.on('data', (d) => wc.send('acp:err', { id, text: d.toString() }));
    proc.on('exit', (code) => { procs.delete(id); try { wc.send('acp:exit', { id, code }); } catch (_) {} });
    proc.on('error', (err) => { procs.delete(id); try { wc.send('acp:err', { id, text: String(err && err.message) }); } catch (_) {} });
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
