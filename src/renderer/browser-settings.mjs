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
  const profiles = status.profiles || [];
  const profileId = actions.profileId ?? status.defaultProfileId ?? profiles[0]?.id;
  const profile = profiles.find(p => p.id === profileId) || {};
  const defaultProfile = profiles.find(p => p.id === status.defaultProfileId) || profiles[0];
  const download = profile.downloadMode === 'auto' ? 'auto' : 'ask';
  const popup = profile.popupMode === 'oauth' ? 'oauth' : 'block';
  const sites = permissionRows(profile.id ? [profile] : []);
  const blank = status.newTab === 'dark' || status.newTab === 'light' ? status.newTab : 'system';
  const selection = `<section class="bs-section" aria-labelledby="browser-selection-heading">
    <label class="field-label" id="browser-selection-heading" for="browser-settings-profile">Settings for profile</label>
    <select id="browser-settings-profile">${!profile.id ? '<option value="" selected>Choose a profile</option>' : ''}${profiles.map(p => `<option value="${esc(p.id)}"${p.id === profile.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <p class="bs-note">New browser tabs use ${esc(defaultProfile?.name || 'the selected profile')}. Existing tabs keep their profiles.</p>
    ${profile.id && profile.id !== defaultProfile?.id ? `<button class="btn btn--small" data-browser-settings="default">Use ${esc(profile.name)} for new tabs</button>` : ''}
  </section>`;
  if (!profile.id) return selection + '<p class="bs-note" role="status">Choose an available profile to view its settings.</p>';
  return selection + `<section class="bs-section" aria-labelledby="browser-blank-heading">
    <h3 class="field-label" id="browser-blank-heading">New tab</h3>
    <label class="bs-toggle"><input type="radio" name="browser-blank" id="browser-blank-light" value="light"${blank === 'light' ? ' checked' : ''}><span>Light</span></label>
    <label class="bs-toggle"><input type="radio" name="browser-blank" id="browser-blank-dark" value="dark"${blank === 'dark' ? ' checked' : ''}><span>Dark</span></label>
    <label class="bs-toggle"><input type="radio" name="browser-blank" id="browser-blank-system" value="system"${blank === 'system' ? ' checked' : ''}><span>System</span></label>
    <p class="bs-note">System follows Nami’s theme, and websites follow it too.</p>
  </section>
  <section class="bs-section" aria-labelledby="browser-download-heading">
    <h3 class="field-label" id="browser-download-heading">Downloads</h3>
    <label class="bs-toggle"><input type="radio" name="browser-download" id="browser-download-ask" value="ask"${download === 'ask' ? ' checked' : ''}><span>Ask where to save</span></label>
    <label class="bs-toggle"><input type="radio" name="browser-download" id="browser-download-auto" value="auto"${download === 'auto' ? ' checked' : ''}><span>Save to Downloads</span></label>
  </section>
  <section class="bs-section" aria-labelledby="browser-popup-heading">
    <h3 class="field-label" id="browser-popup-heading">Popups</h3>
    <label class="bs-toggle"><input type="radio" name="browser-popups" id="browser-popups-block" value="block"${popup === 'block' ? ' checked' : ''}><span>Block other popups</span></label>
    <label class="bs-toggle"><input type="radio" name="browser-popups" id="browser-popups-oauth" value="oauth"${popup === 'oauth' ? ' checked' : ''}><span>Allow OAuth-style popups</span></label>
  </section>
  <section class="bs-section" aria-labelledby="browser-media-heading">
    <h3 class="field-label" id="browser-media-heading">Site permissions</h3>
    ${sites.length ? sites.map((row) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(row.origin)}</strong><small>${esc(row.permission)}</small></div><label class="bs-toggle"><input type="checkbox" data-browser-permission="${esc(row.origin)}" data-permission="${esc(row.permission)}" data-profile="${esc(row.profileId)}"${row.value === 'allow' ? ' checked' : ''}><span>Allow</span></label></div>`).join('') : '<p class="bs-note">No site has asked for anything yet. Camera, microphone and storage requests land here, switched off until you allow them.</p>'}
  </section>
  <section class="bs-section" aria-labelledby="browser-profile-heading"><h3 class="field-label" id="browser-profile-heading">Profiles</h3>
    ${profiles.length ? profiles.map((p) => `<div class="bs-row"><div class="bs-row-label"><strong>${esc(p.name || p.id)}</strong><small>${p.viewCount ? `${p.viewCount} ${p.viewCount === 1 ? 'tab' : 'tabs'}` : 'Browser profile'}</small></div></div>`).join('') : `<p class="bs-note">${status.profileLoadError ? 'Could not load profiles.' : 'Sign into websites in a tab.'}</p>`}
    <div class="bs-actions">${actions.onProfiles ? '<button class="btn btn--small" data-browser-settings="profiles">Manage profiles…</button>' : ''}${actions.onImportCookies ? '<button class="btn btn--small" data-browser-settings="cookies">Import from Chrome…</button>' : ''}${actions.onClear ? '<button class="btn btn--small" data-browser-settings="clear">Clear browsing data…</button>' : ''}</div>
  </section>`;
}

export async function wireBrowserSettings(modal, options) {
  const { api, onError = () => {} } = options;
  const host = modal.querySelector('#browser-settings-body');
  if (!host) return;
  const token = {}; host._browserSettingsRequest = token;
  const current = () => host.isConnected && host._browserSettingsRequest === token;
  try {
    const [status, profileResult] = await Promise.all([api.browserStatus(), api.browserProfiles ? api.browserProfiles({ action: 'list' }) : null]);
    if (!current()) return;
    if (status?.error || profileResult?.error) throw new Error(status?.error || profileResult.error);
    if (profileResult?.profiles) status.profiles = profileResult.profiles.map((profile) => ({ ...profile, viewCount: (status.views || []).filter((view) => view.profileId === profile.id).length }));
    if (profileResult?.defaultProfileId) status.defaultProfileId = profileResult.defaultProfileId;
    if (profileResult?.capabilities?.cookieImport) status.cookieImport = profileResult.capabilities.cookieImport;
    if (profileResult?.capabilities?.newTab) status.newTab = profileResult.capabilities.newTab;
    const activeView = status.views?.find(view => view.id === options.panelId);
    const profileId = options.profileId ?? activeView?.profileId ?? status.defaultProfileId ?? status.profiles?.[0]?.id;
    options.onProfileChange?.(profileId);
    host.innerHTML = browserSettingsContent(status, { ...options, profileId });
    const refresh = () => current() ? wireBrowserSettings(modal, { ...options, profileId }) : undefined;
    const picker = host.querySelector('#browser-settings-profile');
    if (picker) picker.onchange = () => {
      options.onProfileChange?.(picker.value);
      return wireBrowserSettings(modal, { ...options, profileId: picker.value });
    };
    let saving = false;
    const save = async (args) => {
      if (saving || !current()) return;
      saving = true;
      host.querySelectorAll('input,select,button').forEach(input => input.disabled = true);
      try {
        const result = await api.browserProfiles(args);
        if (result?.error || !result?.ok) throw new Error(result?.error || 'Could not save browser settings.');
        await refresh();
      } catch (error) {
        // Read the saved values again so a rejected change cannot look accepted.
        if (current()) { await refresh(); onError(error.message || 'Could not save browser settings.'); }
      }
    };
    host.querySelectorAll('[name="browser-blank"]').forEach(input => {
      input.onchange = () => save({ action: 'new-tab', value: input.value });
    });
    host.querySelectorAll('[name="browser-download"]').forEach(input => {
      input.onchange = () => save({ action: 'configure', profileId, downloadMode: input.value });
    });
    host.querySelectorAll('[name="browser-popups"]').forEach(input => {
      input.onchange = () => save({ action: 'configure', profileId, popupMode: input.value });
    });
    host.querySelectorAll('[data-browser-permission]').forEach(input => {
      input.onchange = () => save({ action: 'configure', profileId, origin: input.dataset.browserPermission,
        permission: input.dataset.permission, value: input.checked ? 'allow' : 'deny' });
    });
    const defaultButton = host.querySelector('[data-browser-settings="default"]');
    if (defaultButton) defaultButton.onclick = () => save({ action: 'set-default', profileId });
    // Management keeps a tab context only when it actually uses this profile.
    const context = { profileId, panelId: activeView?.profileId === profileId ? activeView.id : undefined };
    for (const [key, callback] of [['profiles', options.onProfiles], ['import', options.onImport], ['cookies', options.onImportCookies], ['clear', options.onClear]]) {
      const button = host.querySelector(`[data-browser-settings="${key}"]`);
      if (button) button.onclick = async () => { try { await callback(context); } catch (error) { onError(error.message || 'Could not open browser settings.'); } };
    }
  } catch (error) {
    if (!current()) return;
    host.innerHTML = '<p class="bs-note" role="alert">Could not load browser settings.</p><button class="btn btn--small">Retry</button>';
    host.querySelector('button').onclick = () => wireBrowserSettings(modal, options);
  }
}
