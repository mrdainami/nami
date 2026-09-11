// Run with Electron. NAMI_TEST_APP_ROOT can point at a packaged app.asar;
// otherwise exercise this checkout. All input and profile data are synthetic.
const { app, BrowserWindow, WebContentsView } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const root = process.env.NAMI_TEST_APP_ROOT || path.resolve(__dirname, '..');
const load = createRequire(path.join(root, 'package.json'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-native-fixture-'));
app.setPath('userData', path.join(tmp, 'profile'));
app.on('window-all-closed', () => {}); // speech still runs after capture windows close
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Native runtime check timed out'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
  let win, child;
  try {
    const sharp = load('sharp');
    assert.equal(sharp.versions.sharp, '0.35.4');
    assert.equal(sharp.versions.heif, '1.23.2');
    assert.equal(sharp.versions.vips, '8.18.6');
    win = new BrowserWindow({ width: 800, height: 600, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<style>html,body{margin:0;background:rgb(0,0,255)}</style>');
    child = new WebContentsView({ webPreferences: { sandbox: true } });
    child.setBounds({ x: 100, y: 100, width: 300, height: 200 });
    win.contentView.addChildView(child);
    await child.webContents.loadURL('data:text/html,<style>html,body{margin:0;background:rgb(255,0,0)}</style>');
    const { captureWindow } = load('./src/main/window-capture');
    for (const zoom of [1, 1.5]) {
      child.webContents.setZoomFactor(zoom);
      await pause(300);
      const result = await captureWindow(win, new Map([['child', { window: win, view: child }]]));
      const { data, info } = await sharp(result).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const scale = info.width / win.getContentBounds().width;
      const pixel = (x, y) => [...data.subarray((Math.round(y * scale) * info.width + Math.round(x * scale)) * 3, (Math.round(y * scale) * info.width + Math.round(x * scale)) * 3 + 3)];
      assert.equal(info.height, Math.round(win.getContentBounds().height * scale));
      assert.deepEqual(pixel(20, 20), [0, 0, 255]);
      assert.deepEqual(pixel(110, 110), [255, 0, 0]);
      assert.deepEqual(pixel(390, 290), [255, 0, 0]);
      assert.deepEqual(pixel(410, 310), [0, 0, 255]);
    }
    console.log('PASS: actual window and native browser composition, dimensions and edge alignment at 100%/150% zoom.');
    win.destroy(); win = null; child.webContents.close(); child = null;
    const wav = path.join(tmp, 'speech.wav');
    execFileSync('/usr/bin/say', ['-v', 'Samantha', '--file-format=WAVE', '--data-format=LEF32@16000', '-o', wav, 'The quick brown fox jumps over the lazy dog.'], { timeout: 15000 });
    const bytes = fs.readFileSync(wav);
    let pcm;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = bytes.readUInt32LE(offset + 4);
      if (bytes.toString('ascii', offset, offset + 4) === 'data') {
        const samples = bytes.subarray(offset + 8, offset + 8 + length);
        pcm = new Float32Array(samples.length / 4);
        for (let i = 0; i < pcm.length; i++) pcm[i] = samples.readFloatLE(i * 4);
        break;
      }
      offset += 8 + length + (length % 2);
    }
    assert.ok(pcm?.length > 16000);
    const stt = load('./src/main/stt-local');
    const models = root.endsWith('.asar') ? path.join(path.dirname(root), 'models') : path.join(root, 'build', 'models');
    stt.configure({ dir: models });
    assert.equal(stt.status().ready, true);
    // Missing model files must never silently become cloud requests.
    const originalFetch = global.fetch;
    global.fetch = () => { throw Error('Network is forbidden during this inference fixture'); };
    try {
      for (let i = 0; i < 2; i++) {
        const text = await stt.transcribe({ pcm, sampleRate: 16000 });
        assert.match(text.toLowerCase(), /quick brown fox/);
        assert.match(text.toLowerCase(), /lazy dog/);
      }
    } finally { global.fetch = originalFetch; }
    console.log(`PASS: ${process.arch} native image libraries and two real offline speech transcriptions from bundled weights.`);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    clearTimeout(watchdog); child?.webContents.close(); win?.destroy();
    fs.rmSync(tmp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
  }
});
