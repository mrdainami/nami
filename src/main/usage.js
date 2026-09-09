// Provider quota windows, never inferred from token/context usage.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const percentage = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.max(0, Math.min(100, 100 - n)) : null;
function codexUsage(data, now = Date.now()) {
  const buckets = data?.rateLimitsByLimitId || (data?.rateLimits ? { codex: data.rateLimits } : {});
  return Object.entries(buckets).flatMap(([key, bucket]) => ['primary', 'secondary'].flatMap((window) => {
    const w = bucket?.[window], left = percentage(w?.usedPercent);
    if (left === null) return [];
    const expired = Number.isFinite(w.resetsAt) && w.resetsAt * 1000 <= now;
    return [{ id: 'codex:' + key + ':' + window, name: 'Codex · ' + (key === 'codex' && !bucket.limitName ? '' : (bucket.limitName || key) + ' · ') + (w.windowDurationMins ? (w.windowDurationMins % 1440 === 0 ? w.windowDurationMins / 1440 + ' days' : w.windowDurationMins / 60 + 'h') : window), remaining: expired ? null : Math.round(left * 10) / 10,
      checkedAt: now, detail: expired ? 'Window reset; refresh for the new allowance.' : 'Reported by Codex' + (w.resetsAt ? ' · resets ' + new Date(w.resetsAt * 1000).toLocaleString() : '') }];
  }));
}
function feedUsage(data, now = Date.now()) {
  return Object.entries(data?.rate_limits || {}).flatMap(([key, w]) => {
    const left = percentage(w?.used_percentage); if (left === null) return [];
    const stale = !Number.isFinite(data.at) || now - data.at > 5 * 60 * 1000 || data.at > now + 60000 || (Number.isFinite(w.resets_at) && w.resets_at * 1000 <= now);
    return [{ id: 'claude:' + key, name: 'Claude · ' + key.replaceAll('_', ' '), remaining: stale ? null : Math.round(left * 10) / 10, checkedAt: data.at,
      detail: stale ? 'Last report is stale. Use Claude to refresh its status line.' : 'Claude status line' + (w.resets_at ? ' · resets ' + new Date(w.resets_at * 1000).toLocaleString() : '') }];
  });
}
function customUsage(id, data, now = Date.now()) {
  if (!Array.isArray(data?.windows)) return [];
  const stale = !Number.isFinite(data.at) || Math.abs(now - data.at) > 5 * 60 * 1000;
  return data.windows.slice(0, 12).map((w, i) => {
    const valid = typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent) && w.remainingPercent >= 0 && w.remainingPercent <= 100;
    const expired = Number.isFinite(w.resetsAt) && w.resetsAt <= now;
    return { id: id + ':feed:' + i, name: String(data.name || id).slice(0, 100) + ' · ' + String(w.label || 'Allowance').slice(0, 100),
      remaining: valid && !stale && !expired ? Math.round(w.remainingPercent * 10) / 10 : null,
      checkedAt: stale ? null : data.at, detail: 'Custom feed · ' + String(data.source || 'User-configured adapter').slice(0, 200) + (stale || expired ? ' · report expired; refresh the adapter.' : '') };
  });
}
function queryCodex(command, envPath, spawnFn = spawn) {
  return new Promise((resolve) => {
    let child, buffer = '', done = false;
    const finish = (data) => { if (done) return; done = true; clearTimeout(timer); child?.kill(); resolve(data); };
    const timer = setTimeout(() => finish(null), 6000);
    try { child = spawnFn(command, ['app-server'], { env: { ...process.env, PATH: envPath || process.env.PATH }, stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch (_) { finish(null); return; }
    child.on('error', () => finish(null)); child.on('exit', () => finish(null)); child.stdin.on('error', () => finish(null));
    const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
    child.stdout.on('data', (chunk) => {
      buffer += chunk; if (buffer.length > 1024 * 1024) { finish(null); return; }
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch (_) { continue; }
        if (m.id === 1 && !m.error) { send({ method: 'initialized' }); send({ id: 2, method: 'account/rateLimits/read' }); }
        if (m.id === 2 || m.error) finish(m.result || null);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'nami-usage', version: '1.0.0' }, capabilities: {} } });
  });
}
async function readUsage({ agents, directory, envPath }) {
  const accounts = [], feeds = new Map();
  try {
    for (const name of fs.readdirSync(directory).slice(0, 100)) if (/^[a-z0-9-]+\.json$/.test(name) && name !== 'claude.json') {
      try { const file = path.join(directory, name); if (fs.statSync(file).size < 64000) feeds.set(name.slice(0, -5), customUsage(name.slice(0, -5), JSON.parse(fs.readFileSync(file, 'utf8')))); } catch (_) {}
    }
  } catch (_) {}
  for (const agent of agents.filter((a) => a.found)) {
    let rows = [];
    if (agent.id === 'codex') rows = codexUsage(await queryCodex(agent.path, envPath));
    if (agent.id === 'claude') {
      try { const file = path.join(directory, 'claude.json'); if (fs.statSync(file).size < 64000) rows = feedUsage(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) {}
    }
    if (!rows.length) rows = feeds.get(agent.id) || [];
    feeds.delete(agent.id);
    accounts.push(...(rows.length ? rows : [{ id: agent.id, name: agent.name, remaining: null, detail: agent.id === 'claude' ? 'Connect the Claude status-line feed to report eligible subscription limits.' : agent.id === 'codex' ? 'The configured Codex account did not return a quota window.' : 'This provider has no connected quota adapter.' }]));
  }
  for (const rows of feeds.values()) accounts.push(...rows);
  return { accounts };
}
module.exports = { codexUsage, feedUsage, customUsage, queryCodex, readUsage };
