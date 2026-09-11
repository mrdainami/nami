const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// API and service keys must never be written with the process's usual 0644
// permissions. Follow deliberate config symlinks, then replace the target
// atomically using an exclusively created, owner-only temporary file.
function writePrivateConfig(file, text) {
  try { file = fs.realpathSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomBytes(12).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
module.exports = { writePrivateConfig };
