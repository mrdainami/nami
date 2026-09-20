import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseManifest, bundleSlug } = require('../src/main/mcpb');

// A minimal zip: every entry stored uncompressed, marked as made on Unix so the
// mode bits (a symlink is 0o120777) mean what an extractor takes them to mean.
function storedZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [entryName, text, mode = 0o600] of entries) {
    const name = Buffer.from(entryName), data = Buffer.from(text);
    // shared by both headers: version needed, flags, method, time, date, crc, sizes, name/extra length
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0); shared.writeUInt16LE(0x21, 8);
    shared.writeUInt32LE(zlib.crc32(data), 10);
    shared.writeUInt32LE(data.length, 14); shared.writeUInt32LE(data.length, 18);
    shared.writeUInt16LE(name.length, 22);
    const local = Buffer.alloc(4); local.writeUInt32LE(0x04034b50);
    const head = Buffer.alloc(6); head.writeUInt32LE(0x02014b50); head.writeUInt16LE((3 << 8) | 20, 4);
    const rest = Buffer.alloc(14); // comment length, disk, internal attrs, then:
    rest.writeUInt32LE((mode * 0x10000) >>> 0, 6); rest.writeUInt32LE(offset, 10);
    locals.push(local, shared, name, data);
    central.push(head, shared, rest, name);
    offset += 4 + 26 + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('bundle names cannot select the install root or its parent', () => {
  for (const name of ['.', '..', '...', '/', ' ', '---']) {
    assert.equal(parseManifest(JSON.stringify({ name, server: { mcp_config: { command: 'node' } } })).ok, false, name);
    assert.throws(() => bundleSlug({ name }));
  }
});

test('bundle extraction rejects escaping paths, symlinks and oversized data without replacing a working installation', async () => {
  const { installBundle } = require('../src/main/bundle-install');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nami-bundle-fixture-'));
  const bundles = path.join(root, 'bundles');
  try {
    // The fixture writes its own zips, byte by byte, so it can describe hostile
    // entries no well-behaved zip library would agree to — and so it needs
    // nothing but node, which is all a Windows machine is sure to have. Nothing
    // here is ever extracted by a system utility.
    const zip = async (kind, name = 'fixture') => {
      const file = path.join(root, kind + '.zip');
      const entries = [['manifest.json', JSON.stringify({ name, server: { mcp_config: { command: 'node' } } })]];
      if (kind === 'escape') entries.push(['../outside.txt', 'bad']);
      else if (kind === 'absolute') entries.push(['/outside.txt', 'bad']);
      else if (kind === 'link') entries.push(['link', '../', 0o120777]);
      else if (kind === 'large') entries.push(['large.txt', 'a'.repeat(1024)]);
      else entries.push(['server/index.js', '// fixture']);
      await fs.writeFile(file, storedZip(entries));
      return file;
    };
    const good = await installBundle(await zip('valid'), bundles);
    assert.equal(await fs.readFile(path.join(good.dir, 'server/index.js'), 'utf8'), '// fixture');
    await fs.writeFile(path.join(good.dir, 'keep.txt'), 'working install');
    for (const kind of ['escape', 'absolute', 'link', 'large', 'invalid-name']) {
      await assert.rejects(installBundle(await zip(kind, kind === 'invalid-name' ? '..' : 'fixture'), bundles, { maxBytes: 512 }));
      assert.equal(await fs.readFile(path.join(good.dir, 'keep.txt'), 'utf8'), 'working install');
      assert.deepEqual(await fs.readdir(bundles), ['fixture']);
    }
    await assert.rejects(fs.access(path.join(root, 'outside.txt')));
    await installBundle(await zip('replacement'), bundles);
    await assert.rejects(fs.access(path.join(good.dir, 'keep.txt')));
    assert.deepEqual(await fs.readdir(bundles), ['fixture']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
