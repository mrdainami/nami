// What has to be true of an unpacked Windows app before anyone may download it.
// check-bundle.mjs runs this; it lives apart so that a Mac can test every rule
// against a folder of pretend binaries (tests/check-bundle-win.test.mjs).
//
// Each rule is here because its failure is silent. A Windows app that is
// missing a native module still installs, still opens, and still looks right;
// it has no terminal, or no voice, and the first person to find out is a user
// on a machine that differs from the build machine in exactly the way that
// matters: nothing else has ever been installed on it.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readPe, archProblem } from './pe-info.mjs';
import { VC_RUNTIME } from './stage-vc-runtime.mjs';

const require = createRequire(import.meta.url);
const store = require('../src/main/stt-model.js');

// electron-builder names the folder after the arch, except for x64, which it
// treats as the one that needs no name.
export function archOfUnpacked(name) {
  if (name === 'win-unpacked') return 'x64';
  const m = /^win-(arm64|ia32)-unpacked$/.exec(name);
  return m ? m[1] : null;
}

// A dependency Windows will look for in the importing module's own folder and,
// on a clean PC, nowhere else that has it. Node loads a .node with
// LOAD_WITH_ALTERED_SEARCH_PATH, so "beside Nami.exe" is not searched at all.
const MUST_BE_BESIDE = /^(vcruntime|msvcp|concrt|vccorlib|vcomp|onnxruntime|libvips)[^\\/]*\.dll$/i;

// Native packages are named os-arch. Anything for another OS, or for the other
// Windows arch, is weight at best and at worst the copy that gets loaded.
const SLICE = /(?:^|[\\/])node_modules[\\/](?:@[^\\/]+[\\/])?(?:[^\\/]*-)?(darwin|linux|linuxmusl|freebsd|android|win32)-(x64|arm64|arm|ia32|universal|riscv64|ppc64|s390x)[^\\/]*(?=[\\/]|$)/;
const ORT_SLICE = /onnxruntime-node[\\/]bin[\\/]napi-v3[\\/](darwin|linux|win32)[\\/]([^\\/]+)/;

function foreignSlice(entry, arch) {
  const pkg = SLICE.exec(entry);
  if (pkg && !(pkg[1] === 'win32' && pkg[2] === arch)) return pkg[0].replace(/^[\\/]/, '');
  const ort = ORT_SLICE.exec(entry);
  if (ort && !(ort[1] === 'win32' && ort[2] === arch)) return ort[0];
  return null;
}

function walk(dir, out = []) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

// dir: release/win-arm64-unpacked. asarEntries: every path inside app.asar.
// Returns the lines to print; a bundle is fit to publish when `problems` is empty.
export function checkWinBundle({ dir, arch, exe = 'Nami.exe', asarEntries = [] }) {
  const ok = [], problems = [];
  const resources = path.join(dir, 'resources');
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const modules = path.join(unpacked, 'node_modules');
  const rel = (p) => path.relative(dir, p).split(path.sep).join('/');

  const info = (file) => {
    let bytes;
    try { bytes = fs.readFileSync(file); } catch (_) { return { missing: true }; }
    try { return readPe(bytes); } catch (e) { return { broken: e.message }; }
  };
  // One binary, present and built for this arch.
  const need = (file, why) => {
    const pe = info(file);
    if (pe.missing) { problems.push(`missing ${rel(file)} — ${why}`); return false; }
    const wrong = pe.broken || archProblem(pe, arch);
    if (wrong) { problems.push(`${rel(file)} is ${wrong}`); return false; }
    return true;
  };

  if (!VC_RUNTIME[arch]) return { ok, problems: [`no rules for arch "${arch}"`] };

  need(path.join(dir, exe), 'there is no app');

  // Voice. The binding, the runtime it wraps, and Microsoft's C++ runtime that
  // the runtime in turn needs, all in one folder.
  const ort = path.join(modules, 'onnxruntime-node', 'bin', 'napi-v3', 'win32', arch);
  const voice = [
    need(path.join(ort, 'onnxruntime_binding.node'), 'voice cannot load'),
    need(path.join(ort, 'onnxruntime.dll'), 'voice cannot load'),
    ...VC_RUNTIME[arch].map((name) => need(path.join(ort, name), 'onnxruntime.dll needs it and a clean Windows does not have it; run scripts/stage-vc-runtime.mjs before building')),
  ];
  if (voice.every(Boolean)) ok.push(`onnxruntime and the C++ runtime (${VC_RUNTIME[arch].join(', ')}), all ${arch}`);

  // The terminal. conpty.node starts OpenConsole.exe and loads conpty.dll from
  // the conpty folder beside it, so the .node alone is a pane that never opens.
  const pty = path.join(modules, '@lydell', `node-pty-win32-${arch}`, 'prebuilds', `win32-${arch}`);
  const term = ['conpty.node', 'conpty_console_list.node', path.join('conpty', 'conpty.dll'), path.join('conpty', 'OpenConsole.exe')]
    .map((name) => need(path.join(pty, name), 'no terminal pane can start'));
  if (term.every(Boolean)) ok.push(`node-pty conpty for ${arch}, with OpenConsole`);

  const sharpDir = path.join(modules, '@img', `sharp-win32-${arch}`, 'lib');
  let sharpNode = null;
  try { sharpNode = fs.readdirSync(sharpDir).find((f) => f.startsWith(`sharp-win32-${arch}`) && f.endsWith('.node')) || null; } catch (_) {}
  if (!sharpNode) problems.push(`missing ${rel(sharpDir)}/sharp-win32-${arch}*.node — images cannot be resized`);
  else if (need(path.join(sharpDir, sharpNode), 'images cannot be resized')) ok.push(`sharp for ${arch}`);

  // Everything native that was unpacked, whoever asked for it.
  let natives = 0;
  for (const file of walk(unpacked)) {
    if (/\.(dylib|so)(\.\d+)*$/i.test(file)) { problems.push(`${rel(file)} is a Mac or Linux library`); continue; }
    if (!/\.(node|dll|exe)$/i.test(file)) continue;
    natives++;
    const pe = info(file);
    const wrong = pe.broken || archProblem(pe, arch);
    if (wrong) { problems.push(`${rel(file)} is ${wrong}`); continue; }
    const beside = new Set(fs.readdirSync(path.dirname(file)).map((n) => n.toLowerCase()));
    for (const dep of pe.imports.filter((n) => MUST_BE_BESIDE.test(n) && !beside.has(n.toLowerCase()))) {
      problems.push(`${rel(file)} needs ${dep} in its own folder and it is not there`);
    }
  }
  if (natives) ok.push(`${natives} unpacked binaries, every one ${arch} with its DLLs beside it`);

  const foreign = new Set();
  for (const entry of [...asarEntries, ...walk(unpacked).map((f) => path.relative(unpacked, f))]) {
    const hit = foreignSlice(entry, arch);
    if (hit) foreign.add(hit.split(/[\\/]/).join('/'));
  }
  for (const hit of foreign) problems.push(`carries a slice this PC can never load: ${hit}`);
  if (!foreign.size) ok.push('no Mac, Linux or other-arch slices');

  // The weights a fresh install dictates with before it has ever seen a network.
  const bundled = store.MODELS.filter((m) => m.bundled);
  const unready = bundled.filter((m) => !store.isReady({ dir: path.join(resources, 'models'), repo: m.repo }));
  for (const m of unready) problems.push(`resources/models has no complete ${m.repo} — run \`npm run fetch-model\` before building`);
  if (!unready.length) ok.push(`Whisper weights: ${bundled.map((m) => m.repo).join(', ')}`);

  return { ok, problems };
}
