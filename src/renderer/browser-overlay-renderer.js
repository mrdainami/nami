const surface = document.getElementById('surface');
let previous = '', version=0, sequence=0, composing=false, deferred=null;
function render(data) {
  if(composing){deferred=data;return;}
  deferred=null;
  document.body.dataset.theme = data.theme || 'paper';
  document.body.toggleAttribute('data-glass', !!data.glass); document.body.toggleAttribute('data-soft', !!data.soft);
  const sameVersion=version===data.version;
  version=data.version;
  if (previous === data.html) { const root=surface.firstElementChild; if(root){root.style.width=data.width+'px';root.style.height=data.height+'px';} return; }
  const active = document.activeElement, key = active?.dataset.overlayNode;
  const pendingValue = sameVersion && data.acknowledged<sequence && active && 'value' in active ? active.value : null;
  const caret = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  surface.innerHTML = data.html; previous = data.html;
  const root = surface.firstElementChild;
  if (root) { root.style.width = data.width + 'px'; root.style.height = data.height + 'px'; }
  const restore = key && surface.querySelector('[data-overlay-node="' + key + '"]');
  if (restore) { if(pendingValue!==null)restore.value=pendingValue; restore.focus(); if (caret && restore.setSelectionRange) restore.setSelectionRange(...caret); }
}
window.namiOverlay.onRender(render);
document.addEventListener('compositionstart',()=>{composing=true;});
document.addEventListener('compositionend',()=>{composing=false;setTimeout(()=>{if(deferred){const data=deferred;deferred=null;render(data);}},0);});
for (const type of ['click','input','change','keydown','focusin','submit']) document.addEventListener(type, event => {
  const target = event.type==='click' ? (event.target.closest('button,a,input,select,textarea,label,[role=menuitem],.ctx-item') || event.target.closest('[data-overlay-node]')) : event.target.closest('[data-overlay-node]'); if (!target) return;
  if (type === 'keydown' && event.key !== 'Escape' && event.key !== 'Enter' && !event.key.startsWith('Arrow')) return;
  if(type==='submit')event.preventDefault();
  if(type==='keydown' && (event.key==='ArrowDown'||event.key==='ArrowUp') && target.closest('[role=menu]')){event.preventDefault();const nodes=[...surface.querySelectorAll('[role=menuitem]')],i=nodes.indexOf(target);nodes[(i+(event.key==='ArrowDown'?1:nodes.length-1))%nodes.length]?.focus();return;}
  if(type==='input')sequence++;
  window.namiOverlay.input({ version, sequence, type: type === 'focusin' ? 'focus' : type, target: Number(target.dataset.overlayNode), value: target.value, checked: target.checked, key: event.key, shiftKey: event.shiftKey, isComposing:event.isComposing, keyCode:event.keyCode });
});
