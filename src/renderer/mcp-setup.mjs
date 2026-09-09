// Library MCP connect sheets. Injected deps so parent wiring in app.js is a
// handful of calls; this file owns click → key → connected and the guided
// Gmail/Drive session. Nami Browser is not a catalog entry and is never
// written to connections.json from here.

import { knowsCopy } from './receivers.mjs';

export const CONNECT_OVERLAYS = new Set([
  'connect', 'connect-form', 'connect-done', 'connect-custom', 'connect-own',
]);

export function catalogServices(catalog) {
  return (catalog || []).filter((s) => s && s.id !== 'nami-browser');
}

// One line: the pty seeder types this then presses Enter.
export function guidedSetupSeed(svc) {
  return `Walk me through connecting ${svc.name} step by step (${svc.docs}). Do every step you can yourself, ask me only when a browser sign-in needs me, and when it works register it for this project by adding one entry to connections.json at the project root, under the standard "mcpServers" key (create the file if it is missing) — Nami copies it to every installed agent's own config from there. Then tell me what tools it exposes.`;
}

export function customSetupSeed(text) {
  return `Build an MCP connector for this: ${String(text || '').trim()}. When it works, register it for this project by adding one entry to connections.json at the project root, under the standard "mcpServers" key (create the file if it is missing) — Nami copies it to every installed agent's own config from there. Then tell me what tools it exposes.`;
}

export function connectDoneView(result, svc) {
  const ok = !!(result && result.ok);
  return {
    ok,
    title: ok ? svc.name + ' is connected!' : 'Not yet.',
    subtitle: ok ? 'your agents can use it from the very next session' : 'nothing broke, and nothing was half-written',
    okLine: ok
      ? (result.checked
        ? `tested just now: ${svc.name} answers · ${result.tools} tools ready`
        : `written, but the test could not confirm it yet (${result.checkError || 'no answer'})`)
      : `something went wrong: ${result.error || 'unknown'}`,
    files: (result && result.files) || [],
  };
}

export function connectCatalogHtml({ catalog, connectedIds, esc }) {
  const cat = catalogServices(catalog);
  return `<div class="picker-input"><span class="prompt-mark">⚡</span>
    <span style="font-weight:700">Connect MCP</span>
    <span style="margin-left:auto;font-size:11px;color:var(--muted)">pick one to start</span></div>
    ${cat.length ? '' : '<div class="rail-empty" style="padding:14px">Loading the catalog…</div>'}
    <div class="svc-grid">${cat.map((s) => `
      <div class="svc-card${connectedIds.has(s.id) ? ' connected' : ''}" data-id="${esc(s.id)}" tabindex="0">
        <span class="code" data-kind="service">${esc(s.code)}</span>
        <span class="sv-name">${esc(s.name)}</span>
        <span class="sv-desc">${esc(s.desc)}</span>
        ${s.id === 'kie' ? '<span class="sv-by">by Dainami</span>' : ''}
        <span class="sv-go">${connectedIds.has(s.id) ? '<span class="ok">●</span> connected' : 'connect →'}</span>
      </div>`).join('')}</div>
    <div class="svc-custom" id="svc-own" tabindex="0">
      <span class="code" data-kind="service">＋</span>
      <span class="col"><span class="sv-name">Already have one? Add it yourself</span>
      <span class="sv-desc">paste an address or command — or choose a .mcpb bundle file</span></span>
      <span class="sv-go">add it →</span>
    </div>
    <div class="svc-custom" id="svc-custom" tabindex="0">
      <span class="code" data-kind="service">✳</span>
      <span class="col"><span class="sv-name">Something else? It gets built for you</span>
      <span class="sv-desc">say it in plain words, watch it happen</span></span>
      <span class="sv-go">build it →</span>
    </div>`;
}

export function connectDoneHtml({ svc, result, esc }) {
  const okLine = result.ok
    ? (result.checked ? `tested just now: ${esc(svc.name)} answers · ${result.tools} tools ready` : `written, but the test could not confirm it yet (${esc(result.checkError || 'no answer')})`)
    : `something went wrong: ${esc(result.error || 'unknown')}`;
  const extra = result.claudeUserScope && result.claudeUserScope !== 'written' ? `<div class="setup-note">${esc(result.claudeUserScope)}</div>` : '';
  return `
    <div class="sv-bigok"><div class="sv-bigok-t caveat">${result.ok ? esc(svc.name) + ' is connected!' : 'Not yet.'}</div>
      <div class="sv-bigok-s">${result.ok ? 'your agents can use it from the very next session' : 'nothing broke, and nothing was half-written'}</div></div>
    <div class="sv-okline"><span class="ok"${result.ok ? '' : ' style="color:var(--amber-ink)"'}>●</span> ${okLine}</div>
    <details class="sv-fold"><summary>curious what got written? peek here</summary>
      <div class="sv-fold-body"><div class="setup-note">${(result.files || []).map(esc).join(' · ') || 'nothing yet'}</div>${extra}</div></details>
    <div class="setup-actions">
      <button class="btn btn--go" id="sv-done">Done</button>
      <button class="btn" id="sv-more">Connect another</button></div>`;
}

export function createMcpSetup(deps) {
  const {
    state, overlay, q, esc, api, toast, closeOverlay, renderOverlay,
    refreshServices, refreshAgents, loadLibrary, installedAgentIds,
    chosenAgent, agentOptionsHtml, agentSession, bestAgent, startPanel,
    shortHome, agentNameOf,
  } = deps;

  const projectPathOf = () => state.project && state.project.path;

  function svcKnowsLine() {
    const text = knowsCopy({ kind: 'mcp', installed: installedAgentIds(), nameOf: agentNameOf });
    return text ? esc(text) : '';
  }

  function deliverOnExit() {
    const projectPath = projectPathOf();
    if (!projectPath) return;
    refreshServices();
    return api.deliverServices({ projectPath, agentIds: installedAgentIds() }).then(() => refreshServices());
  }

  function clickOnEnter(el) {
    if (!el) return;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.onclick(); } };
  }

  function openConnect() {
    state.overlay = { type: 'connect' };
    renderOverlay();
    refreshServices();
    refreshAgents();
  }

  function openConnectForm(svc) {
    state.overlay = { type: 'connect-form', svc, scope: 'project', values: {} };
    renderOverlay();
  }

  function openConnectOwn() {
    state.overlay = { type: 'connect-own', name: '', address: '', scope: 'project', values: {}, bundle: null };
    renderOverlay();
    if (!state.agents) refreshAgents();
  }

  function openConnectCustom() {
    state.overlay = { type: 'connect-custom', text: '' };
    renderOverlay();
    if (!state.agents) refreshAgents();
  }

  function renderConnectCatalog() {
    const cat = catalogServices(state.services.catalog);
    const connectedIds = new Set(state.services.connected.map((s) => s.id));
    const modal = overlay('picker-box', connectCatalogHtml({ catalog: cat, connectedIds, esc }));
    modal.querySelectorAll('.svc-card').forEach((el) => {
      el.onclick = () => {
        const svc = cat.find((s) => s.id === el.dataset.id);
        const already = state.services.connected.find((s) => s.id === svc.id);
        if (already) return openServiceDetails(already);
        openConnectForm(svc);
      };
      clickOnEnter(el);
    });
    q('#svc-custom', modal).onclick = () => openConnectCustom();
    clickOnEnter(q('#svc-custom', modal));
    q('#svc-own', modal).onclick = () => openConnectOwn();
    clickOnEnter(q('#svc-own', modal));
  }

  function renderConnectOwn() {
    const o = state.overlay;
    const b = o.bundle;
    const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" data-kind="service">＋</span>
      <span class="col"><span class="name">Add your own</span><span class="desc">an address, a command, or a bundle file</span></span></div>
    ${b ? `<p class="setup-copy"><b>${esc(b.name)}</b>${b.version ? ' · v' + esc(b.version) : ''} — ${esc(b.description || 'unpacked and ready')}</p>`
        : `<p class="setup-copy">Paste what the service gave you — a URL (https://…) or the command line from its README.</p>`}
    <div class="frow" style="display:flex;gap:10px;align-items:baseline;margin:0 0 10px"><span class="sv-lab" style="width:64px;flex:none">Name</span>
      <input class="text-input" id="own-name" style="flex:1" placeholder="what your agents should call it" spellcheck="false" /></div>
    ${b ? '' : `<div class="frow" style="display:flex;gap:10px;align-items:baseline;margin:0 0 10px"><span class="sv-lab" style="width:64px;flex:none">It is</span>
      <input class="text-input" id="own-addr" style="flex:1" placeholder="https://mcp.example.com/mcp  ·  or:  npx -y some-mcp-server" spellcheck="false" /></div>`}
    ${(b ? b.fields : []).map((f) => `<div class="frow" style="display:flex;gap:10px;align-items:baseline;margin:0 0 10px"><span class="sv-lab" style="width:64px;flex:none">${esc(f.label)}</span>
      <input class="text-input own-field" data-k="${esc(f.id)}" style="flex:1" type="${f.sensitive ? 'password' : 'text'}" placeholder="${esc(f.description || (f.default ? 'default: ' + f.default : ''))}" spellcheck="false" /></div>`).join('')}
    ${svcKnowsLine() ? `<div class="setup-note">${svcKnowsLine()}</div>` : ''}
    <div class="chip-row" id="own-scope" style="margin:8px 0">
      <span class="pick-chip${o.scope === 'project' ? ' picked' : ''}" data-v="project">this project</span>
      <span class="pick-chip${o.scope === 'user' ? ' picked' : ''}" data-v="user">this Mac</span></div>
    <div class="setup-actions">
      <button class="btn btn--go" id="own-go">Connect</button>
      ${b ? '<button class="btn" id="own-clear">Different bundle</button>' : '<button class="btn" id="own-bundle">Choose a bundle…</button>'}</div>`);
    const nameIn = q('#own-name', modal), addrIn = q('#own-addr', modal);
    nameIn.value = o.name; if (addrIn) addrIn.value = o.address;
    const keep = () => {
      o.name = nameIn.value; if (addrIn) o.address = addrIn.value;
      modal.querySelectorAll('.own-field').forEach((inp) => { o.values[inp.dataset.k] = inp.value.trim(); });
    };
    nameIn.oninput = keep; if (addrIn) addrIn.oninput = keep;
    modal.querySelectorAll('.own-field').forEach((inp) => { inp.value = o.values[inp.dataset.k] || ''; inp.oninput = keep; });
    q('#own-scope', modal).querySelectorAll('.pick-chip').forEach((chip) => { chip.onclick = () => { keep(); o.scope = chip.dataset.v; renderOverlay(); }; });
    const pickBtn = q('#own-bundle', modal);
    if (pickBtn) pickBtn.onclick = async () => {
      keep();
      const res = await api.pickBundle();
      if (!res) return;
      if (!res.ok) { toast(res.error || 'Could not read that bundle.'); return; }
      o.bundle = res;
      if (!o.name.trim()) o.name = res.name || res.slug;
      renderOverlay();
    };
    const clearBtn = q('#own-clear', modal);
    if (clearBtn) clearBtn.onclick = () => { o.bundle = null; o.values = {}; renderOverlay(); };
    q('#own-go', modal).onclick = async () => {
      keep();
      if (!o.name.trim()) { toast('Give it a name first.'); return; }
      if (!b && !o.address.trim()) { toast('Paste an address or command first — or choose a bundle.'); return; }
      const missing = b ? b.fields.filter((f) => f.required && !o.values[f.id]) : [];
      if (missing.length) { toast(`Fill in ${missing[0].label} first.`); return; }
      q('#own-go', modal).textContent = 'Connecting…';
      const res = await api.connectCustom({
        name: o.name, address: o.address, values: o.values, bundleDir: b && b.dir,
        scope: o.scope, agentIds: installedAgentIds(), projectPath: projectPathOf(),
      });
      refreshServices(); loadLibrary(true);
      state.overlay = { type: 'connect-done', svc: { name: o.name.trim(), code: '＋', desc: 'your own connection' }, result: res };
      renderOverlay();
    };
  }

  function renderConnectForm() {
    const o = state.overlay, svc = o.svc;
    const guided = svc.kind === 'guided';
    const folder = svc.kind === 'folder';
    const keyRows = (svc.keys || []).map((k) => `
    <input class="text-input sv-key" data-k="${esc(k.id)}" placeholder="${esc(k.placeholder)}" spellcheck="false" />
    ${svc.keyHelpUrl ? `<div class="sv-help" data-url="${esc(svc.keyHelpUrl)}">where do I find my key?</div>` : ''}`).join('');
    const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" data-kind="service">${esc(svc.code)}</span>
      <span class="col"><span class="name">Connect ${esc(svc.name)}</span><span class="desc">${esc(svc.desc)}</span></span></div>
    ${guided
      ? `<p class="setup-copy">${esc(svc.guide)}</p><div class="ni-agent">${chosenAgent(o)
          ? `a new session with <select class="agent-pick" id="sv-agent">${agentOptionsHtml(o.workerId)}</select> walks you through it`
          : 'No agent is installed yet. Press ⌘N to add one first.'}</div>`
      : folder
        ? `<p class="setup-copy">Pick the one folder your agents may read and edit. Nothing outside it is reachable.</p><button class="btn" id="sv-pick-folder">Choose a folder…</button><div class="setup-note" id="sv-folder-note">${esc(o.values.folder ? shortHome(o.values.folder) : '')}</div>`
        : `<p class="setup-copy">${esc(svc.name)} gives you one key so your agents can get in. Paste it here. It stays on your Mac.</p>${keyRows}`}
    ${svcKnowsLine() ? `<div class="setup-note">${svcKnowsLine()}</div>` : ''}
    <details class="sv-fold"${o.foldOpen ? ' open' : ''}><summary>choices (fine as they are)</summary>
      <div class="sv-fold-body">
        <div class="sv-lab">works in</div>
        <div class="chip-row" id="sv-scope">
          <span class="pick-chip${o.scope === 'project' ? ' picked' : ''}" data-v="project">this project</span>
          <span class="pick-chip${o.scope === 'user' ? ' picked' : ''}" data-v="user">this Mac</span></div>
      </div></details>
    <div class="setup-actions">
      <button class="btn btn--go" id="sv-connect">${guided ? 'Set it up with my agent' : 'Connect'}</button>
      <button class="btn" id="sv-docs">Guide</button></div>`);
    const saveKeys = () => { modal.querySelectorAll('.sv-key').forEach((inp) => { o.values[inp.dataset.k] = inp.value.trim(); }); };
    modal.querySelectorAll('.sv-key').forEach((inp) => { inp.value = o.values[inp.dataset.k] || ''; });
    modal.querySelectorAll('.sv-help').forEach((el) => { el.onclick = () => api.openUrl(el.dataset.url); });
    const guidedSel = q('#sv-agent', modal);
    if (guidedSel) guidedSel.onchange = () => { o.workerId = guidedSel.value; };
    const fold = q('.sv-fold', modal); fold.ontoggle = () => { o.foldOpen = fold.open; };
    q('#sv-docs', modal).onclick = () => api.openUrl(svc.docs);
    q('#sv-scope', modal).querySelectorAll('.pick-chip').forEach((chip) => { chip.onclick = () => { saveKeys(); o.scope = chip.dataset.v; renderOverlay(); }; });
    const pickBtn = q('#sv-pick-folder', modal);
    if (pickBtn) pickBtn.onclick = async () => { const info = await api.pickFolder(); if (info) { o.values.folder = info.path; q('#sv-folder-note', modal).textContent = info.pathShort; } };
    const install = svc.kind === 'install';
    const installDirOf = () => '~/.nami/connectors/' + svc.docs.split('/').pop();
    if (install && o.installed === undefined) {
      q('#sv-connect', modal).textContent = 'Install first';
      api.statPath({ token: installDirOf() + '/dist/index.js' }).then((st) => {
        o.installed = !!(st && st.exists);
        const btn = q('#sv-connect', modal);
        if (btn && btn.textContent !== 'Connecting…') btn.textContent = o.installed ? 'Connect' : 'Install first';
      });
    } else if (install) {
      q('#sv-connect', modal).textContent = o.installed ? 'Connect' : 'Install first';
    }
    q('#sv-connect', modal).onclick = async () => {
      if (guided) return startGuidedSetup(svc, chosenAgent(o));
      if (install && !o.installed) {
        const dir = installDirOf();
        closeOverlay();
        startPanel({ kind: 'run', title: 'install ' + svc.name, code: svc.code,
          command: 'git clone ' + svc.docs + ' ' + dir + ' && cd ' + dir + ' && npm install && npm run build' });
        toast('When the install finishes, open Connect again: one more click.');
        return;
      }
      saveKeys();
      if (install) o.values.installDir = installDirOf();
      if (svc.keys.some((k) => !o.values[k.id]) || (folder && !o.values.folder)) { toast(folder ? 'Choose a folder first.' : 'Paste your key first.'); return; }
      q('#sv-connect', modal).textContent = 'Connecting…';
      const res = await api.connectService({ id: svc.id, values: o.values, scope: o.scope, agentIds: installedAgentIds(), projectPath: projectPathOf() });
      refreshServices(); loadLibrary(true);
      state.overlay = { type: 'connect-done', svc, result: res }; renderOverlay();
    };
  }

  function renderConnectDone() {
    const { svc, result } = state.overlay;
    const modal = overlay('setup-box', connectDoneHtml({ svc, result, esc }));
    q('#sv-done', modal).onclick = closeOverlay;
    q('#sv-more', modal).onclick = openConnect;
  }

  function openServiceDetails(sv) {
    const cat = catalogServices(state.services.catalog).find((s) => s.id === sv.id)
      || state.services.catalog.find((s) => s.id === sv.id);
    const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" data-kind="service">${esc((cat && cat.code) || 'SV')}</span>
      <span class="col"><span class="name">${esc(sv.name)}</span>
      <span class="desc"><span class="ok">●</span> connected · ${esc(sv.platforms.join(' + '))} · ${esc(sv.scopes.map((s) => s === 'project' ? 'this project' : 'your Mac').join(', '))}</span></span></div>
    <div class="setup-actions">
      <button class="btn" id="sv-disc">Disconnect</button>
      <button class="btn btn--go" id="sv-ok">Done</button></div>`);
    q('#sv-ok', modal).onclick = closeOverlay;
    q('#sv-disc', modal).onclick = async () => {
      await api.disconnectService({ id: sv.id, projectPath: projectPathOf() });
      refreshServices(); closeOverlay(); toast(sv.name + ' disconnected.');
    };
  }

  function renderConnectCustom() {
    const o = state.overlay;
    const worker = chosenAgent(o);
    const modal = overlay('setup-box', `
    <div class="setup-head"><span class="code" data-kind="service">✳</span>
      <span class="col"><span class="name">Built for you</span><span class="desc">describe it like you would to a person</span></span></div>
    <input class="text-input" id="svc-desc" placeholder="our internal wiki at wiki.acme.dev, read-only is fine" spellcheck="false" />
    <div class="ni-agent">${worker
      ? `a new session with <select class="agent-pick" id="svc-agent">${agentOptionsHtml(worker.id)}</select> builds it for you`
      : 'No agent is installed yet. Press ⌘N to add one first.'}</div>
    <div class="setup-actions" style="margin-top:12px"><button class="btn btn--go" id="svc-go" ${worker ? '' : 'disabled'}>Go</button></div>
    <p class="setup-note">Watch it work, talk to it if you want. It appears under MCP in the Library when it lands.</p>`);
    const agentSel = q('#svc-agent', modal);
    if (agentSel) agentSel.onchange = () => { o.workerId = agentSel.value; };
    const input = q('#svc-desc', modal); input.value = o.text; setTimeout(() => input.focus(), 30);
    input.oninput = () => { o.text = input.value; };
    q('#svc-go', modal).onclick = () => {
      const w = chosenAgent(o);
      if (!o.text.trim() || !w) return;
      closeOverlay();
      const onExit = state.project ? deliverOnExit : undefined;
      agentSession(w, { title: 'build: connector', code: 'BC', seed: customSetupSeed(o.text), onExit });
      toast('Your agent is on it. It appears under MCP in the Library when it lands.');
    };
  }

  function startGuidedSetup(svc, worker) {
    worker = worker || bestAgent();
    if (!worker) { toast('No agent is installed yet. Press ⌘N to add one first.'); return; }
    closeOverlay();
    const onExit = state.project ? deliverOnExit : undefined;
    agentSession(worker, { title: 'set up ' + svc.name, code: svc.code, seed: guidedSetupSeed(svc), onExit });
    toast('Your agent will walk you through it, right in the tile.');
  }

  function render() {
    const o = state.overlay;
    if (!o) return;
    if (o.type === 'connect') return renderConnectCatalog();
    if (o.type === 'connect-form') return renderConnectForm();
    if (o.type === 'connect-done') return renderConnectDone();
    if (o.type === 'connect-custom') return renderConnectCustom();
    if (o.type === 'connect-own') return renderConnectOwn();
  }

  return {
    openConnect, openConnectForm, openConnectOwn, openConnectCustom,
    openServiceDetails, startGuidedSetup, render,
    renderConnectCatalog, renderConnectForm, renderConnectOwn,
    renderConnectCustom, renderConnectDone,
  };
}
