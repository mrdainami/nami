// Renders docs/media/social-card.html to social-card.png at exactly 1280x640.
//
//   npx electron docs/media/render-social-card.mjs
//
// Electron rather than a headless-Chrome dependency because the repo already
// has it, and because the card uses backdrop-filter — which several headless
// screenshot tools quietly drop, taking the glass with it.
//
// Upload the PNG by hand: repo Settings → General → Social preview. GitHub
// stores its own copy, so nothing re-reads this file after the upload; it
// lives here so the card can be regenerated rather than recovered from a
// design tool nobody else has.
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WIDTH = 1280;
const HEIGHT = 640;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    // useContentSize keeps the web contents exactly 1280x640 — without it the
    // window chrome is counted in and the capture comes out short.
    useContentSize: true,
    show: false,
    // The desk shows through the slab's translucency; a default white frame
    // behind it shifts every blended colour in the image.
    backgroundColor: '#e8e9ee',
    webPreferences: { zoomFactor: 1 },
  });

  await win.loadFile(join(here, 'social-card.html'));
  // Fonts resolve after load: capturing immediately catches the fallback face,
  // which is the one bug that would survive review — it still looks like a card.
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');

  // capturePage follows the display, so on a retina Mac this comes back at 2x.
  // Resizing down to the target beats rendering at 1x: the glyph edges and the
  // slab's rim are supersampled rather than snapped to whole pixels. On a 1x
  // display the resize is a no-op.
  const shot = await win.webContents.capturePage();
  const image = shot.resize({ width: WIDTH, height: HEIGHT, quality: 'best' });
  const out = join(here, 'social-card.png');
  writeFileSync(out, image.toPNG());

  const { width, height } = image.getSize();
  console.log(`wrote ${out} — ${width}x${height} (captured ${shot.getSize().width}x${shot.getSize().height})`);
  app.quit();
});
