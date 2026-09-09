const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validPercent = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
const validTime = (n) => Number.isFinite(n) && !Number.isNaN(new Date(n).valueOf());
const PROVIDER_CARDS = new Set(['claude', 'codex', 'opencode', 'grok', 'antigravity', 'hermes', 'gemini']);

// Group installed CLIs by provider. Custom feeds stay on their account id so
// two adapters that happen to share a display name never add together.
export function groupUsage(accounts = []) {
  const groups = new Map(), unavailable = [];
  for (const row of accounts) {
    if (row.status === 'unavailable' || (!row.accountId && !validPercent(row.remaining))) { unavailable.push(row); continue; }
    const key = PROVIDER_CARDS.has(row.providerId) ? row.providerId : (row.accountId || row.id);
    if (!groups.has(key)) groups.set(key, { id: key, name: row.providerName || row.name, accountName: row.accountName || '', windows: [] });
    groups.get(key).windows.push(row);
  }
  return { groups: [...groups.values()], unavailable };
}

export function tightestWindow(windows = []) {
  const reported = windows.filter((row) => row.status !== 'stale' && validPercent(row.remaining));
  const pool = reported.length ? reported : windows;
  return pool.reduce((best, row) => validPercent(row.remaining) && (!validPercent(best.remaining) || row.remaining < best.remaining) ? row : best);
}

function windowHtml(row) {
  const reported = row.status !== 'stale' && validPercent(row.remaining);
  const label = row.windowLabel || row.name;
  const value = reported ? `${row.remaining}% left` : row.status === 'stale' ? 'Stale report' : 'Unavailable';
  const metadata = [];
  if (row.source) metadata.push(esc(row.source));
  if (validTime(row.resetsAt)) metadata.push('Resets ' + esc(new Date(row.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
  if (validTime(row.checkedAt)) metadata.push('Checked ' + esc(new Date(row.checkedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })));
  if (!reported && row.detail) metadata.push(esc(row.detail));
  if (!row.source && reported && row.detail) metadata.push(esc(row.detail));
  return `<div class="usage-window"><div class="usage-window-head"><span class="usage-window-label">${esc(label)}${row.scopeLabel ? `<small>${esc(row.scopeLabel)}</small>` : ''}</span><span class="usage-value${row.status === 'stale' ? ' usage-stale' : ''}">${value}</span></div>${reported ? `<div class="usage-bar" role="meter" aria-label="${esc(label)} remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${row.remaining}"><span style="width:${row.remaining}%"></span></div>` : ''}${metadata.length ? `<div class="usage-meta">${metadata.map((text) => `<span>${text}</span>`).join('')}</div>` : ''}</div>`;
}

function meter(row) {
  const label = row.windowLabel || row.name;
  return `<div class="usage-bar" role="meter" aria-label="${esc(label)} remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${row.remaining}"><span style="width:${row.remaining}%"></span></div>`;
}

function cardHtml(group) {
  const tightest = tightestWindow(group.windows);
  const rest = group.windows.filter((row) => row !== tightest);
  const reported = tightest.status !== 'stale' && validPercent(tightest.remaining);
  const label = tightest.windowLabel || tightest.name;
  const value = reported ? `${tightest.remaining}% left` : tightest.status === 'stale' ? 'Stale report' : 'Unavailable';
  return `<section class="usage-card"><div class="usage-card-head"><strong>${esc(group.name)}</strong><span class="usage-value${tightest.status === 'stale' ? ' usage-stale' : ''}">${esc(label)} · ${value}</span></div>${reported ? meter(tightest) : ''}${rest.length ? `<details class="usage-more"><summary>Other windows</summary>${rest.map(windowHtml).join('')}</details>` : ''}</section>`;
}

function quietCard(row) {
  return `<section class="usage-card usage-card--quiet"><div class="usage-card-head"><strong>${esc(row.providerName || row.name)}</strong><span class="usage-value">${esc(row.detail || 'No quota on this Mac yet')}</span></div></section>`;
}

function unavailableBlock(rows) {
  if (!rows.length) return '';
  const label = rows.length === 1
    ? `${rows[0].providerName || rows[0].name} has no quota on this Mac yet`
    : `${rows.length} CLIs have no quota on this Mac yet`;
  return `<details class="usage-unavailable"><summary>${esc(label)}</summary>${rows.map(quietCard).join('')}</details>`;
}

export function usageContent(result = {}) {
  const { groups, unavailable } = groupUsage(result.accounts);
  return `<div class="usage-tools"><p class="bs-note">Reported allowance by installed CLI. Limits may be shared across models.</p><button class="btn btn--small" id="usage-refresh">Refresh</button></div>
    ${groups.map(cardHtml).join('')}
    ${unavailableBlock(unavailable)}
    ${!groups.length && !unavailable.length ? '<p class="bs-note">No installed CLI reported a quota window.</p>' : ''}
    <details class="bs-details usage-advanced" id="usage-advanced"><summary>Advanced</summary>
      <p class="bs-note">Optional adapter for providers that do not keep a local quota on this Mac. Nami does not estimate remaining allowance from token counts.</p>
      ${result.claudeCommand ? '<div class="bs-section"><h3 class="field-label">Claude status line</h3><p class="bs-note">Eligible plans can still report limits through Claude’s status line after an API response.</p><button class="btn btn--small" id="usage-copy-claude">Copy status-line command</button></div>' : ''}
      ${result.feedDirectory ? `<div class="bs-section"><h3 class="field-label">JSON feed</h3><p class="bs-note">Write one JSON feed per account and refresh it within five minutes.</p><pre>${esc(result.feedDirectory)}/my-provider.json</pre><button class="btn btn--small" id="usage-copy-format">Copy feed format</button></div>` : ''}
    </details>`;
}

export function usagePaneHtml() {
  return '<div id="usage-body" class="usage-settings"><p class="bs-note" role="status">Checking account usage…</p></div>';
}

export async function wireUsagePane(modal, { api, toast }) {
  const host = modal.querySelector('#usage-body');
  if (!host) return;
  const token = {}; host._usageRequest = token;
  const current = () => host.isConnected && host._usageRequest === token;
  const refresh = host.querySelector('#usage-refresh');
  if (refresh) { refresh.disabled = true; refresh.textContent = 'Checking…'; }
  try {
    const result = await api.usageRead();
    if (result?.error) throw new Error(result.error);
    if (!current()) return;
    host.innerHTML = usageContent(result);
    const copy = async (text, message = 'Copied.') => {
      try { const result = await api.copyText(text); if (result?.error) throw new Error(result.error); toast(message); }
      catch (_) { toast('Could not copy. Try again.'); }
    };
    host.querySelector('#usage-refresh').onclick = () => wireUsagePane(modal, { api, toast });
    const claude = host.querySelector('#usage-copy-claude');
    if (claude) claude.onclick = () => copy(result.claudeCommand);
    const format = host.querySelector('#usage-copy-format');
    if (format) format.onclick = () => copy(JSON.stringify({ name: 'My provider', source: 'Provider quota API', at: Date.now(), windows: [{ label: 'Weekly', remainingPercent: null, resetsAt: null }] }, null, 2), 'Copied. Use reported percentages and timestamps in milliseconds.');
  } catch (_) {
    if (!current()) return;
    host.innerHTML = '<p class="bs-note" role="alert">Could not read usage.</p><button class="btn btn--small">Retry</button>';
    host.querySelector('button').onclick = () => wireUsagePane(modal, { api, toast });
  }
}
