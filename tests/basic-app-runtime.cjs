// A real app, renderer, editor and PTY with disposable files. The optional root
// exercises packaged first-party code without adding a debug bridge to the app.
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-basic-runtime-'));
const load = createRequire(path.join(process.env.NAMI_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'package.json'));
const note = path.join(root, 'note.md'); fs.writeFileSync(note, '# Fixture\n\nFirst paragraph.\n');
const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
fs.writeFileSync(path.join(profile, 'state.json'), JSON.stringify({ currentFolder: root, windows: [{ folder: root }] }));
const profiles = load('./src/main/browser-profiles'); profiles.detectChromiumProfiles = () => []; profiles.cookieImportStatus = () => ({ available: false, browsers: [] });
safeStorage.isEncryptionAvailable = () => { throw Error('This fixture must not access Keychain'); };
process.argv.push('--review', '--user-data', profile);
app.getVersion = () => load('./package.json').version;
load('./src/main/main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await pause(50); } throw Error('Timed out: ' + label); }
const timer = setTimeout(() => app.exit(1), 45000);
app.whenReady().then(async () => {
  try {
    let win; await until(() => (win = BrowserWindow.getAllWindows()[0]) && !win.webContents.isLoading() && win.webContents.getURL().startsWith('file:'), 'app');
    const run = text => win.webContents.executeJavaScript(text);
    await run('window.terminalFixture="";dainami.onTermData(e=>{if(e.id==="runtime-fixture")window.terminalFixture+=e.data;});true');
    const created = await run(`dainami.termCreate(${JSON.stringify({ id: 'runtime-fixture', cwd: root, kind: 'harness', program: '/bin/sh', args: ['-s'], cols: 80, rows: 24 })})`);
    assert.equal(created.ok, true);
    await run(`dainami.termWrite(${JSON.stringify({ id: 'runtime-fixture', data: "printf 'NAMI_TERMINAL_OK\\n'\nexit\n" })})`);
    await until(() => run('window.terminalFixture.includes("NAMI_TERMINAL_OK\\r\\n")'), 'actual terminal output');
    console.log('PASS: packaged app bridge creates a real local PTY, accepts input and receives output.');
    win.webContents.send('open:file', { filePath: note, folder: root, adopt: false });
    await until(() => run('!!document.querySelector(".ed-tab[data-m=edit]")'), 'editor');
    await run('document.querySelector(".ed-tab[data-m=edit]").click()');
    await until(() => run('!!document.querySelector(".ProseMirror[contenteditable=true]")'), 'rich editor');
    await run(`(()=>{const el=document.querySelector('.ProseMirror');el.focus();const range=document.createRange();range.selectNodeContents(el);range.collapse(false);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);})()`);
    win.focus(); win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await win.webContents.insertText('Second fixture paragraph.');
    await until(() => run('document.querySelector(".ProseMirror").innerText.includes("Second fixture paragraph.")'), 'typed paragraph');
    await until(() => run('[...document.querySelectorAll("textarea")].some(e=>e.value.includes("Second fixture paragraph."))'), 'editor change reaches its Markdown buffer');
    await run('document.querySelector(".ed-save").click()');
    await until(() => fs.readFileSync(note, 'utf8').includes('Second fixture paragraph.'), 'saved Markdown');
    assert.ok(fs.readFileSync(note, 'utf8').includes('First paragraph.'));
    console.log('PASS: real Markdown editor loads, Enter inserts a paragraph, typed content saves to the same file.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timer); for (const win of BrowserWindow.getAllWindows()) win.destroy(); try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } finally { app.exit(process.exitCode || 0); } }
});
