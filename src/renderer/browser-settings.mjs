// Settings content only: the app owns its modal, navigation and profile flows.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function browserSettingsHtml() {
  return '<div id="browser-settings-body" class="browser-settings"><p class="bs-note" role="status">Loading browser settings…</p></div>';
}

export function browserSettingsContent(status, actions = {}) {
  const sessions = status.sessions || [], profiles = status.profiles || [];
  return `<section class="bs-section" aria-labelledby="browser-agent-heading">
    <h3 class="field-label" id="browser-agent-heading">Agent browser access</h3>
    <p class="bs-note">Choose which tabs each session may read and control.</p>
    <label class="bs-toggle"><input type="checkbox" id="browser-enabled"${status.enabled ? ' checked' : ''}><span>Enable local browser connection<small>Access must be granted separately for each session.</small></span></label>
    ${sessions.map((s) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(s.title)}</strong><small>${s.views?.length ? `${s.views.length} permitted ${s.views.length === 1 ? 'tab' : 'tabs'} · Access configured` : 'No browser access'}${s.peers?.length ? ` · ${s.peers.length} allowed ${s.peers.length === 1 ? 'peer' : 'peers'}` : ''}</small></div><button class="btn btn--small" data-browser-session="${esc(s.id)}">Configure…</button></div>`).join('') || '<p class="bs-note">Open an agent session to configure access.</p>'}
    <details class="bs-details"><summary>How access works</summary><p class="bs-note">A compatible MCP client can use permitted tabs when it calls a browser tool. Configuring access does not confirm that a client is connected.</p><p class="bs-note">Access ends when revoked, the session closes, or Nami quits. Closing a tab removes access to it. Text and annotations use a separate, one-time insertion.</p></details>
  </section>
  <section class="bs-section" aria-labelledby="browser-profile-heading"><h3 class="field-label" id="browser-profile-heading">Browser profiles &amp; sign-ins</h3>
    <p class="bs-note">Tabs in the same profile share website sign-ins. These profiles are separate from your agent accounts.</p>
    ${profiles.length ? profiles.map((p) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(p.name || p.id)}</strong><small>${p.viewCount ? 'In use' : 'Browser profile'}${Number.isFinite(p.viewCount) ? ` · ${p.viewCount} ${p.viewCount === 1 ? 'tab' : 'tabs'}` : ''}</small></div></div>`).join('') : `<p class="bs-note">${status.profileLoadError ? 'Could not load profiles. Open Manage profiles to try again.' : 'You can sign into websites directly in a browser tab.'}</p>`}
    <div class="bs-actions">${actions.onProfiles ? '<button class="btn btn--small" data-browser-settings="profiles">Manage profiles…</button>' : ''}${actions.onImport ? '<button class="btn btn--small" data-browser-settings="import">Import saved passwords…</button>' : ''}${actions.onClear ? '<button class="btn btn--small" data-browser-settings="clear">Clear browsing data…</button>' : ''}</div>
  </section>`;
}

export async function wireBrowserSettings(modal, options) {
  const { api, onAccess, onError = () => {} } = options;
  const host = modal.querySelector('#browser-settings-body');
  if (!host) return;
  const token = {}; host._browserSettingsRequest = token;
  const current = () => host.isConnected && host._browserSettingsRequest === token;
  try {
    const [status, profileResult] = await Promise.all([api.browserStatus(), api.browserProfiles ? api.browserProfiles({ action: 'list' }).catch(() => ({ error: true })) : null]);
    if (!current()) return;
    if (status?.error) throw new Error(status.error);
    if (profileResult?.profiles) status.profiles = profileResult.profiles.map((profile) => ({ ...profile, viewCount: (status.views || []).filter((view) => view.profileId === profile.id).length }));
    if (profileResult?.error) status.profileLoadError = true;
    host.innerHTML = browserSettingsContent(status, options);
    const toggle = host.querySelector('#browser-enabled');
    toggle.onchange = async () => {
      const requested = toggle.checked; toggle.disabled = true;
      try {
        const result = await api.browserEnable(requested);
        if (result?.error) throw new Error(result.error);
        if (current()) await wireBrowserSettings(modal, options);
      } catch (error) {
        if (current()) { toggle.checked = !requested; toggle.disabled = false; onError(error.message || 'Could not change browser access.'); }
      }
    };
    host.querySelectorAll('[data-browser-session]').forEach((button) => { button.onclick = () => onAccess(button.dataset.browserSession); });
    for (const [key, callback] of [['profiles', options.onProfiles], ['import', options.onImport], ['clear', options.onClear]]) {
      const button = host.querySelector(`[data-browser-settings="${key}"]`);
      if (button) button.onclick = async () => { try { await callback(); } catch (error) { onError(error.message || 'Could not open browser settings.'); } };
    }
  } catch (error) {
    if (!current()) return;
    host.innerHTML = '<p class="bs-note" role="alert">Could not load browser settings.</p><button class="btn btn--small">Retry</button>';
    host.querySelector('button').onclick = () => wireBrowserSettings(modal, options);
  }
}
