// Pending annotation content exists only in the trusted Nami renderer.
export function annotationBatch(notes) {
  return notes.map((n, i) => [`${i + 1}. ${n.title || 'Browser'}`, n.url,
    n.stale ? 'Snapshot — the original selection has changed.' : '',
    n.locator ? 'Element: ' + n.locator : n.label || 'Page selection',
    n.text ? 'Selection:\n' + n.text : '', n.note ? 'Comment:\n' + n.note : ''].filter(Boolean).join('\n')).join('\n\n');
}
export function createAnnotationStore() {
  let sequence = 0;
  const notes = [];
  const scope = (p) => p.owner || p.id;
  return {
    list: (p) => notes.filter((n) => n.scope === scope(p)),
    tab: (id) => notes.filter((n) => n.panelId === id),
    save(p, value) {
      const old = value.id && notes.find((n) => n.id === value.id && n.scope === scope(p));
      if (old) { Object.assign(old, value); return old; }
      if (notes.length >= 200) throw new Error('Review or clear pending notes before adding more.');
      const note = { ...value, id: 'annotation-' + (++sequence), panelId: p.id, scope: scope(p) };
      notes.push(note); return note;
    },
    update(id, layout) { for (const n of notes) if (n.panelId === id) {
      if (n.documentId && layout.documentId !== n.documentId) { n.stale = true; continue; }
      const value = layout.selections?.find((v) => v.selectionId === n.selectionId);
      if (value) { n.stale ||= !!value.stale; if (!n.stale) Object.assign(n, { rect: value.rect, rects: value.rects, viewport: layout.viewport || n.viewport }); }
    } },
    stale(id) { for (const n of notes) if (n.panelId === id) n.stale = true; },
    remove(id) { const index = notes.findIndex((n) => n.id === id); if (index >= 0) notes.splice(index, 1); },
    removeTab(id) { for (let i = notes.length - 1; i >= 0; i--) if (notes[i].panelId === id) notes.splice(i, 1); },
    clear(p) { for (let i = notes.length - 1; i >= 0; i--) if (!p || notes[i].scope === scope(p)) notes.splice(i, 1); }
  };
}
export function annotationPosition(rect, bounds, size = { width: 280, height: 180 }) {
  const margin = 8, width = Math.min(size.width, Math.max(0, bounds.width - margin * 2));
  let x = rect ? rect.x + rect.width + margin : margin;
  if (x + width > bounds.width - margin) x = rect ? rect.x - width - margin : margin;
  return { x: Math.max(margin, Math.min(x, bounds.width - width - margin)),
    y: Math.max(margin, Math.min(rect?.y ?? margin, bounds.height - size.height - margin)), width };
}
export function createBrowserAnnotations({ api, esc, icon, selection, toast, dictation, onChange = () => {}, confirmDiscard, focus = () => {} }) {
  const store = createAnnotationStore(), mounts = new Map();
  let editing = null, generation = 0, microphone = null;
  const q = (s, el) => el.querySelector(s);
  const selectionLabel = (n) => n.stale ? 'Snapshot annotation' : n.kind === 'region' ? 'Visual region · no image attached' : /^h[1-6]$/.test(n.label) ? 'Heading' : ({ button: 'Button', a: 'Link', img: 'Image', iframe: 'Frame · select a region for visual feedback', p: 'Text', div: 'Page component', span: 'Text' }[n.label] || n.label || 'Page selection');
  const action = (id, action, value) => api.browserAction({ id, action, value }).then((r) => { if (!r?.ok) toast(r?.error || 'Browser selection failed.'); }).catch((e) => toast(e.message));
  const touch = () => onChange();
  function stopDictation() { generation++; microphone?.cancel(); microphone = null; }
  function cancel() {
    if (editing && !editing.id && editing.selectionId) action(editing.panelId, 'annotation-track', { remove: [editing.selectionId] });
    if (editing) { const rec = mounts.get(editing.panelId); rec?.bubble?.remove(); if (rec) { rec.bubble = null; rec.draftHighlight.innerHTML = ''; } }
    const panelId = editing?.panelId; stopDictation(); editing = null; if (panelId && mounts.has(panelId)) render(mounts.get(panelId).panel); touch();
  }
  function scaled(rec, value) {
    const factorX = value.viewport?.width ? rec.host.clientWidth / value.viewport.width : 1;
    const factorY = value.viewport?.height ? rec.host.clientHeight / value.viewport.height : factorX;
    const scale = (r) => ({ x: r.x * factorX, y: r.y * factorY, width: r.width * factorX, height: r.height * factorY });
    return { rect: value.rect ? scale(value.rect) : null, rects: (value.rects?.length ? value.rects : value.rect ? [value.rect] : []).map(scale) };
  }
  function outlines(rec, value, className = '') {
    if (value.stale) return '';
    return scaled(rec, value).rects.map((r) => `<span class="browser-annotation-highlight ${className}" style="left:${r.x}px;top:${r.y}px;width:${Math.max(0, r.width)}px;height:${Math.max(0, r.height)}px"></span>`).join('');
  }
  function render(p) {
    const rec = mounts.get(p.id); if (!rec) return;
    const notes = store.list(p), tab = store.tab(p.id);
    rec.toolbar.hidden = editing?.panelId === p.id || (!rec.active && !notes.length);
    rec.toolbar.innerHTML = `<select aria-label="Annotation selection mode"><option value="component">Component</option><option value="text">Text</option><option value="region">Region</option></select><button class="btn btn--small" data-note="add" title="Select another part">Select</button>${notes.length ? `<select class="browser-annotation-note-list" aria-label="Edit pending note"><option value="">Notes (${notes.length})</option>${notes.map((n, i) => `<option value="${esc(n.id)}">${i + 1}. ${esc(n.title || 'Browser')}${n.stale ? ' · Snapshot' : ''}</option>`).join('')}</select>` : ''}<button class="btn btn--small" data-note="review" ${notes.length ? '' : 'disabled'}>Add to session (${notes.length})</button><span class="browser-annotation-tools"><button class="t-btn" data-note="clear" aria-label="Clear pending notes" title="Clear pending notes" ${notes.length ? '' : 'disabled'}>${icon('trash')}</button><button class="t-btn" data-note="close" aria-label="Exit annotation mode" title="Exit annotation mode">${icon('close')}</button></span>`;
    q('select', rec.toolbar).value = rec.mode;
    q('select', rec.toolbar).onchange = (e) => start(p, e.target.value);
    q('.browser-annotation-note-list', rec.toolbar)?.addEventListener('change', (e) => { const note = notes.find((n) => n.id === e.target.value); if (note) { const source = mounts.get(note.panelId); if (source) { focus(source.panel.id); edit(source.panel, note); } else toast('Open the source tab to edit this note.'); } });
    q('[data-note="add"]', rec.toolbar).onclick = () => start(p, rec.mode);
    q('[data-note="review"]', rec.toolbar).onclick = () => review(p);
    q('[data-note="clear"]', rec.toolbar).onclick = async () => { if (await approveDiscard(notes.length)) { for (const note of notes) action(note.panelId, 'annotation-track', { remove: [note.selectionId] }); store.clear(p); cancel(); renderAll(); } };
    q('[data-note="close"]', rec.toolbar).onclick = () => { rec.active = false; cancel(); action(p.id, 'cancel-annotation'); render(p); };
    rec.pins.innerHTML = tab.map((n) => {
      const number = notes.indexOf(n) + 1;
      const r = scaled(rec, n).rect;
      if (n.stale || !r || r.x + r.width < 0 || r.y + r.height < 0 || r.x > rec.host.clientWidth || r.y > rec.host.clientHeight) return '';
      const x = Math.min(Math.max(2, r.x + r.width - 10), Math.max(2, rec.host.clientWidth - 24));
      const y = Math.min(Math.max(2, r.y - 10), Math.max(2, rec.host.clientHeight - 24));
      return outlines(rec, n) + `<button class="browser-annotation-pin browser-annotation-surface" data-note-id="${esc(n.id)}" style="left:${x}px;top:${y}px" aria-label="Edit annotation ${number}" title="Edit annotation ${number}">${number}</button>`;
    }).join('');
    rec.pins.querySelectorAll('[data-note-id]').forEach((b) => b.onclick = () => edit(p, store.tab(p.id).find((n) => n.id === b.dataset.noteId)));
    touch();
  }
  function renderAll() { for (const rec of mounts.values()) render(rec.panel); }
  async function approveDiscard(count) { return !count || (confirmDiscard ? await confirmDiscard(count) : false); }
  function positionBubble(rec) {
    if (!rec.bubble || !editing) return;
    const geometry = scaled(rec, editing);
    const size = { width: 280, height: rec.bubble.offsetHeight || 190 };
    const position = annotationPosition(geometry.rect, { width: rec.host.clientWidth, height: rec.host.clientHeight }, size);
    Object.assign(rec.bubble.style, { left: position.x + 'px', top: position.y + 'px', width: position.width + 'px', maxHeight: Math.max(64, rec.host.clientHeight - 16) + 'px' });
    rec.draftHighlight.innerHTML = outlines(rec, editing, 'is-editing');
  }
  function edit(p, value) {
    if (!value) return;
    cancel();
    const rec = mounts.get(p.id); if (!rec) return;
    editing = { ...value, panelId: p.id, title: value.title || p.title, url: value.url || p.url, note: value.note || '' };
    rec.active = true; render(p);
    const bubble = document.createElement('section');
    bubble.className = 'browser-annotation-bubble browser-annotation-surface';
    bubble.setAttribute('aria-label', 'Annotation comment');
    bubble.innerHTML = `<div class="browser-annotation-caption">${esc(selectionLabel(value))}<button class="t-btn" data-comment="cancel" aria-label="Cancel comment" title="Cancel">${icon('close')}</button></div><textarea id="browser-comment" aria-label="Annotation comment" placeholder="Add a comment…" rows="3" maxlength="16000">${esc(editing.note)}</textarea><div class="browser-annotation-status" role="status"></div><div class="browser-annotation-actions"><button class="t-btn" data-comment="mic" aria-label="Dictate comment" title="Dictate comment">${icon('voice')}</button>${value.id ? '<button class="btn btn--small" data-comment="delete">Delete</button>' : ''}<button class="btn btn--small btn--go" data-comment="save">Save note</button></div>`;
    rec.bubble = bubble; rec.host.appendChild(bubble); positionBubble(rec);
    const input = q('textarea', bubble);
    input.oninput = () => { if (editing) editing.note = input.value; touch(); };
    input.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); rec.draftHighlight.innerHTML = ''; } };
    q('[data-comment="cancel"]', bubble).onclick = () => { cancel(); rec.draftHighlight.innerHTML = ''; };
    q('[data-comment="save"]', bubble).onclick = () => {
      if (!editing) return;
      editing.note = input.value.trim();
      try { editing = store.save(p, editing); } catch (e) { toast(e.message); return; }
      cancel(); rec.draftHighlight.innerHTML = ''; renderAll();
    };
    q('[data-comment="delete"]', bubble)?.addEventListener('click', () => { store.remove(value.id); action(p.id, 'annotation-track', { remove: [value.selectionId] }); cancel(); rec.draftHighlight.innerHTML = ''; renderAll(); });
    q('[data-comment="mic"]', bubble).onclick = () => {
      if (microphone) { microphone.stop(); return; }
      const status = q('[role="status"]', bubble), mic = q('[data-comment="mic"]', bubble);
      if (!dictation?.start) { status.textContent = 'Dictation is unavailable. Configure Voice in Settings.'; touch(); return; }
      const epoch = ++generation;
      const valid = () => epoch === generation && bubble.isConnected;
      microphone = dictation.start({
        onState(state) { if (!valid()) return; status.textContent = state === 'recording' ? 'Listening… click microphone to finish.' : state === 'transcribing' ? 'Transcribing…' : ''; mic.disabled = state === 'transcribing'; mic.classList.toggle('rec', state === 'recording'); touch(); },
        onText(text) { if (!valid()) return; input.value += (input.value && text ? ' ' : '') + text; editing.note = input.value; microphone = null; status.textContent = ''; mic.disabled = false; mic.classList.remove('rec'); touch(); },
        onError(error) { if (!valid()) return; microphone = null; status.textContent = String(error?.message || error); mic.disabled = false; mic.classList.remove('rec'); touch(); }
      });
    };
    input.focus(); touch();
  }
  function mount(panel, viewport) {
    unmount(panel.id);
    const host = document.createElement('div'); host.className = 'browser-annotations'; viewport.appendChild(host);
    const toolbar = document.createElement('div'); toolbar.className = 'browser-annotation-toolbar browser-annotation-surface'; toolbar.hidden = true;
    const pins = document.createElement('div'), draftHighlight = document.createElement('div'); pins.className = 'browser-annotation-pins'; draftHighlight.className = 'browser-annotation-draft';
    host.append(pins, draftHighlight, toolbar);
    const rec = { panel, host, toolbar, pins, draftHighlight, mode: 'component', active: false };
    rec.observer = new ResizeObserver(() => { render(panel); positionBubble(rec); }); rec.observer.observe(host);
    mounts.set(panel.id, rec); render(panel);
    return () => unmount(panel.id);
  }
  function unmount(id) { const rec = mounts.get(id); if (!rec) return; if (editing?.panelId === id) cancel(); rec.observer.disconnect(); rec.host.remove(); mounts.delete(id); }
  function start(p, mode = 'component') { const rec = mounts.get(p.id); if (!rec) return; cancel(); rec.draftHighlight.innerHTML = ''; rec.active = true; rec.mode = mode; render(p); action(p.id, 'annotate', { active: true, mode }); }
  function review(p) { const notes = store.list(p); if (notes.length) selection(p, { reference: 'Browser annotations · one-time insertion', text: annotationBatch(notes), onInserted: () => { for (const n of notes) { store.remove(n.id); action(n.panelId, 'annotation-track', { remove: [n.selectionId] }); } renderAll(); } }); }
  function handleEvent(event) {
    const rec = mounts.get(event.id); if (!rec) return;
    if (event.type === 'selection') edit(rec.panel, event.selection);
    if (event.type === 'annotation-end') { rec.active = false; render(rec.panel); }
    if (event.type === 'state' && event.loading) { store.stale(event.id); if (editing?.panelId === event.id) { editing.stale = true; rec.draftHighlight.innerHTML = ''; } render(rec.panel); }
    if (event.type === 'annotation-layout') {
      const value = event.layout || event.selection || event;
      store.update(event.id, value);
      if (editing?.panelId === event.id) {
        const update = value.selections?.find((n) => n.selectionId === editing.selectionId);
        if (editing.documentId && value.documentId !== editing.documentId) editing.stale = true;
        if (update) { editing.stale ||= !!update.stale; if (!editing.stale) Object.assign(editing, { rect: update.rect, rects: update.rects, viewport: value.viewport }); }
        positionBubble(rec);
      } else if (rec.active) rec.draftHighlight.innerHTML = value.hover ? outlines(rec, { ...value.hover, viewport: value.viewport }) : '';
      render(rec.panel);
    }
  }
  return { mount, start, edit, handleEvent, review, store, cancel,
    pendingCount: (id) => store.tab(id).length + (editing?.panelId === id && !editing.id ? 1 : 0),
    hasPending: (p) => !!store.list(p).length || (!!editing && (editing.panelId === p.id || mounts.get(editing.panelId)?.panel.owner === p.id)),
    async canClose(p) { const notes = mounts.has(p.id) ? store.tab(p.id) : store.list(p); const hasDraft = editing && (editing.panelId === p.id || mounts.get(editing.panelId)?.panel.owner === p.id); return approveDiscard(notes.length + (hasDraft && !editing.id ? 1 : 0)); },
    removeTab(id) { store.removeTab(id); unmount(id); renderAll(); },
    clear(p) { store.clear(p); cancel(); renderAll(); },
    dispose() { cancel(); for (const id of [...mounts.keys()]) unmount(id); }
  };
}
