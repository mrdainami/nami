// Real Nami browser and saved HTML preview playback. All media and state are
// synthetic and disposable; the application registers its own document scheme.
const { app, BrowserWindow, webContents, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nami-local-media-')));
const userData = path.join(root, 'profile'), site = path.join(root, 'Local media');
fs.mkdirSync(userData); fs.mkdirSync(site);
const clips = ['clip.mp4', 'clip-end.mp4', 'clip.webm', 'clip-audio.mp4', 'clip-audio.webm'];
const hasAudio = clip => clip.startsWith('clip-audio.');
for (const clip of clips) {
  fs.copyFileSync(path.join(__dirname, 'fixtures/local-media', clip), path.join(site, clip));
  fs.writeFileSync(path.join(site, clip + '.html'), `<!doctype html><title>${clip}</title><h1>${clip}</h1><video id="video" src="${clip}" controls ${hasAudio(clip) ? '' : 'muted'} preload="metadata"></video>`);
}
fs.writeFileSync(path.join(root, 'outside.txt'), 'OUTSIDE THE DOCUMENT ROOT');
fs.symlinkSync(path.join(root, 'outside.txt'), path.join(site, 'outside.txt'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'operator', view: 'split' }));
fs.writeFileSync(path.join(userData, 'state.json'), JSON.stringify({ panelsByFolder: { __no_folder__: [{ kind: 'browser', url: 'about:blank' }] } }));
const profiles = require('../src/main/browser-profiles');
profiles.detectChromiumProfiles = () => [];
profiles.cookieImportStatus = () => ({ available: false, browsers: [] });
safeStorage.isEncryptionAvailable = () => { throw Error('No Keychain access belongs in this fixture.'); };
app.getVersion = () => require('../package.json').version;
process.argv.push('--review', '--user-data', userData);
require('../src/main/main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { const end = Date.now() + 12000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(40); } throw Error('Timed out: ' + label); }
async function playback(target, label, audioContents) {
  const run = source => target.executeJavaScript(source, true);
  await until(() => run('document.querySelector("#video")?.readyState>=1'), label + ' metadata');
  assert.ok(Math.abs(await run('document.querySelector("#video").duration') - 4) < 0.1);
  await run('document.querySelector("#video").play()');
  await until(() => run('document.querySelector("#video").currentTime>0.15'), label + ' playing');
  if (audioContents) {
    assert.equal(audioContents.isAudioMuted(), false, label + ' app output is unmuted');
    await until(() => audioContents.isCurrentlyAudible(), label + ' audio reaches browser output');
    assert.ok(await run('document.querySelector("#video").webkitAudioDecodedByteCount>0'), label + ' decoded audio bytes');
    // Keep playback running during mute/unmute so a stopped video cannot make
    // a broken mute control appear to pass.
    await run('document.querySelector("#video").loop=true;document.querySelector("#video").muted=true');
    await until(() => !audioContents.isCurrentlyAudible(), label + ' muted output');
    assert.equal(await run('document.querySelector("#video").paused'), false);
    await run('document.querySelector("#video").muted=false');
    await until(() => audioContents.isCurrentlyAudible(), label + ' unmuted output');
  }
  await run('document.querySelector("#video").pause()');
  assert.equal(await run('document.querySelector("#video").paused'), true);
  for (const time of [2.25, 0.25, 3.5]) {
    await run(`document.querySelector('#video').currentTime=${time}`);
    await until(() => run(`(()=>{const v=document.querySelector('#video');return !v.seeking&&Math.abs(v.currentTime-${time})<0.1&&v.readyState>=2;})()`), label + ' seek ' + time);
  }
  await run('document.querySelector("#video").currentTime=0;document.querySelector("#video").play()');
  await until(() => run('document.querySelector("#video").currentTime>0.15'), label + ' replay');
  if (audioContents) await until(() => audioContents.isCurrentlyAudible(), label + ' audio after seek/replay');
  await run('document.querySelector("#video").pause()');
  assert.equal(await run('document.querySelector("#video").error?.message||null'), null);
  console.log('PASS: ' + label + ' loads, plays, pauses, seeks forward/backward and replays.');
  if (audioContents) console.log('PASS: ' + label + ' decodes audio, produces audible output, mutes/unmutes and retains sound after seek/replay.');
}
app.whenReady().then(async () => {
  try {
    const win = await until(() => BrowserWindow.getAllWindows()[0], 'window');
    await until(() => !win.webContents.isLoadingMainFrame(), 'renderer');
    const run = source => win.webContents.executeJavaScript(source);
    await until(() => run('!!document.querySelector(".browser-address")'), 'browser address');
    for (const clip of clips) {
      const file = path.join(site, clip + '.html');
      await run(`document.querySelector('.browser-address input').value=${JSON.stringify(file)};document.querySelector('.browser-address').requestSubmit()`);
      const page = await until(() => webContents.getAllWebContents().find(w => w.getTitle() === clip && !w.isLoading()), clip + ' page');
      await playback(page, 'browser ' + clip, hasAudio(clip) ? page : null);
      const source = await page.executeJavaScript('document.querySelector("#video").currentSrc');
      const range = await page.session.fetch(source, { headers: { Range: 'bytes=0-99' } });
      assert.equal(range.status, 206);
      assert.match(range.headers.get('content-range'), /^bytes 0-99\//);
      assert.equal((await range.arrayBuffer()).byteLength, 100);
      const head = await page.session.fetch(source, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get('content-length')), fs.statSync(path.join(site, clip)).size);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      const outside = new URL('outside.txt', page.getURL()).href;
      assert.equal((await page.session.fetch(outside)).status, 404, 'symlinks cannot escape the document root');
      assert.equal(await page.executeJavaScript('typeof window.dainami'), 'undefined');
    }
    // Exercise the actual saved HTML editor preview and its default-session
    // handler, not a second copy of the browser partition's handler.
    for (const clip of ['clip.mp4', 'clip-audio.mp4', 'clip-audio.webm']) {
      win.webContents.send('open:file', { filePath: path.join(site, clip + '.html'), adopt: false });
      await until(() => run('!!document.querySelector("iframe.ed-html")'), 'saved HTML preview');
      const frame = await until(() => win.webContents.mainFrame.framesInSubtree.find(f => f.url.startsWith('nami-doc:') && f.url.endsWith('/' + clip + '.html')), 'preview frame');
      await playback(frame, 'saved HTML preview ' + clip, hasAudio(clip) ? win.webContents : null);
      assert.equal(await frame.executeJavaScript(`(()=>{try{return !!parent.document.body;}catch{return false;}})()`), false, 'HTML preview cannot read the app');
      const source = await frame.executeJavaScript('document.querySelector("#video").currentSrc');
      const response = await win.webContents.session.fetch(source, { headers: { Range: 'bytes=-16' } });
      assert.equal(response.status, 206);
      assert.equal((await response.arrayBuffer()).byteLength, 16);
    }
    console.log('PASS: real protocol ranges/HEAD, default preview handler, document-root containment and app isolation.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { for (const win of BrowserWindow.getAllWindows()) win.destroy(); fs.rmSync(root, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
});
