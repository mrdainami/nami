// Chat composer — growing input, ＋ menu (files / commands / skills), live
// slash filtering, attachment chips, mode + model + context chips. Pure DOM;
// the pane supplies behavior through callbacks:
//   onSend(text, attachments)   onPickFiles()   onCommand(name)  — intercepts
//   onModeCycle()               onModelPick()
// State setters returned: setCommands, setSkills, setMode, setModel, setUsage,
// setBusy, attach, focus.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createComposer(host, o) {
  host.classList.add('cw-comp');
  host.innerHTML = `
    <div class="cw-att" hidden></div>
    <div class="cw-inrow">
      <textarea class="cw-in" rows="1" spellcheck="false" placeholder="Write a message…"></textarea>
      <button class="cw-send" title="Send">↑</button>
      <button class="cw-stopbtn" hidden title="Stop">■</button>
    </div>
    <div class="cw-tools">
      <button class="cw-plus" title="Files, commands and skills">＋</button>
      <button class="cw-tool cw-mode" hidden title="Mode — ⇧⇥ cycles"><span>◈</span> <b></b></button>
      <button class="cw-tool cw-model" hidden title="Model"><span>☰</span> <b></b></button>
      <span class="cw-ctx" hidden title="Context used">ctx <b></b></span>
      <span class="cw-drop">Drop files anywhere</span>
    </div>
    <input class="cw-fileinput" type="file" multiple hidden>
    <div class="cw-pop" hidden></div>`;

  const input = host.querySelector('.cw-in');
  const popEl = host.querySelector('.cw-pop');
  const attRow = host.querySelector('.cw-att');
  const modeWrap = host.querySelector('.cw-mode');
  const modelWrap = host.querySelector('.cw-model');
  const ctxWrap = host.querySelector('.cw-ctx');
  const sendBtn = host.querySelector('.cw-send');
  const stopBtn = host.querySelector('.cw-stopbtn');
  const fileInput = host.querySelector('.cw-fileinput');

  let commands = [];   // [{name, description}]
  let skills = [];     // [{name, description}]
  let busy = false;

  // ---- growing input --------------------------------------------------------
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }

  // ---- attachments ----------------------------------------------------------
  function attach(label, meta) {
    attRow.hidden = false;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = label + ' ✕';
    chip._meta = meta || label;
    chip.onclick = () => { chip.remove(); if (!attRow.children.length) attRow.hidden = true; };
    attRow.appendChild(chip);
  }
  function takeAttachments() {
    const list = [...attRow.children].map((c) => c._meta);
    attRow.innerHTML = ''; attRow.hidden = true;
    return list;
  }

  // ---- ＋ menu / slash list --------------------------------------------------
  function menuHeight() {
    const room = host.parentElement ? host.parentElement.clientHeight - host.clientHeight : 400;
    return Math.max(140, Math.min(340, room - 36));
  }
  function openMenu(filter) {
    const q = (filter || '').replace(/^\//, '').toLowerCase();
    const cmdRows = commands.filter((c) => !q || c.name.toLowerCase().startsWith(q));
    const skRows = q ? [] : skills;
    let html = '';
    if (!filter) html += '<button class="r files"><b>📎 Add files and folders</b><span>or drop from Finder</span></button>';
    if (cmdRows.length) html += '<div class="hd">Commands</div>' +
      cmdRows.slice(0, 60).map((c) => `<button class="r" data-cmd="${esc(c.name)}"><b>/${esc(c.name)}</b><span>${esc((c.description || '').slice(0, 44))}</span></button>`).join('');
    if (skRows.length) html += '<div class="hd">Skills</div>' +
      skRows.map((c) => `<button class="r" data-skill="${esc(c.name)}"><b>✦ ${esc(c.name)}</b><span>${esc((c.description || '').slice(0, 44))}</span></button>`).join('');
    if (!cmdRows.length && filter) html += '<div class="ft">No matching command — Enter sends it as written</div>';
    if (!commands.length && !filter) html += '<div class="ft">Connecting…</div>';
    popEl.innerHTML = html;
    popEl.style.maxHeight = menuHeight() + 'px';
    popEl.hidden = false;
    const filesRow = popEl.querySelector('.files');
    if (filesRow) filesRow.onclick = (e) => { e.stopPropagation(); popEl.hidden = true; if (o.onPickFiles) o.onPickFiles(); else fileInput.click(); };
    popEl.querySelectorAll('[data-cmd]').forEach((r) => {
      r.onclick = (e) => {
        e.stopPropagation(); popEl.hidden = true;
        const name = r.dataset.cmd;
        input.value = '';
        grow();
        if (o.onCommand) o.onCommand(name);
      };
    });
    popEl.querySelectorAll('[data-skill]').forEach((r) => {
      r.onclick = (e) => { e.stopPropagation(); popEl.hidden = true; attach('✦ ' + r.dataset.skill, { skill: r.dataset.skill }); };
    });
  }
  const closeMenu = () => { popEl.hidden = true; };
  fileInput.onchange = () => {
    [...fileInput.files].forEach((f) => attach('📎 ' + f.name, { path: f.path || f.name }));
    fileInput.value = '';
  };

  // ---- send -----------------------------------------------------------------
  function send() {
    const v = input.value.trim();
    if (!v || busy) return;
    input.value = ''; input.style.height = 'auto'; closeMenu();
    // a bare slash command routes through the interceptor first
    const m = v.match(/^\/([\w:-]+)\s*$/);
    if (m && o.onCommand) { o.onCommand(m[1]); return; }
    if (o.onSend) o.onSend(v, takeAttachments());
  }
  sendBtn.onclick = (e) => { e.stopPropagation(); send(); };
  stopBtn.onclick = (e) => { e.stopPropagation(); if (o.onStop) o.onStop(); };
  host.querySelector('.cw-plus').onclick = (e) => { e.stopPropagation(); popEl.hidden ? openMenu() : closeMenu(); };
  modeWrap.onclick = (e) => { e.stopPropagation(); if (o.onModeCycle) o.onModeCycle(); };
  modelWrap.onclick = (e) => { e.stopPropagation(); if (o.onModelPick) o.onModelPick(); };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); if (o.onModeCycle) o.onModeCycle(); return; }
    if (e.key === 'Escape') closeMenu();
  });
  input.addEventListener('input', () => {
    grow();
    const v = input.value;
    if (v.startsWith('/') && !v.includes(' ') && !v.includes('\n')) openMenu(v);
    else closeMenu();
  });
  document.addEventListener('click', closeMenu);

  return {
    input,
    attach,
    focus: () => input.focus(),
    setCommands: (list) => { commands = list || []; },
    setSkills: (list) => { skills = list || []; },
    setMode: (name) => { modeWrap.hidden = !name; modeWrap.querySelector('b').textContent = name || ''; },
    setModel: (name) => { modelWrap.hidden = !name; modelWrap.querySelector('b').textContent = name || ''; },
    setUsage: (used, size) => {
      if (!size) { ctxWrap.hidden = true; return; }
      ctxWrap.hidden = false;
      ctxWrap.querySelector('b').textContent = Math.round((used / size) * 100) + '%';
    },
    setBusy: (b) => { busy = b; stopBtn.hidden = !b; sendBtn.hidden = b; },
    openMenu,
  };
}
