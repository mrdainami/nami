// Live permissions have a visible home on both terminal and chat panels.
// A source chip is never evidence that the model has read its content.
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
      toast('Shared with '+(target?.title||'session')+'. Check its source chip for connection status.');
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
    const s=status.sessions.find(s=>s.id===id), chunks=[];
    for (const sourceId of sourceIds(s)) {
      const source=state.panels.find(p=>p.id===sourceId);
      if(source) await publish(source);
      const r=await api.browserContext({action:'read',recipientId:id,sourceId});
      if(!r?.ok) { toast(r?.error||'Source context unavailable.'); continue; }
      const c=r.source||r.context||r;
      chunks.push(`Context from ${c.title||source?.title||sourceId} (${c.kind==='terminal'?'terminal snapshot':'visible chat'}, ${new Date(c.capturedAt||c.updatedAt||c.at).toLocaleTimeString()}${c.truncated||c.incompleteHistory?', incomplete history':''})\n${c.content||''}`);
    }
    return chunks.join('\n\n');
  }
  async function refreshInto(id) {
    try {
      const text=await linkedContext(id);
      if(text) await insert(id,text); else toast('No readable source context.');
    } catch(error) { toast(error.message||'Could not refresh source context.'); }
  }
  function inspect(session, type, source, anchor) {
    const r=anchor.getBoundingClientRect();
    const shared=status.sessions.find(s=>s.id===session.id);
    const access=shared?.activities?.find(a=>a.tabId===source.id);
    const actions=type==='browser' ? [
      {label:source.url||source.title,off:true},
      {label:access?.lastSuccessfulAt?'Last accessed '+new Date(access.lastSuccessfulAt).toLocaleString():'No successful browser access recorded',off:true},
      {label:'Browser setup / connection…',run:()=>settings(session.id)},
    ] : [
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
      const connected=s.initialized||s.connected;
      const sig=JSON.stringify([rows,connected,s.activities]);if(rec.sourceStrip.dataset.signature===sig)continue;
      rec.sourceStrip.dataset.signature=sig;
      rec.sourceStrip.innerHTML=rows.map(({type,source})=>{
        const access=s.activities?.find(a=>a.tabId===source.id);
        const label=type==='session'?'Context':access?.error?'Access failed':access?'Last accessed '+new Date(access.at||access).toLocaleTimeString():connected?'Shared · initialized':'Setup required';
        return `<span class="source-chip"><button class="source-inspect" data-source="${esc(source.id)}" data-source-type="${type}" title="${esc(label)}">${icon(type==='browser'?'browser':'link')}<span>${esc(source.title||source.url||'Browser')}</span><small>${esc(label)}</small></button><button class="source-remove" data-remove="${esc(source.id)}" data-source-type="${type}" aria-label="Stop sharing ${esc(source.title||'source')}" title="Stop sharing">×</button></span>`;
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
  window.addEventListener('beforeunload',()=>clearInterval(interval),{once:true});
  api.onBrowserEvent(()=>refresh());
  return {refresh,paint,shareMenu,shareTab,shareContext,linkedContext,refreshInto};
}
