import test from 'node:test';
import assert from 'node:assert/strict';
import { isFile, isSession, ownerFor, groupRail, previewToReplace, keep, orphan, moveTo, splitAfter, ownerIndexes, resolveOwners } from '../src/renderer/desk-view.mjs';

// A desk the way S.panels holds it: newest first, sessions and files mixed.
function desk() {
  return [
    { id: 'f3', kind: 'editor', filePath: '/p/pricing.ts', owner: 'codex' },
    { id: 'codex', kind: 'run', title: 'Passkey fallback' },
    { id: 'f2', kind: 'editor', filePath: '/p/webauthn.ts', owner: 'cc', preview: true },
    { id: 'f1', kind: 'editor', filePath: '/p/passkey.ts', owner: 'cc' },
    { id: 'cc', kind: 'acp', title: 'Claude Code' },
    { id: 'f0', kind: 'viewer', filePath: '/p/logo.png' },
  ];
}

test('a panel is a file or a session, nothing else', () => {
  assert.equal(isFile({ kind: 'editor' }), true);
  assert.equal(isFile({ kind: 'viewer' }), true);
  assert.equal(isFile({ kind: 'card' }), true);
  for (const k of ['claude', 'run', 'shell', 'harness', 'acp']) assert.equal(isSession({ kind: k }), true, k);
  assert.equal(isSession({ kind: 'editor' }), false);
});

// ---- who owns a file that opens now -----------------------------------------

test('on the desk a file joins the card you last clicked', () => {
  assert.equal(ownerFor(desk(), { activeId: 'codex', view: 'desk' }), 'codex');
});

test("on the desk a file joins the session of the file you last clicked", () => {
  assert.equal(ownerFor(desk(), { activeId: 'f1', view: 'desk' }), 'cc');
});

test('nothing active, or a file with no session, means the desk', () => {
  assert.equal(ownerFor(desk(), { activeId: null, view: 'desk' }), null);
  assert.equal(ownerFor(desk(), { activeId: 'f0', view: 'desk' }), null);
  assert.equal(ownerFor(desk(), { activeId: 'gone', view: 'desk' }), null);
});

test('in split the file joins the session in the left pane, whatever was clicked', () => {
  assert.equal(ownerFor(desk(), { activeId: 'f0', view: 'split', sessionId: 'codex' }), 'codex');
  assert.equal(ownerFor(desk(), { activeId: 'cc', view: 'split', sessionId: null }), null);
});

// ---- the rail --------------------------------------------------------------

test('the rail lists sessions in desk order, each with its files, then the loose ones', () => {
  const g = groupRail(desk());
  assert.deepEqual(g.sessions.map((s) => s.session.id), ['codex', 'cc']);
  assert.deepEqual(g.sessions.map((s) => s.files.map((f) => f.id)), [['f3'], ['f2', 'f1']]);
  assert.deepEqual(g.desk.map((f) => f.id), ['f0']);
});

test('a file whose session is gone is a loose file, not a missing one', () => {
  const g = groupRail(desk().filter((p) => p.id !== 'codex'));
  assert.deepEqual(g.sessions.map((s) => s.session.id), ['cc']);
  assert.deepEqual(g.desk.map((f) => f.id), ['f3', 'f0']);
});

// ---- preview vs kept -------------------------------------------------------

test('one preview per session: a new preview replaces the old one', () => {
  const d = desk();
  const nf = { id: 'f4', kind: 'editor', filePath: '/p/session.ts' };
  assert.equal(previewToReplace(d, 'cc', nf).id, 'f2');
  assert.equal(previewToReplace(d, 'codex', nf), null, 'codex has no preview open');
  assert.equal(previewToReplace(d, null, nf), null, 'the desk keeps everything');
});

test('re-opening the preview itself replaces nothing', () => {
  const d = desk();
  assert.equal(previewToReplace(d, 'cc', d[2]), null);
});

test('keep drops the preview flag and nothing else', () => {
  const f = { id: 'f2', kind: 'editor', owner: 'cc', preview: true };
  keep(f);
  assert.deepEqual(f, { id: 'f2', kind: 'editor', owner: 'cc' });
  keep(f);
  assert.deepEqual(f, { id: 'f2', kind: 'editor', owner: 'cc' });
});

test('a file moves to another session, or to the desk, and is kept either way', () => {
  const f = { id: 'f2', kind: 'editor', owner: 'cc', preview: true };
  moveTo(f, 'codex');
  assert.deepEqual(f, { id: 'f2', kind: 'editor', owner: 'codex' });
  moveTo(f, null);
  assert.deepEqual(f, { id: 'f2', kind: 'editor' });
});

// ---- closing a session -----------------------------------------------------

test('closing a session drops its files to the desk instead of closing them', () => {
  const d = desk();
  assert.equal(orphan(d, 'cc'), 2);
  assert.equal(d[2].owner, undefined);
  assert.equal(d[3].owner, undefined);
  assert.equal(d[0].owner, 'codex', 'other sessions keep theirs');
});

// ---- what the split shows --------------------------------------------------

test('entering split from a clicked file shows its session and that file', () => {
  const s = splitAfter({ panels: desk(), sessionId: null, fileId: null, last: {} }, { type: 'enter', activeId: 'f1' });
  assert.deepEqual([s.sessionId, s.fileId], ['cc', 'f1']);
});

test('entering split from a clicked session shows it with its first file', () => {
  const s = splitAfter({ panels: desk(), sessionId: null, fileId: null, last: {} }, { type: 'enter', activeId: 'codex' });
  assert.deepEqual([s.sessionId, s.fileId], ['codex', 'f3']);
});

test('entering split with nothing useful active shows the first session', () => {
  const s = splitAfter({ panels: desk(), sessionId: null, fileId: null, last: {} }, { type: 'enter', activeId: 'f0' });
  assert.deepEqual([s.sessionId, s.fileId], ['codex', 'f3']);
});

test('selecting a session brings back the file it last showed', () => {
  let s = { panels: desk(), sessionId: 'codex', fileId: 'f3', last: { cc: 'f1' } };
  s = splitAfter(s, { type: 'select-session', id: 'cc' });
  assert.deepEqual([s.sessionId, s.fileId], ['cc', 'f1']);
  s = splitAfter(s, { type: 'select-file', id: 'f2' });
  assert.deepEqual([s.sessionId, s.fileId, s.last.cc], ['cc', 'f2', 'f2']);
  s = splitAfter(s, { type: 'select-session', id: 'codex' });
  s = splitAfter(s, { type: 'select-session', id: 'cc' });
  assert.equal(s.fileId, 'f2', 'remembered');
});

test('selecting a file from the rail switches to its session', () => {
  const s = splitAfter({ panels: desk(), sessionId: 'cc', fileId: 'f1', last: {} }, { type: 'select-file', id: 'f3' });
  assert.deepEqual([s.sessionId, s.fileId], ['codex', 'f3']);
});

test('a session with no files shows none, and a stale remembered file is forgotten', () => {
  const d = desk().filter((p) => p.id !== 'f3');
  const s = splitAfter({ panels: d, sessionId: 'cc', fileId: 'f1', last: { codex: 'f3' } }, { type: 'select-session', id: 'codex' });
  assert.deepEqual([s.sessionId, s.fileId], ['codex', null]);
});

test('closing the shown file falls back to the next file of the same session', () => {
  const d = desk();
  let s = { panels: d, sessionId: 'cc', fileId: 'f2', last: { cc: 'f2' } };
  s = splitAfter({ ...s, panels: d.filter((p) => p.id !== 'f2') }, { type: 'close', id: 'f2' });
  assert.deepEqual([s.sessionId, s.fileId], ['cc', 'f1']);
});

test('closing the shown session moves to the next session', () => {
  const d = desk().filter((p) => p.id !== 'codex');
  const s = splitAfter({ panels: d, sessionId: 'codex', fileId: 'f3', last: {} }, { type: 'close', id: 'codex' });
  assert.deepEqual([s.sessionId, s.fileId], ['cc', 'f2']);
});

test('opening a file shows it and remembers it for the session', () => {
  const d = desk(); d.unshift({ id: 'f4', kind: 'editor', owner: 'cc', preview: true });
  const s = splitAfter({ panels: d, sessionId: 'cc', fileId: 'f1', last: {} }, { type: 'open', id: 'f4' });
  assert.deepEqual([s.sessionId, s.fileId, s.last.cc], ['cc', 'f4', 'f4']);
});

// ---- across a restart --------------------------------------------------------
// Panel ids are minted fresh on restore, so a snapshot names the owner by its
// position in the saved list and the restore resolves positions back to ids.

test('a snapshot names each file\'s owner by position; a restore resolves it', () => {
  const d = desk();
  const idx = ownerIndexes(d);
  assert.deepEqual(idx, { f3: 1, f2: 4, f1: 4 });
  // the restore minted new ids, in the same positions
  const minted = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'];
  const restored = d.map((p, i) => ({ ...p, id: minted[i], owner: undefined }));
  resolveOwners(restored, d.map((p, i) => ({ ownerIndex: idx[p.id] })));
  assert.equal(restored[0].owner, 'n1');
  assert.equal(restored[2].owner, 'n4');
  assert.equal(restored[5].owner, undefined);
});

test('a snapshot from before owners existed restores every file to the desk', () => {
  const restored = [{ id: 'a', kind: 'editor' }, { id: 'b', kind: 'claude' }];
  resolveOwners(restored, [{}, {}]);
  assert.equal(restored[0].owner, undefined);
});

test('a file whose owner did not come back is a desk file', () => {
  const restored = [{ id: 'a', kind: 'editor' }, null, { id: 'c', kind: 'editor' }];
  resolveOwners(restored, [{ ownerIndex: 1 }, {}, { ownerIndex: 1 }]);
  assert.equal(restored[0].owner, undefined);
  assert.equal(restored[2].owner, undefined);
});


// Closing uses the same visual order as the right-pane tab strip.
function closeSplitTab(state, id) {
  return splitAfter({ ...state, panels: state.panels.filter(p => p.id !== id) }, { type:'close', id, before:state.panels });
}
test('closing the middle unowned browser shows its next tab, even with other sessions on the desk', () => {
  const panels=[{id:'a',kind:'browser'},{id:'session',kind:'acp'},{id:'b',kind:'browser'},{id:'c',kind:'browser'},{id:'elsewhere',kind:'browser',owner:'session'}];
  const state={panels,sessionId:null,fileId:'b'};
  const next=closeSplitTab(state,'b');
  assert.deepEqual([next.sessionId,next.fileId],[null,'c']);
  assert.equal(state.fileId,'b','input is unchanged');
});
test('closing the final-position unowned tab shows its previous neighbor', () => {
  const state={panels:[{id:'a',kind:'browser'},{id:'b',kind:'viewer'},{id:'c',kind:'browser'}],sessionId:null,fileId:'c'};
  assert.equal(closeSplitTab(state,'c').fileId,'b');
});
test('closing an owned tab chooses its next neighbor rather than the first tab and leaves the agent unchanged', () => {
  const panels=[{id:'s',kind:'acp'},{id:'a',kind:'browser',owner:'s'},{id:'other',kind:'browser',owner:'different'},{id:'b',kind:'browser',owner:'s'},{id:'c',kind:'viewer',owner:'s'}];
  const next=closeSplitTab({panels,sessionId:'s',fileId:'b',last:{s:'b'}},'b');
  assert.deepEqual([next.sessionId,next.fileId,next.last.s],['s','c','c']);
});
test('closing a background tab keeps the currently visible tab', () => {
  const state={panels:[{id:'a',kind:'browser'},{id:'b',kind:'browser'},{id:'c',kind:'browser'}],sessionId:null,fileId:'b'};
  assert.equal(closeSplitTab(state,'a').fileId,'b');
});
test('closing the last tab leaves that pane empty without jumping to an unrelated session', () => {
  const panels=[{id:'s',kind:'acp'},{id:'other',kind:'browser',owner:'s'},{id:'last',kind:'browser'}];
  const next=closeSplitTab({panels,sessionId:null,fileId:'last'},'last');
  assert.deepEqual([next.sessionId,next.fileId],[null,null]);
  const repaired=splitAfter(next,{type:'close'});
  assert.deepEqual([repaired.sessionId,repaired.fileId],[null,null]);
  const owned=closeSplitTab({panels,sessionId:'s',fileId:'other'},'other');
  assert.deepEqual([owned.sessionId,owned.fileId],['s',null]);
});
test('repairing a missing unowned selection recovers an existing desk tab', () => {
  const next=splitAfter({panels:[{id:'a',kind:'browser'}],sessionId:null,fileId:'gone'},{type:'close'});
  assert.equal(next.fileId,'a');
});
