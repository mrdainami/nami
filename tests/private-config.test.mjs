import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { upsertMcpJson } = require('../src/main/mcp-config');
const { upsertMaster } = require('../src/main/connections');
const { writeSettings } = require('../src/main/settings');
test('configuration saves keep fake keys owner-only and preserve linked configurations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-private-config-'));
  try {
    const file = path.join(root, 'agent.json'), target = path.join(root, 'linked.json');
    fs.writeFileSync(target, JSON.stringify({ keep: true }), { mode: 0o644 });
    fs.symlinkSync(target, file);
    upsertMcpJson({ file, id: 'fixture', entry: { env: { FIXTURE_KEY: 'not-a-real-key' } } });
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
    assert.equal(JSON.parse(fs.readFileSync(target)).keep, true);
    const master = upsertMaster({ scope: 'user', homeDir: root, id: 'fixture', entry: { command: 'node' } });
    assert.equal(master.ok, true);
    assert.equal(fs.statSync(master.file).mode & 0o777, 0o600);
    const settings = path.join(root, 'settings.json');
    assert.equal(writeSettings({ file: settings, patch: { theme: 'paper' } }).ok, true);
    fs.chmodSync(settings, 0o644);
    assert.equal(writeSettings({ file: settings, patch: { sttProvider: 'local' } }).ok, true);
    assert.equal(fs.statSync(settings).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(settings)).theme, 'paper');
    assert.deepEqual(fs.readdirSync(root).sort(), ['.nami', 'agent.json', 'linked.json', 'settings.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
