import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseManifest, bundleSlug } = require('../src/main/mcpb');

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
    // Python's standard zip writer lets the fixture describe hostile entries
    // without ever extracting them with a system utility.
    const zip = async (kind, name = 'fixture') => {
      const file = path.join(root, kind + '.zip');
      const pyBin = process.platform === 'win32' ? 'python' : '/usr/bin/python3';
      execFileSync(pyBin, ['-c', `
import zipfile,json,sys
file,kind,name=sys.argv[1:]
with zipfile.ZipFile(file,'w') as z:
 z.writestr('manifest.json',json.dumps({'name':name,'server':{'mcp_config':{'command':'node'}}}))
 if kind=='escape': z.writestr('../outside.txt','bad')
 elif kind=='absolute': z.writestr('/outside.txt','bad')
 elif kind=='link':
  i=zipfile.ZipInfo('link'); i.create_system=3; i.external_attr=0o120777<<16; z.writestr(i,'../')
 elif kind=='large': z.writestr('large.txt','a'*1024)
 else: z.writestr('server/index.js','// fixture')
`, file, kind, name], { timeout: 5000 });
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
