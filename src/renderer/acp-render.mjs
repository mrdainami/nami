// Chat transcript renderer — consumes normalized ACP events (acp-client's
// normalizeUpdate) and draws the surface. Pure DOM: no protocol, no IPC.
// The replay harness and the live pane both run this exact code.
//
// Copy rules (spec 7b): plain words only, no protocol vocabulary, no
// self-narration. Everything readable is selectable; code gets a copy button.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// small markdown: fenced code, links, inline code, bold. Newlines survive via
// CSS pre-wrap; fenced blocks become real <pre> with a copy button.
function mdBlocks(text) {
  let html = '', last = 0, m;
  const re = /```(\w*)\n?([\s\S]*?)(```|$)/g;
  while ((m = re.exec(String(text)))) {
    html += mdInline(String(text).slice(last, m.index));
    html += `<div class="cw-codewrap"><button class="cw-copy" data-copy>copy</button><pre class="cw-code">${esc(m[2].replace(/\n$/, ''))}</pre></div>`;
    last = re.lastIndex;
    if (m[3] === '') break;
  }
  html += mdInline(String(text).slice(last));
  return html;
}
function mdInline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" data-link>$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

const KIND_LABEL = {
  execute: 'Run', edit: 'Edit', read: 'Read', fetch: 'Fetch',
  search: 'Search', delete: 'Delete', move: 'Move', think: 'Think', other: 'Tool',
};

export function createTranscript(container, opts) {
  const o = opts || {};
  container.classList.add('cw-scroll');
  let openMsg = null, openThought = null, openUser = null, planEl = null;
  const tools = new Map();
  let unknownCount = 0;

  const toBottom = () => { if (o.noScroll) return; requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; }); };
  function block(html, cls) {
    const el = document.createElement('div');
    el.className = 'cw-blk' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
    container.appendChild(el);
    wire(el);
    toBottom();
    return el;
  }
  const PATHISH = /^(~\/|\.{0,2}\/)?[\w .@-]*(\/[\w .@-]+)*\.(png|jpe?g|gif|webp|svg|pdf|md|txt|ts|tsx|js|jsx|mjs|json|html|css|py|rs|go|java|sh|yml|yaml|toml|csv|log)$/i;
  function wire(root) {
    root.querySelectorAll('code:not([data-wired])').forEach((c) => {
      c.dataset.wired = '1';
      const t = c.textContent.trim();
      if (t.startsWith('/') ? /\.[a-z0-9]{1,5}$/i.test(t) : PATHISH.test(t)) {
        c.classList.add('cw-pathlink');
        c.onclick = (e) => {
          e.stopPropagation();
          if (!o.onOpenFile) return;
          let path = t;
          if (path.startsWith('~/')) path = (o.home || '') + path.slice(1);
          else if (!path.startsWith('/')) path = (o.cwd ? o.cwd + '/' : '') + path.replace(/^\.\//, '');
          o.onOpenFile(path);
        };
      }
    });
    root.querySelectorAll('a[data-link]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (o.onLink) o.onLink(a.getAttribute('href')); };
    });
    root.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const pre = b.parentElement.querySelector('pre');
        if (o.onCopy) o.onCopy(pre ? pre.textContent : '');
        b.textContent = 'copied';
        setTimeout(() => { b.textContent = 'copy'; }, 1200);
      };
    });
    root.querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); if (o.onOpenFile) o.onOpenFile(el.dataset.open); });
    });
  }
  function closeStreams() { openMsg = null; openUser = null; if (openThought) { openThought.btnLabel.textContent = 'Thought'; openThought = null; } }

  // ---- event renderers ------------------------------------------------------
  function message(text) {
    if (openThought) { openThought.btnLabel.textContent = 'Thought'; openThought = null; }
    if (!openMsg) {
      const el = block('<div class="cw-a"></div>');
      openMsg = el.querySelector('.cw-a'); openMsg._raw = '';
    }
    openMsg._raw += text;
    openMsg.innerHTML = mdBlocks(openMsg._raw);
    wire(openMsg);
    toBottom();
  }
  function userChunk(text) {
    openMsg = null; if (openThought) { openThought.btnLabel.textContent = 'Thought'; openThought = null; }
    if (!openUser) { const el = block('<div class="cw-u"></div>'); openUser = el.querySelector('.cw-u'); openUser._raw = ''; }
    openUser._raw += text;
    openUser.innerHTML = mdBlocks(openUser._raw);
    wire(openUser); toBottom();
  }
  function thought(text) {
    openMsg = null;
    if (!openThought) {
      const el = block('<button class="cw-think"><span class="tw">Thinking…</span></button><div class="cw-think-body" hidden></div>');
      const btn = el.querySelector('.cw-think');
      const bodyEl = el.querySelector('.cw-think-body');
      btn.onclick = (e) => { e.stopPropagation(); bodyEl.hidden = !bodyEl.hidden; toBottom(); };
      openThought = { body: bodyEl, btnLabel: btn.querySelector('.tw'), _raw: '' };
    }
    openThought._raw += text;
    openThought.body.innerHTML = mdInline(openThought._raw);
    toBottom();
  }
  function toolCard(ev) {
    closeStreams();
    const label = KIND_LABEL[ev.kind] || KIND_LABEL.other;
    const el = block(`<div class="cw-card"><div class="cw-card-hd"><span class="k">${esc(label)}</span> <span class="f"></span><span class="cw-run">running</span></div><div class="cw-tool-body" hidden></div></div>`);
    el.querySelector('.f').textContent = ev.title || '';
    el.querySelector('.cw-card-hd').addEventListener('click', () => {
      const b = el.querySelector('.cw-tool-body'); b.hidden = !b.hidden;
    });
    const rec = { el, seen: new Set() };
    tools.set(ev.id, rec);
    toolApply(rec, ev);
  }
  function toolUpdate(ev) {
    const rec = tools.get(ev.id);
    if (!rec) return toolCard({ ...ev, status: ev.status || 'pending' });
    toolApply(rec, ev);
  }
  function toolApply(rec, ev) {
    const { el } = rec;
    if (ev.title) el.querySelector('.f').textContent = ev.title;
    if (ev.status) {
      const run = el.querySelector('.cw-run');
      if (ev.status === 'completed') { run.textContent = '✓'; run.classList.add('ok'); }
      else if (ev.status === 'failed') { run.textContent = '✗ failed'; run.classList.add('bad'); el.querySelector('.cw-tool-body').hidden = false; }
      else run.textContent = ev.status.replace('_', ' ');
    }
    const bd = el.querySelector('.cw-tool-body');
    for (const c of ev.content || []) {
      const key = JSON.stringify(c).slice(0, 200);
      if (rec.seen.has(key)) continue;
      rec.seen.add(key);
      if (c.type === 'diff') {
        const oldLines = c.oldText == null ? [] : String(c.oldText).split('\n');
        const newLines = c.newText == null ? [] : String(c.newText).split('\n');
        bd.insertAdjacentHTML('beforeend',
          `<div class="cw-diff-path"><button class="cw-filelink" data-open="${esc(c.path || '')}">${esc(shortPath(c.path))}</button></div>` +
          `<pre class="cw-diff">` +
          oldLines.slice(0, 40).map((l) => `<span class="d">- ${esc(l)}</span>`).join('') +
          newLines.slice(0, 40).map((l) => `<span class="a">+ ${esc(l)}</span>`).join('') +
          `</pre>`);
      } else if (c.type === 'content' && c.content && c.content.type === 'text') {
        bd.insertAdjacentHTML('beforeend', `<div class="cw-tool-text">${mdBlocks(c.content.text)}</div>`);
      } else if (c.type === 'content' && c.content && c.content.type === 'image') {
        const uri = c.content.uri || '';
        const src = uri || ('data:' + (c.content.mimeType || 'image/png') + ';base64,' + (c.content.data || ''));
        const openAttr = uri && (uri.startsWith('/') || uri.startsWith('file:')) ? ` data-open="${esc(uri.replace('file://', ''))}"` : '';
        bd.insertAdjacentHTML('beforeend', `<img class="cw-imgout"${openAttr} src="${esc(src.startsWith('/') ? 'file://' + src : src)}" alt="">`);
      }
    }
    wire(bd);
    toBottom();
  }
  function plan(ev) {
    const done = ev.entries.filter((x) => x.status === 'completed').length;
    const html = `<div class="cw-card cw-plan"><div class="cw-card-hd"><span class="k">Plan</span><span class="f">${done}/${ev.entries.length}</span></div>
      <ul>${ev.entries.map((x) => `<li class="${x.status === 'completed' ? 'don' : 'tod'}${x.status === 'in_progress' ? ' cur' : ''}">${esc(x.text)}</li>`).join('')}</ul></div>`;
    if (planEl) planEl.innerHTML = html;
    else planEl = block(html);
    toBottom();
  }

  return {
    apply(ev) {
      switch (ev.type) {
        case 'message': message(ev.text); break;
        case 'user': userChunk(ev.text); break;
        case 'thought': thought(ev.text); break;
        case 'tool': toolCard(ev); break;
        case 'tool_update': toolUpdate(ev); break;
        case 'plan': plan(ev); break;
        case 'commands': if (o.onCommands) o.onCommands(ev.commands); break;
        case 'mode': if (o.onMode) o.onMode(ev.modeId); break;
        case 'usage': if (o.onUsage) o.onUsage(ev.used, ev.size); break;
        case 'info': if (o.onInfo) o.onInfo(ev.title); break;
        case 'ignore': break;
        case 'config': if (o.onConfig) o.onConfig(ev.configOptions); break;
        default:
          unknownCount++;
          if (o.onUnknown) o.onUnknown(ev);
          console.warn('[chat] unhandled event', ev.raw && ev.raw.sessionUpdate, ev.raw);
      }
    },
    userTurn(text) { closeStreams(); block(`<div class="cw-u">${mdBlocks(text)}</div>`); },
    note(text) { block(`<div class="cw-hint">${mdInline(text)}</div>`); },
    error(text) { closeStreams(); block(`<div class="cw-err">${esc(text)}</div>`); },
    permission(params, answer) {
      closeStreams();
      // the tool card above holds what's being decided — open it, don't repeat it
      const tcId = params.toolCall && params.toolCall.toolCallId;
      const owned = tcId && tools.get(tcId);
      if (owned) { const b = owned.el.querySelector('.cw-tool-body'); if (b) b.hidden = false; }
      const title = (params.toolCall && params.toolCall.title) || 'Approve this?';
      const opts = params.options || [];
      const el = block(`<div class="cw-perm"><div class="q">Waiting on you</div>${owned ? '' : `<code>${esc(title)}</code>`}
        <div class="col">${(() => { const primary = opts.findIndex((x) => x.kind === 'allow_once'); return opts.map((op, i) => `<button class="cw-btn ${i === primary ? 'ap' : 'row'}" data-i="${i}">${esc(op.name)}</button>`).join(''); })()}</div></div>`);
      el.querySelectorAll('.cw-btn').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const op = opts[+b.dataset.i];
          el.querySelector('.cw-perm').outerHTML =
            `<div class="cw-settle ${op.kind && op.kind.startsWith('allow') ? 'ok' : ''}">${esc(title)} — ${esc(op.name)}</div>`;
          answer(op.optionId);
        };
      });
      return el;
    },
    dropTool(id) {
      const rec = tools.get(id);
      if (rec && rec.el && rec.el.parentElement) rec.el.remove();
      tools.delete(id);
    },
    clear() { container.querySelectorAll('.cw-blk, .cw-busy').forEach((el) => el.remove()); tools.clear(); planEl = null; closeStreams(); },
    turnEnd() { closeStreams(); },
    setBusy(b) {
      let el = container.querySelector('.cw-busy');
      if (b && !el) { el = document.createElement('div'); el.className = 'cw-busy'; el.innerHTML = '<i></i><i></i><i></i>'; container.appendChild(el); toBottom(); }
      if (!b && el) el.remove();
    },
    stats() { return { unknownCount, toolCount: tools.size }; },
  };
}

function shortPath(p) {
  if (!p) return '';
  const parts = String(p).split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : p;
}
