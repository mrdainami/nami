// Mirror only Nami-owned floating UI into trusted native child surfaces. Each
// view occupies its actual surface bounds; the guest stays live around it.
export function createBrowserOverlays({ api }) {
  const records = new Map(); let serial = 0, previous = '';
  const selector = '.browser-annotation-surface,.browser-menu,.browser-find,.toast,.ctx-menu,.theme-pop,.projects-pop,.term-link-hint';
  function sync(viewports, hidden, pendingCount=0) {
    const items = [], live = new Set();
    if (!hidden) for (const el of document.querySelectorAll(selector)) {
      if (!el.getClientRects().length || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (!viewports.some(v => r.left < v.x + v.width && r.right > v.x && r.top < v.y + v.height && r.bottom > v.y)) continue;
      if (r.width <= 0 || r.height <= 0) continue;
      let rec = records.get(el); if (!rec) { rec = { id: 'overlay-' + ++serial }; records.set(el, rec); }
      live.add(el);
      const clone = el.cloneNode(true); clone.removeAttribute('data-native-mirrored');
      const originals = [el, ...el.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
      if(!rec.nodes || rec.nodes.length!==originals.length || originals.some((node,i)=>node!==rec.nodes[i])) rec.version=(rec.version||0)+1;
      rec.nodes = originals;
      copies.forEach((node, index) => {
        node.dataset.overlayNode = index;
        for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        if (node.tagName === 'SCRIPT' || node.tagName === 'IFRAME') node.remove();
        if (node.tagName === 'TEXTAREA') node.textContent = originals[index].value;
        if (node.tagName === 'INPUT') { node.setAttribute('value', originals[index].value); node.toggleAttribute('checked', originals[index].checked); }
        if (node.tagName === 'OPTION') node.toggleAttribute('selected', originals[index].selected);
      });
      // Theme rules often rely on ancestors; copy their font inheritance.
      const style = getComputedStyle(el); clone.style.font = style.font; clone.style.color = style.color;
      const html=clone.outerHTML;
      items.push({ id: rec.id, version:rec.version, acknowledged:rec.acknowledged || 0, x: Math.max(0,r.left), y: Math.max(0,r.top), width: Math.min(r.width, innerWidth-Math.max(0,r.left)), height: Math.min(r.height,innerHeight-Math.max(0,r.top)), html });
    }
    for (const el of records.keys()) if (!live.has(el)) { el.removeAttribute('data-native-mirrored'); records.delete(el); }
    const payload = { items, pendingCount, theme: document.body.dataset.theme, glass: document.body.hasAttribute('data-glass'), soft: document.body.hasAttribute('data-soft') };
    const signature = JSON.stringify(payload); if (signature !== previous) { previous = signature; api.browserOverlays(payload).then(()=>{for(const el of live)if(el.isConnected)el.setAttribute('data-native-mirrored','');}).catch(() => { previous = ''; for(const el of live)el.removeAttribute('data-native-mirrored'); }); }
  }
  api.onBrowserOverlayInput(event => {
    const rec = [...records.values()].find(r => r.id === event.id), node = rec?.nodes[event.target];
    if (!node?.isConnected || node.disabled || event.version!==rec.version) return;
    rec.acknowledged=Math.max(rec.acknowledged||0,event.sequence||0);
    if (event.type === 'click') { if(typeof node.click==='function')node.click(); else node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); }
    else if(event.type==='submit') node.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    else if(event.type==='focus') node.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
    else if (event.type === 'input' || event.type === 'change') { if ('value' in node) node.value = event.value; if (node.type === 'checkbox') node.checked = event.checked; node.dispatchEvent(new Event(event.type, { bubbles: true })); }
    else if (event.type === 'keydown') node.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, shiftKey: event.shiftKey, isComposing: event.isComposing, keyCode: event.keyCode, bubbles: true, cancelable: true }));
  });
  return { sync };
}
