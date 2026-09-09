// Review captures include native children, whose pixels are absent from the
// main renderer's capturePage. Coordinates are window DIPs, then image pixels.
async function captureWindow(window, views) {
  const visible = [...views.values()].filter((e) => e.window === window && e.view.getVisible());
  const img = await window.webContents.capturePage();
  const scale = img.getSize().width / window.getContentBounds().width;
  const layers = [];
  for (const e of visible) {
    const bounds = e.view.getBounds();
    const contents=e.view.webContents; if(!contents || contents.isDestroyed())continue;
    let page;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { contents.invalidate(); await new Promise((r) => setTimeout(r, 100)); if(contents.isDestroyed())break; page = await contents.capturePage(); break; }
      catch (error) { if(contents.isDestroyed())break; if (attempt === 2) throw error; contents.invalidate(); await new Promise((r) => setTimeout(r, 150)); }
    }
    if(!page)continue;
    layers.push({ input: await require('sharp')(page.toPNG()).resize(Math.round(bounds.width * scale), Math.round(bounds.height * scale)).toBuffer(), left: Math.round(bounds.x * scale), top: Math.round(bounds.y * scale) });
  }
  return layers.length ? require('sharp')(img.toPNG()).composite(layers).png().toBuffer() : img.toPNG();
}
module.exports = { captureWindow };
