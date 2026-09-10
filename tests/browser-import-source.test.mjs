import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const profiles = require('../src/main/browser-profiles');

test('detected import sources retain opaque IDs when Chrome reorders or renames its profiles', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-source-id-'));
  try {
    const root = path.join(home, 'Library/Application Support/Google/Chrome');
    for (const name of ['Default', 'Profile 1']) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(path.join(root, name, 'Cookies'), 'fixture');
    }
    const state = path.join(root, 'Local State');
    fs.writeFileSync(state, JSON.stringify({ profile: { info_cache: { Default: { name: 'Personal' }, 'Profile 1': { name: 'Work' } } } }));
    const first = profiles.detectChromiumProfiles({ home, platform: 'darwin' });
    assert.match(first[0].id || '', /^[a-f0-9]{64}$/, 'source ID is opaque, not its position or a path');
    assert.notEqual(first[0].id, first[1].id);
    fs.writeFileSync(state, JSON.stringify({ profile: { info_cache: { 'Profile 1': { name: 'Work renamed' }, Default: { name: 'Personal' } } } }));
    const second = profiles.detectChromiumProfiles({ home, platform: 'darwin' });
    assert.equal(second[0].id, first[1].id);
    assert.equal(second[1].id, first[0].id);
    const status = profiles.cookieImportStatus({ home, platform: 'darwin' });
    assert.equal(status.browsers[0].id, first[1].id);
    assert.equal(JSON.stringify(status).includes(home), false, 'UI metadata does not include source paths');
    fs.rmSync(path.join(root, 'Profile 1'), { recursive: true });
    const remaining = profiles.detectChromiumProfiles({ home, platform: 'darwin' });
    assert.throws(() => profiles.selectChromiumImportSource(remaining, first[1].id), /no longer available/i);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('source resolution requires the selected ID and never substitutes a numeric index', () => {
  const sources = [{ id: 'work', browser: 'Chrome' }, { id: 'personal', browser: 'Chrome' }];
  assert.equal(profiles.selectChromiumImportSource(sources, 'work'), sources[0]);
  assert.equal(profiles.selectChromiumImportSource([...sources].reverse(), 'work'), sources[0]);
  for (const id of [undefined, null, '', 0, 1, {}, '/arbitrary/profile']) {
    assert.throws(() => profiles.selectChromiumImportSource(sources, id), /source|profile/i);
  }
  assert.throws(() => profiles.selectChromiumImportSource([], 'work'), /no longer available/i);
});
