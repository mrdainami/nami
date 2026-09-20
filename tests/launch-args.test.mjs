import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { launchArgs, fromHandoff } = require('../src/main/launch-args.js');

// A pretend disk. Windows names are matched without regard to case, because
// that is how the real one answers.
function disk({ files = [], folders = [] }, platform) {
  const key = (p) => (platform === 'win32' ? String(p).toLowerCase() : String(p));
  const f = new Set(files.map(key)), d = new Set(folders.map(key));
  return (p) => {
    if (f.has(key(p))) return { isFile: () => true, isDirectory: () => false };
    if (d.has(key(p))) return { isFile: () => false, isDirectory: () => true };
    throw new Error('ENOENT');
  };
}

const WIN_DISK = { files: ['C:\\work\\notes.md', 'C:\\work\\docs\\read me.md', 'C:\\nami\\README.md', '\\\\server\\share\\plan.md'], folders: ['C:\\work', 'C:\\work\\docs', 'C:\\nami', 'C:\\Users\\dev\\profile'] };
const win = (argv, over = {}) => launchArgs({
  argv, cwd: 'C:\\work', isPackaged: true, platform: 'win32', stat: disk(WIN_DISK, 'win32'), ...over,
});

test('a file on the command line is a file to open', () => {
  assert.deepEqual(win(['C:\\Program Files\\Nami\\Nami.exe', 'C:\\work\\notes.md']), { files: ['C:\\work\\notes.md'], folders: [] });
});

test('a folder on the command line is a folder to open', () => {
  assert.deepEqual(win(['C:\\Program Files\\Nami\\Nami.exe', 'C:\\work']), { files: [], folders: ['C:\\work'] });
});

test('a bare launch asks for nothing', () => {
  assert.deepEqual(win(['C:\\Program Files\\Nami\\Nami.exe']), { files: [], folders: [] });
  assert.deepEqual(win([]), { files: [], folders: [] });
  assert.deepEqual(launchArgs(), { files: [], folders: [] });
});

// The exe is argv[0] whether or not it exists on the pretend disk, and must
// never be mistaken for something to open — not even when it really is a file.
test('the program itself is never opened', () => {
  const stat = disk({ files: ['C:\\Nami\\Nami.exe', 'C:\\work\\notes.md'] }, 'win32');
  assert.deepEqual(win(['C:\\Nami\\Nami.exe', 'C:\\work\\notes.md'], { stat }).files, ['C:\\work\\notes.md']);
});

// Chromium adds switches of its own to the argv a second instance hands over,
// and moves them in front of the arguments. None of them is a path.
test('switches are ignored, with or without a value after the equals sign', () => {
  const r = win(['C:\\Nami\\Nami.exe', '--allow-file-access-from-files', '--original-process-start-time=13370000', '--updated', 'C:\\work\\notes.md']);
  assert.deepEqual(r, { files: ['C:\\work\\notes.md'], folders: [] });
});

// Nami's own switches that take their value as the NEXT argument. Without this
// `--user-data C:\Users\dev\profile` opens a window on the profile folder.
test("the value after one of Nami's own switches is not a path to open", () => {
  assert.deepEqual(win(['C:\\Nami\\Nami.exe', '--user-data', 'C:\\Users\\dev\\profile']), { files: [], folders: [] });
  assert.deepEqual(win(['C:\\Nami\\Nami.exe', '--screenshot', 'C:\\work\\notes.md', '--zoom', 'C:\\work']), { files: [], folders: [] });
  assert.deepEqual(win(['C:\\Nami\\Nami.exe', '--user-data', 'C:\\Users\\dev\\profile', 'C:\\work']).folders, ['C:\\work']);
});

// `electron .` — the dot is the app, not a folder the user asked for. It is
// the first argument that is not a switch, wherever the switches ended up.
test('in development the app path is skipped, and only the app path', () => {
  const dev = (argv) => win(argv, { isPackaged: false, cwd: 'C:\\nami' });
  assert.deepEqual(dev(['C:\\nami\\node_modules\\electron\\dist\\electron.exe', '.']), { files: [], folders: [] });
  assert.deepEqual(dev(['electron.exe', '.', 'C:\\nami\\README.md']), { files: ['C:\\nami\\README.md'], folders: [] });
  assert.deepEqual(dev(['electron.exe', '--inspect=5858', '.', 'C:\\work']), { files: [], folders: ['C:\\work'] });
  assert.deepEqual(dev(['electron.exe', '--user-data', 'C:\\Users\\dev\\profile', '.', 'README.md']).files, ['C:\\nami\\README.md']);
  // Packaged, the same dot is an argument like any other: the folder it names.
  assert.deepEqual(win(['Nami.exe', '.']).folders, ['C:\\work']);
});

test('a relative path is read against the folder the launch came from', () => {
  assert.deepEqual(win(['Nami.exe', 'notes.md']).files, ['C:\\work\\notes.md']);
  assert.deepEqual(win(['Nami.exe', 'docs\\read me.md']).files, ['C:\\work\\docs\\read me.md']);
  assert.deepEqual(win(['Nami.exe', '.\\docs']).folders, ['C:\\work\\docs']);
  assert.deepEqual(win(['Nami.exe', '..\\nami\\README.md']).files, ['C:\\nami\\README.md']);
  // The second instance's folder, not the running app's.
  assert.deepEqual(win(['Nami.exe', 'README.md'], { cwd: 'C:\\nami' }).files, ['C:\\nami\\README.md']);
});

test('forward slashes and a trailing separator are tidied into the real name', () => {
  assert.deepEqual(win(['Nami.exe', 'C:/work/notes.md']).files, ['C:\\work\\notes.md']);
  assert.deepEqual(win(['Nami.exe', 'C:\\work\\']).folders, ['C:\\work']);
});

test('a network share is a path like any other', () => {
  assert.deepEqual(win(['Nami.exe', '\\\\server\\share\\plan.md']).files, ['\\\\server\\share\\plan.md']);
});

test('only what exists is accepted', () => {
  assert.deepEqual(win(['Nami.exe', 'C:\\work\\gone.md', 'nami://open', 'hello']), { files: [], folders: [] });
  // A stat that throws, returns nothing, or is missing altogether all mean no.
  assert.deepEqual(win(['Nami.exe', 'C:\\work'], { stat: () => null }), { files: [], folders: [] });
  assert.deepEqual(win(['Nami.exe', 'C:\\work'], { stat: undefined }), { files: [], folders: [] });
});

test('several things at once keep their order, and nothing is listed twice', () => {
  const r = win(['Nami.exe', 'C:\\work\\notes.md', 'C:\\nami', 'notes.md', 'C:\\WORK\\NOTES.MD', 'C:\\work']);
  assert.deepEqual(r, { files: ['C:\\work\\notes.md'], folders: ['C:\\nami', 'C:\\work'] });
});

test('arguments that are not strings are passed over', () => {
  assert.deepEqual(win(['Nami.exe', null, undefined, 7, '', 'C:\\work']).folders, ['C:\\work']);
});

// The same module reads a POSIX command line, with POSIX rules: names differ
// by case, and a backslash is an ordinary character.
test('posix: paths resolve and compare the POSIX way', () => {
  const stat = disk({ files: ['/proj/notes.md', '/proj/Notes.md'], folders: ['/proj'] }, 'linux');
  const r = launchArgs({ argv: ['/opt/nami/nami', '--no-sandbox', 'notes.md', '/proj/Notes.md', '/proj/', '../proj'], cwd: '/proj', isPackaged: true, platform: 'linux', stat });
  assert.deepEqual(r, { files: ['/proj/notes.md', '/proj/Notes.md'], folders: ['/proj'] });
});

// ---- what a second launch hands to the running app --------------------------
// It crossed a process boundary, so it is a claim and is checked like one.
test('a handoff is believed only where it is strings, absolute, and really there', () => {
  const stat = disk(WIN_DISK, 'win32');
  const r = fromHandoff({ files: ['C:\\work\\notes.md', 'notes.md', 'C:\\work\\gone.md', 7, null], folders: ['C:\\work\\', '..\\nami'] }, { platform: 'win32', stat });
  assert.deepEqual(r, { files: ['C:\\work\\notes.md'], folders: ['C:\\work'] });
});

test('a handoff is sorted by what is on disk, not by which list it arrived in', () => {
  const stat = disk(WIN_DISK, 'win32');
  const r = fromHandoff({ files: ['C:\\work'], folders: ['C:\\work\\notes.md'] }, { platform: 'win32', stat });
  assert.deepEqual(r, { files: ['C:\\work\\notes.md'], folders: ['C:\\work'] });
});

test('a handoff that is not one opens nothing', () => {
  const stat = disk(WIN_DISK, 'win32');
  for (const junk of [null, undefined, 'C:\\work', 7, [], { files: 'C:\\work' }, { folders: { 0: 'C:\\work' } }]) {
    assert.deepEqual(fromHandoff(junk, { platform: 'win32', stat }), { files: [], folders: [] });
  }
});

// ---- the wiring, which only a running app can exercise ----------------------
// main.js cannot be loaded here, so its shape is read instead. Two things must
// stay true or the feature is wrong in a way no unit test would see: the lock is
// asked for on Windows only (a Mac's second `npm start` must keep working), and
// only after userData is set, because the lock is keyed on it.
test('main asks for the single-instance lock on Windows only, after userData is set', () => {
  const main = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
  const gate = main.split('\n').find((l) => l.startsWith('const ONE_INSTANCE'));
  assert.ok(gate && gate.includes("process.platform === 'win32'"), gate);
  const locks = main.split('\n').filter((l) => l.includes('requestSingleInstanceLock('));
  assert.equal(locks.length, 1);
  assert.ok(locks[0].includes('ONE_INSTANCE &&'), locks[0]);
  assert.ok(main.indexOf("app.setPath('userData'") < main.indexOf('requestSingleInstanceLock('), 'the lock is keyed on userData');
  assert.ok(main.includes("app.on('second-instance'"), 'nothing receives the handoff');
  assert.ok(main.includes("app.on('open-file'"), 'the Mac route is gone');
});

// Statting \\server\share is a login to that server (remote-path.js). A path on
// the command line was at least put there by somebody, so one that Nami would
// open is looked at — but one it would never open is not worth a login to find
// out whether it exists.
test('windows: a path on a share is only looked at when it is something Nami would open', () => {
  const asked = [];
  const there = disk({ files: ['\\\\evil\\share\\x.md', '\\\\evil\\share\\x.png', '\\\\evil\\share\\run.bat', 'C:\\work\\run.bat'], folders: ['\\\\evil\\share', '\\\\evil\\share\\work'] }, 'win32');
  const stat = (p) => { asked.push(p); return there(p); };
  const argv = ['Nami.exe', '\\\\evil\\share\\x.png', '\\\\evil\\share\\run.bat', '//evil/share/a.exe', '\\\\?\\C:\\work\\a.lnk', '\\\\evil\\share\\x.md', '\\\\evil\\share\\work', 'C:\\work\\run.bat'];
  const out = launchArgs({ argv, cwd: 'C:\\work', platform: 'win32', stat });
  assert.deepEqual(out, { files: ['\\\\evil\\share\\x.md', 'C:\\work\\run.bat'], folders: ['\\\\evil\\share\\work'] });
  assert.deepEqual(asked, ['\\\\evil\\share\\x.md', '\\\\evil\\share\\work', 'C:\\work\\run.bat']);
  // the same for what a second launch hands over
  asked.length = 0;
  const handed = fromHandoff({ files: ['\\\\evil\\share\\x.png', '\\\\evil\\share\\x.md'], folders: ['\\\\evil\\share\\work'] }, { platform: 'win32', stat });
  assert.deepEqual(handed, { files: ['\\\\evil\\share\\x.md'], folders: ['\\\\evil\\share\\work'] });
  assert.deepEqual(asked, ['\\\\evil\\share\\x.md', '\\\\evil\\share\\work']);
});

test('a Mac stats every argument as it always did', () => {
  const asked = [];
  const stat = (p) => { asked.push(p); throw new Error('ENOENT'); };
  launchArgs({ argv: ['nami', '//evil/share/x.png', '/work/run.bat'], cwd: '/work', platform: 'darwin', stat });
  assert.deepEqual(asked, ['/evil/share/x.png', '/work/run.bat']);
});

// Windows runs a program named without a folder from the CURRENT folder first,
// and a Nami opened from a file starts life in that file's folder.
test('main leaves the folder it was started in, on Windows only, once the command line has been read', () => {
  const main = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
  const lines = main.split('\n').filter((l) => l.includes('process.chdir('));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('os.homedir()'), lines[0]);
  const at = main.indexOf('process.chdir(');
  assert.ok(main.lastIndexOf("process.platform === 'win32'", at) > main.lastIndexOf('\n\n', at), 'the chdir is not gated on Windows');
  assert.ok(main.indexOf('cwd: process.cwd()') < at, 'a relative argument must be read against the original folder first');
  assert.ok(main.indexOf('requestSingleInstanceLock(') < at);
});
