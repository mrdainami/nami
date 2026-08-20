// The Workspace tree's filesystem view. Dirent deliberately describes the
// directory entry itself, so a symlink reports as a link even when its target
// is a folder. For navigation, the target's kind is what matters: a live link
// to a directory should sort, count, and expand exactly like a directory.
const fs = require('fs');
const path = require('path');

const IGNORE = new Set(['node_modules', '.git', '.DS_Store', 'dist', 'build', '.next', '.cache']);

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function targetIsDirectory(dir, entry) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try { return fs.statSync(path.join(dir, entry.name)).isDirectory(); }
  catch (_) { return false; }
}

function visibleEntries(dir, all) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => all ? entry.name !== '.DS_Store'
      : !IGNORE.has(entry.name) && !(entry.name.startsWith('.') && entry.name !== '.claude'))
    .map((entry) => ({ entry, isDirectory: targetIsDirectory(dir, entry) }))
    .sort((a, b) => (b.isDirectory - a.isDirectory) || a.entry.name.localeCompare(b.entry.name));
}

function metadata(full, isDirectory) {
  if (isDirectory) {
    let count = 0;
    try { count = fs.readdirSync(full).length; } catch (_) {}
    return count + (count === 1 ? ' item' : ' items');
  }
  try { return fmtSize(fs.statSync(full).size); } catch (_) { return ''; }
}

function readTree(dir, depth, maxDepth) {
  const rows = [];
  let entries;
  try { entries = visibleEntries(dir, false).slice(0, 40); }
  catch (_) { return rows; }

  for (const { entry, isDirectory } of entries) {
    const full = path.join(dir, entry.name);
    rows.push({
      name: entry.name,
      kind: isDirectory ? 'dir' : 'file',
      pad: depth,
      meta: metadata(full, isDirectory),
    });
    if (isDirectory && depth < maxDepth - 1) {
      rows.push(...readTree(full, depth + 1, maxDepth));
    }
  }
  return rows;
}

function listDirectory(dir, all = false) {
  try {
    return visibleEntries(dir, all).map(({ entry, isDirectory }) => {
      const full = path.join(dir, entry.name);
      return {
        name: entry.name,
        path: full,
        kind: isDirectory ? 'dir' : 'file',
        meta: metadata(full, isDirectory),
      };
    });
  } catch (_) { return null; }
}

module.exports = { IGNORE, fmtSize, listDirectory, readTree };
