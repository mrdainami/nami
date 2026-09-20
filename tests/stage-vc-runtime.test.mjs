import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VC_RUNTIME, sourceFolders, chooseSource, stage, explainFailure } from '../scripts/stage-vc-runtime.mjs';
import { makePe, X64, ARM64 } from './pe-fixture.mjs';

// A pretend Windows disk: { 'C:\\folder\\file.dll': Buffer }. Folders exist by
// having something in them, which is all the script ever asks of one.
function disk(files) {
  const norm = (p) => p.toLowerCase();
  const paths = Object.keys(files);
  return {
    list(dir) {
      const prefix = norm(dir) + '\\';
      return [...new Set(paths.filter((p) => norm(p).startsWith(prefix)).map((p) => p.slice(prefix.length).split('\\')[0]))];
    },
    read(file) { const hit = paths.find((p) => norm(p) === norm(file)); return hit ? files[hit] : null; },
  };
}
const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', SystemRoot: 'C:\\Windows' };
const VS = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Redist\\MSVC';
const folderOf = (dir, arch, pe) => Object.fromEntries(VC_RUNTIME[arch].map((n) => [`${dir}\\${n}`, pe]));

test('the lists are what onnxruntime imports: four DLLs on x64, three on arm64', () => {
  assert.deepEqual([...VC_RUNTIME.x64].sort(), ['msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']);
  assert.deepEqual([...VC_RUNTIME.arm64].sort(), ['msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll']);
});

test('Visual Studio comes first, newest toolset first, and System32 last', () => {
  const io = disk({
    ...folderOf(`${VS}\\14.9.1\\x64\\Microsoft.VC143.CRT`, 'x64', makePe({ machine: X64 })),
    ...folderOf(`${VS}\\14.44.35112\\x64\\Microsoft.VC143.CRT`, 'x64', makePe({ machine: X64 })),
    ...folderOf(`${VS}\\14.44.35112\\debug_nonredist\\x64\\Microsoft.VC143.DebugCRT`, 'x64', makePe({ machine: X64 })),
    ...folderOf(`${VS}\\14.44.35112\\onecore\\x64\\Microsoft.VC143.CRT`, 'x64', makePe({ machine: X64 })),
    [`${VS}\\v143\\vc_redist.x64.exe`]: makePe({ machine: X64 }),
    ...folderOf('C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Redist\\MSVC\\14.29.30133\\x64\\Microsoft.VC142.CRT', 'x64', makePe({ machine: X64 })),
  });
  assert.deepEqual(sourceFolders({ arch: 'x64', env, io }), [
    `${VS}\\14.44.35112\\x64\\Microsoft.VC143.CRT`,
    `${VS}\\14.9.1\\x64\\Microsoft.VC143.CRT`,
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\VC\\Redist\\MSVC\\14.29.30133\\x64\\Microsoft.VC142.CRT',
    'C:\\Windows\\System32',
  ]);
});

test('the debug runtime, which may not be shipped, is never a candidate', () => {
  const io = disk(folderOf(`${VS}\\14.44.35112\\debug_nonredist\\arm64\\Microsoft.VC143.DebugCRT`, 'arm64', makePe()));
  assert.deepEqual(sourceFolders({ arch: 'arm64', env, io }), ['C:\\Windows\\System32']);
});

test('with no Visual Studio, an ARM PC\'s System32 serves arm64 — hybrids and all', () => {
  const io = disk(folderOf('C:\\Windows\\System32', 'arm64', makePe({ machine: ARM64, hybrid: true })));
  const picked = chooseSource({ arch: 'arm64', folders: sourceFolders({ arch: 'arm64', env, io }), io });
  assert.equal(picked.folder, 'C:\\Windows\\System32');
  assert.deepEqual(picked.files.map((f) => f.name), VC_RUNTIME.arm64);
});

// Exactly what the VM's System32 holds: ARM64X for three of them, and a
// vcruntime140_1.dll whose header says x64 and whose code is ARM.
test('the same System32 is refused for x64, by header and not by folder name', () => {
  const io = disk({
    'C:\\Windows\\System32\\vcruntime140.dll': makePe({ machine: ARM64, hybrid: true }),
    'C:\\Windows\\System32\\vcruntime140_1.dll': makePe({ machine: X64, hybrid: true }),
    'C:\\Windows\\System32\\msvcp140.dll': makePe({ machine: ARM64, hybrid: true }),
    'C:\\Windows\\System32\\msvcp140_1.dll': makePe({ machine: ARM64, hybrid: true }),
  });
  const picked = chooseSource({ arch: 'x64', folders: ['C:\\Windows\\System32'], io });
  assert.equal(picked.folder, null);
  assert.match(picked.rejected[0].reason, /vcruntime140\.dll is built for arm64, not x64/);

  const onlyTheDisguised = disk(folderOf('C:\\Windows\\System32', 'x64', makePe({ machine: X64, hybrid: true })));
  const second = chooseSource({ arch: 'x64', folders: ['C:\\Windows\\System32'], io: onlyTheDisguised });
  assert.equal(second.folder, null);
  assert.match(second.rejected[0].reason, /ARM64EC/);
});

test('a folder is taken whole or not at all, and the next one is tried', () => {
  const good = `${VS}\\14.40.1\\x64\\Microsoft.VC143.CRT`;
  const partial = `${VS}\\14.44.2\\x64\\Microsoft.VC143.CRT`;
  const files = folderOf(good, 'x64', makePe({ machine: X64 }));
  files[`${partial}\\vcruntime140.dll`] = makePe({ machine: X64 });
  files[`${partial}\\VCRUNTIME140_1.DLL`] = makePe({ machine: X64 });
  const io = disk(files);
  const picked = chooseSource({ arch: 'x64', folders: sourceFolders({ arch: 'x64', env, io }), io });
  assert.equal(picked.folder, good);
  assert.deepEqual(picked.rejected, [{ folder: partial, reason: 'msvcp140.dll is not there' }]);
});

test('a file that is not a binary at all is refused rather than copied', () => {
  const io = disk(folderOf('C:\\Windows\\System32', 'arm64', Buffer.from('<html>404</html>')));
  const picked = chooseSource({ arch: 'arm64', folders: ['C:\\Windows\\System32'], io });
  assert.equal(picked.folder, null);
  assert.match(picked.rejected[0].reason, /not a Windows binary/);
});

test('staging writes exactly the list, under build/vc-runtime/<arch>, with Windows\' own casing ignored', () => {
  const files = {};
  for (const n of VC_RUNTIME.arm64) files[`C:\\Windows\\System32\\${n.toUpperCase()}`] = makePe();
  const written = [];
  const done = stage({ arch: 'arm64', root: '/repo', env, io: disk(files), write: (dest, list) => written.push({ dest, names: list.map((f) => f.name) }) });
  assert.deepEqual(written, [{ dest: done.dest, names: VC_RUNTIME.arm64 }]);
  assert.match(done.dest.split('\\').join('/'), /\/repo\/build\/vc-runtime\/arm64$/);
});

test('when nothing fits, the build stops and says where it looked and what to do', () => {
  const io = disk(folderOf('C:\\Windows\\System32', 'arm64', makePe({ machine: ARM64, hybrid: true })));
  let said = '';
  try { stage({ arch: 'x64', root: '/repo', env, io, write: () => assert.fail('nothing may be written') }); } catch (e) { said = e.message; }
  assert.match(said, /No Microsoft C\+\+ runtime for x64/);
  assert.match(said, /C:\\Windows\\System32\n\s+vcruntime140\.dll is built for arm64/);
  assert.match(said, /Do not download/);
  assert.match(explainFailure('x64', []), /has to run on Windows/);
  assert.throws(() => chooseSource({ arch: 'ia32', folders: [], io }), /No C\+\+ runtime list for arch "ia32"/);
});

test('the script never reaches the network, and its output is ignored by git and found by electron-builder', () => {
  const source = fs.readFileSync(new URL('../scripts/stage-vc-runtime.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\/|node:https?|child_process/);
  const ignore = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^build\/vc-runtime\/$/m);
  const yml = fs.readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  assert.match(yml, /from: build\/vc-runtime\/\$\{arch\}\r?\n\s+to: resources\/app\.asar\.unpacked\/node_modules\/onnxruntime-node\/bin\/napi-v3\/win32\/\$\{arch\}/);
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['predist:win'], /stage-vc-runtime\.mjs/);
});
