// Collects Microsoft's C++ runtime DLLs into build/vc-runtime/<arch>, where
// electron-builder picks them up (see `win.extraFiles` in electron-builder.yml).
//
// Voice is why. onnxruntime.dll is built with Visual C++ and asks Windows for
// its runtime, and a PC that has never had a C++ program installed does not
// have one. Electron links its own copy statically, so nothing else in Nami had
// ever needed these. On a clean Windows 11 the first dictation failed with
// "The specified module could not be found" and a path to a file that was
// plainly there: the missing module was one of these, two steps down.
//
// Microsoft allows exactly this. The files in a Visual Studio redist folder are
// on its redistributable list and may be installed "app-local", beside the
// binary that needs them, instead of making the user run vc_redist.
//
// They are never downloaded. A DLL fetched by name from the internet and then
// shipped inside a signed installer is how a supply chain gets poisoned; the
// only copies taken are ones Microsoft's own installers put on this machine,
// and each is read (scripts/pe-info.mjs) before it is believed.
//
//   node scripts/stage-vc-runtime.mjs            the arch Node itself runs as
//   node scripts/stage-vc-runtime.mjs x64 arm64  named arches
//
// With no argument it takes Node's own arch for the same reason dist:win builds
// one arch per machine: npm has only installed the node-pty and sharp binaries
// that match it, so that is the only installer this machine can build anyway.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPe, archProblem } from './pe-info.mjs';

// What onnxruntime asks for, read out of its import table rather than assumed
// (onnxruntime-node 1.21, both DLLs in bin/napi-v3/win32/<arch>):
//   x64    MSVCP140, MSVCP140_1, VCRUNTIME140, VCRUNTIME140_1
//   arm64  MSVCP140, MSVCP140_1, VCRUNTIME140
// vcruntime140_1 is not in the arm64 list because arm64 code never asks for it:
// it holds an exception handler that only x64 keeps in a separate DLL, and the
// copy in an ARM PC's System32 is an x64 one. check-bundle re-reads the imports
// of what was actually built, so a future onnxruntime that wants one more DLL
// fails there and not on a user.
export const VC_RUNTIME = {
  x64: ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll'],
  arm64: ['vcruntime140.dll', 'msvcp140.dll', 'msvcp140_1.dll'],
};

// These paths are Windows paths wherever the code runs, which is what lets the
// tests walk a pretend Program Files from a Mac.
const win = path.win32;

const diskIo = {
  list: (dir) => { try { return fs.readdirSync(dir); } catch (_) { return []; } },
  read: (file) => { try { return fs.readFileSync(file); } catch (_) { return null; } },
};

// 14.44.35112 sorts after 14.9.1 only if the parts are compared as numbers.
function newestFirst(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] || 0) - (x[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Where to look, best first.
//
// A Visual Studio redist folder is the source Microsoft documents, and GitHub's
// Windows runners have one (Enterprise 2022 on both windows-latest and
// windows-11-arm). Only <version>\<arch>\Microsoft.VC*.CRT is taken: the
// sibling debug_nonredist folder holds DLLs the licence forbids shipping, and
// onecore is for a different Windows.
//
// System32 is the fallback, for a PC with the redistributable installed and no
// Visual Studio. It only ever holds the machine's own arch, and on an ARM PC
// not even that for x64 — which is for the header check to find out, not for
// this list to guess.
export function sourceFolders({ arch, env = process.env, io = diskIo } = {}) {
  const out = [];
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  for (const root of [...new Set(roots)]) {
    const vs = win.join(root, 'Microsoft Visual Studio');
    for (const year of io.list(vs).sort().reverse()) {
      for (const edition of io.list(win.join(vs, year)).sort()) {
        const msvc = win.join(vs, year, edition, 'VC', 'Redist', 'MSVC');
        for (const version of io.list(msvc).filter((v) => /^\d+(\.\d+)+$/.test(v)).sort(newestFirst)) {
          for (const crt of io.list(win.join(msvc, version, arch)).filter((d) => /^Microsoft\.VC\d+\.CRT$/i.test(d))) {
            out.push(win.join(msvc, version, arch, crt));
          }
        }
      }
    }
  }
  const system = env.SystemRoot || env.windir;
  if (system) out.push(win.join(system, 'System32'));
  return out;
}

// The first folder that has every DLL, each one really built for `arch`. A
// folder is taken whole or not at all: the runtime is versioned as a set, and a
// vcruntime from one release beside an msvcp from another is its own bug.
export function chooseSource({ arch, folders, io = diskIo }) {
  const wanted = VC_RUNTIME[arch];
  if (!wanted) throw new Error(`No C++ runtime list for arch "${arch}". Known: ${Object.keys(VC_RUNTIME).join(', ')}.`);
  const rejected = [];
  for (const folder of folders) {
    const have = new Map(io.list(folder).map((name) => [name.toLowerCase(), name]));
    const files = [];
    let reason = null;
    for (const name of wanted) {
      const actual = have.get(name);
      const bytes = actual ? io.read(win.join(folder, actual)) : null;
      if (!bytes) { reason = `${name} is not there`; break; }
      let problem;
      try { problem = archProblem(readPe(bytes), arch); } catch (e) { problem = e.message; }
      if (problem) { reason = `${name} is ${problem}`; break; }
      files.push({ name, from: win.join(folder, actual), bytes });
    }
    if (!reason) return { folder, files, rejected };
    rejected.push({ folder, reason });
  }
  return { folder: null, files: [], rejected };
}

export function explainFailure(arch, rejected) {
  const lines = [`No Microsoft C++ runtime for ${arch} was found on this machine, and a build without one ships without voice.`];
  if (rejected.length) lines.push('Looked in:', ...rejected.map((r) => `  ${r.folder}\n    ${r.reason}`));
  else lines.push('There was nowhere to look: no Visual Studio folder and no SystemRoot. This has to run on Windows.');
  lines.push(
    `Fix: build on Windows for ${arch}, with Visual Studio's C++ tools or the`,
    '"Microsoft Visual C++ 2015-2022 Redistributable" installed. Do not download the DLLs by hand.',
  );
  return lines.join('\n');
}

export function stage({ arch, root, env = process.env, io = diskIo, write = writeOut } = {}) {
  const picked = chooseSource({ arch, folders: sourceFolders({ arch, env, io }), io });
  if (!picked.folder) throw new Error(explainFailure(arch, picked.rejected));
  const dest = path.join(root, 'build', 'vc-runtime', arch);
  write(dest, picked.files);
  return { dest, ...picked };
}

// Emptied first, so a DLL dropped from the list stops shipping the same day.
function writeOut(dest, files) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dest, f.name), f.bytes);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const arches = process.argv.slice(2).map((a) => a.replace(/^--/, ''));
  try {
    for (const arch of arches.length ? arches : [process.arch]) {
      const done = stage({ arch, root });
      console.log(`C++ runtime for ${arch}: ${done.files.map((f) => f.name).join(', ')}`);
      console.log(`  from ${done.folder}`);
      console.log(`  to   ${path.relative(root, done.dest)}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
