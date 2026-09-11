// Bundles contain executable third-party code. Installing one is deliberate;
// writing outside its directory or replacing another directory is never implied.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const yauzl = require('yauzl');
const { parseManifest, bundleSlug } = require('./mcpb');

async function extract(file, dir, { maxBytes = 512 * 1024 * 1024, maxEntries = 20000, timeout = 30000 } = {}) {
  if ((await fsp.stat(file)).size > maxBytes) throw Error('Bundle is too large');
  const zip = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, strictFileNames: true }, (e, z) => e ? reject(e) : resolve(z)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const names = new Set();
  let total = 0, count = 0;
  try {
    await new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => { zip.close(); reject(Error('Bundle extraction timed out')); }, { once: true });
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', entry => {
        (async () => {
          const name = entry.fileName;
          const destination = path.resolve(dir, name);
          const relative = path.relative(dir, destination);
          const type = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || name.includes('\\') || name.split('/').includes('..')) throw Error('Bundle contains an unsafe path');
          if (type && type !== 0x8000 && type !== 0x4000) throw Error('Bundle links and special files are not supported');
          if (entry.isEncrypted()) throw Error('Encrypted bundles are not supported');
          const key = relative.normalize('NFC').toLowerCase();
          if (names.has(key)) throw Error('Bundle contains duplicate paths');
          names.add(key);
          if (++count > maxEntries || entry.uncompressedSize > maxBytes - total) throw Error('Bundle exceeds extraction limits');
          if (name.endsWith('/')) { await fsp.mkdir(destination, { recursive: true, mode: 0o700 }); }
          else {
            await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
            const stream = await new Promise((done, fail) => zip.openReadStream(entry, (e, s) => e ? fail(e) : done(s)));
            const budget = new Transform({ transform(chunk, _encoding, callback) {
              total += chunk.length;
              callback(total > maxBytes ? Error('Bundle exceeds extraction limits') : null, chunk);
            } });
            const mode = (entry.externalFileAttributes >>> 16) & 0o111 ? 0o700 : 0o600;
            await pipeline(stream, budget, fs.createWriteStream(destination, { flags: 'wx', mode }), { signal: controller.signal });
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally { clearTimeout(timer); zip.close(); }
}

async function installBundle(file, parent, limits) {
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  parent = await fsp.realpath(parent);
  const tmp = await fsp.mkdtemp(path.join(parent, '.unpacking-'));
  let backup;
  try {
    await extract(file, tmp, limits);
    const manifestFile = path.join(tmp, 'manifest.json');
    if ((await fsp.stat(manifestFile)).size > 1024 * 1024) throw Error('Bundle manifest is too large');
    const parsed = parseManifest(await fsp.readFile(manifestFile, 'utf8'));
    if (!parsed.ok) throw Error(parsed.error);
    const dir = path.join(parent, bundleSlug(parsed.manifest));
    if (path.dirname(dir) !== parent) throw Error('Invalid bundle destination');
    // Keep an existing working installation until extraction and validation
    // finish. A failed swap restores it, instead of deleting it first.
    try {
      await fsp.lstat(dir);
      backup = tmp + '-previous';
      await fsp.rename(dir, backup);
    } catch (e) { if (e.code !== 'ENOENT') throw e; backup = null; }
    try {
      await fsp.rename(tmp, dir);
    } catch (e) { if (backup) { await fsp.rename(backup, dir); backup = null; } throw e; }
    if (backup) { await fsp.rm(backup, { recursive: true, force: true }); backup = null; }
    return { dir, manifest: parsed.manifest };
  } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
}
module.exports = { installBundle };
