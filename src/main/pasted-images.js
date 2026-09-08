const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
function storePng(directory, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 8).equals(PNG)) throw new Error('Expected a PNG image under 20 MB');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, createHash('sha256').update(bytes).digest('hex') + '.png');
  try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  return file;
}
module.exports = { storePng };
