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
    .replace(/(^|[\s(])((https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" data-link>$2</a>')
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
  const pendingPerms = new Map();
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
        const resolve = () => {
          let path = t;
          if (path.startsWith('~/')) path = (o.home || '') + path.slice(1);
          else if (!path.startsWith('/')) path = (o.cwd ? o.cwd + '/' : '') + path.replace(/^\.\//, '');
          return path;
        };
        c.onclick = (e) => { e.stopPropagation(); if (o.onOpenFile) o.onOpenFile(resolve()); };
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(t) && !c.dataset.thumbed) {
          c.dataset.thumbed = '1';
          const th = document.createElement('button');
          th.className = 'cw-inline-thumb';
          th.innerHTML = '<img alt="">';
          th.querySelector('img').src = 'file://' + encodeURI(resolve());
          th.onclick = (e) => { e.stopPropagation(); if (o.onOpenFile) o.onOpenFile(resolve()); };
          th.querySelector('img').onerror = () => th.remove();
          const blk = c.closest('.cw-a, .cw-tool-text');
          if (blk) blk.insertAdjacentElement('afterend', th);
        }
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
    // a permission the agent resolved itself (auto modes) retires quietly
    const pp = ev.id && pendingPerms.get(ev.id);
    if (pp && !pp.state.answered && ev.status && ev.status !== 'pending') {
      pp.state.answered = true;
      pendingPerms.delete(ev.id);
      pp.el.querySelector('.cw-perm').outerHTML = `<div class="cw-settle ok"><b>✓</b> ${esc(pp.title)} — approved automatically</div>`;
      if (pp.onRetire) pp.onRetire();
    }
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
    userTurn(text, files) {
      closeStreams();
      const chips = (files || []).map((f) => `<button class="cw-u-file" data-open="${esc(f)}">📎 ${esc(f.split('/').pop())}</button>`).join('');
      block(`<div class="cw-u">${mdBlocks(text)}${chips ? `<div class="cw-u-files">${chips}</div>` : ''}</div>`);
    },
    note(text) { block(`<div class="cw-hint">${mdInline(text)}</div>`); },
    action(text, label, cb) {
      const el = block(`<div class="cw-hint cw-action">${mdInline(text)} <button class="cw-act-btn"></button></div>`);
      const b = el.querySelector('.cw-act-btn');
      b.textContent = label;
      b.onclick = (e) => { e.stopPropagation(); cb(); };
    },
    error(text) { closeStreams(); block(`<div class="cw-err">${esc(text)}</div>`); },
    permission(params, answer, onRetire) {
      closeStreams();
      const tcId = params.toolCall && params.toolCall.toolCallId;
      const owned = tcId && tools.get(tcId);
      const title = (params.toolCall && params.toolCall.title) || 'Approve this?';
      const opts = params.options || [];
      const el = block(`<div class="cw-perm"><div class="q">Waiting on you</div>${owned ? '' : `<code>${esc(title)}</code>`}
        <div class="col">${(() => { const primary = opts.findIndex((x) => x.kind === 'allow_once'); return opts.map((op, i) => `<button class="cw-btn ${i === primary ? 'ap' : 'row'}" data-i="${i}">${esc(op.name)}</button>`).join(''); })()}</div></div>`);
      const state2 = { answered: false };
      el.querySelectorAll('.cw-btn').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          if (state2.answered) return;
          state2.answered = true;
          pendingPerms.delete(tcId);
          const op = opts[+b.dataset.i];
          el.querySelector('.cw-perm').outerHTML =
            `<div class="cw-settle ${op.kind && op.kind.startsWith('allow') ? 'ok' : ''}"><b>${op.kind && op.kind.startsWith('allow') ? '✓' : '✗'}</b> ${esc(title)} — ${esc(op.name)}</div>`;
          answer(op.optionId);
        };
      });
      // only a genuinely blocking request opens the tool's detail
      setTimeout(() => {
        if (!state2.answered && owned) { const b = owned.el.querySelector('.cw-tool-body'); if (b) b.hidden = false; toBottom(); }
      }, 600);
      if (tcId) pendingPerms.set(tcId, { el, state: state2, title, onRetire });
      return el;
    },
    question(params, reply) {
      closeStreams();
      const schema = params.requestedSchema || params.schema || {};
      const props = schema.properties || {};
      const keys = Object.keys(props);
      const choiceKeys = keys.filter((k) => props[k].oneOf || props[k].enum);
      const textKeys = keys.filter((k) => !props[k].oneOf && !props[k].enum);
      let inner = '';
      for (const k of choiceKeys) {
        const pr = props[k];
        const options = pr.oneOf
          ? pr.oneOf.map((op) => ({ v: op.const, t: op.title || String(op.const), d: op.description || '' }))
          : pr.enum.map((v, i) => ({ v, t: String((pr.enumNames && pr.enumNames[i]) || v), d: '' }));
        if (choiceKeys.length > 1 && pr.title) inner += `<div class="cw-q-label">${esc(pr.title)}</div>`;
        inner += `<div class="col" data-k="${esc(k)}">` + options.map((op) =>
          `<button class="cw-btn row" data-v="${esc(String(op.v))}"><span class="qt">${esc(op.t)}</span>${op.d ? `<span class="qd">${esc(op.d)}</span>` : ''}</button>`).join('') + '</div>';
      }
      for (const k of textKeys) {
        const pr = props[k];
        inner += `<input class="cw-q-in" data-k="${esc(k)}" type="text" placeholder="${esc(pr.title || pr.description || 'Type an answer')}">`;
      }
      if (!keys.length) inner = '<input class="cw-q-in" data-k="answer" type="text" placeholder="Type an answer">';
      const el = block(`<div class="cw-perm cw-question"><div class="q">Question</div><div class="cw-q-msg">${esc(params.message || '')}</div>${inner}
        <div class="row">${textKeys.length || !keys.length ? '<button class="cw-btn ap cw-q-send">Send</button>' : ''}<button class="cw-btn row cw-q-skip">Skip</button></div></div>`);
      let done = false;
      const settle = (text) => {
        done = true;
        el.querySelector('.cw-perm').outerHTML = `<div class="cw-settle ok"><b>✓</b> ${esc(params.message || 'Question')} — ${esc(text)}</div>`;
      };
      const sendContent = (content, label) => {
        if (done) return;
        reply({ action: 'accept', content });
        settle(label);
      };
      el.querySelectorAll('.col[data-k] .cw-btn').forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const content = {};
          content[b.parentElement.dataset.k] = b.dataset.v;
          sendContent(content, b.querySelector('.qt').textContent);
        };
      });
      const sendTexts = () => {
        const content = {};
        el.querySelectorAll('.cw-q-in').forEach((inp) => { if (inp.value.trim()) content[inp.dataset.k] = inp.value.trim(); });
        if (!Object.keys(content).length) return;
        sendContent(content, Object.values(content).join(', '));
      };
      const sendBtn = el.querySelector('.cw-q-send');
      if (sendBtn) sendBtn.onclick = (e) => { e.stopPropagation(); sendTexts(); };
      el.querySelectorAll('.cw-q-in').forEach((inp) => inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sendTexts(); }));
      el.querySelector('.cw-q-skip').onclick = (e) => {
        e.stopPropagation();
        if (done) return;
        done = true;
        reply({ action: 'decline' });
        el.querySelector('.cw-perm').outerHTML = '<div class="cw-settle">Question skipped</div>';
      };
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
