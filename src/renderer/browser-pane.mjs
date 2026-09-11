import { createBrowserAnnotations } from './browser-annotations.mjs';
import { browserSettingsHtml, wireBrowserSettings } from './browser-settings.mjs';
import { createBrowserOverlays } from './browser-overlays.mjs';
// Native page content; all chrome remains the same DOM tile as other files.
export function createBrowserPane({ api, state, tiles, uid, esc, helpIcon, isFile, isSession, pin, focus, refresh, save,
  show, dialog, close, closePanel, toast, selection, settings, dictation, insertAnnotation, sessions, panelIcon, tileMenu, showMenu, openOutside }) {
  let frame = 0, signature = '';
  const importJobs = new Map();
  let importView = null;
  const importActive = j => j && ['running','cancelling'].includes(j.state);
  const latestImport = profileId => [...importJobs.values()].filter(j=>j.profileId===profileId).sort((a,b)=>b.startedAt-a.startedAt)[0];
  const importStage = j => ({preparing:'Preparing source',keychain:'Waiting for Keychain',reading:'Reading selected data',copying:'Copying into '+j.profileName,cancelling:'Cancelling import',complete:'Import complete',partial:'Import partially completed',cancelled:'Import cancelled',failed:'Import failed'}[j.stage]||'Importing');
  function updateImportStrips() {
    for(const [id,rec] of tiles) {
      const strip=q('.browser-import-status',rec.body);if(!strip)continue;
      const p=state.panels.find(p=>p.id===id),j=latestImport(p?.profileId);
      strip.hidden=!j; if(j){strip.textContent=importStage(j)+' · '+j.profileName+' · View';strip.onclick=()=>show({type:'browser-import',jobId:j.id});}
    }
    schedule();
  }
  function rememberImport(j) { if((importJobs.get(j.id)?.revision||0)>(j.revision||0))return; importJobs.set(j.id,j); updateImportStrips(); importView?.(j); }
  api.browserImport?.({action:'list'}).then(r=>{for(const j of r.jobs||[])rememberImport(j);}).catch(()=>{});
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
      // the tab is the tile: same menu its head shows
      b.oncontextmenu=e=>{e.preventDefault();const x=state.panels.find(t=>t.id===b.dataset.viewId);if(x&&tileMenu&&showMenu)showMenu(e.clientX,e.clientY,tileMenu(x));};
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
    rec.body.innerHTML = `<form class="browser-address">${button('back', 'Back', 'back')}${button('forward', 'Forward', 'forward')}${button('refresh', 'Reload', 'reload')}<input aria-label="Browser address" placeholder="Search or enter address" value="${esc(p.filePath || (p.url && p.url !== 'about:blank' ? p.url : ''))}" spellcheck="false"><button type="button" class="browser-annotate" aria-pressed="false" title="Annotate">Annotate</button>${button('more', 'Browser menu', 'menu')}</form><div class="browser-error" role="status" hidden></div><button type="button" class="browser-import-status" hidden></button><div class="browser-viewport"></div><div class="browser-selection" hidden><button class="btn btn--small">Selection · Add to session…</button></div>`;
    rec.browserViewport = q('.browser-viewport', rec.body);
    updateImportStrips();
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
  let menu = null;
  function closeMenu() { menu?.remove(); menu = null; schedule(); }
  function openMenu(p, anchor) {
    closeMenu();
    menu = document.createElement('div'); menu.className = 'browser-menu'; menu.setAttribute('role','menu');
    const actions = [
      ['Open in Chrome \u2197', () => openOutside(p)],
      ['Find in page', () => findInPage(p)],
      ['Zoom in', () => api.browserAction({id:p.id,action:'zoom',value:p.pageZoom=Math.min(3,(p.pageZoom||1)+0.1)}).then(check)],
      ['Zoom out', () => api.browserAction({id:p.id,action:'zoom',value:p.pageZoom=Math.max(0.5,(p.pageZoom||1)-0.1)}).then(check)],
      ['Reset zoom', () => api.browserAction({id:p.id,action:'zoom',value:p.pageZoom=1}).then(check)],
      ['Take screenshot…', () => api.browserAction({id:p.id,action:'capture'}).then(check)],
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
    host.innerHTML=`<label class="field-label">Profile<select id="profile-choice">${r.profiles.map(p=>`<option value="${esc(p.id)}"${p.id===chosen.id?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label><div class="browser-profile-actions"><button class="btn btn--small" id="profile-new">New</button><button class="btn btn--small" id="profile-rename">Rename</button>${view?'<button class="btn btn--small" id="profile-switch">Use for this tab</button>':''}<button class="btn btn--small" id="profile-remove">Remove…</button></div><div class="browser-profile-actions"><button class="btn btn--small" id="profile-import-cookies">Import from Chrome…</button><button class="btn btn--small" id="profile-import">Import password CSV…</button></div><details${o.section==='clear'?' open':''}><summary>Clear browsing data</summary><label class="browser-check"><input type="checkbox" id="clear-signins"><span>Site data and sign-ins</span></label><label class="browser-check"><input type="checkbox" id="clear-passwords"><span>Saved passwords</span></label><div class="browser-profile-clear"><button class="btn btn--small" id="profile-clear">Clear</button></div></details><details><summary>Saved passwords</summary><div id="profile-credentials"></div></details><div class="browser-profile-contents" role="status">Counting\u2026</div><div class="browser-profile-result" role="status"></div>`;
    const result=q('.browser-profile-result',host);
    const run=async args=>{const out=await api.browserProfiles({profileId:chosen.id,...args});if(!check(out))return null;return out;};
    const ask=(title,action)=>{ const row=document.createElement('div');row.className='browser-profile-confirm';row.innerHTML=`<p class="note">${esc(title)}</p><button class="btn btn--small">Cancel</button><button class="btn btn--small btn--go">Confirm</button>`;result.replaceChildren(row);const [cancel,confirm]=row.querySelectorAll('button');cancel.onclick=()=>row.remove();confirm.onclick=async()=>{confirm.disabled=true;await action();};};
    // What is in this profile, said plainly and left on screen. Counted from
    // the live session, because session cookies — most sign-ins — never reach
    // the file on disk, and a count taken from there reads as empty when it is
    // not. Without this line an import has no visible result at all.
    const contents=q('.browser-profile-contents',host);
    (async()=>{
      const out=await api.browserProfiles({action:'contents',profileId:chosen.id}).catch(()=>null);
      if(!contents.isConnected)return;
      const c=out&&out.contents;
      if(!c){contents.textContent='Could not read what is in this profile.';return;}
      const n=(v,one,many)=>v.toLocaleString()+' '+(v===1?one:many);
      contents.textContent=[n(c.cookies,'cookie','cookies')+(c.session?' ('+c.session+' sign-in)':''),
        n(c.passwords,'password','passwords'), n(c.history,'history row','history rows')].join(' \u00b7 ');
    })();
    q('#profile-choice',host).onchange=e=>show({...o,profileId:e.target.value});
    const nameForm=(action)=>{result.innerHTML=`<label class="field-label">Profile name<input id="profile-name" value="${action==='rename'?esc(chosen.name):''}"></label><button class="btn btn--small" id="profile-name-save">Save</button>`;q('#profile-name-save',result).onclick=async()=>{const out=await run({action,name:q('#profile-name',result).value});if(out)show({...o});};q('input',result).focus();};
    q('#profile-new',host).onclick=()=>nameForm('create');q('#profile-rename',host).onclick=()=>nameForm('rename');
    if(view)q('#profile-switch',host).onclick=()=>ask('Use '+chosen.name+' for this tab?',async()=>{if(await run({action:'switch',id:view.id})){close();toast('Profile changed.');}});
    q('#profile-remove',host).onclick=()=>ask('Remove '+chosen.name+' and close its tabs? Any import into this profile will be cancelled.',async()=>{if(await run({action:'remove',confirmed:true}))show({...o});});
    const recent=(r.importJobs||[]).filter(j=>j.profileId===chosen.id).sort((a,b)=>b.startedAt-a.startedAt)[0];
    if(recent){const b=document.createElement('button');b.className='btn btn--small';b.textContent=importActive(recent)?'View running import':'View import result';b.onclick=()=>show({type:'browser-import',jobId:recent.id});q('.browser-profile-actions',host).appendChild(b);}
    q('#profile-import-cookies',host).onclick=()=>show({type:'browser-import',profileId:chosen.id,panelId:o.panelId});
    q('#profile-import',host).onclick=()=>ask('Import a password CSV into '+chosen.name+'?',async()=>{const out=await run({action:'import-passwords'});if(out)result.textContent=out.canceled?'Cancelled.':out.message||('Imported '+(out.imported??0)+' passwords.');});
    q('#profile-clear',host).onclick=()=>{const siteData=q('#clear-signins',host).checked,credentials=q('#clear-passwords',host).checked;if(!siteData&&!credentials){result.textContent='Choose data to clear.';return;}ask('Clear selected data from '+chosen.name+'? Any import into this profile will be cancelled.',async()=>{if(await run({action:'clear',siteData,credentials,confirmed:true})){result.textContent='Cleared.';}});};
    const canFill=!!view && chosen.id===view.profileId;
    q('#profile-import',host).disabled=!r.capabilities?.passwordCsv; if(!r.capabilities?.passwordCsv) q('#profile-import',host).title='Unlock macOS Keychain to import saved passwords.';
    let currentOrigin=''; try{currentOrigin=new URL(view?.url).origin;}catch{}
    const saved=await run({action:'credentials'});if(state.overlay!==o||!saved)return;
    q('#profile-credentials',host).innerHTML=(saved.credentials||[]).map(c=>`<div class="browser-credential"><span>${esc(c.origin)}<small>${esc(c.username)}</small></span>${canFill&&c.origin===currentOrigin?`<button class="btn btn--small" data-fill="${esc(c.id)}">Fill</button>`:''}<button class="btn btn--small" data-delete="${esc(c.id)}">Delete</button></div>`).join('')||'<p class="note">No saved passwords.</p>';
    host.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>ask('Delete this saved password from Nami?',async()=>{if(await run({action:'delete-credential',credentialId:b.dataset.delete}))show({...o});}));
    host.querySelectorAll('[data-fill]').forEach(b=>b.onclick=async()=>{if(await run({action:'autofill',id:view.id,credentialId:b.dataset.fill})){close();toast('Filled matching fields. Review the page before submitting.');}});
  }
  async function renderImportJob(o) {
    const modal=dialog('modal modal--browser', `<div class="modal-head"><span class="title">Browser import</span></div>
      <div class="modal-body browser-profile-body"><p class="browser-import-context"></p><p class="browser-profile-result" role="status">Loading import…</p>
      <div class="browser-import-results"></div><p class="note browser-import-explanation"></p></div>
      <div class="modal-foot"><button class="btn" id="import-cancel">Close</button><button class="btn" id="import-stop">Cancel import</button><button class="btn btn--go browser-import-go" id="import-go" hidden disabled>Import again</button></div>`);
    const current=()=>state.overlay===o && modal.isConnected;
    q('#import-cancel',modal).onclick=close;
    let job;
    const update=j=>{
      if(!current() || j.id!==o.jobId)return; job=j;
      q('.browser-import-context',modal).textContent=j.sourceName+' → Nami · '+j.profileName;
      q('.browser-profile-result',modal).textContent=importStage(j)+' · '+j.profileName+(j.category && importActive(j)?' · '+j.category:'')+(j.error?' · '+j.error:'');
      q('.browser-import-results',modal).innerHTML=Object.entries(j.results).map(([category,r])=>`<div class="browser-import-result-row"><strong>${esc({cookies:'Cookies',passwords:'Saved passwords',history:'Browsing history'}[category])}</strong><span>${r.copied} copied · ${r.skipped} skipped · ${r.failed} failed</span>${r.error?`<p>${esc(r.error)}</p>`:''}${r.reasons.map(reason=>`<p>${esc(reason)}</p>`).join('')}</div>`).join('');
      q('.browser-import-explanation',modal).textContent=importActive(j)?'You can close this panel and keep browsing. Cancel stops further copying; data already copied stays in this profile.':j.state==='cancelled'?'Data copied before cancellation remains in this profile.': 'Copied cookies may still require you to sign in on the website. The source browser is unchanged.';
      const stop=q('#import-stop',modal),retry=q('#import-go',modal);stop.hidden=!importActive(j);stop.disabled=j.state==='cancelling';stop.textContent=j.state==='cancelling'?'Cancelling…':'Cancel import';retry.hidden=importActive(j);retry.disabled=importActive(j);retry.textContent=['failed','partial','cancelled'].includes(j.state)?'Review and retry':'Import again';
    };
    importView=update;
    q('#import-stop',modal).onclick=async()=>{
      if(!job || !importActive(job))return;
      q('#import-stop',modal).disabled=true;
      try{const r=await api.browserImport({action:'cancel',jobId:job.id});if(!r.ok)throw Error(r.error);rememberImport(r.job);}catch(error){if(current()){q('.browser-profile-result',modal).textContent=error.message;q('#import-stop',modal).disabled=false;}}
    };
    q('#import-go',modal).onclick=()=>show({type:'browser-import',profileId:job.profileId,sourceId:job.sourceId,importCategories:job.categories,newImport:true});
    const r=await api.browserImport({action:'get',jobId:o.jobId});
    if(!current())return;
    if(!r.ok){q('.browser-profile-result',modal).textContent=r.error;q('#import-stop',modal).hidden=true;return;}
    rememberImport(r.job);
  }
  async function renderImport() {
    const o=state.overlay;
    importView=null;
    if(o.jobId)return renderImportJob(o);
    const modal=dialog('modal modal--browser', `<div class="modal-head"><span class="title">Import from your browser</span></div>
      <div class="modal-body browser-profile-body">Loading…</div>
      <div class="modal-foot"><button class="btn" id="import-cancel">Cancel</button><button class="btn btn--go browser-import-go" id="import-go" disabled>Choose destination</button></div>`);
    const current=()=>state.overlay===o && modal.isConnected;
    q('#import-cancel',modal).onclick=close;
    const r=await api.browserProfiles({action:'list'}); if(!current()||!check(r))return;
    const sources=r.capabilities?.cookieImport?.browsers||[];
    const source=o.sourceId===undefined?sources[0]:sources.find(s=>s.id===o.sourceId);
    const sourceError=o.sourceId && !source?'The selected browser profile is no longer available. Choose a source from the refreshed list.':'';
    const host=q('.browser-profile-body',modal);
    if(!r.profiles?.length){host.textContent='Create a Nami profile first.';return;}
    // A tab-menu entry carries a panel ID, while Manage profiles carries an
    // explicit profile. Resolve that context without substituting Personal.
    let profileId=o.profileId, contextError='';
    if(profileId==null && o.panelId){
      const status=await api.browserStatus(); if(!current())return;
      profileId=status?.views?.find(v=>v.id===o.panelId)?.profileId;
      if(!profileId)contextError='The original tab is no longer available. Choose a destination profile.';
    }
    for(const j of r.importJobs||[])rememberImport(j);
    const running=(r.importJobs||[]).find(j=>j.profileId===profileId && importActive(j));
    if(running)return show({type:'browser-import',jobId:running.id});
    const dest=r.profiles.find(p=>p.id===profileId);
    if(profileId!=null && !dest)contextError='The original profile is no longer available. Choose a destination profile.';
    const checked=key=>o.importCategories?.[key]===false?'':' checked';
    host.innerHTML=`<label class="field-label">From<select id="import-source"><option value=""${source?'':' selected'} disabled>${sources.length?'Choose a browser profile':'No browser profile found'}</option>${sources.map(s=>`<option value="${esc(s.id)}"${s.id===source?.id?' selected':''}>${esc(s.browser)} · ${esc(s.name)}</option>`).join('')}</select></label>
      <div class="browser-import-refresh"><button class="btn btn--small" id="import-refresh" type="button">Refresh list</button></div>
      <label class="field-label">Into<select id="import-destination"><option value=""${dest?'':' selected'} disabled>Choose a Nami profile</option>${r.profiles.map(p=>`<option value="${esc(p.id)}"${p.id===dest?.id?' selected':''}>Nami · ${esc(p.name)}</option>`).join('')}</select></label>
      <p class="note">Allow Keychain access if macOS asks.</p>
      <label class="browser-check"><input type="checkbox" id="import-passwords"${checked('passwords')}><span>Saved passwords</span></label>
      <label class="browser-check"><input type="checkbox" id="import-cookies"${checked('cookies')}><span>Cookies</span></label>
      <label class="browser-check"><input type="checkbox" id="import-history"${checked('history')}><span>Browsing history</span></label>
      <div class="browser-profile-result" role="status"></div><div class="browser-import-running"></div>`;
    const go=q('#import-go',modal), result=q('.browser-profile-result',host), destination=q('#import-destination',host);
    const sourceInput=q('#import-source',host), refreshSources=q('#import-refresh',host);
    const controls=[...host.querySelectorAll('select,input'),refreshSources];
    const selected=()=>r.profiles.find(p=>p.id===destination.value);
    const update=()=>{
      const profile=selected();
      const active=profile && [...importJobs.values()].some(j=>j.profileId===profile.id && importActive(j));
      go.textContent=active?'Import already running':profile?'Import into '+profile.name:'Choose destination';
      go.disabled=!!active || !sources.some(s=>s.id===sourceInput.value) || !profile || !host.querySelector('input:checked');
      const running=q('.browser-import-running',host);running.replaceChildren();
      for(const j of importJobs.values())if(importActive(j)){const b=document.createElement('button');b.className='btn btn--small';b.textContent='View import into '+j.profileName;b.onclick=()=>show({type:'browser-import',jobId:j.id});running.appendChild(b);}
    };
    importView=()=>{if(current())update();};
    destination.onchange=()=>{result.textContent='';update();};
    sourceInput.onchange=()=>{result.textContent='';update();};
    refreshSources.onclick=()=>show({...o,sourceId:sourceInput.value||o.sourceId,profileId:destination.value||undefined,importCategories:{passwords:q('#import-passwords',host).checked,cookies:q('#import-cookies',host).checked,history:q('#import-history',host).checked}});
    host.querySelectorAll('input').forEach(input=>input.onchange=update);
    result.textContent=[contextError,sourceError].filter(Boolean).join(' '); update();
    go.onclick=async()=>{
      const profile=selected(); if(go.disabled || !profile)return;
      const args={action:'import-browser',profileId:profile.id,sourceId:sourceInput.value,passwords:q('#import-passwords',host).checked,cookies:q('#import-cookies',host).checked,history:q('#import-history',host).checked};
      go.disabled=true; controls.forEach(input=>input.disabled=true);
      result.textContent='Importing into '+profile.name+'…';
      try{
        const out=await api.browserImport({...args,action:'start'}); if(!current())return;
        if(!out || out.ok===false || out.error)throw new Error(out?.error||'Could not import browser data.');
        rememberImport(out.job);show({type:'browser-import',jobId:out.job.id});
      }catch(error){if(current())result.textContent=error.message||'Could not import browser data.';}
      finally{if(current()){controls.forEach(input=>input.disabled=false);update();}}
    };
  }
  function settingsHtml() { return browserSettingsHtml(); }
  function wireSettings(modal) { return wireBrowserSettings(modal, { api, onProfiles:()=>show({type:'browser-profiles'}), onImport:()=>show({type:'browser-import'}), onImportCookies:()=>show({type:'browser-import'}), onClear:()=>show({type:'browser-profiles',section:'clear'}), onError:toast }); }
  api.onBrowserEvent((event) => {
    if(event.type==='import-job'){rememberImport(event.job);return;}
    let p = state.panels.find((p) => p.id === event.id), rec = tiles.get(event.id);
    if (event.type === 'created') { if (!p) open(event.url, null, event.owner, event.id, false, event.profileId); return; }
    if (event.type === 'closed') { if (p) { annotations.store.stale(p.id); closePanel(p.id, {browserConfirmed:true}); } return; }
    if (event.type === 'message') return;
    if(event.type==='access-revoked') return;
    if (!p || !rec) return;
    annotations.handleEvent(event);
    if(event.type==='profile-changed'){signature='';updateImportStrips();schedule();}
    if (event.type === 'focus' && !state.overlay) { closeMenu(); focus(p.id, false); }
    if (event.type === 'address-focus') { const input=q('.browser-address input',rec.body); input.focus(); input.select(); }
    if (event.type === 'state') { p.profileId=event.profileId; p.pageZoom=event.zoom || 1; p.url = event.url; p.filePath = event.filePath || null; if (event.title) p.title = event.title; const input = q('.browser-address input', rec.body); if (document.activeElement !== input) input.value = p.filePath || (event.url && event.url !== 'about:blank' ? event.url : ''); q('.t-title', rec.head).textContent = p.title; q('[data-browser-action="back"]', rec.body).disabled = !event.canBack; q('[data-browser-action="forward"]', rec.body).disabled = !event.canForward; if (!event.loading) { tabs(p, rec); save(); } }
    if (event.type === 'new-tab') open(event.url, null, p.owner, null, false, event.profileId || p.profileId);
    if (event.type === 'error') { const e = q('.browser-error', rec.body); e.hidden = !event.error; e.textContent = event.error; }
    if (event.type === 'text-selection') { rec.pendingSelection = event.selection; q('.browser-selection', rec.body).hidden = false; }
    updateImportStrips();
    schedule();
  });
  function inbox(p) {
    if (!p.browserMessages?.length) { toast('No messages for this session.'); return; }
    selection({ owner: p.id }, { reference: 'Messages for ' + p.title, text: p.browserMessages.map((m) => 'From ' + m.title + '\n' + m.text).join('\n\n') });
  }
  return { open, mount, restore, decorate, schedule, clearNotes, newBrowser, renderNew, renderNote, settingsHtml, wireSettings, renderProfiles, renderImport, inbox, hasPending:p=>annotations.hasPending(p), canClose:p=>annotations.canClose(p), removeNotes:id=>annotations.removeTab(id) };
}
