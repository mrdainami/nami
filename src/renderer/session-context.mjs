// Context is a bounded record of visible output, never hidden model state.
const clean = value => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const bounds = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
export function createSessionContextRecorder({ identity = '', maxChars = 48000, maxEntries = 200, now = Date.now } = {}) {
  maxChars = bounds(maxChars, 48000, 100, 200000); maxEntries = bounds(maxEntries, 200, 1, 1000);
  let entries = [], truncated = false, updatedAt = now(), version = 0;
  const trim = () => {
    while (entries.length > maxEntries) { entries.shift(); truncated = true; }
    let size = entries.reduce((n, entry) => n + entry.text.length + entry.role.length + 4, 0);
    while (size > maxChars && entries.length > 1) { const entry = entries.shift(); size -= entry.text.length + entry.role.length + 4; truncated = true; }
    if (size > maxChars && entries.length) { const last = entries[0]; last.text = last.text.slice(-(maxChars - last.role.length - 4)); truncated = true; }
  };
  function add(role, text, { stream = false, id } = {}) {
    text = clean(text); if (!text) return false;
    const previous = entries.at(-1);
    if (stream && previous?.role === role && !previous.closed) previous.text += text;
    else { if (previous) previous.closed = true; entries.push({ role, text, id, closed: !stream }); }
    trim(); updatedAt = now(); version++; return true;
  }
  return {
    user(text) { return add('User', text); },
    event(event) {
      if (event?.type === 'message') return add('Assistant', event.text, { stream: true });
      if (event?.type === 'user') return add('User', event.text, { stream: true });
      if (event?.type !== 'tool' && event?.type !== 'tool_update') return false;
      const old = entries.find(entry => entry.role === 'Tool' && entry.id === event.id);
      const summary = (event.content || []).map(item => item?.type === 'content' && item.content?.type === 'text' ? item.content.text : item?.type === 'text' ? item.text : item?.type === 'diff' ? 'Changed file: ' + item.path : '').filter(Boolean).join('\n').slice(0, 2000);
      const text = [event.title || old?.title || 'Tool activity', event.status || old?.status, summary].filter(Boolean).join(' · ');
      if (old) { old.text = clean(text); old.title = event.title || old.title; old.status = event.status || old.status; trim(); updatedAt = now(); version++; return true; }
      const changed = add('Tool', text, { id: event.id });
      const entry = entries.at(-1); if (entry?.id === event.id) { entry.title = event.title; entry.status = event.status; }
      return changed;
    },
    endTurn() { if (entries.length) entries.at(-1).closed = true; },
    identify(nextIdentity) { identity = String(nextIdentity); updatedAt = now(); version++; },
    reset(nextIdentity = '') { identity = String(nextIdentity); entries = []; truncated = false; updatedAt = now(); version++; },
    snapshot() { return pack(identity, entries, truncated, updatedAt, version); },
    brief({ maxChars = 4000, maxEntries = 12 } = {}) {
      maxEntries = bounds(maxEntries, 12, 1, 40);
      const slice = entries.slice(-maxEntries);
      return takeBrief(pack(identity, slice, truncated || slice.length < entries.length, updatedAt, version), { maxChars });
    }
  };
}
function pack(identity, entries, truncated, updatedAt, version) {
  return { identity, kind: 'chat', content: entries.map(entry => entry.role + ':\n' + entry.text).join('\n\n'), truncated, incomplete: true, updatedAt, version };
}
function takeBrief(snapshot = {}, { maxChars = 4000 } = {}) {
  maxChars = bounds(maxChars, 4000, 80, 20000);
  const kind = snapshot.kind === 'terminal' ? 'terminal' : 'chat';
  const content = String(snapshot.content || '');
  const clipped = content.length > maxChars;
  return {
    identity: snapshot.identity || '', kind, content: clipped ? content.slice(-maxChars) : content,
    truncated: !!(snapshot.truncated || clipped), incomplete: true, updatedAt: snapshot.updatedAt, version: snapshot.version,
    label: snapshot.label || (kind === 'terminal' ? 'Terminal snapshot · available scrollback only' : 'Visible chat')
  };
}
export function brief(snapshot, opts) { return takeBrief(snapshot, opts); }
export function terminalSnapshot(term, { maxChars = 48000, maxLines = 6000, now = Date.now } = {}) {
  maxChars = bounds(maxChars, 48000, 100, 200000); maxLines = bounds(maxLines, 6000, 1, 6000);
  const buffer = term?.buffer?.active;
  const lines = []; let size = 0, clipped = false;
  if (buffer) for (let i = buffer.length - 1; i >= Math.max(0, buffer.length - maxLines); i--) {
    const text = clean(buffer.getLine(i)?.translateToString(true) || '');
    if (size + text.length + 1 > maxChars) { const room = Math.max(0, maxChars - size - 1); if (room) lines.unshift(text.slice(-room)); clipped = true; break; }
    lines.unshift(text); size += text.length + 1;
  }
  return { kind: 'terminal', content: lines.join('\n').trimEnd(), truncated: clipped || !!buffer && buffer.length > maxLines, incomplete: true, label: 'Terminal snapshot · available scrollback only', updatedAt: now() };
}
