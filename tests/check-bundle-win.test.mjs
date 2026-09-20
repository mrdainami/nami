import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { checkWinBundle, archOfUnpacked } from '../scripts/check-bundle-win.mjs';
import { VC_RUNTIME } from '../scripts/stage-vc-runtime.mjs';
import { packEnv } from '../scripts/win-pack.mjs';
import { makePe, X64, ARM64 } from './pe-fixture.mjs';

const store = createRequire(import.meta.url)('../src/main/stt-model.js');
const MACHINE = { x64: X64, arm64: ARM64 };

// A whole unpacked app, as electron-builder lays it out, made of pretend
// binaries. `change` gets the file map before it is written, so each test
// breaks exactly one thing in an otherwise good bundle.
function bundle(arch, change = () => {}) {
  const pe = makePe({ machine: MACHINE[arch] });
  const mods = 'resources/app.asar.unpacked/node_modules';
  const ort = `${mods}/onnxruntime-node/bin/napi-v3/win32/${arch}`;
  const pty = `${mods}/@lydell/node-pty-win32-${arch}/prebuilds/win32-${arch}`;
  const sharp = `${mods}/@img/sharp-win32-${arch}/lib`;
  const repo = store.MODELS.find((m) => m.bundled).repo;
  const files = {
    'Nami.exe': pe,
    'ffmpeg.dll': pe,
    // x86 on every arch in a real build, and outside the unpacked tree, so it
    // is nobody's business here.
    'resources/elevate.exe': makePe({ machine: 0x14c }),
    [`${ort}/onnxruntime_binding.node`]: makePe({ machine: MACHINE[arch], imports: ['onnxruntime.dll', 'KERNEL32.dll', 'MSVCP140.dll', 'VCRUNTIME140.dll'], delayImports: ['NODE.EXE'] }),
    [`${ort}/onnxruntime.dll`]: makePe({ machine: MACHINE[arch], imports: ['KERNEL32.dll', ...VC_RUNTIME[arch].map((n) => n.toUpperCase().replace('.DLL', '.dll'))], delayImports: ['DirectML.dll'] }),
    [`${ort}/DirectML.dll`]: pe,
    [`${pty}/conpty.node`]: pe,
    [`${pty}/conpty_console_list.node`]: pe,
    [`${pty}/conpty/conpty.dll`]: pe,
    [`${pty}/conpty/OpenConsole.exe`]: pe,
    [`${sharp}/sharp-win32-${arch}-0.35.4.node`]: makePe({ machine: MACHINE[arch], imports: ['KERNEL32.dll', 'libvips-42.dll'] }),
    [`${sharp}/libvips-42.dll`]: pe,
    [`${mods}/@lydell/node-pty/index.js`]: Buffer.from('module.exports = {}'),
    [`resources/models/${repo}/.ready`]: Buffer.from('now'),
  };
  for (const name of VC_RUNTIME[arch]) files[`${ort}/${name}`] = pe;
  for (const f of store.MODEL_FILES) files[`resources/models/${repo}/${f}`] = Buffer.from('w');
  change(files, { ort, pty, sharp, mods, repo });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-winbundle-'));
  for (const [rel, bytes] of Object.entries(files)) {
    if (bytes == null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), bytes);
  }
  return dir;
}
const problemsOf = (arch, change, asarEntries = []) => {
  const dir = bundle(arch, change);
  try { return checkWinBundle({ dir, arch, asarEntries }).problems; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('electron-builder\'s folder names say which arch is inside', () => {
  assert.equal(archOfUnpacked('win-unpacked'), 'x64');
  assert.equal(archOfUnpacked('win-arm64-unpacked'), 'arm64');
  assert.equal(archOfUnpacked('mac-arm64'), null);
  assert.equal(archOfUnpacked('win-unpacked.bak'), null);
});

test('a complete bundle passes, on both arches', () => {
  for (const arch of ['x64', 'arm64']) assert.deepEqual(problemsOf(arch), [], arch);
});

test('each missing C++ runtime DLL is a refusal that names the file and the fix', () => {
  for (const arch of ['x64', 'arm64']) for (const name of VC_RUNTIME[arch]) {
    const problems = problemsOf(arch, (files, at) => { files[`${at.ort}/${name}`] = null; });
    assert.ok(problems.some((p) => p.includes(`missing`) && p.includes(name) && /stage-vc-runtime/.test(p)), `${arch} ${name}: ${problems.join(' | ')}`);
  }
});

test('the runtime beside Nami.exe does not count: Windows never looks there for a .node', () => {
  const problems = problemsOf('arm64', (files, at) => {
    for (const name of VC_RUNTIME.arm64) { files[name] = files[`${at.ort}/${name}`]; files[`${at.ort}/${name}`] = null; }
  });
  assert.ok(problems.some((p) => /onnxruntime\.dll needs MSVCP140\.dll in its own folder/i.test(p)), problems.join(' | '));
});

test('an x64 runtime inside an arm64 app is refused, and so is an ARM PC\'s disguised one inside x64', () => {
  const wrong = problemsOf('arm64', (files, at) => { files[`${at.ort}/msvcp140.dll`] = makePe({ machine: X64 }); });
  assert.ok(wrong.some((p) => /msvcp140\.dll is built for x64, not arm64/.test(p)), wrong.join(' | '));
  const disguised = problemsOf('x64', (files, at) => { files[`${at.ort}/vcruntime140_1.dll`] = makePe({ machine: X64, hybrid: true }); });
  assert.ok(disguised.some((p) => /vcruntime140_1\.dll is an ARM64EC hybrid/.test(p)), disguised.join(' | '));
});

test('voice, the terminal and sharp each have to be unpacked, whole', () => {
  const cases = [
    [(f, at) => { f[`${at.ort}/onnxruntime_binding.node`] = null; }, /onnxruntime_binding\.node — voice cannot load/],
    [(f, at) => { f[`${at.ort}/onnxruntime.dll`] = null; }, /onnxruntime\.dll — voice cannot load/],
    [(f, at) => { f[`${at.pty}/conpty.node`] = null; }, /conpty\.node — no terminal pane can start/],
    [(f, at) => { f[`${at.pty}/conpty/OpenConsole.exe`] = null; }, /OpenConsole\.exe — no terminal pane can start/],
    [(f, at) => { f[`${at.pty}/conpty/conpty.dll`] = null; }, /conpty\.dll — no terminal pane can start/],
    [(f, at) => { f[`${at.sharp}/sharp-win32-arm64-0.35.4.node`] = null; }, /sharp-win32-arm64\*\.node — images cannot be resized/],
    [(f, at) => { f[`${at.sharp}/libvips-42.dll`] = null; }, /needs libvips-42\.dll in its own folder/],
    [(f) => { f['Nami.exe'] = null; }, /missing Nami\.exe — there is no app/],
  ];
  for (const [change, expected] of cases) {
    const problems = problemsOf('arm64', change);
    assert.ok(problems.some((p) => expected.test(p)), `${expected}: ${problems.join(' | ')}`);
  }
});

// What the first arm64 build on the ARM VM actually did: the x64 app it also
// produced carried the arm64 node-pty, a terminal that could never start.
test('a native module for the other Windows arch is refused', () => {
  const problems = problemsOf('x64', (files, at) => {
    const pe = makePe({ machine: ARM64 });
    files[`${at.mods}/@lydell/node-pty-win32-arm64/prebuilds/win32-arm64/conpty.node`] = pe;
  });
  assert.ok(problems.some((p) => /node-pty-win32-arm64.*conpty\.node is built for arm64, not x64/.test(p)), problems.join(' | '));
  assert.ok(problems.some((p) => /slice this PC can never load: node_modules\/@lydell\/node-pty-win32-arm64/.test(p)), problems.join(' | '));
});

test('nothing from the Mac or Linux slices rides along, unpacked or inside the asar', () => {
  const unpacked = problemsOf('arm64', (files, at) => {
    const macho = Buffer.alloc(64); macho.writeUInt32LE(0xfeedfacf, 0);
    files[`${at.mods}/@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/pty.node`] = macho;
    files[`${at.mods}/onnxruntime-node/bin/napi-v3/darwin/arm64/libonnxruntime.1.21.0.dylib`] = macho;
    files[`${at.mods}/onnxruntime-node/bin/napi-v3/linux/x64/libonnxruntime.so.1`] = Buffer.from('\x7fELF');
  });
  assert.ok(unpacked.some((p) => /pty\.node is not a Windows binary/.test(p)), unpacked.join(' | '));
  assert.ok(unpacked.some((p) => /\.dylib is a Mac or Linux library/.test(p)));
  assert.ok(unpacked.some((p) => /\.so\.1 is a Mac or Linux library/.test(p)));
  assert.ok(unpacked.some((p) => /never load: node_modules\/@lydell\/node-pty-darwin-arm64$/.test(p)));
  assert.ok(unpacked.some((p) => /never load: onnxruntime-node\/bin\/napi-v3\/darwin\/arm64$/.test(p)));

  const inAsar = problemsOf('arm64', undefined, [
    'node_modules/@img/sharp-libvips-linuxmusl-x64/lib/libvips.so', 'node_modules\\@img\\sharp-darwin-arm64\\package.json',
    'node_modules/@img/sharp-win32-arm64/package.json', 'node_modules/is-windows/index.js', 'src/main/platform.js',
  ]);
  assert.deepEqual(inAsar.sort(), [
    'carries a slice this PC can never load: node_modules/@img/sharp-darwin-arm64',
    'carries a slice this PC can never load: node_modules/@img/sharp-libvips-linuxmusl-x64',
  ]);
});

test('Whisper has to be in resources/models, complete and marked ready', () => {
  const none = problemsOf('arm64', (files, at) => { for (const k of Object.keys(files)) if (k.startsWith('resources/models/')) files[k] = null; });
  assert.ok(none.some((p) => /resources\/models has no complete onnx-community\/whisper-tiny\.en/.test(p)), none.join(' | '));
  const partial = problemsOf('arm64', (files, at) => { files[`resources/models/${at.repo}/onnx/encoder_model_quantized.onnx`] = null; });
  assert.equal(partial.length, 1);
  const unmarked = problemsOf('arm64', (files, at) => { files[`resources/models/${at.repo}/.ready`] = null; });
  assert.equal(unmarked.length, 1);
});

test('an arch nobody wrote rules for is a failure, not a pass', () => {
  assert.deepEqual(checkWinBundle({ dir: os.tmpdir(), arch: 'ia32' }).problems, ['no rules for arch "ia32"']);
});

// scripts/win-pack.mjs: without the filter an arm64 installer installs an app
// with no Nami.exe and no DLLs, and reports success.
test('an arm64 Windows build asks 7-Zip for a filter the installer can undo; nothing else is touched', () => {
  assert.deepEqual(packEnv('darwin', 'arm64', {}), {});
  assert.deepEqual(packEnv('win32', 'x64', {}), {}, 'x64 gets BCJ from 7-Zip without being told');
  assert.deepEqual(packEnv('win32', 'arm64', { ELECTRON_BUILDER_7Z_FILTER: 'ARM' }), { ELECTRON_BUILDER_7Z_FILTER: 'ARM' });
  const env = {};
  assert.deepEqual(packEnv('win32', 'arm64', env), { ELECTRON_BUILDER_7Z_FILTER: 'BCJ' });
  assert.deepEqual(packEnv('win32', 'x64', env), {}, 'and what was set for arm64 does not leak into the next arch');
  assert.deepEqual(packEnv('win32', 'x64', { ELECTRON_BUILDER_7Z_FILTER: 'ARM' }), { ELECTRON_BUILDER_7Z_FILTER: 'ARM' }, 'a value set by hand is never removed');
  const yml = fs.readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
  assert.match(yml, /^beforePack: scripts\/win-pack\.mjs$/m);
});
