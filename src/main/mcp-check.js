// Start an MCP server once over stdio, shake hands, count tools, kill it.
// "Connected" in the UI is this function saying so, never an assumption.
const { spawn } = require('child_process');
const { buildChildEnv, redactChildError } = require('./session-env');
const { spawnPlan } = require('./platform');
const { unwrapCmd } = require('./mcp-entry');

// Two things differ on a PC, both measured in the Windows 11 VM.
//
// An entry spelled `cmd /c npx …` is started as the `npx …` inside it.
// spawnPlan already goes through cmd.exe, and cmd inside cmd is handed a quoted
// "/c" it does not read as a switch — so it sat at a prompt nobody could see
// until the timeout, and a working connector was reported as not answering.
//
// And a program that is not there cannot fail to spawn: cmd.exe always starts,
// says "is not recognized" and exits. With no 'error' to catch, that used to
// wait out the whole timeout too. So here a child that ends before the
// handshake is the answer, in the first thing it said — on 'close', not
// 'exit', so stderr has been read to the end. A Mac keeps the behaviour it had.
function checkServer({ command, args = [], env = {}, spawnFn = spawn, timeoutMs = 15000, parentEnv = process.env, settings = {}, platform = process.platform }) {
  return new Promise((resolve) => {
    const win = platform === 'win32';
    let child;
    try {
      if (win) ({ command, args = [] } = unwrapCmd({ command, args }));
      const plan = spawnPlan(command, args, platform, parentEnv);
      child = spawnFn(plan.file, plan.args, { env: buildChildEnv({ parentEnv, settings, purpose: 'connector', explicitEnv: env }), stdio: ['pipe', 'pipe', 'pipe'], ...plan.options });
    } catch (e) {
      resolve({ ok: false, error: 'could not start: ' + redactChildError(e, { parentEnv, settings, explicitEnv: env }) });
      return;
    }
    let buf = '', done = false, id = 0;
    const finish = (out) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch (_) {} resolve(out); };
    const timer = setTimeout(() => finish({ ok: false, error: 'no answer within ' + Math.round(timeoutMs / 1000) + 's' }), timeoutMs);
    const send = (method, params) => { id += 1; try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); } catch (_) {} return id; };
    let initId = null, listId = null;
    child.on('error', (e) => finish({ ok: false, error: 'could not start: ' + redactChildError(e, { parentEnv, settings, explicitEnv: env }) }));
    if (win) {
      let said = '';
      if (child.stderr) child.stderr.on('data', (d) => { said = (said + d.toString()).slice(-2000); });
      child.on('close', (code) => {
        const line = said.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || 'it stopped before answering (exit ' + code + ')';
        finish({ ok: false, error: 'could not start: ' + redactChildError(line, { parentEnv, settings, explicitEnv: env }) });
      });
    }
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.id === initId) {
          try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } catch (_) {}
          listId = send('tools/list', {});
        } else if (msg.id === listId) {
          const tools = msg.result && Array.isArray(msg.result.tools) ? msg.result.tools.length : 0;
          finish({ ok: true, tools });
        }
      }
    });
    initId = send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nami', version: '1.0' } });
  });
}
module.exports = { checkServer };
