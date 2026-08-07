// Dainami CLI — the paper agent workbench (renderer).
// Vanilla DOM. Static shell built once; regions refreshed on state change. Session cards are managed
// incrementally so live terminals (xterm) survive re-renders.

import { Terminal } from './vendor/xterm.mjs';
import { FitAddon } from './vendor/addon-fit.mjs';

const api = window.dainami;

// ---- palette ---------------------------------------------------------------
const TINTS = ['#a9c0dc', '#a9c8a4', '#e3b0bd', '#ecc98d', '#dfa287', '#c0b3dc'];
const PAPERS = ['#fffdf6', '#fdf7e6', '#fbf3e0'];
const ROTS = ['-0.7deg', '0.5deg', '-0.4deg', '0.8deg', '-0.9deg'];
const ART_ROTS = ['-1.4deg', '1deg', '-0.7deg', '1.3deg'];
let colorSeed = 3;
function nextTint() { colorSeed = (colorSeed + 1) % TINTS.length; return TINTS[colorSeed]; }

// Ink-on-paper xterm theme (ANSI remapped to the mockup's tints).
const XTERM_THEME = {
  background: 'rgba(0,0,0,0)', foreground: '#33302a', cursor: '#4a6b52', cursorAccent: '#fdf9ec',
  selectionBackground: 'rgba(120,145,180,0.35)',
  black: '#5a4b34', red: '#a8482f', green: '#4a7a4a', yellow: '#9a7420', blue: '#3f6088',
  magenta: '#8a5f8a', cyan: '#3f7d82', white: '#6f6553',
  brightBlack: '#8d8065', brightRed: '#b4503c', brightGreen: '#5f8f5f', brightYellow: '#a8792a',
  brightBlue: '#5a7fae', brightMagenta: '#a07aa0', brightCyan: '#5aa0a0', brightWhite: '#2f2b26',
};

// ---- state -----------------------------------------------------------------
const S = {
  project: null,          // folder info from main
  recents: [],
  claudeExe: null,
  demo: false,
  sessions: [],           // session objects
  activeSessionId: null,
  railTab: 'sessions',    // sessions | workspace
  overlay: null,          // { type, ... }
  draft: '',
  seq: 0,
  toast: null,
};

let els = {};             // static shell region refs
const cardEls = new Map(); // sessionId -> { root, head, body, term, fit, statusChip, mark }

function uid(prefix) { S.seq += 1; return `${prefix}${S.seq}`; }
function code2(str) {
  const words = String(str || '').replace(/[^a-zA-Z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (String(str || '?').replace(/[^a-zA-Z]/g, '').slice(0, 2) || 'SS').toUpperCase();
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function shorten(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---- session model ---------------------------------------------------------
function makeSession(opts) {
  return Object.assign({
    id: uid('ses_'), type: 'claude', tint: nextTint(), rot: ROTS[S.sessions.length % ROTS.length],
    code: code2(opts.goal || opts.agentName || 'SS'),
    goal: opts.goal || 'New session', subtitle: '', agentName: opts.agentName || null,
    model: opts.model || null, cwd: opts.cwd || (S.project && S.project.path),
    status: 'building', flow: [], artifacts: [], pendingPermission: null,
    claudeSessionId: null, expanded: true, command: '',
    term: null, fit: null, ptyStarted: false, exited: false,
  }, opts);
}

function statusMeta(s) {
  const t = s.type === 'terminal';
  switch (s.status) {
    case 'building': return { label: t ? 'live' : 'thinking', color: '#7a5d3a', working: true };
    case 'running': return { label: t ? 'live' : 'working', color: '#4a6b52', working: true };
    case 'needs-ok': return { label: 'needs your ok', color: '#a8792a', working: false };
    case 'done': return { label: 'finished', color: '#4a7a4a', working: false };
    case 'failed': return { label: 'stopped', color: '#b4503c', working: false };
    case 'idle': return { label: 'idle', color: '#8d8065', working: false };
    case 'exited': return { label: 'closed', color: '#8d8065', working: false };
    default: return { label: s.status, color: '#8d8065', working: false };
  }
}

// ===========================================================================
//  Boot
// ===========================================================================
(async function boot() {
  buildShell();
  const b = await api.boot();
  S.demo = b.demo; S.claudeExe = b.claudeExe;
  S.recents = b.recentFolders || [];
  S.project = b.currentFolder || null;

  api.onClaudeEvent(onClaudeEvent);
  api.onTermData(({ id, data }) => { const c = cardEls.get(id); if (c && c.term) c.term.write(data); });
  api.onTermExit(({ id, code }) => {
    const s = S.sessions.find((x) => x.id === id); if (!s) return;
    s.exited = true; s.status = 'exited';
    const c = cardEls.get(id); if (c && c.term) c.term.write(`\r\n\x1b[38;2;141;128;101m[session closed · exit ${code}]\x1b[0m\r\n`);
    refreshCardHead(s); refreshRail();
  });

  if (S.demo) seedDemo();
  renderAll();
})();

// ===========================================================================
//  Static shell
// ===========================================================================
function buildShell() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="desk">
      <div class="sheet">
        <div class="tape tape--left"></div><div class="tape tape--right"></div>

        <div class="topbar">
          <div class="brand"><span class="brand-name">Dainami CLI</span><span class="brand-sub">agent workbench</span></div>
          <div class="topbar-center" id="topbar-center"></div>
          <div class="topbar-right">
            <div class="live-badge" id="live-badge" style="display:none"><span class="dot"></span><span id="live-label"></span></div>
            <button class="btn" id="btn-agents">Agents ⌘K</button>
            <button class="btn btn--go" id="btn-new">＋ New session ⌘N</button>
          </div>
        </div>

        <div class="split">
          <div class="rail">
            <div class="rail-tabs">
              <button class="rail-tab active" data-tab="sessions">Sessions</button>
              <button class="rail-tab" data-tab="workspace">Workspace</button>
            </div>
            <div id="rail-content" style="flex:1;min-height:0;display:flex;flex-direction:column;"></div>
            <div id="agents-panel" class="agents-panel"></div>
          </div>

          <div class="main">
            <div class="lane" id="lane"><div class="lane-stack" id="lane-stack"></div></div>
            <div class="cmdbar">
              <div class="cmdbar-box" id="cmdbar-box">
                <span class="prompt-mark">❯</span>
                <input id="cmd-input" placeholder="Describe the job, or type /run /open /agents /term /help" />
                <button class="btn btn--go cmd-run" id="cmd-run">Run ⌘⏎</button>
              </div>
              <div class="cmd-preview" id="cmd-preview"></div>
            </div>
            <div class="footer">
              <span>⌘N new session</span><span>⌘O open folder</span><span>⌘K agents</span>
              <span>⌘⏎ run</span><span>space quick-look</span><span>esc close</span>
              <span class="path" id="footer-path"></span>
            </div>
          </div>
        </div>

        <div id="overlay-root"></div>
        <div id="toast-root"></div>
      </div>
    </div>`;

  els = {
    topbarCenter: q('#topbar-center'), liveBadge: q('#live-badge'), liveLabel: q('#live-label'),
    railContent: q('#rail-content'), agentsPanel: q('#agents-panel'),
    laneStack: q('#lane-stack'), lane: q('#lane'),
    cmdInput: q('#cmd-input'), cmdPreview: q('#cmd-preview'), cmdbarBox: q('#cmdbar-box'),
    footerPath: q('#footer-path'), overlayRoot: q('#overlay-root'), toastRoot: q('#toast-root'),
  };

  q('#btn-new').onclick = () => openNewSession();
  q('#btn-agents').onclick = () => openAgentPicker();
  q('#cmd-run').onclick = () => runDraft();
  els.cmdInput.addEventListener('input', (e) => { S.draft = e.target.value; refreshCmdPreview(); });
  els.cmdInput.addEventListener('focus', () => els.cmdbarBox.classList.add('focused'));
  els.cmdInput.addEventListener('blur', () => els.cmdbarBox.classList.remove('focused'));
  els.cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runDraft(); }
  });
  document.querySelectorAll('.rail-tab').forEach((t) => { t.onclick = () => { S.railTab = t.dataset.tab; renderAll(); }; });

  document.addEventListener('keydown', onGlobalKey);
}

function q(sel, root) { return (root || document).querySelector(sel); }

// ===========================================================================
//  Global keys
// ===========================================================================
function onGlobalKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (meta && e.key === 'Enter') { e.preventDefault(); runDraft(); return; }
  if (meta && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); openNewSession(); return; }
  if (meta && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFolderDialog(); return; }
  if (meta && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openAgentPicker(); return; }
  if (e.key === 'Escape') { if (S.overlay) { S.overlay = null; renderOverlay(); } }
}

// ===========================================================================
//  Render regions
// ===========================================================================
function renderAll() {
  renderHeader();
  renderRail();
  renderAgentsPanel();
  renderLane();
  renderFooter();
  renderOverlay();
  refreshCmdPreview();
}

function renderHeader() {
  const p = S.project;
  els.topbarCenter.innerHTML = '';
  const chip = document.createElement('div');
  chip.className = 'project-chip';
  if (p) {
    chip.innerHTML = `<span class="swatch" style="background:${TINTS[0]}"></span>
      <span class="name">${esc(p.name)}</span><span class="path">${esc(p.pathShort)}</span><span class="caret">▼</span>`;
  } else {
    chip.innerHTML = `<span class="swatch" style="background:${TINTS[3]}"></span><span class="name">Open a folder</span><span class="caret">▼</span>`;
  }
  chip.onclick = (e) => { e.stopPropagation(); toggleProjectsPop(chip); };
  els.topbarCenter.appendChild(chip);

  const live = S.sessions.filter((s) => statusMeta(s).working).length;
  if (live > 0) { els.liveBadge.style.display = ''; els.liveLabel.textContent = `${live} session${live > 1 ? 's' : ''} live`; }
  else els.liveBadge.style.display = 'none';
}

function toggleProjectsPop(anchor) {
  const existing = q('.projects-pop', els.topbarCenter);
  if (existing) { existing.remove(); return; }
  const pop = document.createElement('div');
  pop.className = 'projects-pop';
  const rows = (S.recents || []).map((r) => `
    <button class="project-row" data-path="${esc(r.path)}">
      <span class="swatch" style="background:${TINTS[hashIdx(r.path)]}"></span>
      <span class="col"><span class="name">${esc(r.name)}</span><span class="summary">${esc(r.pathShort)}</span></span>
      <span class="mark">›</span>
    </button>`).join('');
  pop.innerHTML = `<div class="pop-label">Recent folders</div>${rows || '<div class="rail-empty">No recent folders yet.</div>'}
    <button class="project-open-other" id="open-other"><span class="plus">＋</span><span>Open another folder…</span><span class="kbd">⌘O</span></button>`;
  els.topbarCenter.appendChild(pop);
  pop.querySelectorAll('.project-row').forEach((r) => { r.onclick = async () => { pop.remove(); await openFolder(r.dataset.path); }; });
  q('#open-other', pop).onclick = () => { pop.remove(); openFolderDialog(); };
  setTimeout(() => document.addEventListener('click', function off() { pop.remove(); document.removeEventListener('click', off); }, { once: true }), 0);
}
function hashIdx(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % TINTS.length; }

function renderRail() {
  document.querySelectorAll('.rail-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === S.railTab));
  refreshRail();
}
function refreshRail() {
  const c = els.railContent; c.innerHTML = '';
  if (S.railTab === 'sessions') {
    const head = document.createElement('div'); head.className = 'rail-head';
    head.innerHTML = `<span class="title">Sessions</span>${S.sessions.length ? '<span class="action" id="clear-all">clear finished</span>' : ''}`;
    c.appendChild(head);
    const cl = q('#clear-all', head); if (cl) cl.onclick = clearFinished;
    const list = document.createElement('div'); list.className = 'rail-list';
    if (!S.sessions.length) { const e = document.createElement('div'); e.className = 'rail-empty'; e.textContent = 'No sessions yet. Write a job below, or press ⌘N.'; c.appendChild(e); return; }
    for (const s of S.sessions) {
      const m = statusMeta(s);
      const card = document.createElement('div');
      card.className = 'nav-card' + (s.id === S.activeSessionId ? ' active' : '');
      card.innerHTML = `<span class="code" style="background:${s.tint}">${esc(s.code)}</span>
        <span class="col"><span class="goal">${esc(shorten(s.goal, 30))}</span><span class="sid">${esc(s.type === 'terminal' ? 'terminal' : (s.claudeSessionId ? s.claudeSessionId.slice(0, 8) : 'starting…'))}</span></span>
        <span class="status" style="color:${m.color}">${esc(m.label)}</span>`;
      card.onclick = () => focusSession(s.id);
      list.appendChild(card);
    }
    c.appendChild(list);
  } else {
    const p = S.project;
    const tree = document.createElement('div'); tree.className = 'tree';
    if (!p) { tree.innerHTML = '<div class="rail-empty">Open a folder to see its files.</div>'; c.appendChild(tree); return; }
    tree.innerHTML = `<div class="tree-path">${esc(p.pathShort)}</div>`;
    for (const n of (p.tree || [])) {
      const row = document.createElement('div'); row.className = 'tree-row';
      row.style.paddingLeft = (6 + n.pad * 14) + 'px';
      row.innerHTML = `<span class="icon" style="background:${n.kind === 'dir' ? '#e8dfc7' : '#f0e7d0'}"></span>
        <span class="name" style="font-weight:${n.kind === 'dir' ? 700 : 400}">${esc(n.name)}</span><span class="meta">${esc(n.meta)}</span>`;
      if (n.kind === 'file') row.onclick = () => quickLook(joinPath(p.path, n.name));
      tree.appendChild(row);
    }
    c.appendChild(tree);
  }
}

function renderAgentsPanel() {
  const p = S.project; const el = els.agentsPanel;
  const agents = (p && p.agents) || [];
  el.innerHTML = `<div class="head"><span class="title">Agents on file</span><span class="count">${agents.length}</span></div>
    <div class="from">${p ? 'read from ' + esc(p.pathShort) + '/.claude' : 'open a folder to read .claude'}</div>
    <div class="list" id="agents-list"></div>`;
  const list = q('#agents-list', el);
  if (!agents.length) { list.innerHTML = `<div class="rail-empty" style="padding:2px 0">No agents found${p ? '' : ' yet'}.</div>`; return; }
  for (const a of agents) {
    const row = document.createElement('div'); row.className = 'agent-row';
    row.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.slug)]}">${esc(code2(a.name))}</span>
      <span class="col"><span class="name">${esc(a.name)}</span><span class="tools">${esc(a.tools || a.desc || '')}</span></span><span class="chev">›</span>`;
    row.onclick = () => openAgentInspector(a);
    list.appendChild(row);
  }
}

function renderFooter() { els.footerPath.textContent = S.project ? S.project.pathShort : (S.claudeExe ? 'claude ready · ' + S.claudeExe : 'no folder open'); }

// ===========================================================================
//  Lane — incremental session cards
// ===========================================================================
function renderLane() {
  if (!S.sessions.length) {
    cardEls.forEach((c) => c.root.remove()); cardEls.clear();
    els.laneStack.innerHTML = `<div class="lane-empty">
      <div class="polaroid">no sessions</div>
      <div><div class="big">Start a session</div><div class="hint">Write the job below, or press ⌘N to set one up.</div></div></div>`;
    return;
  }
  if (q('.lane-empty', els.laneStack)) els.laneStack.innerHTML = '';
  // remove stale
  for (const [id, c] of cardEls) { if (!S.sessions.find((s) => s.id === id)) { c.root.remove(); cardEls.delete(id); } }
  // ensure + order
  for (const s of S.sessions) {
    if (!cardEls.has(s.id)) mountCard(s);
    els.laneStack.appendChild(cardEls.get(s.id).root);
    refreshCardHead(s);
    if (s.type === 'claude') refreshClaudeBody(s);
  }
}

function mountCard(s) {
  const root = document.createElement('div'); root.className = 'card'; root.style.transform = `rotate(${s.rot})`;
  root.innerHTML = `<div class="card-tape" style="background-color:${s.tint}"></div>
    <div class="card-head">
      <span class="code" style="background:${s.tint}"></span>
      <span class="col"><span class="goal"></span><span class="subtitle"></span></span>
      <span class="status-chip"></span><span class="mark"></span>
    </div>
    <div class="card-body"></div>`;
  const head = q('.card-head', root); const body = q('.card-body', root);
  head.onclick = (e) => { if (e.target.closest('.status-chip')) return; s.expanded = !s.expanded; body.style.display = s.expanded ? '' : 'none'; q('.mark', head).textContent = s.expanded ? '▾' : '▸'; };
  const rec = { root, head, body, statusChip: q('.status-chip', head), mark: q('.mark', head), code: q('.code', head), goal: q('.goal', head), subtitle: q('.subtitle', head), term: null, fit: null };
  cardEls.set(s.id, rec);
  if (s.type === 'terminal') mountTerminal(s, rec);
}

function refreshCardHead(s) {
  const c = cardEls.get(s.id); if (!c) return;
  const m = statusMeta(s);
  c.code.textContent = s.code; c.code.style.background = s.tint;
  c.goal.textContent = s.goal;
  c.subtitle.textContent = s.subtitle || (s.type === 'terminal' ? 'terminal · ' + shortHome(s.cwd) : (s.agentName ? s.agentName + ' · ' + shortHome(s.cwd) : 'claude code · ' + shortHome(s.cwd)));
  c.statusChip.textContent = m.label;
  c.statusChip.style.color = m.color;
  c.statusChip.classList.toggle('working', m.working);
  c.mark.textContent = s.expanded ? '▾' : '▸';
}
function shortHome(p) { return String(p || '').replace(/^\/Users\/[^/]+/, '~'); }

function refreshClaudeBody(s) {
  const c = cardEls.get(s.id); if (!c || s.type !== 'claude') return;
  const b = c.body; b.innerHTML = '';

  if (s.command) { const cs = document.createElement('div'); cs.className = 'cmd-strip'; cs.textContent = s.command; b.appendChild(cs); }

  const flow = document.createElement('div'); flow.className = 'flow';
  for (const item of s.flow) flow.appendChild(renderFlowItem(item));
  b.appendChild(flow);

  if (s.pendingPermission) b.appendChild(renderApproval(s));
  if (s.status === 'failed' && s.failText) b.appendChild(renderStopped(s));
  if (s.artifacts.length) b.appendChild(renderArtifacts(s));
  if (!s.exited) b.appendChild(renderReplyRow(s));
}

function renderFlowItem(item) {
  const el = document.createElement('div');
  if (item.kind === 'assistant') { el.className = 'say'; el.textContent = item.text; return el; }
  if (item.kind === 'user') { el.className = 'say say--user'; el.textContent = item.text; return el; }
  if (item.kind === 'thinking') { el.className = 'say'; el.style.color = '#9c8f78'; el.style.fontStyle = 'italic'; el.textContent = shorten(item.text, 160); return el; }
  if (item.kind === 'step') {
    el.className = 'step ' + (item.state || 'running');
    const mk = item.state === 'done' ? '✓' : item.state === 'failed' ? '✕' : '·';
    el.innerHTML = `<span class="box">${mk}</span><span class="text">${esc(item.label)}</span>${item.detail ? `<span class="detail">${esc(item.detail)}</span>` : ''}`;
    return el;
  }
  if (item.kind === 'todos') {
    const wrap = document.createElement('div'); wrap.className = 'flow'; wrap.style.gap = '9px';
    for (const t of item.todos) {
      const st = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'running' : '';
      const row = document.createElement('div'); row.className = 'step ' + st;
      const mk = st === 'done' ? '✓' : st === 'running' ? '·' : '';
      row.innerHTML = `<span class="box">${mk}</span><span class="text">${esc(t.text)}</span>`;
      wrap.appendChild(row);
    }
    return wrap;
  }
  return el;
}

function renderApproval(s) {
  const p = s.pendingPermission;
  const wrap = document.createElement('div'); wrap.className = 'approval';
  wrap.innerHTML = `<div class="col"><div class="title">Needs your OK</div><div class="body">${esc(p.summary || p.label)}</div></div>
    <div class="actions"><button class="btn btn--quiet">Not now</button><button class="btn btn--amber">Go ahead</button></div>`;
  const [deny, allow] = wrap.querySelectorAll('button');
  deny.onclick = () => decide(s, false);
  allow.onclick = () => decide(s, true);
  return wrap;
}
function renderStopped(s) {
  const wrap = document.createElement('div'); wrap.className = 'stopped';
  wrap.innerHTML = `<div class="col"><div class="title">Stopped early</div><div class="body">${esc(s.failText)}</div></div>
    <button class="btn btn--red">Try again</button>`;
  wrap.querySelector('button').onclick = () => retrySession(s);
  return wrap;
}
function renderArtifacts(s) {
  const wrap = document.createElement('div'); wrap.className = 'artifacts';
  wrap.innerHTML = `<div class="title">Pasted in</div><div class="grid"></div>`;
  const grid = q('.grid', wrap);
  s.artifacts.slice(-8).forEach((a, i) => {
    const el = document.createElement('div'); el.className = 'artifact'; el.style.transform = `rotate(${ART_ROTS[i % ART_ROTS.length]})`;
    el.innerHTML = `<span class="kind" style="background:${a.tint || TINTS[hashIdx(a.path)]}">${esc(a.kind || 'FILE')}</span>
      <span class="col"><span class="label">${esc(baseNameOf(a.path))}</span><span class="what">${esc(a.what || shortHome(a.path))}</span></span>`;
    el.onclick = () => quickLook(a.path);
    grid.appendChild(el);
  });
  return wrap;
}
function renderReplyRow(s) {
  const row = document.createElement('div'); row.className = 'reply-row';
  row.innerHTML = `<span class="prompt-mark">❯</span><input placeholder="Reply, or add to the job…" /><button class="btn btn--go send">Send</button>`;
  const input = q('input', row);
  const doSend = () => { const v = input.value.trim(); if (!v) return; input.value = ''; sendToSession(s, v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
  q('.send', row).onclick = doSend;
  return row;
}
function baseNameOf(p) { return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '(file)'; }

// ---- terminal cards --------------------------------------------------------
function mountTerminal(s, rec) {
  const wrap = document.createElement('div'); wrap.className = 'term-wrap';
  rec.body.innerHTML = ''; rec.body.appendChild(wrap);
  const term = new Terminal({
    fontFamily: "'Courier Prime', 'Courier New', monospace", fontSize: 13, lineHeight: 1.15,
    theme: XTERM_THEME, cursorBlink: true, allowTransparency: true, scrollback: 4000,
  });
  const fit = new FitAddon(); term.loadAddon(fit);
  term.open(wrap); rec.term = term; rec.fit = fit;
  requestAnimationFrame(() => { try { fit.fit(); } catch (_) {} startTerm(s, term.cols, term.rows); });
  term.onData((d) => api.termWrite({ id: s.id, data: d }));
  term.onResize(({ cols, rows }) => api.termResize({ id: s.id, cols, rows }));
  const ro = new ResizeObserver(() => { try { fit.fit(); } catch (_) {} });
  ro.observe(wrap);
}
async function startTerm(s, cols, rows) {
  if (s.ptyStarted) return; s.ptyStarted = true;
  await api.termCreate({ id: s.id, cwd: s.cwd, cols, rows, command: s.command || null });
}

// ===========================================================================
//  Claude events → flow
// ===========================================================================
function onClaudeEvent(ev) {
  const s = S.sessions.find((x) => x.id === ev.sessionId); if (!s) return;
  switch (ev.kind) {
    case 'init': s.claudeSessionId = ev.claudeSessionId || s.claudeSessionId; s.status = 'running'; break;
    case 'assistant': s.flow.push({ kind: 'assistant', text: ev.text }); s.status = 'running'; break;
    case 'thinking': /* keep quiet; optional */ break;
    case 'tool': s.flow.push({ kind: 'step', toolId: ev.toolId, label: ev.label, detail: ev.detail, state: 'running' }); s.status = 'running';
      if (/^Writing /.test(ev.label) || ev.name === 'Write') pushArtifact(s, ev); break;
    case 'tool_result': {
      const step = [...s.flow].reverse().find((f) => f.kind === 'step' && f.toolId === ev.toolId);
      if (step) step.state = ev.isError ? 'failed' : 'done';
      break;
    }
    case 'todos': {
      const existing = s.flow.find((f) => f.kind === 'todos');
      if (existing) existing.todos = ev.todos; else s.flow.push({ kind: 'todos', todos: ev.todos });
      break;
    }
    case 'permission':
      s.pendingPermission = { permissionId: ev.permissionId, toolName: ev.toolName, label: ev.label, summary: ev.summary };
      s.status = 'needs-ok'; break;
    case 'user_echo': s.flow.push({ kind: 'user', text: ev.text }); s.status = 'running'; break;
    case 'result':
      s.claudeSessionId = ev.claudeSessionId || s.claudeSessionId;
      if (ev.ok) { s.status = 'done'; s.subtitle = `finished · $${(ev.costUsd || 0).toFixed(3)}`; }
      else { s.status = 'failed'; s.failText = friendlyFail(ev.subtype); }
      break;
    case 'interrupted': s.status = 'idle'; break;
    case 'error': s.status = 'failed'; s.failText = shorten(ev.message || 'Something went wrong.', 200); break;
    default: break;
  }
  refreshCardHead(s); refreshClaudeBody(s); refreshRail(); renderHeader();
}

function pushArtifact(s, ev) {
  const path = (ev.detail && ev.detail.indexOf('/') >= 0) ? ev.detail : null;
  if (!path) return;
  if (!s.artifacts.find((a) => a.path === path)) s.artifacts.push({ path, kind: 'FILE', tint: TINTS[hashIdx(path)], what: 'written by the agent' });
}
function friendlyFail(subtype) {
  if (subtype === 'error_max_turns') return 'Hit the turn limit before finishing.';
  if (subtype === 'error_max_budget_usd') return 'Hit the spend limit.';
  return 'The run stopped before finishing.';
}

// ===========================================================================
//  Actions
// ===========================================================================
function decide(s, allow) {
  const p = s.pendingPermission; if (!p) return;
  api.claudePermission({ id: s.id, permissionId: p.permissionId, allow, note: allow ? '' : 'Not now.' });
  s.pendingPermission = null; s.status = 'running';
  refreshCardHead(s); refreshClaudeBody(s); refreshRail();
}
function sendToSession(s, text) {
  if (s.type === 'terminal') { api.termWrite({ id: s.id, data: text + '\r' }); return; }
  api.claudeSend({ id: s.id, text });
  s.status = 'running'; refreshCardHead(s);
}
function retrySession(s) {
  s.flow.push({ kind: 'user', text: 'Try again.' });
  s.status = 'running'; s.failText = null;
  api.claudeStart({ id: s.id, cwd: s.cwd, model: s.model, agentName: s.agentName, prompt: 'Please try again — continue where you left off.', resumeId: s.claudeSessionId });
  refreshCardHead(s); refreshClaudeBody(s);
}
function focusSession(id) { S.activeSessionId = id; renderRail(); const c = cardEls.get(id); if (c) c.root.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function clearFinished() {
  const gone = S.sessions.filter((s) => ['done', 'failed', 'exited'].includes(s.status));
  for (const s of gone) { if (s.type === 'terminal') api.termKill({ id: s.id }); else api.claudeClose({ id: s.id }); const c = cardEls.get(s.id); if (c) { c.root.remove(); cardEls.delete(s.id); } }
  S.sessions = S.sessions.filter((s) => !gone.includes(s));
  renderAll();
}

// ---- start sessions --------------------------------------------------------
function startClaudeSession({ goal, agentName, model, cwd }) {
  const s = makeSession({ type: 'claude', goal, agentName, model, cwd: cwd || (S.project && S.project.path) });
  s.command = buildCommand({ goal, agentName });
  S.sessions.unshift(s); S.activeSessionId = s.id;
  renderLane(); renderRail(); renderHeader();
  api.claudeStart({ id: s.id, cwd: s.cwd, model: s.model, agentName, prompt: goal });
  return s;
}
function startTerminalSession({ goal, command, cwd }) {
  const s = makeSession({ type: 'terminal', goal: goal || 'Terminal', command: command || '', cwd: cwd || (S.project && S.project.path) });
  s.status = 'running';
  S.sessions.unshift(s); S.activeSessionId = s.id;
  renderLane(); renderRail(); renderHeader();
  return s;
}

function buildCommand({ goal, agentName }) {
  const proj = S.project ? S.project.name : 'here';
  const who = agentName ? `--agent ${agentName} ` : '';
  return `dainami run ${who}--project ${proj} "${shorten(goal || '', 60)}"`;
}

// ---- command bar -----------------------------------------------------------
function runDraft() {
  const v = (els.cmdInput.value || '').trim(); if (!v) { openNewSession(); return; }
  els.cmdInput.value = ''; S.draft = ''; refreshCmdPreview();
  if (v.startsWith('/')) {
    const [cmd, ...rest] = v.slice(1).split(' '); const arg = rest.join(' ').trim();
    if (cmd === 'open') return openFolderDialog();
    if (cmd === 'agents') return openAgentPicker();
    if (cmd === 'term') return startTerminalSession({ goal: arg || 'Terminal', command: arg || '' });
    if (cmd === 'help') return toast('Commands: /run /open /agents /term');
    if (cmd === 'run') return guardStart(arg);
    return toast('Unknown command: /' + cmd);
  }
  guardStart(v);
}
function guardStart(goal) {
  if (!goal) return;
  if (!S.project) { toast('Open a folder first (⌘O).'); return; }
  startClaudeSession({ goal });
}
function refreshCmdPreview() {
  const v = (S.draft || '').trim();
  if (!v || v.startsWith('/')) { els.cmdPreview.textContent = v.startsWith('/') ? 'slash command' : ''; return; }
  els.cmdPreview.textContent = buildCommand({ goal: v });
}

// ===========================================================================
//  Overlays
// ===========================================================================
function renderOverlay() {
  els.overlayRoot.innerHTML = '';
  const o = S.overlay; if (!o) return;
  if (o.type === 'new') return renderNewSessionSheet();
  if (o.type === 'agents') return renderAgentPickerSheet();
  if (o.type === 'inspector') return renderInspector(o.agent);
  if (o.type === 'quicklook') return renderQuickLook(o.data);
}
function closeOverlay() { S.overlay = null; renderOverlay(); }

function overlay(cls, inner, opts) {
  const wrap = document.createElement('div'); wrap.className = 'overlay' + (opts && opts.top ? ' overlay--top' : '');
  wrap.onclick = closeOverlay;
  const modal = document.createElement('div'); modal.className = cls; modal.onclick = (e) => e.stopPropagation();
  modal.innerHTML = inner;
  wrap.appendChild(modal); els.overlayRoot.appendChild(wrap);
  return modal;
}

// ---- new session sheet -----------------------------------------------------
function openNewSession() { S.overlay = { type: 'new', goal: '', folder: S.project ? S.project.path : null, who: 'auto', rules: { ask: true, sandbox: true } }; renderOverlay(); }
function renderNewSessionSheet() {
  const o = S.overlay;
  const agents = (S.project && S.project.agents) || [];
  const folderChips = [
    ...(S.recents || []).map((r) => ({ path: r.path, name: r.name })),
  ];
  if (S.project && !folderChips.find((f) => f.path === S.project.path)) folderChips.unshift({ path: S.project.path, name: S.project.name });

  const modal = overlay('modal', `
    <div class="modal-head"><div class="col"><div class="title">New session</div><div class="sub">One job, one runner, one folder.</div></div><div class="modal-x">✕</div></div>
    <div class="modal-body">
      <div class="field-label">1 · What needs doing</div>
      <input class="text-input" id="ns-goal" placeholder="e.g. pull competitor pricing into a sheet" value="${esc(o.goal)}" />
      <div class="field-label section-gap">2 · Where</div>
      <div class="chip-row" id="ns-folders"></div>
      <div class="field-label section-gap">3 · Who runs it</div>
      <div class="who-grid" id="ns-who"></div>
      <div class="field-label section-gap">4 · Ground rules</div>
      <div class="chip-row" id="ns-rules"></div>
      <div class="sheet-cmd" id="ns-cmd"></div>
    </div>
    <div class="modal-foot"><span class="note" id="ns-note"></span>
      <button class="btn btn--quiet" id="ns-cancel">Cancel</button>
      <button class="btn btn--go" id="ns-start">Start session</button></div>`);

  const goalInput = q('#ns-goal', modal);
  goalInput.oninput = () => { o.goal = goalInput.value; refreshSheetCmd(modal); };
  setTimeout(() => goalInput.focus(), 30);
  goalInput.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') startFromSheet(); });

  // folders
  const fWrap = q('#ns-folders', modal);
  folderChips.forEach((f) => {
    const chip = document.createElement('div'); chip.className = 'pick-chip' + (o.folder === f.path ? ' picked' : '');
    chip.innerHTML = `<span class="swatch" style="background:${TINTS[hashIdx(f.path)]}"></span><span>${esc(f.name)}</span>`;
    chip.onclick = () => { o.folder = f.path; renderOverlay(); };
    fWrap.appendChild(chip);
  });
  const other = document.createElement('div'); other.className = 'pick-chip'; other.style.borderStyle = 'dashed'; other.innerHTML = '＋ another folder';
  other.onclick = async () => { const info = await api.pickFolder(); if (info) { S.project = info; S.recents = [{ path: info.path, pathShort: info.pathShort, name: info.name }, ...S.recents.filter((r) => r.path !== info.path)]; o.folder = info.path; renderAll(); renderOverlay(); } };
  fWrap.appendChild(other);

  // who
  const wWrap = q('#ns-who', modal);
  const auto = document.createElement('div'); auto.className = 'who-tile' + (o.who === 'auto' ? ' picked' : '');
  auto.innerHTML = `<span class="code" style="background:#e8dfc7">✳</span><span class="col"><span class="name">Pick for me</span><span class="short">claude reads the job</span></span>`;
  auto.onclick = () => { o.who = 'auto'; renderOverlay(); };
  wWrap.appendChild(auto);
  const term = document.createElement('div'); term.className = 'who-tile' + (o.who === 'terminal' ? ' picked' : '');
  term.innerHTML = `<span class="code" style="background:${TINTS[4]}">❯</span><span class="col"><span class="name">Terminal</span><span class="short">plain shell, ink on paper</span></span>`;
  term.onclick = () => { o.who = 'terminal'; renderOverlay(); };
  wWrap.appendChild(term);
  agents.forEach((a) => {
    const tile = document.createElement('div'); tile.className = 'who-tile' + (o.who === a.slug ? ' picked' : '');
    tile.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.slug)]}">${esc(code2(a.name))}</span><span class="col"><span class="name">${esc(a.name)}</span><span class="short">${esc(shorten(a.desc || a.tools || '', 32))}</span></span>`;
    tile.onclick = () => { o.who = a.slug; renderOverlay(); };
    wWrap.appendChild(tile);
  });

  // rules
  const rWrap = q('#ns-rules', modal);
  const RULES = [{ id: 'ask', name: 'ask before anything destructive' }, { id: 'sandbox', name: 'stay inside this folder' }, { id: 'net', name: 'allow internet' }];
  RULES.forEach((r) => {
    const on = o.rules[r.id] !== false;
    const chip = document.createElement('div'); chip.className = 'pick-chip' + (on ? ' picked' : '');
    chip.innerHTML = `<span class="check">${on ? '✓' : ''}</span><span>${esc(r.name)}</span>`;
    chip.onclick = () => { o.rules[r.id] = !on; renderOverlay(); };
    rWrap.appendChild(chip);
  });

  q('.modal-x', modal).onclick = closeOverlay;
  q('#ns-cancel', modal).onclick = closeOverlay;
  q('#ns-start', modal).onclick = startFromSheet;
  refreshSheetCmd(modal);
}
function refreshSheetCmd(modal) {
  const o = S.overlay; const proj = folderName(o.folder);
  const who = o.who === 'terminal' ? '' : (o.who === 'auto' ? '' : `--agent ${o.who} `);
  const cmd = o.who === 'terminal'
    ? `# opens a terminal in ${proj}${o.goal ? '\n' + o.goal : ''}`
    : `dainami run ${who}--project ${proj} "${shorten(o.goal || '', 60)}"`;
  const cmdEl = q('#ns-cmd', modal); if (cmdEl) cmdEl.textContent = cmd;
  const note = q('#ns-note', modal); if (note) note.textContent = o.folder ? '' : 'Pick a folder to run in.';
}
function folderName(p) { const f = (S.recents || []).find((r) => r.path === p); if (f) return f.name; if (S.project && S.project.path === p) return S.project.name; return baseNameOf(p) || 'folder'; }
function startFromSheet() {
  const o = S.overlay; if (!o.goal || !o.goal.trim()) { toast('What needs doing?'); return; }
  if (!o.folder) { toast('Pick a folder.'); return; }
  const goal = o.goal.trim();
  closeOverlay();
  if (o.who === 'terminal') { startTerminalSession({ goal, command: goal.startsWith('/') ? '' : goal, cwd: o.folder }); return; }
  const agentName = o.who === 'auto' ? null : o.who;
  startClaudeSession({ goal, agentName, cwd: o.folder });
}

// ---- agent picker (⌘K) -----------------------------------------------------
function openAgentPicker() { S.overlay = { type: 'agents', query: '', hi: 0 }; renderOverlay(); }
function renderAgentPickerSheet() {
  const o = S.overlay;
  const agents = (S.project && S.project.agents) || [];
  const filtered = agents.filter((a) => (a.name + ' ' + (a.desc || '')).toLowerCase().includes(o.query.toLowerCase()));
  const modal = overlay('picker-box', `
    <div class="picker-input"><span class="prompt-mark">❯</span><input id="ap-input" placeholder="Which agent? (or type a job)" value="${esc(o.query)}" /></div>
    <div class="picker-list" id="ap-list"></div>`, { top: true });
  const input = q('#ap-input', modal); setTimeout(() => input.focus(), 30);
  input.oninput = () => { o.query = input.value; o.hi = 0; renderOverlay(); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = filtered[o.hi]; if (a) { closeOverlay(); startClaudeSession({ goal: o.query || `Run ${a.name}`, agentName: a.slug }); } else if (o.query.trim()) { closeOverlay(); guardStart(o.query.trim()); } }
    if (e.key === 'ArrowDown') { o.hi = Math.min(filtered.length - 1, o.hi + 1); renderOverlay(); }
    if (e.key === 'ArrowUp') { o.hi = Math.max(0, o.hi - 1); renderOverlay(); }
  });
  const list = q('#ap-list', modal);
  if (!filtered.length) { list.innerHTML = `<div class="rail-empty" style="padding:14px">${agents.length ? 'No match.' : 'No agents in this folder. Type a job and press Enter.'}</div>`; return; }
  filtered.forEach((a, i) => {
    const row = document.createElement('div'); row.className = 'picker-row' + (i === o.hi ? ' hilite' : '');
    row.innerHTML = `<span class="code" style="background:${TINTS[hashIdx(a.slug)]}">${esc(code2(a.name))}</span>
      <span class="col"><span class="name">${esc(a.name)}</span><span class="desc">${esc(a.desc || a.tools || '')}</span></span>`;
    row.onclick = () => { closeOverlay(); openNewSessionWithAgent(a); };
    list.appendChild(row);
  });
}
function openNewSessionWithAgent(a) { S.overlay = { type: 'new', goal: '', folder: S.project ? S.project.path : null, who: a.slug, rules: { ask: true, sandbox: true } }; renderOverlay(); }

// ---- agent inspector -------------------------------------------------------
function openAgentInspector(a) { S.overlay = { type: 'inspector', agent: a }; renderOverlay(); }
function renderInspector(a) {
  const skills = (S.project && S.project.skills) || [];
  const tools = (a.tools || '').split(/[,·]/).map((t) => t.trim()).filter(Boolean);
  const modal = overlay('modal', `
    <div class="modal-head">
      <span class="code" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:${TINTS[hashIdx(a.slug)]};border:1px solid rgba(60,45,25,.35);box-shadow:2px 2px 0 rgba(90,72,44,.2)">${esc(code2(a.name))}</span>
      <div class="col"><div class="title">${esc(a.name)}</div><div class="sub">${esc(a.desc || 'agent on file')}</div></div><div class="modal-x">✕</div></div>
    <div class="modal-body" style="width:560px">
      <div class="field-label">Tools it can use</div>
      <div class="chip-row">${tools.length ? tools.map((t) => `<span class="pick-chip picked"><span class="check">✓</span><span>${esc(t)}</span></span>`).join('') : '<div class="rail-empty" style="padding:2px 0">not specified</div>'}</div>
      <div class="field-label section-gap">Skills in this folder</div>
      <div class="chip-row">${skills.length ? skills.map((sk) => `<span class="pick-chip"><span>${esc(sk.name)}</span></span>`).join('') : '<div class="rail-empty" style="padding:2px 0">none found</div>'}</div>
    </div>
    <div class="modal-foot"><span class="note">read-only</span><button class="btn btn--go" id="insp-use">Start a session</button></div>`);
  q('.modal-x', modal).onclick = closeOverlay;
  q('#insp-use', modal).onclick = () => { closeOverlay(); openNewSessionWithAgent(a); };
}

// ---- quick look ------------------------------------------------------------
async function quickLook(file) {
  const data = await api.readFile(file);
  data._path = file;
  S.overlay = { type: 'quicklook', data }; renderOverlay();
}
function renderQuickLook(d) {
  let bodyHtml = '';
  if (d.kind === 'dir') {
    bodyHtml = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">${(d.files || []).map((f) => `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 8px;background:#fffdf6;border:1px solid #d4c7ab;box-shadow:3px 3px 0 rgba(90,72,44,.16)">
        <div style="width:44px;height:54px;background:#f0e7d0;border:1px solid #cdbfa2"></div>
        <span style="font-size:10.5px;text-align:center;word-break:break-all">${esc(f.name)}</span></div>`).join('')}</div>`;
  } else {
    bodyHtml = `<div class="ql-lines">${(d.rows || []).map((r) => `<div class="ql-row"><span class="n">${r.n}</span><span class="t">${esc(r.t)}</span></div>`).join('')}</div>`;
  }
  const modal = overlay('modal', `
    <div class="modal-head"><span class="code" style="width:34px;height:40px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;background:${TINTS[hashIdx(d._path)]};border:1px solid rgba(60,45,25,.35)">${d.kind === 'dir' ? 'DIR' : 'FILE'}</span>
      <div class="col"><div class="title">${esc(d.name)}</div><div class="sub">${esc(shortHome(d._path))}${d.size ? ' · ' + d.size : ''}</div></div><div class="modal-x">✕</div></div>
    <div class="modal-body" style="width:760px;max-height:60vh">${bodyHtml}</div>
    <div class="modal-foot"><span class="note">${esc(shortHome(d._path))}</span>
      <button class="btn btn--quiet" id="ql-copy">Copy path</button>
      <button class="btn btn--go" id="ql-reveal">Reveal in Finder</button></div>`);
  q('.modal-x', modal).onclick = closeOverlay;
  q('#ql-copy', modal).onclick = () => { api.copyText(d._path); toast('Path copied'); };
  q('#ql-reveal', modal).onclick = () => api.revealFile(d._path);
}

// ---- folders ---------------------------------------------------------------
async function openFolderDialog() { const info = await api.pickFolder(); if (info) applyProject(info); }
async function openFolder(path) { const info = await api.openFolder(path); if (info) applyProject(info); }
function applyProject(info) {
  S.project = info;
  S.recents = [{ path: info.path, pathShort: info.pathShort, name: info.name }, ...S.recents.filter((r) => r.path !== info.path)].slice(0, 8);
  renderAll();
}
function joinPath(dir, name) { return dir.replace(/\/$/, '') + '/' + name; }

// ---- toast -----------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  els.toastRoot.innerHTML = `<div class="toast"><span class="dot"></span><span class="msg">${esc(msg)}</span></div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { els.toastRoot.innerHTML = ''; }, 2200);
}

// ===========================================================================
//  Demo seed (for the screenshot / first-run preview)
// ===========================================================================
function seedDemo() {
  S.project = {
    path: '/Users/calvin/work/atlas', pathShort: '~/work/atlas', name: 'Atlas', hasClaude: true,
    tree: [
      { name: '.claude', kind: 'dir', pad: 0, meta: 'agents & skills' },
      { name: 'agents', kind: 'dir', pad: 1, meta: '5 items' },
      { name: 'src', kind: 'dir', pad: 0, meta: '212 items' },
      { name: 'auth', kind: 'dir', pad: 1, meta: '9 items' },
      { name: 'passkey.ts', kind: 'file', pad: 2, meta: '4 KB' },
      { name: 'data', kind: 'dir', pad: 0, meta: '2 items' },
      { name: 'pricing.csv', kind: 'file', pad: 1, meta: '31 KB' },
      { name: 'CLAUDE.md', kind: 'file', pad: 0, meta: 'house rules' },
      { name: 'README.md', kind: 'file', pad: 0, meta: '2 KB' },
    ],
    agents: [
      { slug: 'collector', name: 'collector', desc: 'Pulls structured data off pages', tools: 'browser · files · shell' },
      { slug: 'engineer', name: 'engineer', desc: 'Edits the repo, runs tests, opens a PR', tools: 'claude code · git' },
      { slug: 'researcher', name: 'researcher', desc: 'Reads the web and writes a brief', tools: 'web · sources' },
      { slug: 'writer', name: 'writer', desc: 'Drafts docs and updates', tools: 'files · mcp' },
      { slug: 'operator', name: 'operator', desc: 'Touches live systems — asks first', tools: 'shell · mcp' },
    ],
    skills: [{ slug: 'review-pr', name: 'review-pr' }, { slug: 'write-tests', name: 'write-tests' }, { slug: 'brand-voice', name: 'brand-voice' }],
  };
  S.recents = [
    { path: '/Users/calvin/work/atlas', pathShort: '~/work/atlas', name: 'Atlas' },
    { path: '/Users/calvin/work/pricing', pathShort: '~/work/pricing', name: 'Pricing research' },
    { path: '/Users/calvin/work/site', pathShort: '~/work/site', name: 'Marketing site' },
  ];

  const s1 = makeSession({ type: 'claude', goal: 'Compare our pricing with the top 20 competitors', agentName: 'collector' });
  s1.tint = TINTS[2]; s1.code = 'CO'; s1.status = 'done'; s1.subtitle = 'collector · finished · $0.42'; s1.command = 'dainami run --agent collector --project Atlas "Compare our pricing…"';
  s1.flow = [
    { kind: 'step', label: 'Lining up 20 websites', state: 'done' },
    { kind: 'step', label: 'Reading each page', state: 'done' },
    { kind: 'step', label: 'Tidying the numbers', state: 'done' },
    { kind: 'step', label: 'Building your spreadsheet', state: 'done' },
  ];
  s1.artifacts = [
    { path: '/Users/calvin/work/atlas/out/pricing.csv', kind: 'FILE', tint: TINTS[0], what: 'spreadsheet · 187 rows' },
    { path: '/Users/calvin/work/atlas/out/pages', kind: 'DIR', tint: TINTS[3], what: 'the raw pages it read' },
  ];

  const s2 = makeSession({ type: 'claude', goal: 'Rotate the staging database credentials', agentName: 'operator' });
  s2.tint = TINTS[4]; s2.code = 'OP'; s2.status = 'needs-ok'; s2.subtitle = 'operator · waiting';
  s2.flow = [
    { kind: 'assistant', text: "I'll rotate the staging credentials. First I need to run the rotation script." },
    { kind: 'step', label: 'Reading the current config', state: 'done' },
    { kind: 'step', label: 'Rotate staging DB password', detail: 'rotate-db.sh', state: 'running' },
  ];
  s2.pendingPermission = { permissionId: 'demo', toolName: 'Bash', label: 'Rotate staging DB password', summary: 'Run: ./scripts/rotate-db.sh staging — this changes a live credential.' };

  const s3 = makeSession({ type: 'claude', goal: 'Summarise the Q2 board notes into a brief', agentName: 'writer' });
  s3.tint = TINTS[1]; s3.code = 'WR'; s3.status = 'running'; s3.subtitle = 'writer · working';
  s3.flow = [
    { kind: 'todos', todos: [
      { text: 'Read the board notes', status: 'completed' },
      { text: 'Pull out the decisions', status: 'completed' },
      { text: 'Draft the one-page brief', status: 'in_progress' },
      { text: 'Add the action items', status: 'pending' },
    ] },
  ];

  S.sessions = [s2, s3, s1];
  S.activeSessionId = s2.id;
}
