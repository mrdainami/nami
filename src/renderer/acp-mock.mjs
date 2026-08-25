// Cowork surface — VISUAL PROTOTYPE (demo mode only).
// The pane an ACP session shows instead of a terminal: transcript drawn from
// protocol events, real composer, approve bar, media cards that open real
// files through the app's own openFile (peek → pin → tile). The agent's brain
// is canned — no process, no protocol; everything else is the real app.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// demo-assets/ sits at the worktree root, two levels up from src/renderer/
export const DEMO_ASSETS = decodeURIComponent(new URL('../../demo-assets/', location.href).pathname);

const REPLIES = [
  'Good call — checking that now. The fixture shape is the only remaining breakage; everything else in the suite passed on the last run.',
  'Done. I kept the exports untouched, so nothing downstream needs a change. Want me to open a PR with the diff above?',
  'On it — running the auth suite again with the new fixtures. I will flag anything that is not green.',
];
let replyIx = 0;

export function mountAcpMock(p, rec, hooks) {
  const A = DEMO_ASSETS;
  const body = rec.body;
  body.classList.add('cw-body');
  body.innerHTML = `
    <div class="cw-scroll">
      <div class="cw-u">refactor the auth module, keep the API stable — and give me a visual check when the landing page still renders</div>
      <div class="cw-a">On it. The public surface is three exports, all staying put. Details in
        <button class="cw-file" data-open="${esc(A)}passkey.ts">passkey.ts</button> and the migration notes below.</div>
      <div class="cw-chain">4 tool calls · Read ×2 · Edit ×1 · Bash ×1 <b>all ✓</b> · 6.2s</div>
      <div class="cw-card">
        <div class="cw-card-hd"><span class="k">EDIT</span> <span class="f">src/auth/passkey.ts</span>
          <span class="add">+12</span> <span class="del">−3</span>
          <button class="cw-open" data-open="${esc(A)}passkey.ts">Open ↗</button></div>
        <pre class="cw-diff"><span class="c">  export async function register(user: User) {</span>
<span class="d">-   const cred = await make(user)</span>
<span class="a">+   const options = await createOptions(user)</span>
<span class="a">+   const cred = await navigator.credentials</span>
<span class="a">+     .create({ publicKey: options })</span>
<span class="c">    return verifyRegistration(cred)</span>
<span class="c">  }</span></pre>
      </div>
      <div class="cw-a"><span class="cw-h4">VISUAL CHECK</span>These open in the normal peek — pin from there and they become tiles.</div>
      <div class="cw-media">
        <button class="cw-m" data-open="${esc(A)}landing-after.png">
          <span class="cw-m-img"><img src="file://${esc(A)}landing-after.png" alt="landing page after the change"></span>
          <span class="cw-m-f"><span>landing-after.png</span><b>IMAGE</b></span>
        </button>
        <button class="cw-m" data-open="${esc(A)}preview.html">
          <span class="cw-m-img"><img src="file://${esc(A)}landing-after.png" alt="live page"></span>
          <span class="cw-m-f"><span>preview.html</span><b>PAGE</b></span>
        </button>
        <button class="cw-m" data-open="${esc(A)}auth-migration.md">
          <span class="cw-m-doc"><i>Auth migration notes</i>Passkey registration now builds options server-side. Two fixture shapes changed…</span>
          <span class="cw-m-f"><span>auth-migration.md</span><b>NOTES</b></span>
        </button>
      </div>
      <div class="cw-perm">
        <div class="q">CLAUDE WANTS TO RUN</div>
        <code>rm -rf dist</code>
        <div class="row">
          <button class="cw-btn ap">Approve</button>
          <button class="cw-btn no">Deny</button>
          <span class="hint">real reply on the wire — not typed keystrokes</span>
        </div>
      </div>
      <div class="cw-settle" hidden></div>
    </div>
    <div class="cw-comp">
      <div class="cw-att" hidden></div>
      <div class="cw-inrow">
        <input class="cw-in" type="text" spellcheck="false"
          placeholder="Reply to claude — type / for commands…  (⏎ send)">
        <button class="cw-send" title="Send">↑</button>
      </div>
      <div class="cw-tools">
        <button class="cw-tool" data-pop="cmd">／ Commands</button>
        <button class="cw-tool" data-pop="skill">✦ Skills</button>
        <span class="cw-drop">⇣ drop files — path goes to the agent</span>
      </div>
      <div class="cw-pop" hidden></div>
    </div>`;

  const scroll = body.querySelector('.cw-scroll');
  const toBottom = () => requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  toBottom();

  // ---- files open through the real app ------------------------------------
  body.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); if (hooks.open) hooks.open(el.dataset.open); });
  });

  // ---- permission ----------------------------------------------------------
  const perm = body.querySelector('.cw-perm');
  const settle = body.querySelector('.cw-settle');
  const finish = (ok) => {
    perm.hidden = true;
    settle.hidden = false;
    settle.classList.toggle('ok', ok);
    settle.textContent = ok ? '✓ rm -rf dist — approved · exit 0' : '✗ denied — choosing another way';
    if (hooks.settled) hooks.settled(p);
    stream(ok ? 'Build directory cleared. Re-running the auth suite to confirm green.'
              : 'Understood — leaving dist/ alone. I will scope the cleanup to the auth bundle only.');
  };
  perm.querySelector('.ap').onclick = (e) => { e.stopPropagation(); finish(true); };
  perm.querySelector('.no').onclick = (e) => { e.stopPropagation(); finish(false); };

  // ---- typing + canned streaming ------------------------------------------
  const input = body.querySelector('.cw-in');
  rec.aiInput = input; // focusPanel() focuses the composer like it would a term
  function stream(text) {
    const el = document.createElement('div');
    el.className = 'cw-a';
    scroll.appendChild(el);
    const words = text.split(' ');
    let i = 0;
    const cur = '<span class="cw-cur"></span>';
    const tick = setInterval(() => {
      i += 1 + Math.floor(Math.random() * 2);
      el.innerHTML = esc(words.slice(0, i).join(' ')) + (i < words.length ? cur : '');
      toBottom();
      if (i >= words.length) clearInterval(tick);
    }, 60);
  }
  function send() {
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    const u = document.createElement('div');
    u.className = 'cw-u'; u.textContent = v;
    scroll.appendChild(u); toBottom();
    setTimeout(() => stream(REPLIES[replyIx++ % REPLIES.length]), 450);
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); send(); }
    if (e.key === '/' && !input.value) { openPop('cmd'); }
    if (e.key === 'Escape') closePop();
  });
  body.querySelector('.cw-send').onclick = (e) => { e.stopPropagation(); send(); };

  // ---- popovers: commands (off the wire) + skills (the library) ------------
  const popEl = body.querySelector('.cw-pop');
  const POPS = {
    cmd: {
      hd: 'COMMANDS · advertised by the agent',
      rows: [['/compact', 'compress context'], ['/review', 'review current diff'], ['/test', 'run project tests'], ['/ship-notes', 'your custom command']],
      pick: (name) => { input.value = name + ' '; input.focus(); },
      foot: 'live list off the ACP stream',
    },
    skill: {
      hd: 'SKILLS · from your Library',
      rows: [['collector', 'pulls structured data'], ['engineer', 'edits, tests, opens PR'], ['ship', 'release pre-flight']],
      pick: (name) => attach('✦ ' + name),
      foot: 'same rows as the Library tab',
    },
  };
  function openPop(kind) {
    const d = POPS[kind];
    popEl.innerHTML = `<div class="hd">${d.hd}</div>` +
      d.rows.map(([n, t]) => `<button class="r" data-n="${esc(n)}"><b>${esc(n)}</b><span>${esc(t)}</span></button>`).join('') +
      `<div class="ft">${d.foot}</div>`;
    popEl.hidden = false;
    popEl.querySelectorAll('.r').forEach((r) => {
      r.onclick = (e) => { e.stopPropagation(); d.pick(r.dataset.n); closePop(); };
    });
  }
  function closePop() { popEl.hidden = true; }
  body.querySelectorAll('.cw-tool').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); popEl.hidden ? openPop(b.dataset.pop) : closePop(); };
  });
  document.addEventListener('click', closePop);

  // ---- attachments (skills, dropped files) --------------------------------
  const attRow = body.querySelector('.cw-att');
  function attach(label) {
    attRow.hidden = false;
    const c = document.createElement('span');
    c.className = 'chip'; c.textContent = label + ' ✕';
    c.onclick = () => { c.remove(); if (!attRow.children.length) attRow.hidden = true; };
    attRow.appendChild(c);
  }
  rec.acpAttach = attach; // dropFilesOnPanel and the Library "use" reach the composer here
}
