const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { ownerOnly } = require('./owner-only');
const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
function storePng(directory, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 8).equals(PNG)) throw new Error('Expected a PNG image under 20 MB');
  // Windows has no 0o700. Screenshots are not keys and are saved far too often
  // to run icacls for each, so the folder is closed once, when it is made, and
  // every image written into it afterwards inherits that (see owner-only.js).
  const made = fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (made) ownerOnly(made, { directory: true });
  const file = path.join(directory, createHash('sha256').update(bytes).digest('hex') + '.png');
  try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  return file;
}
module.exports = { storePng };
