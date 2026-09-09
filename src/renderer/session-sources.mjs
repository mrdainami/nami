// Live permissions have a visible home on both terminal and chat panels.
// A source chip is never evidence that the model has read its content.
const PAGE_TEXT = 16000;
export function pageTitle(source) {
  if (source?.title && source.title !== source.url) return source.title;
  try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return source?.url || source?.title || 'Browser'; }
}
export function browserChipLabel(access) {
  if (access?.error) return 'Access failed';
  const at = Number(access?.lastSuccessfulAt || access?.at);
  if (Number.isFinite(at) && at > 0) return 'Last accessed ' + new Date(at).toLocaleTimeString();
  return 'Watching';
}
export function formatBrowserSnapshot({ title, url, text, capturedAt } = {}) {
  const name = title || pageTitle({ url, title }) || 'Browser';
  const when = capturedAt ? new Date(capturedAt).toLocaleTimeString() : '';
  const head = `Watching ${name}${url ? ` (${url})` : ''}${when ? `, ${when}` : ''}`;
  const body = String(text || '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, PAGE_TEXT);
  return body ? head + '\n' + body : head;
}
export function browserInspectActions({ source, access, mcpUnsupported }) {
  const actions = [
    { label: source.url || source.title, off: true },
    { label: access?.lastSuccessfulAt ? 'Last accessed ' + new Date(access.lastSuccessfulAt).toLocaleString() : 'No successful browser access recorded', off: true },
  ];
  if (mcpUnsupported) actions.push({ label: 'HTTP MCP unsupported. Page snapshots still attach on send.', off: true });
  actions.push({ label: 'Send page now' });
  return actions;
}
export async function captureBrowserPage(api, view) {
  const page = { title: view?.title || '', url: view?.url || '', text: typeof view?.text === 'string' ? view.text : '', capturedAt: Date.now() };
  if (!api?.browserAction || !view?.id) return page;
  try {
    const r = await api.browserAction({ id: view.id, action: 'snapshot' });
    if (r && r.ok !== false) {
      if (r.title) page.title = r.title;
      if (r.url) page.url = r.url;
      if (typeof r.text === 'string') page.text = r.text;
      if (r.image?.data && r.image.mimeType) page.image = { type: 'image', data: r.image.data, mimeType: r.image.mimeType };
    }
  } catch (_) {}
  return page;
}
export function createSessionSources({ api, state, tiles, esc, icon, isSession, menu, toast, settings, publish, insert }) {
  let status = {sessions:[],views:[]}, pending = null;
  const sourceIds = s => (s?.sources||[]).map(x=>typeof x==='string'?x:x.id);
  const sessions = () => state.panels.filter(p => isSession(p) && !p.exited);
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      const r = await api.browserStatus();
      if (r?.ok) { status = r; paint(); }
    })().catch(() => {}).finally(() => { pending = null; });
    return pending;
  }
  const edits = new Map();
  function update(id, change) {
    const next=(edits.get(id)||Promise.resolve()).then(()=>applyUpdate(id,change));
    edits.set(id,next.catch(()=>{}));return next;
  }
  async function applyUpdate(id, change) {
    await api.browserSync(sessions().map(p=>({id:p.id,title:p.title})));
    const r = await api.browserStatus();
    const s = r.sessions?.find(s=>s.id===id);
    if (!r.ok || !s) { toast('That session is no longer available.'); return false; }
    if (!r.enabled) {
      const enabled = await api.browserEnable(true);
      if (!enabled?.ok) { toast(enabled?.error || 'Could not enable local connection.'); return false; }
    }
    const result = await api.browserGrant({id,viewIds:s.views||[],peers:s.peers||[],sourceIds:sourceIds(s),
      expectedSourceIdentities:Object.fromEntries((s.sources||[]).filter(x=>x?.id).map(x=>[x.id,x.identity])),
      ...change(s), expectedIdentities:Object.fromEntries((r.views||[]).map(v=>[v.id,v.identity]))});
    if (!result?.ok) { toast(result?.error || 'Could not update sharing.'); return false; }
    await refresh(); return true;
  }
  async function shareTab(panel, id) {
    await refresh();
    if (await update(id,s=>({viewIds:[...new Set([...(s.views||[]),panel.id])]}))) {
      const target=sessions().find(p=>p.id===id);
      toast('Watching in '+(target?.title||'session')+'.');
    }
  }
  async function shareContext(source, id) {
    let published;
    try { published=await publish(source); } catch(error) { toast(error.message||'Source context is not ready.');return false; }
    if(!published?.ok || !published.source){toast('Source context is not ready.');return false;}
    await refresh();
    return update(id,s=>({sourceIds:[...new Set([...sourceIds(s),source.id])],expectedSourceIdentities:{...Object.fromEntries((s.sources||[]).map(x=>[x.id,x.identity])),[source.id]:published.source.identity}}));
  }
  function shareMenu(panel, x, y) {
    menu(x,y,sessions().filter(s=>s.id!==panel.id).map(s=>({label:'Share with '+s.title,
      run:()=>panel.kind==='browser'?shareTab(panel,s.id):shareContext(panel,s.id)})));
  }
  async function linkedContext(id) {
    await refresh();
    const s=status.sessions.find(s=>s.id===id), chunks=[], images=[];
    for (const viewId of s?.views||[]) {
      const view=status.views.find(v=>v.id===viewId);
      if(!view) continue;
      const page=await captureBrowserPage(api, view);
      chunks.push(formatBrowserSnapshot(page));
      if(page.image) images.push(page.image);
    }
    for (const sourceId of sourceIds(s)) {
      const source=state.panels.find(p=>p.id===sourceId);
      if(source) await publish(source);
      const r=await api.browserContext({action:'read',recipientId:id,sourceId});
      if(!r?.ok) { toast(r?.error||'Source context unavailable.'); continue; }
      const c=r.source||r.context||r;
      chunks.push(`Context from ${c.title||source?.title||sourceId} (${c.kind==='terminal'?'terminal snapshot':'visible chat'}, ${new Date(c.capturedAt||c.updatedAt||c.at).toLocaleTimeString()}${c.truncated||c.incompleteHistory?', incomplete history':''})\n${c.content||''}`);
    }
    const content=chunks.join('\n\n');
    return images.length ? { content, images } : content;
  }
  async function refreshInto(id) {
    try {
      const linked=await linkedContext(id);
      const text=typeof linked==='string'?linked:linked?.content||'';
      if(text) await insert(id,text); else toast('No readable source context.');
    } catch(error) { toast(error.message||'Could not send the page.'); }
  }
  function inspect(session, type, source, anchor) {
    const r=anchor.getBoundingClientRect();
    const shared=status.sessions.find(s=>s.id===session.id);
    const access=shared?.activities?.find(a=>a.tabId===source.id);
    const mcpUnsupported=!!tiles.get(session.id)?.acpCapabilities?.()?.mcpUnsupported;
    const actions=type==='browser'
      ? browserInspectActions({source,access,mcpUnsupported}).map(a=>a.label==='Send page now'?{...a,run:()=>refreshInto(session.id)}:a)
      : [
        {label:'Session context · '+source.title,off:true},
        {label:source.capturedAt?'Snapshot updated '+new Date(source.capturedAt).toLocaleString():'Snapshot not yet available',off:true},
        {label:'Refresh into input',run:()=>refreshInto(session.id)},
        {label:'Reads available messages or a terminal snapshot',off:true},
      ];
    menu(r.left,r.bottom,actions);
  }
  function paint() {
    for(const p of sessions()) {
      const rec=tiles.get(p.id); if(!rec)continue;
      const s=status.sessions.find(s=>s.id===p.id);
      const rows=[...(s?.views||[]).map(id=>({type:'browser',source:status.views.find(v=>v.id===id)})),
        ...(s?.sources||[]).map(source=>({type:'session',source:typeof source==='string'?state.panels.find(v=>v.id===source):source}))].filter(r=>r.source);
      if(!rows.length) { rec.sourceStrip?.remove();rec.sourceStrip=null;continue; }
      if(!rec.sourceStrip) {
        rec.sourceStrip=document.createElement('div');rec.sourceStrip.className='session-sources';rec.sourceStrip.setAttribute('aria-label','Shared sources');
        const composer=rec.body.querySelector('.cw-composer-host');
        if(composer)composer.before(rec.sourceStrip);else rec.root.appendChild(rec.sourceStrip);
      }
      const mcpUnsupported=!!rec.acpCapabilities?.()?.mcpUnsupported;
      const sig=JSON.stringify([rows,s.activities,mcpUnsupported]);if(rec.sourceStrip.dataset.signature===sig)continue;
      rec.sourceStrip.dataset.signature=sig;
      rec.sourceStrip.innerHTML=rows.map(({type,source})=>{
        const access=s.activities?.find(a=>a.tabId===source.id);
        const label=type==='session'?'Context':browserChipLabel(access);
        const watching=type==='browser'&&label==='Watching';
        const name=type==='browser'?pageTitle(source):source.title||source.url||'Browser';
        const title=watching?`Watching · ${name}`:label;
        return `<span class="source-chip"${watching?' style="border-color:var(--green)"':''}><button class="source-inspect" data-source="${esc(source.id)}" data-source-type="${type}" title="${esc(title)}">${icon(type==='browser'?'browser':'link')}<span>${esc(name)}</span><small${watching?' style="color:var(--green)"':''}>${esc(label)}</small></button><button class="source-remove" data-remove="${esc(source.id)}" data-source-type="${type}" aria-label="Stop sharing ${esc(name)}" title="Stop sharing">×</button></span>`;
      }).join('');
      rec.sourceStrip.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{const row=rows.find(r=>r.source.id===b.dataset.source&&r.type===b.dataset.sourceType);inspect(p,row.type,row.source,b);});
      rec.sourceStrip.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{
        b.disabled=true;
        await update(p.id,current=>b.dataset.sourceType==='browser'?{viewIds:current.views.filter(id=>id!==b.dataset.remove)}:{sourceIds:sourceIds(current).filter(id=>id!==b.dataset.remove)});
        b.disabled=false;
      });
    }
  }
  const interval=setInterval(refresh,2000);
  interval.unref?.();
  window.addEventListener('beforeunload',()=>clearInterval(interval),{once:true});
  api.onBrowserEvent(()=>refresh());
  return {refresh,paint,shareMenu,shareTab,shareContext,linkedContext,refreshInto};
}
