// What a program found by the scan really is.
//
// On Windows npm's codex.cmd is a shim, and a shim's arguments are read by
// cmd.exe (cmd-shim.js). real-program.js opens the shim and, when it is plainly
// "node, this script", hands back node.exe and the script so that everything
// which starts the agent starts a real program. It is the half that touches
// the disk; the reading of the text is shimTarget's and is tested there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { realProgram, forgetShims } = require('../src/main/real-program.js');
const { reachesCmd } = require('../src/main/cmd-shim.js');
const { initialPromptArgs, seedHeld } = require('../src/main/seed-launch.js');

const NPM = 'C:\\Users\\cal\\AppData\\Roaming\\npm';
const SHIM = NPM + '\\codex.cmd';
const SCRIPT = NPM + '\\node_modules\\@openai\\codex\\bin\\codex.js';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const TEXT = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\n'
  + 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';

// A disk with these files on it. `reads` counts how often a shim was opened.
function disk(files) {
  const d = { reads: 0, files: { ...files } };
  d.fs = {
    statSync: (p) => { if (!(p in d.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); const f = d.files[p]; return { isFile: () => true, size: String(f.text || '').length, mtimeMs: f.mtimeMs || 1 }; },
    readFileSync: (p) => { d.reads++; return d.files[p].text; },
  };
  return d;
}
const opts = (d, extra) => ({ platform: 'win32', pathValue: 'C:\\Program Files\\nodejs', env: {}, fs: d.fs, ...extra });

test('a shim that is plainly node and one script becomes node.exe and that script', () => {
  forgetShims();
  const d = disk({ [SHIM]: { text: TEXT }, [SCRIPT]: {}, [NODE]: {} });
  const run = realProgram(SHIM, opts(d));
  assert.deepEqual(run, { file: NODE, args: [SCRIPT] });
  // which is the whole point: the message and the name go as they do on a Mac
  assert.equal(reachesCmd(run.file, 'win32'), false);
  assert.deepEqual(initialPromptArgs('codex', 'say "hi" & calc', { program: run.file, platform: 'win32' }), ['--', 'say "hi" & calc']);
  assert.equal(seedHeld('codex', 'say "hi" & calc', { program: run.file, platform: 'win32' }), false);
});

test('anything else is handed back as it came, and is still a shim to everyone downstream', () => {
  forgetShims();
  const same = (program, d, extra) => assert.deepEqual(realProgram(program, opts(d, extra)), { file: program, args: [] }, String(program));
  same(SHIM, disk({ [SHIM]: { text: TEXT }, [SCRIPT]: {} }), { pathValue: 'C:\\nowhere' });            // no node to be found
  same(SHIM, disk({ [SHIM]: { text: TEXT }, [SCRIPT]: {}, 'bin\\node.exe': {} }), { pathValue: 'bin' }); // only a relative one
  same(SHIM, disk({ [SHIM]: { text: TEXT }, [NODE]: {} }));                                             // the script is gone
  same(SHIM, disk({ [SHIM]: { text: '@echo off\r\ncalc.exe %*\r\n' }, [NODE]: {} }));                   // not npm's
  same(SHIM, disk({ [SHIM]: { text: TEXT + ' '.repeat(70000) }, [SCRIPT]: {}, [NODE]: {} }));           // far too long to be one
  same(SHIM, disk({}));                                                                                 // not there at all
  same('C:\\x\\run.bat', disk({ 'C:\\x\\run.bat': { text: TEXT } }));
  same('codex', disk({}));
  for (const p of ['', null, undefined]) same(p, disk({}));
  assert.equal(reachesCmd(realProgram(SHIM, opts(disk({}))).file, 'win32'), true);
  assert.equal(seedHeld('codex', 'hi', { program: realProgram(SHIM, opts(disk({}))).file, platform: 'win32' }), true, 'so the message is held, as before');
});

test('a real .exe is never opened, and neither is anything on a Mac', () => {
  forgetShims();
  const d = disk({ [SHIM]: { text: TEXT }, [SCRIPT]: {}, [NODE]: {} });
  const trap = { statSync() { throw new Error('touched the disk'); }, readFileSync() { throw new Error('touched the disk'); } };
  assert.deepEqual(realProgram('C:\\Users\\cal\\.local\\bin\\claude.exe', opts(d, { fs: trap })), { file: 'C:\\Users\\cal\\.local\\bin\\claude.exe', args: [] });
  for (const p of ['/opt/homebrew/bin/codex', 'codex', SHIM, '', null])
    assert.deepEqual(realProgram(p, { platform: 'darwin', fs: trap }), { file: p, args: [] }, String(p));
  assert.deepEqual(realProgram('/usr/bin/codex', { platform: 'linux', fs: trap }), { file: '/usr/bin/codex', args: [] });
});

test('a shim is read once, and again only when npm has rewritten it', () => {
  forgetShims();
  const d = disk({ [SHIM]: { text: TEXT, mtimeMs: 10 }, [SCRIPT]: {}, [NODE]: {} });
  for (let i = 0; i < 3; i++) assert.deepEqual(realProgram(SHIM, opts(d)), { file: NODE, args: [SCRIPT] });
  assert.equal(d.reads, 1);
  // an update that turned it into something else is noticed at the next tile
  d.files[SHIM] = { text: '@echo off\r\ncalc.exe %*\r\n', mtimeMs: 20 };
  assert.deepEqual(realProgram(SHIM, opts(d)), { file: SHIM, args: [] });
  assert.equal(d.reads, 2);
  // and the files it points at are looked for every time: they are what moves
  d.files[SHIM] = { text: TEXT, mtimeMs: 30 };
  assert.deepEqual(realProgram(SHIM, opts(d)), { file: NODE, args: [SCRIPT] });
  delete d.files[SCRIPT];
  assert.deepEqual(realProgram(SHIM, opts(d)), { file: SHIM, args: [] });
  assert.equal(d.reads, 3);
});
