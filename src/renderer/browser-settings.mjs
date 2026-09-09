// Settings content only: the app owns its modal, navigation and profile flows.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function browserSettingsHtml() {
  return '<div id="browser-settings-body" class="browser-settings"><p class="bs-note" role="status">Loading browser settings…</p></div>';
}

function permissionRows(profiles) {
  const rows = [];
  for (const profile of profiles || []) {
    for (const [origin, perms] of Object.entries(profile.permissions || {})) {
      for (const [permission, value] of Object.entries(perms || {})) {
        rows.push({ profileId: profile.id, origin, permission, value });
      }
    }
  }
  return rows;
}

export function browserSettingsContent(status, actions = {}) {
  const sessions = status.sessions || [], profiles = status.profiles || [];
  const profile = profiles[0] || {};
  const download = profile.downloadMode === 'auto' ? 'auto' : 'ask';
  const popup = profile.popupMode === 'oauth' ? 'oauth' : 'block';
  const sites = permissionRows(profiles);
  const cookieNote = status.cookieImport?.message || (status.cookieImport?.decrypt === 'unavailable'
    ? 'Chrome’s cookie encryption could not be copied. Import a password CSV instead.'
    : 'One-time copy into the current Nami profile. Google cookies are skipped. Chrome is unchanged.');
  return `<section class="bs-section" aria-labelledby="browser-agent-heading">
    <h3 class="field-label" id="browser-agent-heading">Agent browser access</h3>
    <label class="bs-toggle"><input type="checkbox" id="browser-enabled"${status.enabled ? ' checked' : ''}><span>Enable local browser connection<small>Access must be granted separately for each session.</small></span></label>
    ${sessions.map((s) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(s.title)}</strong><small>${s.views?.length ? `${s.views.length} permitted ${s.views.length === 1 ? 'tab' : 'tabs'} · Access configured` : 'No browser access'}</small></div><button class="btn btn--small" data-browser-session="${esc(s.id)}">Configure…</button></div>`).join('') || '<p class="bs-note">Open an agent session to configure access.</p>'}
    <p class="bs-note">Configuring access does not confirm that a client is connected.</p>
  </section>
  <section class="bs-section" aria-labelledby="browser-download-heading">
    <h3 class="field-label" id="browser-download-heading">Downloads</h3>
    <label class="bs-toggle"><input type="radio" name="browser-download" id="browser-download-ask" value="ask"${download === 'ask' ? ' checked' : ''}><span>Ask where to save</span></label>
    <label class="bs-toggle"><input type="radio" name="browser-download" id="browser-download-auto" value="auto"${download === 'auto' ? ' checked' : ''}><span>Save to Downloads</span></label>
  </section>
  <section class="bs-section" aria-labelledby="browser-popup-heading">
    <h3 class="field-label" id="browser-popup-heading">Popups</h3>
    <p class="bs-note">http(s) links open as a new tab.</p>
    <label class="bs-toggle"><input type="radio" name="browser-popups" id="browser-popups-block" value="block"${popup === 'block' ? ' checked' : ''}><span>Block other popups</span></label>
    <label class="bs-toggle"><input type="radio" name="browser-popups" id="browser-popups-oauth" value="oauth"${popup === 'oauth' ? ' checked' : ''}><span>Allow OAuth-style popups</span></label>
  </section>
  <section class="bs-section" aria-labelledby="browser-media-heading">
    <h3 class="field-label" id="browser-media-heading">Camera &amp; microphone</h3>
    <p class="bs-note">Denied until you allow a site. Remembered per origin.</p>
    ${sites.length ? sites.map((row) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(row.origin)}</strong><small>${esc(row.permission)}${row.value === 'asked' ? ' · asked' : ''}</small></div><label class="bs-toggle"><input type="checkbox" data-browser-permission="${esc(row.origin)}" data-permission="${esc(row.permission)}" data-profile="${esc(row.profileId)}"${row.value === 'allow' ? ' checked' : ''}><span>Allow</span></label></div>`).join('') : '<p class="bs-note">No sites have asked yet.</p>'}
  </section>
  <section class="bs-section" aria-labelledby="browser-profile-heading"><h3 class="field-label" id="browser-profile-heading">Profiles</h3>
    ${profiles.length ? profiles.map((p) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(p.name || p.id)}</strong><small>${p.viewCount ? `${p.viewCount} ${p.viewCount === 1 ? 'tab' : 'tabs'}` : 'Browser profile'}</small></div></div>`).join('') : `<p class="bs-note">${status.profileLoadError ? 'Could not load profiles.' : 'Sign into websites in a tab.'}</p>`}
    <p class="bs-note">${esc(cookieNote)}</p>
    <div class="bs-actions">${actions.onProfiles ? '<button class="btn btn--small" data-browser-settings="profiles">Manage profiles…</button>' : ''}${actions.onImportCookies ? '<button class="btn btn--small" data-browser-settings="cookies">Import from Chrome…</button>' : ''}${actions.onClear ? '<button class="btn btn--small" data-browser-settings="clear">Clear browsing data…</button>' : ''}</div>
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
    if (profileResult?.capabilities?.cookieImport) status.cookieImport = profileResult.capabilities.cookieImport;
    host.innerHTML = browserSettingsContent(status, options);
    const profileId = status.profiles?.[0]?.id;
    const configure = async (patch) => {
      if (!profileId || !api.browserProfiles) return;
      const result = await api.browserProfiles({ action: 'configure', profileId, ...patch });
      if (result?.error) throw new Error(result.error);
    };
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
    host.querySelectorAll('[name="browser-download"]').forEach((input) => { input.onchange = async () => { try { await configure({ downloadMode: input.value }); } catch (error) { onError(error.message || 'Could not change downloads.'); } }; });
    host.querySelectorAll('[name="browser-popups"]').forEach((input) => { input.onchange = async () => { try { await configure({ popupMode: input.value }); } catch (error) { onError(error.message || 'Could not change popups.'); } }; });
    host.querySelectorAll('[data-browser-permission]').forEach((input) => {
      input.onchange = async () => {
        try { await configure({ origin: input.dataset.browserPermission, permission: input.dataset.permission, value: input.checked ? 'allow' : 'deny', profileId: input.dataset.profile || profileId }); }
        catch (error) { input.checked = !input.checked; onError(error.message || 'Could not change site permission.'); }
      };
    });
    host.querySelectorAll('[data-browser-session]').forEach((button) => { button.onclick = () => onAccess(button.dataset.browserSession); });
    for (const [key, callback] of [['profiles', options.onProfiles], ['import', options.onImport], ['cookies', options.onImportCookies], ['clear', options.onClear]]) {
      const button = host.querySelector(`[data-browser-settings="${key}"]`);
      if (button) button.onclick = async () => { try { await callback(); } catch (error) { onError(error.message || 'Could not open browser settings.'); } };
    }
  } catch (error) {
    if (!current()) return;
    host.innerHTML = '<p class="bs-note" role="alert">Could not load browser settings.</p><button class="btn btn--small">Retry</button>';
    host.querySelector('button').onclick = () => wireBrowserSettings(modal, options);
  }
}
