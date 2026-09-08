// Files belong to a session. The rules, with no DOM in them, so they can be
// checked without a window. Spec: specs/2026-09-08-split-view.md (private).
//
// A panel is a file (editor, viewer, card) or a session (everything else). A
// file carries `owner`: the id of the session it joined when it opened, or
// nothing for a file that opened with no session active — a desk file. The
// rail groups files under their session; the split view shows one session
// beside one of its files.

export const FILE_KINDS = ['editor', 'viewer', 'card'];
export function isFile(p) { return !!p && FILE_KINDS.includes(p.kind); }
export function isSession(p) { return !!p && !FILE_KINDS.includes(p.kind); }

const byId = (panels, id) => (id ? panels.find((p) => p.id === id) : null) || null;
const liveOwner = (panels, f) => { const s = f && f.owner ? byId(panels, f.owner) : null; return s && isSession(s) ? s : null; };

// Which session a file opened now belongs to. On the desk: the card you last
// clicked, or that card's session if it is a file. In split: the session in
// the left pane, whatever else was clicked. Null is the desk.
export function ownerFor(panels, { activeId = null, view = 'desk', sessionId = null } = {}) {
  if (view === 'split') return sessionId && byId(panels, sessionId) ? sessionId : null;
  const a = byId(panels, activeId);
  if (!a) return null;
  if (isSession(a)) return a.id;
  const s = liveOwner(panels, a);
  return s ? s.id : null;
}

// The rail: sessions in desk order, each with its files in desk order, then
// the files with no live session. A file whose session closed is loose, not lost.
export function groupRail(panels) {
  const sessions = panels.filter(isSession).map((session) => ({ session, files: panels.filter((f) => isFile(f) && f.owner === session.id) }));
  const desk = panels.filter((f) => isFile(f) && !liveOwner(panels, f));
  return { sessions, desk };
}

// One preview per session. Opening `file` as a preview into `ownerId` closes
// the session's current preview — returned here for the caller to close, since
// closing a panel is the app's business (dirty checks, teardown).
export function previewToReplace(panels, ownerId, file) {
  if (!ownerId) return null;
  return panels.find((p) => isFile(p) && p.preview && p.owner === ownerId && p.id !== file.id) || null;
}

// A preview becomes a kept file: double-click, the pin control, or an edit.
export function keep(file) { if (file && 'preview' in file) delete file.preview; return file; }

// A closed session leaves its files on the desk. Returns how many.
export function orphan(panels, closedId) {
  let n = 0;
  for (const f of panels) if (isFile(f) && f.owner === closedId) { delete f.owner; n++; }
  return n;
}

// ---- what the split shows -----------------------------------------------------
// state: { panels, sessionId, fileId, last } where last maps a session id to
// the file it showed most recently. Actions:
//   enter { activeId }     — leaving the desk for split
//   select-session { id }  — a session row or chip
//   select-file { id }     — a file row
//   open { id }            — a file just opened into the current session
//   close { id }           — a panel just closed (panels already without it)
// Returns the next state (panels carried through); never mutates the input.
export function splitAfter(state, action) {
  const panels = state.panels || [];
  const last = Object.assign({}, state.last || {});
  const sessions = panels.filter(isSession);
  const filesOf = (sid) => panels.filter((f) => isFile(f) && f.owner === sid);
  const firstFile = (sid) => { const r = last[sid] && filesOf(sid).find((f) => f.id === last[sid]); return (r || filesOf(sid)[0] || null); };
  let sessionId = state.sessionId, fileId = state.fileId;
  const t = action && action.type;
  if (t === 'enter') {
    const a = byId(panels, action.activeId);
    const s = a ? (isSession(a) ? a : liveOwner(panels, a)) : null;
    sessionId = s ? s.id : (sessions[0] ? sessions[0].id : null);
    const f = a && isFile(a) && s ? a : firstFile(sessionId);
    fileId = f ? f.id : null;
  } else if (t === 'select-session') {
    if (byId(panels, action.id)) { sessionId = action.id; const f = firstFile(sessionId); fileId = f ? f.id : null; }
  } else if (t === 'select-file' || t === 'open') {
    const f = byId(panels, action.id);
    if (f) { const s = liveOwner(panels, f); sessionId = s ? s.id : (t === 'open' ? sessionId : null); fileId = f.id; }
  } else if (t === 'close') {
    // fall through to the repair below: whatever closed, show what is left
  }
  // Repair: the session must exist, the file must be one of its files.
  if (sessionId && !byId(panels, sessionId)) sessionId = sessions[0] ? sessions[0].id : null;
  if (!sessionId && sessions[0] && !fileId) sessionId = sessions[0].id;
  const shown = byId(panels, fileId);
  if (!shown || !isFile(shown) || (sessionId ? shown.owner !== sessionId : liveOwner(panels, shown))) {
    const f = sessionId ? firstFile(sessionId) : null;
    fileId = f ? f.id : null;
  }
  if (sessionId) { if (fileId) last[sessionId] = fileId; else delete last[sessionId]; }
  return { panels, sessionId, fileId, last };
}

// ---- across a restart --------------------------------------------------------
// Ids are minted fresh on restore, so a snapshot names a file's owner by the
// owner's position in the saved list; the restore turns positions back into ids.
export function ownerIndexes(panels) {
  const out = {};
  panels.forEach((f) => {
    if (!isFile(f) || !f.owner) return;
    const i = panels.findIndex((p) => p.id === f.owner && isSession(p));
    if (i >= 0) out[f.id] = i;
  });
  return out;
}

// restored[i] is the panel made from snaps[i], or null when it did not come
// back. A file whose owner did not come back is a desk file.
export function resolveOwners(restored, snaps) {
  snaps.forEach((s, i) => {
    const f = restored[i];
    if (!f || !isFile(f)) return;
    const owner = s && Number.isInteger(s.ownerIndex) ? restored[s.ownerIndex] : null;
    if (owner && isSession(owner)) f.owner = owner.id; else delete f.owner;
  });
  return restored;
}
