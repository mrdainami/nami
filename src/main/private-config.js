const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { ownerOnly } = require('./owner-only');

// API and service keys must never be written with the process's usual 0644
// permissions. Follow deliberate config symlinks, then replace the target
// atomically using an exclusively created, owner-only temporary file.
//
// Windows has no mode to ask for, so there the temporary file is made empty,
// closed to everyone else with icacls (see owner-only.js), and only then given
// the text: the key is never on disk under the folder's permissions, not even
// for the moment before the rename. It has to be the temporary file that is
// tightened, on every save. A rename over an existing file keeps the
// permissions of the file that arrives, not of the one it replaces, so a target
// tightened last time would quietly go back to whatever the folder allows.
// That is two short programs run synchronously, about 40 ms a save on an idle
// PC and far more on a busy one — these are settings and connector saves made
// by hand, never a loop.
//
// Answers whether the file ended up owner-only. It is false on a volume that
// cannot hold permissions at all (FAT, some shared folders), and the save still
// lands: the same file a Mac would have written to the same place.
function writePrivateConfig(file, text, options = {}) {
  const platform = options.platform || process.platform;
  try { file = fs.realpathSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const made = fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (made) ownerOnly(made, { ...options, directory: true });
  const tmp = file + '.' + randomBytes(12).toString('hex') + '.tmp';
  let kept = true;
  try {
    if (platform === 'win32') {
      // Held open from the moment it is made, and written through that handle:
      // opened again by name, the key would go to whatever was at that name by
      // then, which need not be the file icacls has just closed.
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try {
        kept = ownerOnly(tmp, { ...options, directory: false });
        fs.writeFileSync(fd, text);
      } finally { fs.closeSync(fd); }
    } else fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return kept;
}
module.exports = { writePrivateConfig };
