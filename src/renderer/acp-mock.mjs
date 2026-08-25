// Cowork surface — INTERACTIVE TESTBED (demo mode only).
// Every block this pane renders is labelled with the ACP event that would
// produce it in the real build (the small grey "wire" tags). The composer
// routes test inputs to scripted flows so each content type — thinking,
// edits, bash runs, permissions with options, links, images, html, plans,
// errors, /commands, /model, shift-tab modes — can be exercised by hand.
// The agent's brain is canned; the rendering and interaction are the design.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const DEMO_ASSETS = decodeURIComponent(new URL('../../demo-assets/', location.href).pathname);

// What this fake agent "advertises" at connect — the lists our pickers render.
const CAPS = {
  // Claude Code's command set. acp:true = advertised over the protocol
  // (live rows); acp:false = TUI-only (greyed — the guard, made visible).
  commands: [
    ['/add-dir', 'add a working directory', true],
    ['/agents', 'list and manage agents', true],
    ['/clear', 'clear conversation history', true],
    ['/compact', 'compact the conversation', true],
    ['/cost', 'token + cost for this session', true],
    ['/init', 'write CLAUDE.md for this repo', true],
    ['/memory', 'edit memory files', true],
    ['/model', 'switch model — native picker', true],
    ['/output-style', 'set the output style', true],
    ['/permissions', 'view or change permissions', true],
    ['/pr-comments', 'fetch PR comments', true],
    ['/resume', 'resume a past session — session/load', true],
    ['/review', 'review the current diff', true],
    ['/security-review', 'security-review the diff', true],
    ['/status', 'session status', true],
    ['/todos', 'show the todo list', true],
    ['/help', 'reshow the testbed card', true],
    ['/test', 'testbed: bash run', true],
    ['/fail', 'testbed: error rendering', true],
    ['/vim', 'vim keybindings', false],
    ['/terminal-setup', 'configure terminal keys', false],
    ['/ide', 'connect to an IDE', false],
    ['/doctor', 'diagnose the install', false],
    ['/bug', 'report a bug to Anthropic', false],
    ['/hooks', 'edit hook config', false],
    ['/statusline', 'set the status line', false],
    ['/export', 'export transcript to clipboard', false],
  ],
  skills: [['collector', 'pulls structured data'], ['engineer', 'edits, tests, PR'], ['ship', 'release pre-flight']],
  models: ['sonnet-5', 'opus-5', 'haiku-4.5'],
  // whatever THIS session advertises — claude's real permission modes
  modes: ['default', 'accept edits', 'plan', 'bypass'],
};

export function mountAcpMock(p, rec, hooks) {
  if (p.acpLive) return mountAcpLive(p, rec, hooks);
  const A = DEMO_ASSETS;
  const body = rec.body;
  body.classList.add('cw-body');
  body.innerHTML = `
    <div class="cw-scroll"></div>
    <div class="cw-comp">
      <div class="cw-att" hidden></div>
      <div class="cw-inrow">
        <textarea class="cw-in" rows="1" spellcheck="false" placeholder="Write a message…"></textarea>
        <button class="cw-send" title="Send">↑</button>
      </div>
      <div class="cw-tools">
        <button class="cw-plus" data-act="menu" title="files, commands, skills — or type /">＋</button>
        <button class="cw-tool cw-mode" title="permission mode — ⇧⇥ cycles what this session advertises">◈ <b>default</b></button>
        <button class="cw-tool cw-model" title="/model opens the picker">☰ <b>sonnet-5</b></button>
        <span class="cw-ctx" title="context">ctx <b>42%</b></span>
        <span class="cw-drop">⇣ drop files — path goes to the agent</span>
      </div>
      <input class="cw-fileinput" type="file" multiple hidden>
      <div class="cw-pop" hidden></div>
    </div>`;

  const scroll = body.querySelector('.cw-scroll');
  const input = body.querySelector('.cw-in');
  const popEl = body.querySelector('.cw-pop');
  const modeBtn = body.querySelector('.cw-mode b');
  const modelBtn = body.querySelector('.cw-model b');
  const ctxEl = body.querySelector('.cw-ctx b');
  rec.aiInput = input;
  let ctx = 42;

  const toBottom = () => requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });

  // ---- block factory: every block carries its wire label --------------------
  function block(wire, html, cls) {
    const wrap = document.createElement('div');
    wrap.className = 'cw-blk' + (cls ? ' ' + cls : '');
    wrap.innerHTML = (wire ? `<span class="cw-wire">${esc(wire)}</span>` : '') + html;
    scroll.appendChild(wrap); toBottom();
    return wrap;
  }
  function userTurn(text) { block('client → session/prompt', `<div class="cw-u">${esc(text)}</div>`); }
  function md(text) {
    // links [t](u), `code`, **bold** — what the real markdown pass renders
    return esc(text)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="#" data-url="$2">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function say(text, done) {
    const el = block('session/update · agent_message_chunk', '<div class="cw-a"></div>');
    const target = el.querySelector('.cw-a');
    const words = text.split(' ');
    let i = 0;
    const tick = setInterval(() => {
      i += 1 + Math.floor(Math.random() * 2);
      target.innerHTML = md(words.slice(0, i).join(' ')) + (i < words.length ? '<span class="cw-cur"></span>' : '');
      wireLinks(target); toBottom();
      if (i >= words.length) { clearInterval(tick); if (done) done(); }
    }, 55);
  }
  function wireLinks(root) {
    root.querySelectorAll('a[data-url]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (hooks.toast) hooks.toast('→ ' + a.dataset.url + ' — opens in your browser'); };
    });
  }
  function thought(text) {
    const el = block('session/update · agent_thought_chunk',
      `<button class="cw-think"><span class="tw">▸ thought for ${(1 + Math.random() * 3).toFixed(1)}s</span></button><div class="cw-think-body" hidden>${md(text)}</div>`);
    const btn = el.querySelector('.cw-think'), bd = el.querySelector('.cw-think-body');
    btn.onclick = (e) => { e.stopPropagation(); bd.hidden = !bd.hidden; btn.querySelector('.tw').textContent = (bd.hidden ? '▸' : '▾') + ' thought for a moment'; toBottom(); };
  }
  function editCard(file, lines) {
    const el = block('session/update · tool_call → tool_call_update',
      `<div class="cw-card"><div class="cw-card-hd"><span class="k">EDIT</span> <span class="f">${esc(file)}</span>
        <span class="cw-run">running…</span>
        <button class="cw-open" data-open="${esc(A)}passkey.ts">Open ↗</button></div>
        <pre class="cw-diff"></pre></div>`);
    wireOpens(el);
    const pre = el.querySelector('.cw-diff');
    el.querySelector('.cw-card-hd').addEventListener('click', () => { pre.hidden = !pre.hidden; });
    let i = 0;
    const tick = setInterval(() => {
      if (i >= lines.length) { clearInterval(tick);
        const run = el.querySelector('.cw-run'); run.textContent = '✓ applied'; run.classList.add('ok');
        const hd = el.querySelector('.cw-card-hd');
        hd.insertAdjacentHTML('beforeend', '<span class="add">+' + lines.filter((l) => l[0] === 'a').length + '</span> <span class="del">−' + lines.filter((l) => l[0] === 'd').length + '</span>');
        return; }
      pre.insertAdjacentHTML('beforeend', `<span class="${lines[i][0]}">${esc(lines[i][1])}</span>`);
      i++; toBottom();
    }, 160);
  }
  function bashCard(cmd, lines, exit) {
    const el = block('session/update · tool_call (execute)',
      `<div class="cw-card"><div class="cw-card-hd"><span class="k">BASH</span> <span class="f">${esc(cmd)}</span><span class="cw-run">running…</span></div>
        <pre class="cw-bash"></pre></div>`);
    const pre = el.querySelector('.cw-bash');
    el.querySelector('.cw-card-hd').addEventListener('click', () => { pre.hidden = !pre.hidden; });
    let i = 0;
    const tick = setInterval(() => {
      if (i >= lines.length) { clearInterval(tick);
        const run = el.querySelector('.cw-run');
        run.textContent = exit === 0 ? '✓ exit 0' : '✗ exit ' + exit;
        run.classList.add(exit === 0 ? 'ok' : 'bad'); return; }
      pre.insertAdjacentHTML('beforeend', esc(lines[i]) + '\n');
      i++; toBottom();
    }, 220);
  }
  function permission(cmd, options, after) {
    if (hooks.wake) hooks.wake(p);
    const el = block('session/request_permission · options[] from the agent',
      `<div class="cw-perm"><div class="q">CLAUDE WANTS TO RUN</div><code>${esc(cmd)}</code>
       <div class="row">${options.map((o, i) => `<button class="cw-btn ${i === 0 ? 'ap' : 'no'}" data-i="${i}">${esc(o)}</button>`).join('')}</div></div>`);
    el.querySelectorAll('.cw-btn').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const i = +b.dataset.i;
        el.querySelector('.cw-perm').outerHTML =
          `<div class="cw-settle ${i === 0 ? 'ok' : ''}">${i === 0 ? '✓' : '✗'} ${esc(cmd)} — “${esc(options[i])}” <span class="cw-wire-inline">→ client replied optionId ${i}</span></div>`;
        if (hooks.settled) hooks.settled(p);
        if (after) after(i);
      };
    });
  }
  function planCard(items) {
    const el = block('session/update · plan',
      `<div class="cw-card cw-plan"><div class="cw-card-hd"><span class="k">PLAN</span><span class="f">${items.filter((x) => x[0]).length}/${items.length}</span></div>
       <ul>${items.map(([done, t]) => `<li class="${done ? 'don' : 'tod'}">${esc(t)}</li>`).join('')}</ul></div>`);
    return el;
  }
  function mediaRow() {
    const el = block('session/update · tool_call content (image / resource)',
      `<div class="cw-media">
        <button class="cw-m" data-open="${esc(A)}landing-after.png"><span class="cw-m-img"><img src="file://${esc(A)}landing-after.png" alt=""></span><span class="cw-m-f"><span>landing-after.png</span><b>IMAGE</b></span></button>
        <button class="cw-m" data-open="${esc(A)}preview.html"><span class="cw-m-img"><img src="file://${esc(A)}landing-after.png" alt=""></span><span class="cw-m-f"><span>preview.html</span><b>PAGE</b></span></button>
        <button class="cw-m" data-open="${esc(A)}auth-migration.md"><span class="cw-m-doc"><i>Auth migration notes</i>Passkey registration now builds options server-side…</span><span class="cw-m-f"><span>auth-migration.md</span><b>NOTES</b></span></button>
      </div>`);
    wireOpens(el);
  }
  function errorCard(text) {
    block('session/update · error (rendered, never swallowed)', `<div class="cw-err">⚠ ${esc(text)}</div>`);
  }
  function wireOpens(root) {
    root.querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); if (hooks.open) hooks.open(el.dataset.open); });
    });
  }
  function hint(text) { block('', `<div class="cw-hint">${md(text)}</div>`); }

  // ---- popovers -------------------------------------------------------------
  function openPop(rows, hd, ft, pick) {
    popEl.innerHTML = `<div class="hd">${hd}</div>` +
      rows.map(([n, t, on]) => `<button class="r${on ? ' on' : ''}" data-n="${esc(n)}"><b>${esc(n)}</b><span>${esc(t || '')}</span></button>`).join('') +
      (ft ? `<div class="ft">${ft}</div>` : '');
    popEl.hidden = false;
    popEl.querySelectorAll('.r').forEach((r) => { r.onclick = (e) => { e.stopPropagation(); popEl.hidden = true; pick(r.dataset.n); }; });
  }
  const closePop = () => { popEl.hidden = true; };
  document.addEventListener('click', closePop);

  function modelPicker() {
    openPop(CAPS.models.map((m) => [m, m === modelBtn.textContent ? 'current' : '', m === modelBtn.textContent]),
      'MODELS · listed by the agent at connect', 'picking sends session/set_model — no restart, context kept',
      (m) => { modelBtn.textContent = m; hint(`\`session/set_model → ${m}\` · ok — the picker is Nami's, the list is the agent's`); });
  }
  function cycleMode() {
    const next = CAPS.modes[(CAPS.modes.indexOf(modeBtn.textContent) + 1) % CAPS.modes.length];
    modeBtn.textContent = next;
    hint(`\`session/set_mode → ${next}\` · ok — these four are what claude's session advertises; another agent's list would differ and ⇧⇥ cycles that instead`);
  }

  // ---- the input router: each test input → its scripted event flow ---------
  function route(v) {
    const t = v.toLowerCase();
    if (t.startsWith('/')) {
      const cmd = t.split(' ')[0];
      if (cmd === '/model') { modelPicker(); return; }
      if (cmd === '/compact') {
        userTurn(v);
        thought('Transcript is 84k tokens. Summarising tool results older than the last plan update; keeping the diff heads.');
        say('Compacted. Context **84k → 36k tokens** — summaries keep the last plan and every unapplied diff.', () => {
          ctx = 18; ctxEl.textContent = ctx + '%';
          hint('the ctx chip updated from the same event stream — nothing parsed');
        });
        return;
      }
      if (cmd === '/test') {
        userTurn(v);
        bashCard('pnpm test --filter auth', [
          '> atlas@ test /work/atlas', 'RUN auth.spec.ts',
          '✓ register creates credential options', '✓ login verifies assertion',
          '✓ fixture user has passkey id', '✓ register rejects duplicate id',
          'Tests: 4 passed, 4 total'], 0);
        setTimeout(() => say('Suite is **green**. The fixture change covered both failures.'), 1800);
        return;
      }
      if (cmd === '/fail') {
        userTurn(v);
        bashCard('pnpm build', ['> atlas@ build /work/atlas', 'src/auth/webauthn.ts:41:12 — error TS2339:', "  property 'algs' does not exist on type 'PublicKeyOptions'"], 1);
        setTimeout(() => errorCard('build failed — exit 1. The event carries the full output; nothing is clipped to a screen.'), 1400);
        setTimeout(() => say('That failure is mine — `algs` moved in the refactor. Want me to fix it?'), 2200);
        return;
      }
      if (cmd === '/help') { testbedCard(); return; }
      if (cmd === '/clear') { scroll.innerHTML = ''; hint('history cleared — `' + cmd + '` sent over the wire'); return; }
      if (cmd === '/cost') { userTurn(v); hint('session so far: **$0.48** \u00b7 84k tokens \u00b7 6 turns \u2014 streamed back as data, rendered natively'); return; }
      if (cmd === '/status') { userTurn(v); hint('claude \u00b7 sonnet-5 \u00b7 mode ' + modeBtn.textContent + ' \u00b7 ctx ' + ctx + '% \u00b7 4 tool calls \u00b7 all green'); return; }
      if (cmd === '/resume') { userTurn(v); hint('`session/load` \u2014 Nami lists your saved sessions natively (the acpSid snapshots the app already keeps) and reloads the one you pick, full transcript replayed.'); return; }
      const known = CAPS.commands.find(([n]) => n === cmd);
      if (known && known[2]) { userTurn(v); say('`' + cmd + '` sent over the wire \u2014 in the real pane the agent streams its response here. (canned demo has no flow for it)'); return; }
      if (known) { hint('`' + esc(cmd) + '` is **TUI-only** \u2014 not advertised over ACP; the real pane never shows it. Flip to terminal for it.'); return; }
      hint(`\`${esc(cmd)}\` is **not in available_commands** for this agent — it wouldn't autocomplete, so this dead-end can't happen.`);
      return;
    }
    userTurn(v);
    if (/(rm|delete|clean|clear)/.test(t)) {
      thought('dist/ holds the stale build. Deleting it is destructive, so this needs a permission round-trip.');
      permission('rm -rf dist', ['Allow once', 'Always allow rm in dist/', 'No — tell claude what to do'],
        (i) => { if (i < 2) say('Cleared. Re-running the suite to confirm green.'); else say('Understood — scoping cleanup to `dist/auth` only. Nothing deleted.'); });
      return;
    }
    if (/edit|refactor|change|fix/.test(t)) {
      thought('The register() flow builds options inline; moving it server-side keeps the export signature identical.');
      planCard([[1, 'read auth module + tests'], [1, 'refactor passkey.ts'], [0, 'clear stale build'], [0, 'update fixtures']]);
      editCard('src/auth/passkey.ts', [
        ['c', '  export async function register(user: User) {'],
        ['d', '-   const cred = await make(user)'],
        ['a', '+   const options = await createOptions(user)'],
        ['a', '+   const cred = await navigator.credentials'],
        ['a', '+     .create({ publicKey: options })'],
        ['c', '    return verifyRegistration(cred)'],
        ['c', '  }']]);
      setTimeout(() => say('Edited — exports untouched. See [the WebAuthn spec §7.1](https://w3.org/TR/webauthn) for why options move server-side.'), 2400);
      return;
    }
    if (/show|landing|page|screenshot|image|visual/.test(t)) {
      say('Here is the visual check — screenshot, the live page, and my notes. Each opens in your normal peek; pin to keep.', () => mediaRow());
      return;
    }
    if (/link|doc|spec|pr/.test(t)) {
      say('Links render as links: the [WebAuthn spec §7.1](https://w3.org/TR/webauthn), the open [PR #142](https://github.com/mrdainami/atlas/pull/142), and inline `code` all come out of one markdown pass over `message_chunk` text.');
      return;
    }
    thought('Plain question — answering from the session context, no tools needed.');
    say('The refactor holds: three exports unchanged, suite green after the fixture fix. Ask for an **edit**, a **test run**, something **destructive**, a **visual**, or **links** — or use ／ for `/model`, `/compact`, `/test`, `/fail`.');
  }

  // ---- composer wiring ------------------------------------------------------
  function send() { const v = input.value.trim(); if (!v) return; input.value = ''; input.style.height = 'auto'; closePop(); route(v); }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(); }
    if (e.key === 'Escape') closePop();
  });
  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }
  body.querySelector('.cw-send').onclick = (e) => { e.stopPropagation(); send(); };
  input.addEventListener('input', () => {
    grow();
    const v = input.value;
    if (v.startsWith('/') && !v.includes(' ') && !v.includes('\n')) openMenu(v);
    else closePop();
  });
  const fileInput = body.querySelector('.cw-fileinput');
  fileInput.onchange = () => {
    Array.from(fileInput.files).forEach((f) => attach('\u{1F4CE} ' + f.name));
    fileInput.value = '';
  };
  function openMenu(filter) {
    const cmds = CAPS.commands.filter(([n]) => !filter || n.startsWith(filter));
    popEl.innerHTML =
      '<button class="r files"><b>\u{1F4CE} Add files and folders</b><span>picker \u00b7 or drop from Finder</span></button>' +
      '<div class="hd">COMMANDS \u00b7 advertised by the agent this session</div>' +
      cmds.map(([n, t, acp]) => '<button class="r' + (acp ? '' : ' dis') + '" data-n="' + n + '"><b>' + n + '</b><span>' + t + (acp ? '' : ' \u00b7 terminal-only') + '</span></button>').join('') +
      '<div class="hd">SKILLS \u00b7 from your Library</div>' +
      CAPS.skills.map(([n, t]) => '<button class="r" data-sk="' + n + '"><b>\u2726 ' + n + '</b><span>' + t + '</span></button>').join('') +
      '<div class="ft">greyed rows are TUI-only \u2014 the real pane never shows them, so no dead ends</div>';
    popEl.style.maxHeight = Math.max(140, Math.min(340, scroll.clientHeight - 36)) + 'px';
    popEl.hidden = false;
    popEl.querySelector('.files').onclick = (e) => { e.stopPropagation(); popEl.hidden = true; fileInput.click(); };
    popEl.querySelectorAll('.r[data-n]').forEach((r) => {
      r.onclick = (e) => {
        e.stopPropagation(); popEl.hidden = true;
        if (r.classList.contains('dis')) { hint('`' + r.dataset.n + '` is **TUI-only** \u2014 not advertised over ACP, so in the real pane this row would not exist. Flip the pane to terminal for it.'); return; }
        input.value = r.dataset.n + ' '; input.focus();
        route(r.dataset.n); input.value = '';
      };
    });
    popEl.querySelectorAll('.r[data-sk]').forEach((r) => {
      r.onclick = (e) => { e.stopPropagation(); popEl.hidden = true; attach('\u2726 ' + r.dataset.sk); };
    });
  }
  body.querySelector('.cw-plus').onclick = (e) => { e.stopPropagation(); popEl.hidden ? openMenu() : closePop(); };
  body.querySelector('.cw-mode').onclick = (e) => { e.stopPropagation(); cycleMode(); };
  body.querySelector('.cw-model').onclick = (e) => { e.stopPropagation(); modelPicker(); };

  const attRow = body.querySelector('.cw-att');
  function attach(label) {
    attRow.hidden = false;
    const c = document.createElement('span');
    c.className = 'chip'; c.textContent = label + ' ✕';
    c.onclick = () => { c.remove(); if (!attRow.children.length) attRow.hidden = true; };
    attRow.appendChild(c);
  }
  rec.acpAttach = attach;

  // ---- seed: the testbed card ----------------------------------------------
  function testbedCard() {
    block('', `<div class="cw-guide"><b>TESTBED — type these into the composer</b>
      <span><code>/model</code> native picker · <code>/compact</code> context · <code>/test</code> bash run · <code>/fail</code> error · <code>/wrong</code> the dead-end guard</span>
      <span><b>⇧⇥</b> cycles mode · “<i>edit the login flow</i>” diff+plan · “<i>delete dist</i>” 3-option permission · “<i>show the landing page</i>” media · “<i>send links</i>” links</span>
      <span>every block carries a grey tag naming the ACP event that produced it — that tag is the whole answer to “how do we handle it”</span></div>`);
  }
  testbedCard();
  userTurn('refactor the auth module, keep the API stable');
  thought('Three public exports. Refactor passkey.ts first, keep signatures; visual check after.');
  say('On it — plan first, then the passkey flow. Try anything from the card above while I work.');
}


// ============================================================================
//  LIVE — real Claude Code over ACP (official adapter). The renderer IS the
//  ACP client: JSON-RPC over the main-process stdio bridge. Nothing canned.
// ============================================================================
const ADAPTER_BIN = decodeURIComponent(new URL('../../acp-tools/node_modules/.bin/claude-agent-acp', location.href).pathname);

export function mountAcpLive(p, rec, hooks) {
  const api = window.dainami;
  const body = rec.body;
  body.classList.add('cw-body');
  body.innerHTML = `
    <div class="cw-scroll"></div>
    <div class="cw-comp">
      <div class="cw-att" hidden></div>
      <div class="cw-inrow">
        <textarea class="cw-in" rows="1" spellcheck="false" placeholder="Write a message…"></textarea>
        <button class="cw-send" title="Send">↑</button>
      </div>
      <div class="cw-tools">
        <button class="cw-plus" title="commands — or type /">＋</button>
        <button class="cw-tool cw-mode" hidden title="permission mode — ⇧⇥ cycles">◈ <b></b></button>
        <button class="cw-tool cw-stop" hidden title="interrupt">■ stop</button>
        <span class="cw-live-st">connecting…</span>
        <span class="cw-drop">⇣ live session — real Claude Code over ACP</span>
      </div>
      <div class="cw-pop" hidden></div>
    </div>`;

  const scroll = body.querySelector('.cw-scroll');
  const input = body.querySelector('.cw-in');
  const popEl = body.querySelector('.cw-pop');
  const modeWrap = body.querySelector('.cw-mode');
  const modeBtn = modeWrap.querySelector('b');
  const stopBtn = body.querySelector('.cw-stop');
  const statEl = body.querySelector('.cw-live-st');
  rec.aiInput = input;

  const toBottom = () => requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  function block(html, cls) {
    const el = document.createElement('div');
    el.className = 'cw-blk' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
    scroll.appendChild(el); toBottom();
    return el;
  }
  function mdText(text) {
    return esc(text)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function hint(t) { block(`<div class="cw-hint">${mdText(t)}</div>`); }

  // ---- streaming assembly: chunks append to the open block ------------------
  let openMsg = null, openThought = null;
  function closeStreams() { openMsg = null; openThought = null; }
  function msgChunk(text) {
    openThought = null;
    if (!openMsg) { openMsg = block('<div class="cw-a"></div>').querySelector('.cw-a'); openMsg._raw = ''; }
    openMsg._raw += text;
    openMsg.innerHTML = mdText(openMsg._raw);
    toBottom();
  }
  function thoughtChunk(text) {
    openMsg = null;
    if (!openThought) {
      const el = block(`<button class="cw-think"><span class="tw">▾ thinking…</span></button><div class="cw-think-body"></div>`);
      const btn = el.querySelector('.cw-think'), bd = el.querySelector('.cw-think-body');
      btn.onclick = (e) => { e.stopPropagation(); bd.hidden = !bd.hidden; };
      openThought = bd; openThought._raw = ''; openThought._btn = btn;
    }
    openThought._raw += text;
    openThought.innerHTML = mdText(openThought._raw);
    toBottom();
  }

  // ---- tool calls -----------------------------------------------------------
  const tools = new Map();
  function toolBlock(u) {
    closeStreams();
    const kind = (u.kind || 'tool').toUpperCase();
    const el = block(`<div class="cw-card"><div class="cw-card-hd"><span class="k">${esc(kind)}</span> <span class="f">${esc(u.title || '')}</span><span class="cw-run">running…</span></div><div class="cw-tool-body"></div></div>`);
    el.querySelector('.cw-card-hd').addEventListener('click', () => {
      const b = el.querySelector('.cw-tool-body'); b.hidden = !b.hidden;
    });
    tools.set(u.toolCallId, el);
    toolContent(el, u);
    toolStatus(el, u.status);
  }
  function toolStatus(el, status) {
    if (!status) return;
    const run = el.querySelector('.cw-run');
    if (status === 'completed') { run.textContent = '✓ done'; run.classList.add('ok'); }
    else if (status === 'failed') { run.textContent = '✗ failed'; run.classList.add('bad'); }
    else run.textContent = status + '…';
  }
  function toolContent(el, u) {
    if (!u.content) return;
    const bd = el.querySelector('.cw-tool-body');
    for (const c of u.content) {
      if (c.type === 'diff') {
        const oldLines = (c.oldText || '').split('\n').slice(0, 30);
        const newLines = (c.newText || '').split('\n').slice(0, 30);
        bd.insertAdjacentHTML('beforeend',
          `<div class="cw-diff-path">${esc(c.path || '')}</div><pre class="cw-diff">` +
          oldLines.map((l) => `<span class="d">- ${esc(l)}</span>`).join('') +
          newLines.map((l) => `<span class="a">+ ${esc(l)}</span>`).join('') + '</pre>');
      } else if (c.type === 'content' && c.content && c.content.type === 'text') {
        bd.insertAdjacentHTML('beforeend', `<pre class="cw-bash">${esc(c.content.text.slice(0, 4000))}</pre>`);
      } else if (c.type === 'terminal') {
        bd.insertAdjacentHTML('beforeend', `<pre class="cw-bash">[terminal output]</pre>`);
      }
    }
    toBottom();
  }

  // ---- plan -----------------------------------------------------------------
  let planEl = null;
  function renderPlan(entries) {
    closeStreams();
    const done = entries.filter((x) => x.status === 'completed').length;
    const html = `<div class="cw-card cw-plan"><div class="cw-card-hd"><span class="k">PLAN</span><span class="f">${done}/${entries.length}</span></div>
      <ul>${entries.map((x) => `<li class="${x.status === 'completed' ? 'don' : 'tod'}${x.status === 'in_progress' ? ' cur' : ''}">${esc(x.content)}</li>`).join('')}</ul></div>`;
    if (planEl) { planEl.innerHTML = html; } else { planEl = block(html); }
    toBottom();
  }

  // ---- JSON-RPC client ------------------------------------------------------
  let nextId = 1; const pending = new Map();
  let sessionId = null; let commands = []; let modes = null;
  let running = false;
  function rpc(method, params) {
    const id = nextId++;
    api.acpSend({ id: p.id, payload: { jsonrpc: '2.0', id, method, params } });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  function respond(id, result) { api.acpSend({ id: p.id, payload: { jsonrpc: '2.0', id, result } }); }
  function respondErr(id, code, message) { api.acpSend({ id: p.id, payload: { jsonrpc: '2.0', id, error: { code, message } } }); }

  const offMsg = api.onAcpMsg(({ id, msg }) => {
    if (id !== p.id) return;
    // responses to our calls
    if (msg.id !== undefined && !msg.method) {
      const pd = pending.get(msg.id);
      if (pd) { pending.delete(msg.id); msg.error ? pd.reject(msg.error) : pd.resolve(msg.result); }
      return;
    }
    // requests + notifications from the agent
    if (msg.method === 'session/update') { onUpdate(msg.params.update || msg.params); return; }
    if (msg.method === 'session/request_permission') { onPermission(msg); return; }
    if (msg.method === 'fs/read_text_file' || msg.method === 'fs/write_text_file') { respondErr(msg.id, -32601, 'fs not granted'); return; }
    if (msg.id !== undefined) respondErr(msg.id, -32601, 'not supported by this prototype');
  });
  api.onAcpErr(({ id, text }) => { if (id === p.id && text.trim()) console.warn('[acp]', text.trim()); });
  api.onAcpExit(({ id, code }) => {
    if (id !== p.id) return;
    statEl.textContent = 'agent exited (' + code + ')';
    hint('**agent process exited** — code ' + code + '. Restart the pane to reconnect.');
  });

  function onUpdate(u) {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': if (u.content && u.content.type === 'text') msgChunk(u.content.text); break;
      case 'agent_thought_chunk': if (u.content && u.content.type === 'text') thoughtChunk(u.content.text); break;
      case 'user_message_chunk': break;
      case 'tool_call': toolBlock(u); break;
      case 'tool_call_update': {
        const el = tools.get(u.toolCallId);
        if (el) { toolStatus(el, u.status); toolContent(el, u); }
        break;
      }
      case 'plan': renderPlan(u.entries || []); break;
      case 'available_commands_update':
        commands = (u.availableCommands || []).map((c) => [ '/' + c.name, c.description || '' ]);
        statEl.textContent = commands.length + ' commands live';
        break;
      case 'current_mode_update':
        if (modes) { modes.currentModeId = u.currentModeId; syncMode(); }
        break;
      default: break;
    }
  }
  function onPermission(msg) {
    closeStreams();
    if (hooks.wake) hooks.wake(p);
    const prm = msg.params;
    const title = (prm.toolCall && prm.toolCall.title) || 'permission';
    const opts = prm.options || [];
    const el = block(`<div class="cw-perm"><div class="q">CLAUDE WANTS TO</div><code>${esc(title)}</code>
      <div class="row">${opts.map((o, i) => `<button class="cw-btn ${o.kind && o.kind.startsWith('allow') ? 'ap' : 'no'}" data-i="${i}">${esc(o.name)}</button>`).join('')}</div></div>`);
    el.querySelectorAll('.cw-btn').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const o = opts[+b.dataset.i];
        respond(msg.id, { outcome: { outcome: 'selected', optionId: o.optionId } });
        el.querySelector('.cw-perm').outerHTML = `<div class="cw-settle ${o.kind && o.kind.startsWith('allow') ? 'ok' : ''}">${esc(title)} — ${esc(o.name)}</div>`;
        if (hooks.settled) hooks.settled(p);
      };
    });
  }
  function syncMode() {
    if (!modes || !modes.availableModes || !modes.availableModes.length) { modeWrap.hidden = true; return; }
    modeWrap.hidden = false;
    const cur = modes.availableModes.find((m) => m.id === modes.currentModeId);
    modeBtn.textContent = cur ? cur.name : modes.currentModeId;
  }

  // ---- boot -----------------------------------------------------------------
  (async () => {
    const started = await api.acpStart({ id: p.id, cwd: p.cwd, command: ADAPTER_BIN, args: [] });
    if (!started.ok) { statEl.textContent = 'spawn failed'; hint('**could not start the adapter** — ' + esc(started.error || '')); return; }
    try {
      statEl.textContent = 'initializing…';
      await rpc('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      statEl.textContent = 'new session…';
      const r = await rpc('session/new', { cwd: p.cwd, mcpServers: [] });
      sessionId = r.sessionId;
      if (r.modes) { modes = r.modes; syncMode(); }
      statEl.textContent = 'ready';
      hint('**live** — real Claude Code over ACP in `' + esc(p.cwd) + '`. Type anything; / lists the commands the agent just advertised.');
    } catch (err) {
      statEl.textContent = 'error';
      hint('**' + esc((err && err.message) || 'connect failed') + '** — if this is auth, run `claude` once in a terminal and sign in, then restart the pane.');
    }
  })();

  async function send() {
    const v = input.value.trim();
    if (!v || !sessionId || running) return;
    input.value = ''; input.style.height = 'auto'; popEl.hidden = true;
    closeStreams();
    block(`<div class="cw-u">${esc(v)}</div>`);
    running = true; stopBtn.hidden = false; statEl.textContent = 'working…';
    try {
      const r = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: v }] });
      statEl.textContent = 'ready · ' + ((r && r.stopReason) || 'end');
    } catch (err) {
      hint('**prompt failed** — ' + esc((err && err.message) || ''));
      statEl.textContent = 'ready';
    }
    running = false; stopBtn.hidden = true; closeStreams();
  }
  stopBtn.onclick = (e) => { e.stopPropagation(); if (sessionId) api.acpSend({ id: p.id, payload: { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } } }); };

  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  function openCmdMenu(filter) {
    const rows = commands.filter(([n]) => !filter || n.startsWith(filter));
    if (!rows.length) { popEl.hidden = true; return; }
    popEl.innerHTML = '<div class="hd">COMMANDS · advertised live by claude</div>' +
      rows.map(([n, t]) => `<button class="r" data-n="${esc(n)}"><b>${esc(n)}</b><span>${esc(t.slice(0, 46))}</span></button>`).join('') +
      '<div class="ft">picked straight off available_commands_update — nothing hardcoded</div>';
    popEl.style.maxHeight = Math.max(140, Math.min(340, scroll.clientHeight - 36)) + 'px';
    popEl.hidden = false;
    popEl.querySelectorAll('.r').forEach((r) => {
      r.onclick = (e) => { e.stopPropagation(); popEl.hidden = true; input.value = r.dataset.n + ' '; input.focus(); };
    });
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (modes && modes.availableModes && modes.availableModes.length) {
        const ms = modes.availableModes;
        const i = ms.findIndex((m) => m.id === modes.currentModeId);
        const nextMode = ms[(i + 1) % ms.length];
        rpc('session/set_mode', { sessionId, modeId: nextMode.id }).then(() => { modes.currentModeId = nextMode.id; syncMode(); }).catch(() => {});
      }
    }
    if (e.key === 'Escape') popEl.hidden = true;
  });
  input.addEventListener('input', () => {
    grow();
    const v = input.value;
    if (v.startsWith('/') && !v.includes(' ') && !v.includes('\n')) openCmdMenu(v);
    else popEl.hidden = true;
  });
  body.querySelector('.cw-send').onclick = (e) => { e.stopPropagation(); send(); };
  body.querySelector('.cw-plus').onclick = (e) => { e.stopPropagation(); popEl.hidden ? openCmdMenu() : (popEl.hidden = true); };
  document.addEventListener('click', () => { popEl.hidden = true; });

  rec.disposeRo = () => { offMsg && offMsg(); api.acpKill({ id: p.id }); };
}
