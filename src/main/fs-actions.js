// File verbs for the Workspace tree. Guarded: every path must resolve inside
// the open project root. IO is injectable so tests never touch the disk.
const fs = require('fs');
const path = require('path');

const fsOps = {
  exists: (p) => fs.existsSync(p),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  writeFile: (p) => fs.writeFileSync(p, '', { flag: 'wx' }),
  rename: (a, b) => fs.renameSync(a, b),
};

function inside(root, p) {
  if (!root) return null;
  const r = path.resolve(root), abs = path.resolve(String(p || ''));
  return abs === r || abs.startsWith(r + path.sep) ? abs : null;
}
function badName(name) { return !name || String(name).includes('/') || String(name).includes('\\'); }

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
  if (ops.exists(dest)) return { ok: false, error: 'Something with that name is already there' };
  try { ops.rename(s, dest); return { ok: true, path: dest }; } catch (e) { return { ok: false, error: e.message }; }
}
async function trashPath({ root, path: target, trashFn, ops = fsOps }) {
  const abs = inside(root, target);
  if (!abs || abs === path.resolve(root)) return { ok: false, error: 'Not inside the open folder' };
  if (!ops.exists(abs)) return { ok: false, error: 'Already gone' };
  try { await trashFn(abs); return { ok: true, path: abs }; } catch (e) { return { ok: false, error: e.message }; }
}
module.exports = { newFile, newFolder, movePath, trashPath };
