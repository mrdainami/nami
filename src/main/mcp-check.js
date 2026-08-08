// Start an MCP server once over stdio, shake hands, count tools, kill it.
// "Connected" in the UI is this function saying so, never an assumption.
const { spawn } = require('child_process');

function checkServer({ command, args = [], env = {}, spawnFn = spawn, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: 'could not start: ' + e.message });
      return;
    }
    let buf = '', done = false, id = 0;
    const finish = (out) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch (_) {} resolve(out); };
    const timer = setTimeout(() => finish({ ok: false, error: 'no answer within ' + Math.round(timeoutMs / 1000) + 's' }), timeoutMs);
    const send = (method, params) => { id += 1; try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); } catch (_) {} return id; };
    let initId = null, listId = null;
    child.on('error', (e) => finish({ ok: false, error: 'could not start: ' + e.message }));
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
