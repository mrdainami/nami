// What a program the scan found really is.
//
// On Windows an agent installed by npm is a .cmd shim, and whatever is handed
// to a shim is read by cmd.exe as a command (cmd-shim.js). This opens the shim
// and, when it is unmistakably npm's "find node, run this one script", answers
// with node.exe and the script instead (or with the .exe itself, for a package
// like opencode's whose `bin` is one) — so the pane, the run tile's line and
// `claude mcp add-json` all start a real program, and the first message and the
// session's name travel exactly as they do on a Mac. Everything downstream asks
// its questions of the answer: reachesCmd says no to node.exe by itself, and
// nothing else has to know that a shim was ever involved.
//
// Whatever cannot be read that way is handed back as it came, still a shim,
// and keeps the held message and the reduced name. A real .exe, and every
// program on a Mac, comes back without the disk being touched.
//
// cmd-shim.js reads the text and platform.js says where node might be; this is
// the half that does the looking. The shim's text is kept by its path and the
// time it was written, because a tile is opened far more often than npm
// rewrites a shim. The files it points at are looked for every time: they are
// what an uninstall or a node upgrade moves.

const fs = require('fs');
const { shimTarget } = require('./cmd-shim');
const { nodeCandidates } = require('./platform');

const WIN = 'win32';
// npm's are under 400 bytes. One this long was written by somebody else.
const LONGEST_SHIM = 4096;
const texts = new Map();

function forgetShims() { texts.clear(); }

function shimText(file, disk) {
  try {
    const st = disk.statSync(file);
    if (!st.isFile() || st.size > LONGEST_SHIM) return '';
    const kept = texts.get(file);
    if (kept && kept.mtimeMs === st.mtimeMs && kept.size === st.size) return kept.text;
    const text = String(disk.readFileSync(file, 'utf8'));
    texts.set(file, { mtimeMs: st.mtimeMs, size: st.size, text });
    return text;
  } catch (_) { return ''; }
}

// { file, args }: start `file` with `args` ahead of the program's own.
function realProgram(program, { platform = process.platform, env = process.env, pathValue, fs: disk = fs } = {}) {
  const same = { file: program, args: [] };
  if (platform !== WIN || !/\.cmd$/i.test(String(program || ''))) return same;
  const text = shimText(program, disk);
  if (!text) return same;
  const exists = (p) => { try { return disk.statSync(p).isFile(); } catch (_) { return false; } };
  const node = nodeCandidates({ env, pathValue, platform }).find(exists) || '';
  return shimTarget(text, program, { exists, node }) || same;
}

module.exports = { realProgram, forgetShims };
