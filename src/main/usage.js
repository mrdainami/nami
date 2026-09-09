// Provider quota windows, never inferred from token/context usage.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const LOCAL_STALE_MS = 30 * 60 * 1000;
const FEED_STALE_MS = 5 * 60 * 1000;
const percentage = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.max(0, Math.min(100, 100 - n)) : null;
const fractionRemaining = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 1000) / 10 : null;
function parseResets(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') { const t = Date.parse(value); return Number.isFinite(t) ? t : null; }
  return null;
}
function mergeWindows(primary, extra) {
  const seen = new Set(primary.map((row) => row.windowKey || row.id)), out = primary.slice();
  for (const row of extra) { const key = row.windowKey || row.id; if (seen.has(key)) continue; seen.add(key); out.push(row); }
  return out;
}
function readJson(file) {
  try {
    if (fs.statSync(file).size >= 64000) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (_) { return null; }
}
function unavailable(agent) {
  return [{ id: agent.id, name: agent.name, providerId: agent.id, providerName: agent.name, status: 'unavailable', remaining: null, detail: 'No quota on this Mac yet' }];
}
function claudeWindowLabel(key) {
  if (key === 'five_hour') return '5 hours';
  if (key === 'seven_day') return '7 days';
  if (key === 'spend_limit') return 'spend limit';
  return String(key).replaceAll('_', ' ');
}
function codexUsage(data, now = Date.now()) {
  const buckets = data?.rateLimitsByLimitId || (data?.rateLimits ? { codex: data.rateLimits } : {});
  return Object.entries(buckets).flatMap(([key, bucket]) => ['primary', 'secondary'].flatMap((window) => {
    const w = bucket?.[window], left = percentage(w?.usedPercent);
    if (left === null) return [];
    const expired = Number.isFinite(w.resetsAt) && w.resetsAt * 1000 <= now;
    const windowLabel = w.windowDurationMins ? (w.windowDurationMins % 1440 === 0 ? w.windowDurationMins / 1440 + ' days' : w.windowDurationMins / 60 + 'h') : window;
    return [{ id: 'codex:' + key + ':' + window, name: 'Codex · ' + (key === 'codex' && !bucket.limitName ? '' : (bucket.limitName || key) + ' · ') + windowLabel, remaining: expired ? null : Math.round(left * 10) / 10,
      providerId: 'codex', providerName: 'Codex', accountId: 'codex:configured', accountName: 'Configured CLI account', windowLabel, windowKey: key + ':' + window,
      scopeLabel: key === 'codex' && !bucket.limitName ? 'Shared account allowance' : String(bucket.limitName || key), source: 'Codex', status: expired ? 'stale' : 'reported', resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : null,
      checkedAt: now, detail: expired ? 'Window reset; refresh for the new allowance.' : 'Reported by Codex' + (w.resetsAt ? ' · resets ' + new Date(w.resetsAt * 1000).toLocaleString() : '') }];
  }));
}
function feedUsage(data, now = Date.now()) {
  return Object.entries(data?.rate_limits || {}).flatMap(([key, w]) => {
    const left = percentage(w?.used_percentage); if (left === null) return [];
    const stale = !Number.isFinite(data.at) || now - data.at > FEED_STALE_MS || data.at > now + 60000 || (Number.isFinite(w.resets_at) && w.resets_at * 1000 <= now);
    return [{ id: 'claude:' + key, name: 'Claude · ' + key.replaceAll('_', ' '), remaining: stale ? null : Math.round(left * 10) / 10, checkedAt: data.at,
      providerId: 'claude', providerName: 'Claude', accountId: 'claude:status-line', accountName: 'Status-line account', windowLabel: key.replaceAll('_', ' '), windowKey: key, source: 'Claude status line', status: stale ? 'stale' : 'reported', resetsAt: Number.isFinite(w.resets_at) ? w.resets_at * 1000 : null,
      detail: stale ? 'Last report is stale. Use Claude to refresh its status line.' : 'Claude status line' + (w.resets_at ? ' · resets ' + new Date(w.resets_at * 1000).toLocaleString() : '') }];
  });
}
function customUsage(id, data, now = Date.now()) {
  if (!Array.isArray(data?.windows)) return [];
  const stale = !Number.isFinite(data.at) || Math.abs(now - data.at) > FEED_STALE_MS;
  return data.windows.slice(0, 12).map((w, i) => {
    const valid = typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent) && w.remainingPercent >= 0 && w.remainingPercent <= 100;
    const expired = Number.isFinite(w.resetsAt) && w.resetsAt <= now;
    return { id: id + ':feed:' + i, name: String(data.name || id).slice(0, 100) + ' · ' + String(w.label || 'Allowance').slice(0, 100),
      providerId: id, providerName: String(data.name || id).slice(0, 100), accountId: id + ':feed', accountName: 'Feed: ' + id, windowLabel: String(w.label || 'Allowance').slice(0, 100), source: String(data.source || 'User-configured adapter').slice(0, 200), status: stale || expired ? 'stale' : valid ? 'reported' : 'unknown', resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt : null,
      remaining: valid && !stale && !expired ? Math.round(w.remainingPercent * 10) / 10 : null,
      checkedAt: stale ? null : data.at, detail: 'Custom feed · ' + String(data.source || 'User-configured adapter').slice(0, 200) + (stale || expired ? ' · report expired; refresh the adapter.' : '') };
  });
}
function utilizationMap(data) {
  const cached = data?.cachedUsageUtilization;
  if (cached && cached.utilization && typeof cached.utilization === 'object') return { utilization: cached.utilization, fetchedAtMs: cached.fetchedAtMs };
  if (data?.utilization && typeof data.utilization === 'object' && !Array.isArray(data.utilization)) return { utilization: data.utilization, fetchedAtMs: data.fetchedAtMs ?? data.at };
  const utilization = {};
  for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'spend_limit']) {
    if (data?.[key] && typeof data[key] === 'object') utilization[key] = data[key];
  }
  return Object.keys(utilization).length ? { utilization, fetchedAtMs: data.fetchedAtMs ?? data.at } : { utilization: null, fetchedAtMs: null };
}
function claudeUsage(data, now = Date.now()) {
  const { utilization, fetchedAtMs } = utilizationMap(data || {});
  const rows = [];
  if (utilization) {
    const ageStale = Number.isFinite(fetchedAtMs) && (now - fetchedAtMs > LOCAL_STALE_MS || fetchedAtMs > now + 60000);
    for (const [key, w] of Object.entries(utilization)) {
      if (!w || typeof w !== 'object') continue;
      const used = typeof w.utilization === 'number' ? w.utilization : typeof w.used_percentage === 'number' ? w.used_percentage : typeof w.usedPercent === 'number' ? w.usedPercent : null;
      const left = percentage(used); if (left === null) continue;
      const resetsAt = parseResets(w.resets_at ?? w.resetsAt);
      const stale = ageStale || (resetsAt != null && resetsAt <= now);
      const windowLabel = claudeWindowLabel(key);
      rows.push({ id: 'claude:local:' + key, name: 'Claude · ' + windowLabel, remaining: stale ? null : Math.round(left * 10) / 10,
        providerId: 'claude', providerName: 'Claude', accountId: 'claude:local', accountName: 'Claude on this Mac', windowLabel, windowKey: key, source: 'Claude',
        status: stale ? 'stale' : 'reported', resetsAt, checkedAt: Number.isFinite(fetchedAtMs) ? fetchedAtMs : now,
        detail: stale ? 'Last report is stale. Use Claude to refresh.' : 'Reported by Claude' + (resetsAt ? ' · resets ' + new Date(resetsAt).toLocaleString() : '') });
    }
  }
  return data?.rate_limits ? mergeWindows(rows, feedUsage(data, now)) : rows;
}
function geminiUsage(data, now = Date.now(), provider = { id: 'antigravity', name: 'Antigravity' }) {
  const buckets = Array.isArray(data?.buckets) ? data.buckets : Array.isArray(data?.quota?.buckets) ? data.quota.buckets : [];
  return buckets.flatMap((bucket, i) => {
    const remaining = fractionRemaining(bucket?.remainingFraction); if (remaining === null) return [];
    const resetsAt = parseResets(bucket.resetTime ?? bucket.resetsAt ?? bucket.reset_at);
    const expired = resetsAt != null && resetsAt <= now;
    const windowLabel = String(bucket.modelId || bucket.label || 'Allowance').slice(0, 100);
    return [{ id: provider.id + ':gemini:' + i, name: provider.name + ' · ' + windowLabel, remaining: expired ? null : remaining,
      providerId: provider.id, providerName: provider.name, accountId: provider.id + ':local', accountName: 'Configured CLI account', windowLabel, windowKey: windowLabel,
      source: provider.name, status: expired ? 'stale' : 'reported', resetsAt, checkedAt: now,
      detail: expired ? 'Window reset; refresh for the new allowance.' : 'Reported by ' + provider.name }];
  });
}
function claudeRows(home, directory, now) {
  const files = [
    path.join(home, '.claude.json'),
    path.join(home, '.claude', '.claude.json'),
    path.join(home, '.claude', 'usage-limits.json'),
    path.join(home, '.claude', 'rate-limits.json'),
    path.join(home, '.claude', 'statusline_raw.json'),
  ];
  if (process.env.CLAUDE_CONFIG_DIR) files.push(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'));
  let rows = [];
  for (const file of files) { const data = readJson(file); if (data) rows = mergeWindows(rows, claudeUsage(data, now)); }
  const feed = readJson(path.join(directory, 'claude.json'));
  if (feed) rows = mergeWindows(rows, feedUsage(feed, now));
  return rows;
}
function geminiRows(home, agent, now) {
  const files = [
    path.join(home, '.gemini', 'quota.json'),
    path.join(home, '.gemini', 'user-quota.json'),
    path.join(home, '.gemini', 'cached-quota.json'),
    path.join(home, '.gemini', 'oauth_creds.json'),
    path.join(home, '.gemini', 'antigravity-cli', 'quota.json'),
  ];
  let rows = [];
  for (const file of files) { const data = readJson(file); if (data) rows = mergeWindows(rows, geminiUsage(data, now, { id: agent.id, name: agent.name })); }
  return rows;
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
async function readUsage({ agents, directory, envPath, home, now, spawnFn }) {
  home = home || os.homedir();
  now = now ?? Date.now();
  const accounts = [], feeds = new Map();
  try {
    for (const name of fs.readdirSync(directory).slice(0, 100)) if (/^[a-z0-9-]+\.json$/.test(name) && name !== 'claude.json') {
      try { const file = path.join(directory, name); if (fs.statSync(file).size < 64000) feeds.set(name.slice(0, -5), customUsage(name.slice(0, -5), JSON.parse(fs.readFileSync(file, 'utf8')), now)); } catch (_) {}
    }
  } catch (_) {}
  for (const agent of agents.filter((a) => a.found)) {
    let rows = [];
    if (agent.id === 'codex') rows = codexUsage(await queryCodex(agent.path, envPath, spawnFn || spawn), now);
    if (agent.id === 'claude') rows = claudeRows(home, directory, now);
    if (agent.id === 'antigravity' || agent.id === 'gemini') rows = geminiRows(home, agent, now);
    if (!rows.length) rows = feeds.get(agent.id) || [];
    feeds.delete(agent.id);
    accounts.push(...(rows.length ? rows : unavailable(agent)));
  }
  for (const rows of feeds.values()) accounts.push(...rows);
  return { accounts };
}
module.exports = { codexUsage, feedUsage, customUsage, claudeUsage, geminiUsage, queryCodex, readUsage };
