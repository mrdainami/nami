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
// Two reports of the same window: keep the one that is actually a number, and
// among equals the one checked most recently. Neither source outranks the other
// by being read first.
function freshest(a, b) {
  const known = (row) => typeof row.remaining === 'number' && Number.isFinite(row.remaining);
  if (known(a) !== known(b)) return known(a) ? a : b;
  const at = Number.isFinite(a.checkedAt) ? a.checkedAt : -Infinity;
  const bt = Number.isFinite(b.checkedAt) ? b.checkedAt : -Infinity;
  return bt > at ? b : a;
}
function mergeReports(primary, extra) {
  const out = primary.slice(), index = new Map();
  out.forEach((row, i) => index.set(row.windowKey || row.id, i));
  for (const row of extra) {
    const key = row.windowKey || row.id;
    if (index.has(key)) { out[index.get(key)] = freshest(out[index.get(key)], row); continue; }
    index.set(key, out.length); out.push(row);
  }
  return out;
}
// A file too big to parse is a skip, not an absence: the caller has to know the
// difference so it can ask the account instead of reporting "no usage".
const JSON_SIZE_LIMIT = 64000;
function readJson(file) {
  try {
    if (fs.statSync(file).size >= JSON_SIZE_LIMIT) return { skipped: 'too-large' };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (_) { return null; }
}
const usable = (data) => data && !data.skipped ? data : null;
function unavailable(agent, detail) {
  return [{ id: agent.id, name: agent.name, providerId: agent.id, providerName: agent.name, status: 'unavailable', remaining: null, detail: detail || ('Sign in with ' + (agent.name || agent.id)) }];
}
function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
async function httpJson(url, opts = {}, fetchFn) {
  const fn = fetchFn || globalThis.fetch;
  if (!fn) return null;
  const res = await fn(url, { ...opts, signal: opts.signal || AbortSignal.timeout(8000) });
  if (!res || !res.ok) return null;
  return res.json();
}
// One vocabulary for every provider, matching the words the CLIs print:
// a span ("5 hours", "7 days") and, where the window is per-model, the model.
const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, twenty: 20, thirty: 30 };
const NAMED_WINDOWS = { five_hour: 'Session · 5 hours', seven_day: 'All models · 7 days', spend_limit: 'Spend limit' };
const titleWords = (text) => String(text).replaceAll('_', ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
function spanLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes % 1440 === 0 ? minutes / 1440 + ' days' : Math.round(minutes / 60) + ' hours';
}
function windowLabel(key) {
  if (NAMED_WINDOWS[key]) return NAMED_WINDOWS[key];
  const parts = /^([a-z]+)_(hour|day|week|month)s?(?:_(.+))?$/.exec(String(key));
  if (!parts) return titleWords(key);
  const count = COUNT_WORDS[parts[1]] ?? Number(parts[1]);
  if (!Number.isFinite(count)) return titleWords(key);
  const span = count + ' ' + parts[2] + (count === 1 ? '' : 's');
  return parts[3] ? titleWords(parts[3]) + ' · ' + span : span;
}
function codexUsage(data, now = Date.now()) {
  const buckets = data?.rateLimitsByLimitId || (data?.rateLimits ? { codex: data.rateLimits } : {});
  return Object.entries(buckets).flatMap(([key, bucket]) => ['primary', 'secondary'].flatMap((window) => {
    const w = bucket?.[window], left = percentage(w?.usedPercent);
    if (left === null) return [];
    const expired = Number.isFinite(w.resetsAt) && w.resetsAt * 1000 <= now;
    const label = spanLabel(w.windowDurationMins) || window;
    return [{ id: 'codex:' + key + ':' + window, name: 'Codex · ' + (key === 'codex' && !bucket.limitName ? '' : (bucket.limitName || key) + ' · ') + label, remaining: expired ? null : Math.round(left * 10) / 10,
      providerId: 'codex', providerName: 'Codex', accountId: 'codex:configured', accountName: 'Configured CLI account', windowLabel: label, windowKey: key + ':' + window,
      scopeLabel: key === 'codex' && !bucket.limitName ? 'Shared account allowance' : String(bucket.limitName || key), source: 'Codex', status: expired ? 'stale' : 'reported', resetsAt: Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : null,
      checkedAt: now, detail: expired ? 'Window reset; refresh for the new allowance.' : 'Reported by Codex' + (w.resetsAt ? ' · resets ' + new Date(w.resetsAt * 1000).toLocaleString() : '') }];
  }));
}
function feedUsage(data, now = Date.now()) {
  return Object.entries(data?.rate_limits || {}).flatMap(([key, w]) => {
    const left = percentage(w?.used_percentage); if (left === null) return [];
    const stale = !Number.isFinite(data.at) || now - data.at > FEED_STALE_MS || data.at > now + 60000 || (Number.isFinite(w.resets_at) && w.resets_at * 1000 <= now);
    return [{ id: 'claude:' + key, name: 'Claude · ' + windowLabel(key), remaining: stale ? null : Math.round(left * 10) / 10, checkedAt: data.at,
      providerId: 'claude', providerName: 'Claude', accountId: 'claude:status-line', accountName: 'Status-line account', windowLabel: windowLabel(key), windowKey: key, source: 'Claude status line', status: stale ? 'stale' : 'reported', resetsAt: Number.isFinite(w.resets_at) ? w.resets_at * 1000 : null,
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
      const label = windowLabel(key);
      rows.push({ id: 'claude:local:' + key, name: 'Claude · ' + label, remaining: stale ? null : Math.round(left * 10) / 10,
        providerId: 'claude', providerName: 'Claude', accountId: 'claude:local', accountName: 'Claude on this Mac', windowLabel: label, windowKey: key, source: 'Claude',
        status: stale ? 'stale' : 'reported', resetsAt, checkedAt: Number.isFinite(fetchedAtMs) ? fetchedAtMs : now,
        detail: stale ? 'Last report is stale. Use Claude to refresh.' : 'Reported by Claude' + (resetsAt ? ' · resets ' + new Date(resetsAt).toLocaleString() : '') });
    }
  }
  return data?.rate_limits ? mergeReports(rows, feedUsage(data, now)) : rows;
}
function geminiUsage(data, now = Date.now(), provider = { id: 'antigravity', name: 'Antigravity' }) {
  const buckets = Array.isArray(data?.buckets) ? data.buckets : Array.isArray(data?.quota?.buckets) ? data.quota.buckets : [];
  return buckets.flatMap((bucket, i) => {
    const remaining = fractionRemaining(bucket?.remainingFraction); if (remaining === null) return [];
    const resetsAt = parseResets(bucket.resetTime ?? bucket.resetsAt ?? bucket.reset_at);
    const expired = resetsAt != null && resetsAt <= now;
    const label = String(bucket.modelId || bucket.label || 'Allowance').slice(0, 100);
    return [{ id: provider.id + ':gemini:' + i, name: provider.name + ' · ' + label, remaining: expired ? null : remaining,
      providerId: provider.id, providerName: provider.name, accountId: provider.id + ':local', accountName: 'Configured CLI account', windowLabel: label, windowKey: label,
      source: provider.name, status: expired ? 'stale' : 'reported', resetsAt, checkedAt: now,
      detail: expired ? 'Window reset; refresh for the new allowance.' : 'Reported by ' + provider.name }];
  });
}
function claudeFiles(home) {
  const files = [
    path.join(home, '.claude.json'),
    path.join(home, '.claude', '.claude.json'),
    path.join(home, '.claude', 'usage-limits.json'),
    path.join(home, '.claude', 'rate-limits.json'),
    path.join(home, '.claude', 'statusline_raw.json'),
  ];
  if (process.env.CLAUDE_CONFIG_DIR) files.push(path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'));
  return files;
}
function claudeSkippedLocal(home) {
  return claudeFiles(home).some((file) => readJson(file)?.skipped === 'too-large');
}
function claudeRows(home, directory, now) {
  let rows = [];
  for (const file of claudeFiles(home)) { const data = usable(readJson(file)); if (data) rows = mergeReports(rows, claudeUsage(data, now)); }
  const feed = usable(readJson(path.join(directory, 'claude.json')));
  if (feed) rows = mergeReports(rows, feedUsage(feed, now));
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
  for (const file of files) { const data = usable(readJson(file)); if (data) rows = mergeReports(rows, geminiUsage(data, now, { id: agent.id, name: agent.name })); }
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
function claudeTokenFromKeychain() {
  const { execFileSync } = require('node:child_process');
  let user = '';
  try { user = os.userInfo().username; } catch { user = process.env.USER || ''; }
  const tries = [];
  if (user) tries.push(['find-generic-password', '-w', '-s', 'Claude Code-credentials', '-a', user]);
  tries.push(['find-generic-password', '-w', '-s', 'Claude Code-credentials']);
  for (const args of tries) {
    try {
      const raw = String(execFileSync('security', args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
      if (!raw) continue;
      const data = JSON.parse(raw);
      const token = data?.claudeAiOauth?.accessToken;
      if (typeof token === 'string' && token) return token;
    } catch {}
  }
  return null;
}
function claudeToken(home) {
  for (const file of [path.join(home, '.claude', '.credentials.json'), path.join(home, '.claude.json'), path.join(home, '.claude', 'credentials.json')]) {
    const data = readJsonFile(file);
    const token = data?.claudeAiOauth?.accessToken || data?.accessToken;
    if (typeof token === 'string' && token) return token;
  }
  if (home === os.homedir()) return claudeTokenFromKeychain();
  return null;
}
// Every window the account reports, whatever it is called. A new model tier
// shows up in the CLI the day it ships; an allowlist here would drop it.
function claudeOauthUsage(data, now) {
  const utilization = {};
  for (const [key, w] of Object.entries(data && typeof data === 'object' ? data : {})) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    const used = w.used_percentage ?? w.utilization ?? w.usedPercent;
    if (typeof used !== 'number' || !Number.isFinite(used)) continue;
    utilization[key] = { utilization: used, resets_at: w.resets_at ?? w.resetsAt };
  }
  return claudeUsage({ cachedUsageUtilization: { utilization, fetchedAtMs: now } }, now)
    .map((row) => ({ ...row, id: 'claude:account:' + row.windowKey, accountId: 'claude:account', accountName: 'Claude account', source: 'Claude account',
      detail: row.status === 'stale' ? row.detail : 'Reported by the Claude account' + (row.resetsAt ? ' · resets ' + new Date(row.resetsAt).toLocaleString() : '') }));
}
async function fetchClaudeAccount(home, now, fetchFn) {
  const token = claudeToken(home);
  if (!token) return [];
  const data = await httpJson('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code/2.1.0' },
  }, fetchFn);
  return data ? claudeOauthUsage(data, now) : [];
}
function grokSession(home) {
  const j = readJsonFile(path.join(home, '.grok', 'auth.json'));
  if (!j || typeof j !== 'object') return null;
  const entries = Object.values(j).filter((v) => v && typeof v === 'object');
  if (!entries.length) return null;
  return entries.slice().sort((a, b) => (Date.parse(b.create_time) || 0) - (Date.parse(a.create_time) || 0))[0];
}
function moneyVal(value) {
  const raw = value && typeof value === 'object' && 'val' in value ? value.val : value;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
function grokUsage(data, now, agent) {
  const cfg = data?.config && typeof data.config === 'object' ? data.config : data;
  let used = typeof cfg?.creditUsagePercent === 'number' ? cfg.creditUsagePercent
    : typeof cfg?.usagePercent === 'number' ? cfg.usagePercent
    : typeof cfg?.used_percent === 'number' ? cfg.used_percent : null;
  if (used === null) {
    const limit = moneyVal(cfg?.monthlyLimit);
    const spent = moneyVal(cfg?.used);
    if (limit && limit > 0 && spent !== null) used = (spent / limit) * 100;
  }
  const left = percentage(used);
  if (left === null) return [];
  return [{ id: 'grok:credits', name: agent.name, remaining: Math.round(left * 10) / 10, providerId: 'grok', providerName: agent.name,
    accountId: 'grok:account', accountName: agent.name, windowLabel: 'Credits', source: 'Grok', status: 'reported', checkedAt: now, detail: 'Reported by Grok' }];
}
function grokHeaders(session) {
  const headers = { Authorization: 'Bearer ' + session.key, 'X-XAI-Token-Auth': 'xai-grok-cli', Accept: 'application/json' };
  if (typeof session.user_id === 'string' && session.user_id) headers['x-userid'] = session.user_id;
  return headers;
}
async function fetchGrokAccount(home, now, agent, fetchFn) {
  const session = grokSession(home);
  if (!session || typeof session.key !== 'string') return [];
  const headers = grokHeaders(session);
  const credits = await httpJson('https://cli-chat-proxy.grok.com/v1/billing?format=credits', { headers }, fetchFn);
  let rows = credits ? grokUsage(credits, now, agent) : [];
  if (rows.length) return rows;
  const billing = await httpJson('https://cli-chat-proxy.grok.com/v1/billing', { headers }, fetchFn);
  return billing ? grokUsage(billing, now, agent) : [];
}
function kimiToken(home) {
  const cred = readJsonFile(path.join(home, '.kimi-code', 'credentials', 'kimi-code.json'));
  if (cred && typeof cred.access_token === 'string' && cred.access_token) return cred.access_token;
  try {
    const toml = fs.readFileSync(path.join(home, '.kimi-code', 'config.toml'), 'utf8');
    const match = toml.match(/api_key\s*=\s*"([^"]+)"/) || toml.match(/api_key\s*=\s*'([^']+)'/);
    return match ? match[1] : null;
  } catch { return null; }
}
function kimiWindows(data, now, agent) {
  if (data?.usage && data.usage.limit != null) {
    const limit = Number(data.usage.limit), spent = Number(data.usage.used);
    if (limit > 0 && Number.isFinite(spent)) {
      const left = percentage((spent / limit) * 100);
      if (left !== null) return [{ id: 'kimi:weekly', name: agent.name, remaining: Math.round(left * 10) / 10, providerId: 'kimi', providerName: agent.name,
        accountId: 'kimi:account', accountName: agent.name, windowLabel: 'Weekly', source: 'Kimi', status: 'reported', checkedAt: now, detail: 'Reported by Kimi' }];
    }
  }
  const windows = Array.isArray(data.windows) ? data.windows : Array.isArray(data.usages) ? data.usages : Array.isArray(data.limits) ? data.limits : [data];
  return windows.flatMap((w, i) => {
    const detail = w.detail || w;
    const used = detail.used_percentage ?? detail.usedPercent ?? detail.utilization;
    const left = percentage(used); if (left === null) return [];
    return [{ id: 'kimi:' + i, name: agent.name, remaining: Math.round(left * 10) / 10, providerId: 'kimi', providerName: agent.name,
      accountId: 'kimi:account', windowLabel: String(detail.label || detail.name || w.timeUnit || 'Allowance'), source: 'Kimi', status: 'reported', checkedAt: now }];
  });
}
async function fetchKimiAccount(home, now, agent, fetchFn) {
  const token = kimiToken(home);
  if (!token) return [];
  const data = await httpJson('https://api.kimi.com/coding/v1/usages', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
  }, fetchFn);
  return data ? kimiWindows(data, now, agent) : [];
}
async function fetchGeminiAccount(home, now, agent, fetchFn) {
  const cred = readJsonFile(path.join(home, '.gemini', 'oauth_creds.json'))
    || readJsonFile(path.join(home, '.gemini', 'google_accounts.json'));
  const token = cred?.access_token || cred?.accessToken || cred?.token || cred?.access;
  if (typeof token !== 'string' || !token) return [];
  const assist = await httpJson('https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } }),
  }, fetchFn);
  const project = assist?.cloudaicompanionProject;
  const data = await httpJson('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(project ? { project } : {}),
  }, fetchFn);
  return data ? geminiUsage(data, now, { id: agent.id, name: agent.name }) : [];
}
function signedInFile(home, rel) {
  try { return fs.existsSync(path.join(home, ...rel.split('/'))); } catch { return false; }
}
async function rowsFor(agent, { home, directory, envPath, now, spawnFn, fetchFn }) {
  if (agent.id === 'codex') return codexUsage(await queryCodex(agent.path, envPath, spawnFn || spawn), now);
  if (agent.id === 'claude') return mergeReports(claudeRows(home, directory, now), await fetchClaudeAccount(home, now, fetchFn));
  if (agent.id === 'antigravity' || agent.id === 'gemini') return mergeReports(geminiRows(home, agent, now), await fetchGeminiAccount(home, now, agent, fetchFn));
  if (agent.id === 'grok') return fetchGrokAccount(home, now, agent, fetchFn);
  if (agent.id === 'kimi') return fetchKimiAccount(home, now, agent, fetchFn);
  return [];
}
function missingDetail(agent, home) {
  if (agent.id === 'hermes') return signedInFile(home, '.hermes/auth.json') ? 'Hermes does not report a quota window.' : 'Sign in with Hermes';
  if (agent.id === 'opencode') return signedInFile(home, '.local/share/opencode/auth.json') ? 'OpenCode does not report a quota window.' : 'Sign in with OpenCode';
  if (agent.id === 'claude' && claudeSkippedLocal(home)) return claudeToken(home)
    ? 'Claude\u2019s local report is too large to scan, and the account did not answer.'
    : 'Claude\u2019s local report is too large to scan. Sign in with Claude to read the account.';
  if (agent.id === 'claude' && claudeToken(home)) return 'Could not read Claude usage.';
  if (agent.id === 'grok' && grokSession(home)) return 'Could not read Grok usage.';
  if (agent.id === 'kimi' && kimiToken(home)) return signedInFile(home, '.kimi-code/credentials/kimi-code.json') ? 'Could not read Kimi usage.' : 'Kimi does not report a quota window for this login.';
  if ((agent.id === 'antigravity' || agent.id === 'gemini') && signedInFile(home, '.gemini/oauth_creds.json')) return 'Could not read Antigravity usage.';
  return 'Sign in with ' + (agent.name || agent.id);
}
async function readUsage({ agents, directory, envPath, home, now, spawnFn, fetchFn }) {
  home = home || os.homedir();
  now = now ?? Date.now();
  const accounts = [];
  for (const agent of (agents || []).filter((a) => a.found)) {
    let rows = [];
    try { rows = await rowsFor(agent, { home, directory, envPath, now, spawnFn, fetchFn }); }
    catch (_) { rows = []; }
    accounts.push(...(rows.length ? rows : unavailable(agent, missingDetail(agent, home))));
  }
  return { accounts };
}
module.exports = { codexUsage, feedUsage, customUsage, claudeUsage, geminiUsage, grokUsage, claudeOauthUsage, queryCodex, readUsage };
