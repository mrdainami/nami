import { createBrowserAnnotations } from './browser-annotations.mjs';
import { browserSettingsHtml, wireBrowserSettings } from './browser-settings.mjs';
import { createBrowserOverlays } from './browser-overlays.mjs';
// Native page content; all chrome remains the same DOM tile as other files.
export function createBrowserPane({ api, state, tiles, uid, esc, helpIcon, isFile, isSession, pin, focus, refresh, save,
  show, dialog, close, closePanel, toast, selection, settings, dictation, insertAnnotation, sessions, shareTab, panelIcon }) {
  let frame = 0, signature = '';
  const annotations = createBrowserAnnotations({ api, esc, icon:helpIcon, selection, toast, dictation, focus, insertAnnotation, sessions, onChange:schedule, confirmDiscard:count=>api.browserConfirmDiscard(count) });
  const overlays = createBrowserOverlays({ api });
  const q = (s, el = document) => el.querySelector(s);
  const button = (icon, title, action) => `<button class="t-btn" title="${title}" aria-label="${title}" data-browser-action="${action}">${helpIcon(icon)}</button>`;
  function schedule() { if (!frame) frame = requestAnimationFrame(layout); }
  function layout() {
    frame = 0;
    for (const [id,rec] of tiles) if(rec.browserViewport) {
      const b=q('.browser-annotate',rec.body),active=annotations.isActive(id);
      if(b){b.classList.toggle('is-on',active);b.setAttribute('aria-pressed',String(active));b.textContent=active?'Annotating':'Annotate';}
    }
    const hidden = !!state.overlay;
    const items = [];
    for (const [id, rec] of tiles) if (rec.browserViewport && rec.browserViewport.getClientRects().length) {
      const r = rec.browserViewport.getBoundingClientRect();
      const clip = rec.root.closest('.main')?.getBoundingClientRect();
      const x = Math.max(r.left, clip?.left || 0), y = Math.max(r.top, clip?.top || 0);
      const right = Math.min(r.right, clip?.right || innerWidth), bottom = Math.min(r.bottom, clip?.bottom || innerHeight);
      items.push({ id, x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) });
    }
    const pending=state.panels.filter(p=>p.kind==='browser').map(p=>({id:p.id,count:annotations.pendingCount?.(p.id) || annotations.store.tab(p.id).length}));
    const data = { hidden, items, pending }, next = JSON.stringify(data);
    if (signature !== next) { signature = next; api.browserLayout(data).then(() => overlays.sync(items, hidden, pending.reduce((n,p)=>n+p.count,0))).catch(() => {}); } else overlays.sync(items, hidden, pending.reduce((n,p)=>n+p.count,0));
  }
  document.addEventListener('input', schedule);
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='l'){const rec=tiles.get(state.activeId);if(rec?.browserViewport){e.preventDefault();q('.browser-address input',rec.body).focus();q('.browser-address input',rec.body).select();}}});
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
  // Menus, rail folding, pane moves and zoom can move a native child without
  // resizing the browser viewport itself. Observe geometry-affecting DOM state.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-theme', 'data-glass', 'data-soft'] });
  function open(url = 'about:blank', filePath = null, owner = null, id = null, deferred = false, profileId = null) {
    const p = { id: id || uid('p_'), kind: 'browser', chipKind: 'viewer', code: 'WEB', title: filePath ? filePath.split('/').pop() : 'Browser', url, filePath, status: 'live', browserDeferred: deferred, profileId };
    pin(p, owner ? { owner } : {}); if (owner) { p.owner = owner; refresh(); } return p;
  }
  function newBrowser(owner) {
    const active=state.panels.find(p=>p.id===state.activeId && p.kind==='browser');
    const p=open('about:blank', null, owner, null, false, active?.profileId);
    p.focusAddress = true;
    return p;
  }
  function renderNew() {
    const {owner,profileId}=state.overlay||{};
    close();
    const p=open('about:blank', null, owner, null, false, profileId);
    p.focusAddress = true;
  }
  function tabs(p, rec) {
    if (!isFile(p) && !p.companionOf) return;
    if (!rec.companionTabs) { rec.companionTabs = document.createElement('div'); rec.companionTabs.className = 'companion-tabs'; rec.head.after(rec.companionTabs); }
    rec.companionTabs.hidden = state.view !== 'split';
    if (rec.companionTabs.hidden) return;
    const owner=p.companionOf||p.owner;
    const siblings = state.panels.filter(x => (isFile(x) && (x.owner||null)===(owner||null)) || (owner && x.companionOf===owner));
    rec.companionTabs.innerHTML = siblings.map(x=>`<span class="companion-tab-item${x.id===p.id?' selected':''}"><button class="companion-tab" data-view-id="${esc(x.id)}" title="${esc(x.title)}" aria-pressed="${x.id===p.id}">${panelIcon?.(x)||''}<span>${esc(x.title)}</span></button><button class="companion-close" data-close-id="${esc(x.id)}" aria-label="Close ${esc(x.title)}" title="Close tab">×</button></span>`).join('')+'<button class="companion-add" title="New browser tab" aria-label="New browser tab">＋</button>';
    rec.companionTabs.querySelectorAll('[data-view-id]').forEach(b=>{
      b.onclick=()=>focus(b.dataset.viewId);
      b.oncontextmenu=e=>{e.preventDefault();const tab=siblings.find(x=>x.id===b.dataset.viewId);if(tab.kind==='browser')shareTab?.(tab,e.clientX,e.clientY);};
    });
    rec.companionTabs.querySelectorAll('[data-close-id]').forEach(b=>b.onclick=e=>{e.stopPropagation();closePanel(b.dataset.closeId);});
    q('.companion-add',rec.companionTabs).onclick=()=>newBrowser(owner);
  }
  function decorate() {
    for (const p of state.panels) { const rec = tiles.get(p.id); if (rec) tabs(p, rec); }
    const empty = q('.pane-files .pane-empty');
    if (empty && !q('button', empty)) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = '+ Add'; b.onclick = () => newBrowser(state.split.sessionId); empty.appendChild(b); }
    api.browserSync(state.panels.filter((p) => isSession(p) && !p.exited).map((p) => ({ id: p.id, title: p.title }))).catch(() => {});
    schedule();
  }
  function mount(p, rec) {
    rec.root.classList.add('browser-tile'); rec.body.classList.add('browser-body');
    q('.t-zoom-out', rec.head).hidden = true; q('.t-zoom-in', rec.head).hidden = true;
    q('.t-mic', rec.head).hidden = true;
    rec.body.innerHTML = `<form class="browser-address">${button('back', 'Back', 'back')}${button('forward', 'Forward', 'forward')}${button('refresh', 'Reload', 'reload')}<input aria-label="Browser address" placeholder="Search or enter address" value="${esc(p.filePath || (p.url && p.url !== 'about:blank' ? p.url : ''))}" spellcheck="false"><button type="button" class="browser-annotate" aria-pressed="false" title="Annotate">Annotate</button>${button('more', 'Browser menu', 'menu')}</form><div class="browser-error" role="status" hidden></div><div class="browser-viewport"></div><div class="browser-selection" hidden><button class="btn btn--small">Selection · Add to session…</button></div>`;
    rec.browserViewport = q('.browser-viewport', rec.body);
    const disposeAnnotations = annotations.mount(p, rec.browserViewport);
    const ro = new ResizeObserver(schedule); ro.observe(rec.browserViewport);
    rec.disposeBrowser = () => { disposeAnnotations(); ro.disconnect(); api.browserClose(p.id).catch(() => {}); };
    const form = q('form', rec.body);
    form.onsubmit = async (event) => { event.preventDefault(); const value=q('input',form).value.trim(); if(p.filePath&&value===p.filePath){api.browserAction({id:p.id,action:'reload'}).then(check);return;} const r = await api.browserResolve(value); if (check(r) && r.url) api.browserAction({ id: p.id, action: 'navigate', url: r.url }).then(check); };
    form.querySelectorAll('[data-browser-action]').forEach((b) => { b.type = 'button'; b.onclick = () => b.dataset.browserAction === 'menu' ? openMenu(p, b) : api.browserAction({ id: p.id, action: b.dataset.browserAction }).then(check); });
    q('.browser-annotate', form).onclick = () => { annotations.toggle(p); schedule(); };
    q('.browser-selection button', rec.body).onclick = () => annotateSelection(p, rec.pendingSelection);
    if (p.focusAddress) { delete p.focusAddress; const input = q('input', form); requestAnimationFrame(() => { input.focus(); input.select(); }); }
    if (!p.browserDeferred) createNative(p);
  }
  function createNative(p) { api.browserCreate({ id: p.id, owner: p.owner, url: p.url, filePath: p.filePath, profileId:p.profileId }).then((r) => { check(r); signature = ''; schedule(); }); }
  function restore() { for (const p of state.panels) if (p.browserDeferred) { delete p.browserDeferred; createNative(p); } }
  function check(result) { if (!result?.ok) toast(result?.error || 'Browser action failed.'); return !!result?.ok; }
  function annotateSelection(p, n) { if (n) annotations.edit(p, n); }
  function renderNote() { const o=state.overlay, p=state.panels.find(p=>p.id===o.panelId); close(); if(p) annotations.edit(p,o.selection); }
  function reviewNotes(p) { annotations.review(p); }
  function clearNotes(p) { annotations.clear(p); }
  async function renderAccess() {
    const o = state.overlay;
    const modal = dialog('modal modal--browser', '<div class="modal-head"><span class="title">Browser access</span></div><div class="modal-body" id="browser-access-body">Loading…</div><div class="modal-foot"><button class="btn" id="browser-access-cancel">Cancel</button><button class="btn" id="browser-access-revoke">Revoke access</button><button class="btn btn--go" id="browser-access-save" disabled>Save access</button></div>');
    q('#browser-access-cancel', modal).onclick = close;
    const r = await api.browserStatus(); if (state.overlay !== o) return;
    if (!check(r)) return;
    const owner = r.sessions.find((s) => s.id === o.sessionId) || r.sessions[0];
    if (!owner) { q('#browser-access-body', modal).textContent = 'Open an agent session first.'; return; }
    o.sessionId = owner.id;
    q('#browser-access-body', modal).innerHTML = `<label class="field-label">Session<select id="browser-access-session">${r.sessions.map((s) => `<option value="${esc(s.id)}"${s.id === owner.id ? ' selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label><div class="field-label">Browser views</div>${r.views.map((v) => `<label class="browser-check"><input type="checkbox" data-grant-view="${esc(v.id)}"${owner.views.includes(v.id) ? ' checked' : ''}><span>${esc(v.title || v.url)}<small>${esc(v.url)}</small></span></label>`).join('')}<label class="browser-check"><input type="checkbox" id="browser-control"${owner.views.length ? ' checked' : ''}${r.enabled ? '' : ' disabled'}><span>Allow browser control on selected views</span></label><button class="shortcuts-link" id="browser-access-settings">${r.enabled ? 'Browser setup' : 'Enable in Settings → Browser'}</button><details class="browser-peers"><summary>Allow messages to other sessions</summary>${r.sessions.filter((s) => s.id !== owner.id).map((s) => `<label class="browser-check"><input type="checkbox" data-grant-peer="${esc(s.id)}"${owner.peers.includes(s.id) ? ' checked' : ''}>${esc(s.title)}</label>`).join('')}</details>`;
    q('#browser-access-session', modal).onchange = (e) => show({ type: 'browser-access', sessionId: e.target.value });
    q('#browser-access-settings', modal).onclick = () => settings('browser');
    q('#browser-access-revoke', modal).onclick = async () => { const result = await api.browserGrant({id:owner.id,viewIds:[],peers:[]}); if (check(result)) { close(); toast('Browser access revoked.'); } };
    const apply = q('#browser-access-save', modal); apply.disabled = !r.enabled;
    apply.onclick = async () => {
      const ids = [...modal.querySelectorAll('[data-grant-view]:checked')].map((b) => b.dataset.grantView);
      const peers = [...modal.querySelectorAll('[data-grant-peer]:checked')].map((b) => b.dataset.grantPeer);
      const granted = await api.browserGrant({ id: owner.id, viewIds: q('#browser-control', modal).checked ? ids : [], peers, expectedIdentities:Object.fromEntries(r.views.map(v=>[v.id,v.identity])) });
      if (!check(granted)) return;
      if (!granted.url) { close(); toast('Browser access revoked.'); return; }
      show({ type: 'browser-connection', url: granted.url, sessionId: owner.id, views: ids });
    };
  }
  function renderConnection() {
    const o = state.overlay, text = JSON.stringify({ mcpServers: { 'nami-browser': { type: 'http', url: o.url } } }, null, 2);
    const modal = dialog('modal modal--browser', `<div class="modal-head"><span class="title">Access configured</span></div><div class="modal-body selection-sheet"><p>Connect your MCP client to use this permission. Configuring access does not connect the client automatically.</p><details><summary>Connection details</summary><p>Use this connection for this agent session. Anyone given its URL can use the selected views and peers.</p><label class="field-label">MCP URL<input readonly id="browser-mcp-url" value="${esc(o.url)}"></label><pre class="selection-preview">${esc(text)}</pre><p class="note">The commands below launch Claude or Codex with this connection for that run. For other HTTP MCP clients, use their per-session configuration. This connection lasts for this Nami session. Adding or removing shared tabs updates access without changing the connection. A client that was started without Nami Browser still needs setup.</p><div class="browser-client-commands"><button class="btn" id="browser-copy-claude">Copy Claude command</button><button class="btn" id="browser-copy-codex">Copy Codex command</button><button class="btn" id="browser-copy-json">Copy JSON</button></div></details></div><div class="modal-foot"><button class="btn" id="browser-copy-url">Copy URL</button><button class="btn btn--go" id="browser-connection-done">Done</button></div>`);
    const copy = (value) => api.copyText(value).then(() => toast('Copied.'));
    q('#browser-copy-url', modal).onclick = () => copy(o.url);
    q('#browser-copy-json', modal).onclick = () => copy(text);
    q('#browser-copy-claude', modal).onclick = () => copy("claude --mcp-config '" + JSON.stringify({ mcpServers: { 'nami-browser': { type: 'http', url: o.url } } }) + "'");
    q('#browser-copy-codex', modal).onclick = () => copy("codex -c 'mcp_servers.nami_browser.url=\"" + o.url + "\"'");
    q('#browser-connection-done', modal).onclick = close;
  }
  let menu = null;
  function closeMenu() { menu?.remove(); menu = null; schedule(); }
  function openMenu(p, anchor) {
    closeMenu();
    menu = document.createElement('div'); menu.className = 'browser-menu'; menu.setAttribute('role','menu');
    const actions = [
      ['Find in page', () => findInPage(p)],
      ['Zoom in', () => api.browserAction({id:p.id,action:'zoom',value:p.pageZoom=Math.min(3,(p.pageZoom||1)+0.1)}).then(check)],
      ['Zoom out', () => api.browserAction({id:p.id,action:'zoom',value:p.pageZoom=Math.max(0.5,(p.pageZoom||1)-0.1)}).then(check)],
      ['Reset zoom', () => api.browserAction({id:p.id,action:'zoom',value:p.pageZoom=1}).then(check)],
      ['Take screenshot…', () => api.browserAction({id:p.id,action:'capture'}).then(check)],
      ['Browser access…', () => show({type:'browser-access',sessionId:p.owner || state.split.sessionId})],
      ['Import from Chrome…', () => show({type:'browser-import',panelId:p.id})],
      ['Manage profiles…', () => show({type:'browser-profiles',panelId:p.id})],
      ['Clear browsing data…', () => show({type:'browser-profiles',panelId:p.id,section:'clear'})],
      ['Browser settings…', () => settings('browser')],
    ];
    for (const [label, run] of actions) { const b = document.createElement('button'); b.type='button'; b.setAttribute('role','menuitem'); b.textContent=label; b.onclick=()=>{closeMenu();run();}; menu.appendChild(b); }
    document.body.appendChild(menu); const r=anchor.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(r.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px'; menu.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-menu.offsetHeight-8))+'px';
    menu.onkeydown=e=>{ const buttons=[...menu.querySelectorAll('button')]; let i=buttons.indexOf(document.activeElement); if(e.key==='Escape'){closeMenu();anchor.focus();} else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();} };
    menu.querySelector('button').focus(); schedule();
  }
  document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target)&&!e.target.closest('[data-browser-action="menu"]'))closeMenu();});
  function findInPage(p) {
    document.querySelector('.browser-find')?.remove();
    const rec=tiles.get(p.id), bar=document.createElement('form'); bar.className='browser-find';
    bar.innerHTML='<input aria-label="Find in page" placeholder="Find in page"><button class="btn btn--small">Find</button><button class="btn btn--small" type="button" aria-label="Close find">×</button>';
    rec.body.prepend(bar);
    bar.onsubmit=e=>{e.preventDefault();api.browserAction({id:p.id,action:'find',value:q('input',bar).value}).then(check);};
    const finish=()=>{api.browserAction({id:p.id,action:'stop-find'});bar.remove();schedule();};
    q('[type="button"]',bar).onclick=finish;bar.onkeydown=e=>{if(e.key==='Escape')finish();};q('input',bar).focus();schedule();
  }
  async function renderProfiles() {
    const o=state.overlay;
    const modal=dialog('modal modal--browser', '<div class="modal-head"><span class="title">Browser profiles</span></div><div class="modal-body browser-profile-body">Loading…</div><div class="modal-foot"><button class="btn btn--go browser-profile-done" id="profiles-done">Done</button></div>');
    q('#profiles-done',modal).onclick=close;
    const r=await api.browserProfiles({action:'list'}); if(state.overlay!==o||!check(r))return;
    const status=await api.browserStatus(); if(state.overlay!==o)return;
    const view=status.views?.find(v=>v.id===o.panelId);
    const chosen=r.profiles.find(p=>p.id===(o.profileId||view?.profileId))||r.profiles[0];
    if(!chosen)return;
    o.profileId=chosen.id;
    const host=q('.browser-profile-body',modal);
    host.innerHTML=`<label class="field-label">Nami profile<select id="profile-choice">${r.profiles.map(p=>`<option value="${esc(p.id)}"${p.id===chosen.id?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="note">Tabs using the same profile share sign-ins. Agent access ends when you change or clear their profile.</p><div class="browser-profile-actions"><button class="btn btn--small" id="profile-new">New profile</button><button class="btn btn--small" id="profile-rename">Rename</button>${view?'<button class="btn btn--small" id="profile-switch">Use for this tab</button>':''}<button class="btn btn--small" id="profile-remove">Remove profile…</button></div><details${o.section==='cookies'?' open':''}><summary>Import cookies from Chrome or Edge</summary><p class="note">One-time copy into this Nami profile. Google cookies are skipped. Chrome stays unchanged. This is not Chrome Sync.</p><p class="note">${esc(r.capabilities?.cookieImport?.available ? (r.capabilities.cookieImport.browsers || []).map(s=>s.browser+' · '+s.name).join(', ') : 'No Chrome or Edge profile was found on this Mac.')}</p><button class="btn btn--small" id="profile-import-cookies">Import cookies…</button></details><details${o.section==='import'?' open':''}><summary>Import saved passwords</summary><p class="note">Copy saved passwords from a Chrome CSV. Chrome stays unchanged.</p><p class="note">If cookies cannot be copied, import a password CSV and sign in inside Nami.</p><button class="btn btn--small" id="profile-import">Choose password CSV…</button><p class="note">The original CSV remains where you exported it. Saved passwords are protected on this Mac. Filling a password in an agent-controlled page makes it available to that page and its automation.</p></details><details${o.section==='clear'?' open':''}><summary>Clear browsing data</summary><label class="browser-check"><input type="checkbox" id="clear-signins">Site data and sign-ins</label><label class="browser-check"><input type="checkbox" id="clear-passwords">Saved passwords</label><button class="btn btn--small" id="profile-clear">Clear selected data…</button></details><details><summary>Saved passwords</summary><div id="profile-credentials"></div></details><div class="browser-profile-result" role="status"></div>`;
    const result=q('.browser-profile-result',host);
    const run=async args=>{const out=await api.browserProfiles({profileId:chosen.id,...args});if(!check(out))return null;return out;};
    const ask=(title,action)=>{ const row=document.createElement('div');row.className='browser-profile-confirm';row.innerHTML=`<p class="note">${esc(title)}</p><button class="btn btn--small">Cancel</button><button class="btn btn--small btn--go">Confirm</button>`;result.replaceChildren(row);const [cancel,confirm]=row.querySelectorAll('button');cancel.onclick=()=>row.remove();confirm.onclick=async()=>{confirm.disabled=true;await action();};};
    q('#profile-choice',host).onchange=e=>show({...o,profileId:e.target.value});
    const nameForm=(action)=>{result.innerHTML=`<label class="field-label">Profile name<input id="profile-name" value="${action==='rename'?esc(chosen.name):''}"></label><button class="btn btn--small" id="profile-name-save">Save</button>`;q('#profile-name-save',result).onclick=async()=>{const out=await run({action,name:q('#profile-name',result).value});if(out)show({...o});};q('input',result).focus();};
    q('#profile-new',host).onclick=()=>nameForm('create');q('#profile-rename',host).onclick=()=>nameForm('rename');
    if(view)q('#profile-switch',host).onclick=()=>ask('Switch this tab to '+chosen.name+' and revoke its agent access?',async()=>{if(await run({action:'switch',id:view.id})){close();toast('Profile changed. Reconfigure browser access when ready.');}});
    q('#profile-remove',host).onclick=()=>ask('Close this profile’s tabs, discard their pending notes, and permanently remove its Nami sign-ins and passwords? Chrome stays unchanged.',async()=>{if(await run({action:'remove',confirmed:true}))show({...o});});
    q('#profile-import-cookies',host).onclick=()=>show({type:'browser-import',profileId:chosen.id,panelId:o.panelId});
    q('#profile-import',host).onclick=()=>ask('Import a password CSV into '+chosen.name+'? Existing agent access to this profile will be revoked.',async()=>{const out=await run({action:'import-passwords'});if(out)result.textContent=out.canceled?'Import cancelled.':out.message||('Imported '+(out.imported??0)+' passwords'+(out.skipped?', skipped '+out.skipped+' invalid rows':'')+'.');});
    q('#profile-clear',host).onclick=()=>{const siteData=q('#clear-signins',host).checked,credentials=q('#clear-passwords',host).checked;if(!siteData&&!credentials){result.textContent='Choose data to clear.';return;}ask('Clear selected data from '+chosen.name+'? Clearing sign-ins closes all its Nami tabs and discards their pending notes. Chrome stays unchanged.',async()=>{if(await run({action:'clear',siteData,credentials,confirmed:true})){result.textContent='Selected Nami data cleared. Agent access revoked.';}});};
    const canFill=!!view && chosen.id===view.profileId;
    q('#profile-import',host).disabled=!r.capabilities?.passwordCsv; if(!r.capabilities?.passwordCsv) q('#profile-import',host).title='Unlock macOS Keychain to import saved passwords.';
    let currentOrigin=''; try{currentOrigin=new URL(view?.url).origin;}catch{}
    const saved=await run({action:'credentials'});if(state.overlay!==o||!saved)return;
    q('#profile-credentials',host).innerHTML=(saved.credentials||[]).map(c=>`<div class="browser-credential"><span>${esc(c.origin)}<small>${esc(c.username)}</small></span>${canFill&&c.origin===currentOrigin?`<button class="btn btn--small" data-fill="${esc(c.id)}">Fill</button>`:''}<button class="btn btn--small" data-delete="${esc(c.id)}">Delete</button></div>`).join('')||'<p class="note">No saved passwords.</p>';
    host.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>ask('Delete this saved password from Nami?',async()=>{if(await run({action:'delete-credential',credentialId:b.dataset.delete}))show({...o});}));
    host.querySelectorAll('[data-fill]').forEach(b=>b.onclick=async()=>{if(await run({action:'autofill',id:view.id,credentialId:b.dataset.fill})){close();toast('Filled matching fields. Review the page before submitting.');}});
  }
  async function renderImport() {
    const o=state.overlay;
    const modal=dialog('modal modal--browser', `<div class="modal-head"><span class="title">Import from your browser</span></div>
      <div class="modal-body browser-profile-body">Loading…</div>
      <div class="modal-foot"><button class="btn" id="import-cancel">Cancel</button><button class="btn btn--go" id="import-go">Import</button></div>`);
    q('#import-cancel',modal).onclick=close;
    const r=await api.browserProfiles({action:'list'}); if(state.overlay!==o||!check(r))return;
    const sources=r.capabilities?.cookieImport?.browsers||[];
    const host=q('.browser-profile-body',modal);
    const dest=r.profiles.find(p=>p.id===(o.profileId))||r.profiles[0];
    if(!dest){host.textContent='Create a Nami profile first.';return;}
    host.innerHTML=`<p class="note">Choose data to bring over to Nami’s browser.</p>
      <label class="field-label">From<select id="import-source">${sources.map((s,i)=>`<option value="${i}">${esc(s.browser)} · ${esc(s.name)}</option>`).join('')||'<option value="">No Chrome or Edge profile found</option>'}</select></label>
      <p class="note">Quit Chrome completely before importing.</p>
      <label class="browser-check"><input type="checkbox" id="import-passwords" checked><span>Saved passwords</span></label>
      <label class="browser-check"><input type="checkbox" id="import-cookies" checked><span>Cookies</span></label>
      <label class="browser-check"><input type="checkbox" id="import-history" checked><span>Browsing history</span></label>
      <div class="browser-profile-result" role="status"></div>`;
    const go=q('#import-go',modal), result=q('.browser-profile-result',host);
    go.disabled=!sources.length;
    go.onclick=async()=>{
      go.disabled=true; result.textContent='Importing…';
      const out=await api.browserProfiles({action:'import-browser',profileId:dest.id,sourceIndex:Number(q('#import-source',host).value)||0,passwords:q('#import-passwords',host).checked,cookies:q('#import-cookies',host).checked,history:q('#import-history',host).checked});
      go.disabled=false;
      if(!check(out))return;
      result.textContent=out.message||'Import finished.';
    };
  }
  function settingsHtml() { return browserSettingsHtml(); }
  function wireSettings(modal) { return wireBrowserSettings(modal, { api, onAccess:sessionId=>show({type:'browser-access',sessionId}), onProfiles:()=>show({type:'browser-profiles'}), onImport:()=>show({type:'browser-import'}), onImportCookies:()=>show({type:'browser-import'}), onClear:()=>show({type:'browser-profiles',section:'clear'}), onError:toast }); }
  api.onBrowserEvent((event) => {
    let p = state.panels.find((p) => p.id === event.id), rec = tiles.get(event.id);
    if (event.type === 'created') { if (!p) open(event.url, null, event.owner, event.id, false, event.profileId); return; }
    if (event.type === 'closed') { if (p) { annotations.store.stale(p.id); closePanel(p.id, {browserConfirmed:true}); } return; }
    if (event.type === 'message') { const target = state.panels.find((p) => p.id === event.sessionId); if (target) { target.browserMessages ||= []; target.browserMessages.push(event.message); target.browserMessages = target.browserMessages.slice(-100); toast('Message for ' + target.title + '. Right-click its header to review.'); } return; }
    if(event.type==='access-revoked'){toast(event.reason || 'Browser access revoked.');return;}
    if (!p || !rec) return;
    annotations.handleEvent(event);
    if(event.type==='profile-changed'){signature='';schedule();}
    if (event.type === 'focus' && !state.overlay) { closeMenu(); focus(p.id, false); }
    if (event.type === 'address-focus') { const input=q('.browser-address input',rec.body); input.focus(); input.select(); }
    if (event.type === 'state') { p.profileId=event.profileId; p.pageZoom=event.zoom || 1; p.url = event.url; p.filePath = event.filePath || null; if (event.title) p.title = event.title; const input = q('.browser-address input', rec.body); if (document.activeElement !== input) input.value = p.filePath || (event.url && event.url !== 'about:blank' ? event.url : ''); q('.t-title', rec.head).textContent = p.title; q('[data-browser-action="back"]', rec.body).disabled = !event.canBack; q('[data-browser-action="forward"]', rec.body).disabled = !event.canForward; if (!event.loading) { tabs(p, rec); save(); } }
    if (event.type === 'new-tab') open(event.url, null, p.owner, null, false, event.profileId || p.profileId);
    if (event.type === 'error') { const e = q('.browser-error', rec.body); e.hidden = !event.error; e.textContent = event.error; }
    if (event.type === 'text-selection') { rec.pendingSelection = event.selection; q('.browser-selection', rec.body).hidden = false; }
    schedule();
  });
  function inbox(p) {
    if (!p.browserMessages?.length) { toast('No messages for this session.'); return; }
    selection({ owner: p.id }, { reference: 'Messages for ' + p.title, text: p.browserMessages.map((m) => 'From ' + m.title + '\n' + m.text).join('\n\n') });
  }
  return { open, mount, restore, decorate, schedule, clearNotes, newBrowser, renderNew, renderNote, renderAccess, renderConnection, settingsHtml, wireSettings, renderProfiles, renderImport, inbox, hasPending:p=>annotations.hasPending(p), canClose:p=>annotations.canClose(p), removeNotes:id=>annotations.removeTab(id) };
}
