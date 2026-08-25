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
  commands: [
    ['/model', 'switch model — native picker'],
    ['/compact', 'compress context'],
    ['/test', 'run the auth suite'],
    ['/fail', 'see how errors render'],
    ['/help', 'reshow the testbed card'],
  ],
  models: ['sonnet-5', 'opus-5', 'haiku-4.5'],
  modes: ['Code', 'Plan', 'Ask', 'Bypass'],
};

export function mountAcpMock(p, rec, hooks) {
  const A = DEMO_ASSETS;
  const body = rec.body;
  body.classList.add('cw-body');
  body.innerHTML = `
    <div class="cw-scroll"></div>
    <div class="cw-comp">
      <div class="cw-att" hidden></div>
      <div class="cw-inrow">
        <input class="cw-in" type="text" spellcheck="false"
          placeholder="type here — / for commands · ⇧⇥ cycles mode · ⏎ send">
        <button class="cw-send" title="Send">↑</button>
      </div>
      <div class="cw-tools">
        <button class="cw-tool" data-act="menu">／ Commands · Skills</button>
        <button class="cw-tool cw-mode" title="⇧⇥ cycles">◇ <b>Code</b></button>
        <button class="cw-tool cw-model" title="/model opens the picker">☰ <b>sonnet-5</b></button>
        <span class="cw-ctx" title="context">ctx <b>42%</b></span>
        <span class="cw-drop">⇣ drop files — path goes to the agent</span>
      </div>
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
    hint(`\`session/set_mode → ${next.toLowerCase()}\` · ok — ⇧⇥ cycles whatever modes this agent advertised`);
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
      hint(`\`${esc(cmd)}\` is **not in available_commands** for this agent — in the real pane it wouldn't autocomplete, so this dead-end can't happen. Try ／ Commands.`);
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
  function send() { const v = input.value.trim(); if (!v) return; input.value = ''; route(v); }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); send(); }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode(); }
    if (e.key === 'Escape') closePop();
  });
  body.querySelector('.cw-send').onclick = (e) => { e.stopPropagation(); send(); };
  body.querySelectorAll('.cw-tool[data-act]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (!popEl.hidden) { closePop(); return; }
      const rows = CAPS.commands.concat([['\u2014', '', false]], [['\u2726 collector', 'pulls structured data'], ['\u2726 engineer', 'edits, tests, PR'], ['\u2726 ship', 'release pre-flight']]);
      openPop(rows, 'COMMANDS \u00b7 from the agent \u2014 SKILLS \u00b7 from your Library',
        'one door: typing / in the composer opens this too, like the terminal',
        (n) => {
          if (n === '\u2014') return;
          if (n.startsWith('\u2726')) attach(n);
          else { input.value = n + ' '; input.focus(); if (n === '/model') route('/model'); }
        });
    };
  });
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
