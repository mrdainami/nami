const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validPercent = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
const validTime = (n) => Number.isFinite(n) && !Number.isNaN(new Date(n).valueOf());

// Group by explicit account identity. Never add quota windows together or infer
// model/account identity from a user-facing label.
export function groupUsage(accounts = []) {
  const groups = new Map(), unavailable = [];
  for (const row of accounts) {
    if (row.status === 'unavailable' || (!row.accountId && !validPercent(row.remaining))) { unavailable.push(row); continue; }
    const key = row.accountId || row.id;
    if (!groups.has(key)) groups.set(key, { id: key, name: row.providerName || row.name, accountName: row.accountName || '', windows: [] });
    groups.get(key).windows.push(row);
  }
  return { groups: [...groups.values()], unavailable };
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

export function usageContent(result = {}) {
  const { groups, unavailable } = groupUsage(result.accounts);
  return `<div class="usage-tools"><p class="bs-note">Reported allowance by account. Limits may be shared across models.</p><button class="btn btn--small" id="usage-refresh">Refresh</button></div>
    ${groups.map((group) => `<section class="usage-group"><div class="usage-group-head"><strong>${esc(group.name)}</strong><small>${esc(group.accountName)}</small></div>${group.windows.map(windowHtml).join('')}</section>`).join('')}
    ${!groups.length ? '<p class="bs-note">No current allowance reports. Connect a supported usage source below.</p>' : ''}
    ${unavailable.length ? `<details class="bs-details usage-unavailable"><summary>Unavailable providers (${unavailable.length})</summary><p class="bs-note">Unavailable does not mean zero remaining.</p>${unavailable.map((row) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(row.providerName || row.name)}</strong><small>${esc(row.detail || 'No connected quota source.')}</small></div></div>`).join('')}<button class="shortcuts-link" id="usage-open-setup">Set up a usage source</button></details>` : ''}
    <details class="bs-details usage-setup" id="usage-setup"><summary>Usage sources &amp; setup</summary>
      <p class="bs-note">Nami reads reported limits when you open Usage or refresh. It does not estimate remaining allowance from token counts.</p>
      ${result.claudeCommand ? '<div class="bs-section"><h3 class="field-label">Claude Code</h3><p class="bs-note">Eligible plans report limits through Claude’s status line after an API response. Add this command to your status-line settings, or integrate it with your existing script.</p><button class="btn btn--small" id="usage-copy-claude">Copy status-line command</button></div>' : ''}
      ${result.feedDirectory ? `<div class="bs-section"><h3 class="field-label">Other providers</h3><p class="bs-note">Use an adapter that reports your provider’s quota. Write one JSON feed per account and refresh it within five minutes.</p><pre>${esc(result.feedDirectory)}/my-provider.json</pre><button class="btn btn--small" id="usage-copy-format">Copy feed format</button></div>` : ''}
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
    const setupLink = host.querySelector('#usage-open-setup');
    if (setupLink) setupLink.onclick = () => { const setup = host.querySelector('#usage-setup'); setup.open = true; setup.querySelector('summary').focus(); setup.scrollIntoView({ block: 'nearest' }); };
  } catch (_) {
    if (!current()) return;
    host.innerHTML = '<p class="bs-note" role="alert">Could not read usage.</p><button class="btn btn--small">Retry</button>';
    host.querySelector('button').onclick = () => wireUsagePane(modal, { api, toast });
  }
}
