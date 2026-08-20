// File verbs for the Workspace tree. Guarded: every path must resolve inside
// the open project root. IO is injectable so tests never touch the disk.
const fs = require('fs');
const path = require('path');

const fsOps = {
  exists: (p) => fs.existsSync(p),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  writeFile: (p) => fs.writeFileSync(p, '', { flag: 'wx' }),
  rename: (a, b) => fs.renameSync(a, b),
  // Async, unlike its siblings, and deliberately: every other verb here touches
  // one entry, but a copy can be a folder someone dragged in from Finder. A
  // synchronous recursive copy of a few hundred megabytes freezes the main
  // process, which in Nami means every session's pty stops being read.
  cp: (a, b) => fs.promises.cp(a, b, { recursive: true, errorOnExist: true, force: false }),
};

function inside(root, p) {
  if (!root) return null;
  const r = path.resolve(root), abs = path.resolve(String(p || ''));
  return abs === r || abs.startsWith(r + path.sep) ? abs : null;
}
function badName(name) { return !name || String(name).includes('/') || String(name).includes('\\'); }

// Is `child` the same path as `parent`, or under it? The separator matters:
// a plain startsWith would call /proj/srcXtra a child of /proj/src and refuse a
// legitimate move between siblings.
function isDescendant(parent, child) {
  const a = path.resolve(String(parent || '')), b = path.resolve(String(child || ''));
  return b === a || b.startsWith(a + path.sep);
}

// The first free name beside an existing one: shot.png → shot-copy.png →
// shot-copy-1.png. Dotfiles keep their leading dot out of the split, so .env
// becomes .env-copy rather than -copy.env.
function freeName(dir, base, exists) {
  if (!exists(path.join(dir, base))) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let name = stem + '-copy' + ext;
  let n = 0;
  while (exists(path.join(dir, name))) { n += 1; name = stem + '-copy-' + n + ext; }
  return name;
}

function newFile({ root, dir, name, ops = fsOps }) {
  const d = inside(root, dir);
  if (!d || badName(name)) return { ok: false, error: 'Bad target' };
  const p = path.join(d, name);
  if (ops.exists(p)) return { ok: false, error: 'Already exists: ' + name };
  try { ops.writeFile(p); return { ok: true, path: p }; } catch (e) { return { ok: false, error: e.message }; }
}
function newFolder({ root, dir, name, ops = fsOps }) {
  const d = inside(root, dir);
  if (!d || badName(name)) return { ok: false, error: 'Bad target' };
  const p = path.join(d, name);
  if (ops.exists(p)) return { ok: false, error: 'Already exists: ' + name };
  try { ops.mkdir(p); return { ok: true, path: p }; } catch (e) { return { ok: false, error: e.message }; }
}
function movePath({ root, src, destDir, ops = fsOps }) {
  const s = inside(root, src), d = inside(root, destDir);
  if (!s || !d) return { ok: false, error: 'Move stays inside the open folder' };
  const dest = path.join(d, path.basename(s));
  if (dest === s) return { ok: true, path: s };
  // Dropped on itself: nowhere to go, and Finder says nothing here rather than
  // scolding you for a gesture that clearly meant nothing.
  if (d === s) return { ok: true, path: s };
  // Dropped somewhere below itself: the user aimed at a real folder, so this one
  // earns an explanation. The renderer refuses it too — cosmetically, so the drop
  // cursor never appears — but the guard that counts is here.
  if (isDescendant(s, d)) return { ok: false, error: 'A folder cannot move inside itself' };
  if (ops.exists(dest)) return { ok: false, error: 'Something with that name is already there' };
  try { ops.rename(s, dest); return { ok: true, path: dest }; } catch (e) { return { ok: false, error: e.message }; }
}

// Rename in place. Same guards as its siblings, plus one of its own: the root
// is the folder the window has open, and renaming it would move the project out
// from under every running session.
function renamePath({ root, src, name, ops = fsOps }) {
  const s = inside(root, src);
  if (!s || badName(name)) return { ok: false, error: 'Bad name' };
  if (s === path.resolve(root)) return { ok: false, error: 'That is the open folder — rename it in Finder' };
  const dest = path.join(path.dirname(s), String(name));
  if (dest === s) return { ok: true, path: s };
  if (ops.exists(dest)) return { ok: false, error: 'Already exists: ' + name };
  try { ops.rename(s, dest); return { ok: true, path: dest }; } catch (e) { return { ok: false, error: e.message }; }
}

// Files dragged in from Finder. Copies, never moves — the source is outside the
// project and moving someone's file off their Desktop is not ours to do. The
// destination is guarded; the sources deliberately are not, since being outside
// the root is the entire point.
async function importPaths({ root, destDir, srcPaths, ops = fsOps }) {
  const d = inside(root, destDir);
  if (!d) return { ok: false, error: 'Drop lands inside the open folder' };
  const list = (srcPaths || []).filter((p) => typeof p === 'string' && p);
  if (!list.length) return { ok: false, error: 'Nothing to import' };
  const taken = new Set();
  const exists = (p) => taken.has(p) || ops.exists(p);
  const out = [];
  try {
    for (const src of list) {
      const name = freeName(d, path.basename(src), exists);
      const dest = path.join(d, name);
      taken.add(dest);
      await ops.cp(src, dest);
      out.push(dest);
    }
  } catch (e) { return { ok: false, error: e.message, paths: out }; }
  return { ok: true, paths: out };
}

// A copy beside the original. Recursive, so duplicating a folder brings its
// contents — which is what the word means everywhere else.
async function duplicatePath({ root, src, ops = fsOps }) {
  const s = inside(root, src);
  if (!s) return { ok: false, error: 'Not inside the open folder' };
  if (s === path.resolve(root)) return { ok: false, error: 'Cannot duplicate the open folder' };
  const dir = path.dirname(s);
  const dest = path.join(dir, freeName(dir, path.basename(s), ops.exists));
  try { await ops.cp(s, dest); return { ok: true, path: dest }; }
  catch (e) { return { ok: false, error: e.message }; }
}
async function trashPath({ root, path: target, trashFn, ops = fsOps }) {
  const abs = inside(root, target);
  if (!abs || abs === path.resolve(root)) return { ok: false, error: 'Not inside the open folder' };
  if (!ops.exists(abs)) return { ok: false, error: 'Already gone' };
  try { await trashFn(abs); return { ok: true, path: abs }; } catch (e) { return { ok: false, error: e.message }; }
}
module.exports = {
  newFile, newFolder, movePath, trashPath,
  renamePath, importPaths, duplicatePath, isDescendant,
};
