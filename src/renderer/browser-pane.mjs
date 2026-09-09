// Native page content; all chrome remains the same DOM tile as other files.
export function createBrowserPane({ api, state, tiles, uid, esc, helpIcon, isFile, isSession, pin, focus, refresh, save,
  show, dialog, close, closePanel, toast, selection, settings }) {
  let frame = 0, signature = '';
  const notes = [];
  const q = (s, el = document) => el.querySelector(s);
  const button = (icon, title, action) => `<button class="t-btn" title="${title}" aria-label="${title}" data-browser-action="${action}">${helpIcon(icon)}</button>`;
  function schedule() { if (!frame) frame = requestAnimationFrame(layout); }
  function layout() {
    frame = 0;
    const hidden = !!state.overlay || !!q('#ctx-menu,.theme-pop,.projects-pop');
    const items = [];
    for (const [id, rec] of tiles) if (rec.browserViewport && rec.browserViewport.getClientRects().length) {
      const r = rec.browserViewport.getBoundingClientRect();
      const clip = rec.root.closest('.main')?.getBoundingClientRect();
      const x = Math.max(r.left, clip?.left || 0), y = Math.max(r.top, clip?.top || 0);
      const right = Math.min(r.right, clip?.right || innerWidth), bottom = Math.min(r.bottom, clip?.bottom || innerHeight);
      items.push({ id, x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) });
    }
    const data = { hidden, items }, next = JSON.stringify(data);
    if (signature !== next) { signature = next; api.browserLayout(data).catch(() => {}); }
  }
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
  // Menus, rail folding, pane moves and zoom can move a native child without
  // resizing the browser viewport itself. Observe geometry-affecting DOM state.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  function open(url = 'about:blank', filePath = null, owner = null, id = null, deferred = false) {
    const p = { id: id || uid('p_'), kind: 'browser', chipKind: 'viewer', code: 'WEB', title: filePath ? filePath.split('/').pop() : 'Browser', url, filePath, status: 'live', browserDeferred: deferred };
    pin(p, owner ? { owner } : {}); if (owner) { p.owner = owner; refresh(); } return p;
  }
  function newBrowser(owner) { show({ type: 'browser-new', owner }); }
  function renderNew() {
    const modal = dialog('modal modal--browser', `<div class="modal-head"><span class="title">New browser</span></div><div class="modal-body"><label class="field-label">Address</label><input class="field-input" id="browser-new-url" placeholder="http://localhost:3000" value="http://localhost:3000"></div><div class="modal-foot"><button class="btn" id="browser-new-cancel">Cancel</button><button class="btn btn--go" id="browser-new-open">Open browser</button></div>`);
    q('#browser-new-cancel', modal).onclick = close;
    q('#browser-new-open', modal).onclick = () => { const url = q('#browser-new-url', modal).value.trim(); if (!/^(https?:\/\/|localhost[:/]|127\.0\.0\.1[:/])/.test(url)) { toast('Enter an http:// or https:// address.'); return; } const owner = state.overlay.owner; close(); open(url, null, owner); };
    q('#browser-new-url', modal).onkeydown = (e) => { if (e.key === 'Enter') q('#browser-new-open', modal).click(); };
    q('#browser-new-url', modal).focus();
  }
  function tabs(p, rec) {
    if (!isFile(p)) return;
    if (!rec.companionTabs) { rec.companionTabs = document.createElement('div'); rec.companionTabs.className = 'companion-tabs'; rec.head.after(rec.companionTabs); }
    rec.companionTabs.hidden = state.view !== 'split';
    if (rec.companionTabs.hidden) return;
    const siblings = state.panels.filter((x) => isFile(x) && (x.owner || null) === (p.owner || null));
    rec.companionTabs.innerHTML = siblings.map((x) => `<button class="companion-tab${x.id === p.id ? ' selected' : ''}" data-view-id="${esc(x.id)}" title="${esc(x.title)}" aria-pressed="${x.id === p.id}">${esc(x.title)}</button>`).join('') + '<button class="companion-add" title="Add browser" aria-label="Add browser">＋</button>';
    rec.companionTabs.querySelectorAll('[data-view-id]').forEach((b) => b.onclick = () => focus(b.dataset.viewId));
    q('.companion-add', rec.companionTabs).onclick = () => newBrowser(p.owner);
  }
  function decorate() {
    for (const p of state.panels) { const rec = tiles.get(p.id); if (rec) tabs(p, rec); }
    const empty = q('.pane-files .pane-empty');
    if (empty && !q('button', empty)) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = '+ Browser'; b.onclick = () => newBrowser(state.split.sessionId); empty.appendChild(b); }
    api.browserSync(state.panels.filter((p) => isSession(p) && !p.exited).map((p) => ({ id: p.id, title: p.title }))).catch(() => {});
    schedule();
  }
  function mount(p, rec) {
    rec.root.classList.add('browser-tile'); rec.body.classList.add('browser-body');
    q('.t-zoom-out', rec.head).hidden = true; q('.t-zoom-in', rec.head).hidden = true;
    const annotate = q('.t-mic', rec.head); annotate.innerHTML = helpIcon('annotate'); annotate.title = 'Annotate'; annotate.setAttribute('aria-label', 'Annotate');
    annotate.onclick = () => { api.browserAction({ id: p.id, action: 'annotate' }).then(check); annotate.classList.add('active'); toast('Click an element in the page. Escape cancels.'); };
    rec.body.innerHTML = `<form class="browser-address">${button('back', 'Back', 'back')}${button('refresh', 'Reload', 'reload')}<input aria-label="Browser address" value="${esc(p.filePath || p.url)}" spellcheck="false"></form><div class="browser-error" role="status" hidden></div><div class="browser-viewport"></div><div class="browser-selection" hidden><button class="btn btn--small">Selection · Add to session…</button></div><div class="browser-foot"><button class="browser-context">Context &amp; access…</button><button class="browser-notes" hidden></button></div>`;
    rec.browserViewport = q('.browser-viewport', rec.body);
    const ro = new ResizeObserver(schedule); ro.observe(rec.browserViewport);
    rec.disposeBrowser = () => { ro.disconnect(); api.browserClose(p.id).catch(() => {}); };
    const form = q('form', rec.body);
    form.onsubmit = (event) => { event.preventDefault(); api.browserAction({ id: p.id, action: 'navigate', url: q('input', form).value }).then(check); };
    form.querySelectorAll('[data-browser-action]').forEach((b) => { b.type = 'button'; b.onclick = () => api.browserAction({ id: p.id, action: b.dataset.browserAction }).then(check); });
    q('.browser-context', rec.body).onclick = () => show({ type: 'browser-access', sessionId: p.owner || state.split.sessionId });
    q('.browser-notes', rec.body).onclick = () => reviewNotes(p);
    q('.browser-selection button', rec.body).onclick = () => annotateSelection(p, rec.pendingSelection);
    if (!p.browserDeferred) createNative(p);
  }
  function createNative(p) { api.browserCreate({ id: p.id, owner: p.owner, url: p.url, filePath: p.filePath }).then((r) => { check(r); signature = ''; schedule(); }); }
  function restore() { for (const p of state.panels) if (p.browserDeferred) { delete p.browserDeferred; createNative(p); } }
  function check(result) { if (!result?.ok) toast(result?.error || 'Browser action failed.'); return !!result?.ok; }
  function reference(n) { return [n.url, n.locator ? 'Element: ' + n.locator : n.label, n.note].filter(Boolean).join('\n'); }
  function annotateSelection(p, n) { if (!n) return; show({ type: 'browser-note', panelId: p.id, selection: n, note: '' }); }
  function renderNote() {
    const o = state.overlay, n = o.selection;
    const modal = dialog('modal modal--browser', `<div class="modal-head"><span class="title">Annotate selection</span></div><div class="modal-body selection-sheet"><div class="context-reference">${esc(n.url)}<br>${esc(n.locator || n.label)}</div><pre class="selection-preview">${esc(n.text)}</pre><label>Comment<textarea id="browser-comment" rows="3">${esc(o.note)}</textarea></label></div><div class="modal-foot"><button class="btn" id="browser-note-cancel">Cancel</button><button class="btn" id="browser-note-save">Save note</button><button class="btn btn--go" id="browser-note-insert">Add to session…</button></div>`);
    const capture = () => { n.note = q('#browser-comment', modal).value.trim(); notes.push({ ...n, panelId: o.panelId }); if (notes.length > 200) notes.shift(); updateNotes(); };
    q('#browser-note-cancel', modal).onclick = close;
    q('#browser-note-save', modal).onclick = () => { capture(); close(); toast('Note saved. Select more elements or switch tabs, then review the notes.'); };
    q('#browser-note-insert', modal).onclick = () => { capture(); const p = state.panels.find((p) => p.id === o.panelId); close(); selection(p || {}, { reference: reference(n), text: n.text || n.label }); };
    q('#browser-comment', modal).oninput = (e) => o.note = e.target.value;
    q('#browser-comment', modal).focus();
  }
  function updateNotes() { for (const rec of tiles.values()) if (rec.browserViewport) { const b = q('.browser-notes', rec.body); b.hidden = !notes.length; b.textContent = notes.length + (notes.length === 1 ? ' note · Review' : ' notes · Review'); } }
  function reviewNotes(p) { selection(p, { reference: 'Browser annotation notes', text: notes.map((n) => reference(n) + '\n' + n.text).join('\n\n') }); }
  function clearNotes() { notes.length = 0; }
  async function renderAccess() {
    const o = state.overlay;
    const modal = dialog('modal modal--browser', '<div class="modal-head"><span class="title">Context &amp; browser access</span></div><div class="modal-body" id="browser-access-body">Loading…</div><div class="modal-foot"><button class="btn" id="browser-access-cancel">Cancel</button><button class="btn btn--go" id="browser-access-save" disabled>Apply</button></div>');
    q('#browser-access-cancel', modal).onclick = close;
    const r = await api.browserStatus(); if (state.overlay !== o) return;
    if (!check(r)) return;
    const owner = r.sessions.find((s) => s.id === o.sessionId) || r.sessions[0];
    if (!owner) { q('#browser-access-body', modal).textContent = 'Open an agent session first.'; return; }
    o.sessionId = owner.id;
    q('#browser-access-body', modal).innerHTML = `<label class="field-label">Session<select id="browser-access-session">${r.sessions.map((s) => `<option value="${esc(s.id)}"${s.id === owner.id ? ' selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label><div class="field-label">Browser views</div>${r.views.map((v) => `<label class="browser-check"><input type="checkbox" data-grant-view="${esc(v.id)}"${owner.views.includes(v.id) ? ' checked' : ''}><span>${esc(v.title || v.url)}<small>${esc(v.url)}</small></span></label>`).join('')}<label class="browser-check"><input type="checkbox" id="browser-control"${owner.views.length ? ' checked' : ''}${r.enabled ? '' : ' disabled'}><span>Allow browser control on selected views</span></label><button class="shortcuts-link" id="browser-access-settings">${r.enabled ? 'Browser setup' : 'Enable in Settings → Browser'}</button><details class="browser-peers"><summary>Allow messages to other sessions</summary>${r.sessions.filter((s) => s.id !== owner.id).map((s) => `<label class="browser-check"><input type="checkbox" data-grant-peer="${esc(s.id)}"${owner.peers.includes(s.id) ? ' checked' : ''}>${esc(s.title)}</label>`).join('')}</details>`;
    q('#browser-access-session', modal).onchange = (e) => show({ type: 'browser-access', sessionId: e.target.value });
    q('#browser-access-settings', modal).onclick = () => settings('browser');
    const apply = q('#browser-access-save', modal); apply.disabled = false;
    apply.onclick = async () => {
      const ids = [...modal.querySelectorAll('[data-grant-view]:checked')].map((b) => b.dataset.grantView);
      const peers = [...modal.querySelectorAll('[data-grant-peer]:checked')].map((b) => b.dataset.grantPeer);
      if (q('#browser-control', modal).checked || peers.length || owner.views.length || owner.peers.length) {
        const granted = await api.browserGrant({ id: owner.id, viewIds: q('#browser-control', modal).checked ? ids : [], peers });
        if (!check(granted)) return;
        show({ type: 'browser-connection', url: granted.url, sessionId: owner.id, views: ids });
      } else { close(); if (ids.length) selection({ owner: owner.id }, { reference: 'Browser views (context references)', text: r.views.filter((v) => ids.includes(v.id)).map((v) => v.title + '\n' + v.url).join('\n\n') }); }
    };
  }
  function renderConnection() {
    const o = state.overlay, text = JSON.stringify({ mcpServers: { 'nami-browser': { type: 'http', url: o.url } } }, null, 2);
    const modal = dialog('modal modal--browser', `<div class="modal-head"><span class="title">Connect this session</span></div><div class="modal-body selection-sheet"><p>Use this connection for this agent session. Anyone given its URL can use the selected views and peers.</p><label class="field-label">MCP URL<input readonly id="browser-mcp-url" value="${esc(o.url)}"></label><pre class="selection-preview">${esc(text)}</pre><p class="note">The commands below launch Claude or Codex with this connection for that run. For other HTTP MCP clients, use their per-session configuration. This connection lasts until Nami closes or access changes; restart the agent’s MCP connection after updating it.</p><div class="browser-client-commands"><button class="btn" id="browser-copy-claude">Copy Claude command</button><button class="btn" id="browser-copy-codex">Copy Codex command</button><button class="btn" id="browser-copy-json">Copy JSON</button></div></div><div class="modal-foot"><button class="btn" id="browser-copy-url">Copy URL</button><button class="btn btn--go" id="browser-connection-done">Done</button></div>`);
    const copy = (value) => api.copyText(value).then(() => toast('Copied.'));
    q('#browser-copy-url', modal).onclick = () => copy(o.url);
    q('#browser-copy-json', modal).onclick = () => copy(text);
    q('#browser-copy-claude', modal).onclick = () => copy("claude --mcp-config '" + JSON.stringify({ mcpServers: { 'nami-browser': { type: 'http', url: o.url } } }) + "'");
    q('#browser-copy-codex', modal).onclick = () => copy("codex -c 'mcp_servers.nami_browser.url=\"" + o.url + "\"'");
    q('#browser-connection-done', modal).onclick = close;
  }
  function settingsHtml() { return '<div id="browser-settings-body"><p class="note">Loading browser settings…</p></div>'; }
  async function wireSettings(modal) {
    const r = await api.browserStatus(), host = q('#browser-settings-body', modal);
    if (!host?.isConnected || !check(r)) return;
    host.innerHTML = `<h3>Browser access</h3><p class="note">Connect compatible MCP clients to selected Nami views. Text selections work without enabling browser control.</p><label class="browser-check"><input type="checkbox" id="browser-enabled"${r.enabled ? ' checked' : ''}>Enable local browser connection</label><p class="note">Configure access per session. No model list limits which MCP clients can connect.</p>${r.sessions.map((s) => `<div class="browser-settings-session"><span>${esc(s.title)}<small>${s.views.length} browser views · ${s.peers.length} peers</small></span><button class="btn btn--small" data-browser-session="${esc(s.id)}">Configure…</button></div>`).join('') || '<p class="note">Open an agent session to configure its access.</p>'}`;
    q('#browser-enabled', host).onchange = async (e) => { const result = await api.browserEnable(e.target.checked); if (check(result)) wireSettings(modal); };
    host.querySelectorAll('[data-browser-session]').forEach((b) => b.onclick = () => show({ type: 'browser-access', sessionId: b.dataset.browserSession }));
  }
  api.onBrowserEvent((event) => {
    let p = state.panels.find((p) => p.id === event.id), rec = tiles.get(event.id);
    if (event.type === 'created') { if (!p) open(event.url, null, event.owner, event.id); return; }
    if (event.type === 'closed') { if (p) closePanel(p.id); return; }
    if (event.type === 'message') { const target = state.panels.find((p) => p.id === event.sessionId); if (target) { target.browserMessages ||= []; target.browserMessages.push(event.message); target.browserMessages = target.browserMessages.slice(-100); toast('Message for ' + target.title + '. Right-click its header to review.'); } return; }
    if (!p || !rec) return;
    if (event.type === 'focus' && !state.overlay) focus(p.id, false);
    if (event.type === 'state') { p.url = event.url; p.filePath = event.filePath || null; if (event.title) p.title = event.title; const input = q('.browser-address input', rec.body); if (document.activeElement !== input) input.value = event.url; q('.t-title', rec.head).textContent = p.title; q('[data-browser-action="back"]', rec.body).disabled = !event.canBack; if (!event.loading) { tabs(p, rec); save(); } }
    if (event.type === 'new-tab') open(event.url, null, p.owner);
    if (event.type === 'error') { const e = q('.browser-error', rec.body); e.hidden = !event.error; e.textContent = event.error; }
    if (event.type === 'selection') { q('.t-mic', rec.head).classList.remove('active'); annotateSelection(p, event.selection); }
    if (event.type === 'text-selection') { rec.pendingSelection = event.selection; q('.browser-selection', rec.body).hidden = false; }
    if (event.type === 'annotation-end') q('.t-mic', rec.head).classList.remove('active');
    schedule();
  });
  function inbox(p) {
    if (!p.browserMessages?.length) { toast('No messages for this session.'); return; }
    selection({ owner: p.id }, { reference: 'Messages for ' + p.title, text: p.browserMessages.map((m) => 'From ' + m.title + '\n' + m.text).join('\n\n') });
  }
  return { open, mount, restore, decorate, schedule, clearNotes, newBrowser, renderNew, renderNote, renderAccess, renderConnection, settingsHtml, wireSettings, inbox };
}
