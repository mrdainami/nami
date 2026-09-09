import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAfter, focusSplit, orphan } from '../src/renderer/desk-view.mjs';

const panels = [{ id:'a',kind:'claude' }, { id:'b',kind:'run',companionOf:'a' }, { id:'web',kind:'browser',owner:'a' }];
test('companion session occupies right pane without replacing source', () => {
  const state=splitAfter({panels,sessionId:'a',fileId:'web'}, {type:'select-companion',id:'b'});
  assert.equal(state.sessionId,'a'); assert.equal(state.fileId,'b');
  assert.equal(splitAfter(state,{type:'close'}).fileId,'b');
  assert.equal(splitAfter({...state,panels:panels.filter(p=>p.id!=='b')},{type:'close',id:'b'}).fileId,'web');
});
test('same pane focus keeps expanded state; explicit opposite pane reveals it', () => {
  const state={panels,sessionId:'a',fileId:'web'};
  assert.equal(focusSplit(state,'a','agent').full,'agent');
  assert.equal(focusSplit(state,'web','agent').full,null);
  assert.equal(focusSplit(state,'web','files').full,'files');
});
test('closing source leaves its companion independently navigable', () => {
  const remaining=panels.filter(p=>p.id!=='a').map(p=>({...p}));
  orphan(remaining,'a');
  assert.equal(remaining.find(p=>p.id==='b').companionOf,undefined);
  const next=focusSplit({panels:remaining,sessionId:null,fileId:'web'},'b');
  assert.equal(next.split.sessionId,'b');
});
