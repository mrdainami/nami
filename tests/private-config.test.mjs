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
// Owner-only is a POSIX mode, and Windows has no such bits to read back (stat
// reports 0o666 whatever was asked for); a file symlink there needs admin rights
// or Developer Mode. The save itself is covered for every OS by the test below.
const POSIX_ONLY = process.platform === 'win32' && 'Windows has no 0o600 to check, and file symlinks need admin rights';
test('configuration saves keep fake keys owner-only and preserve linked configurations', { skip: POSIX_ONLY }, () => {
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
test('configuration saves merge into what is there and leave no temporary file behind', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-private-config-'));
  try {
    const file = path.join(root, 'agent.json');
    fs.writeFileSync(file, JSON.stringify({ keep: true }));
    upsertMcpJson({ file, id: 'fixture', entry: { env: { FIXTURE_KEY: 'not-a-real-key' } } });
    assert.equal(JSON.parse(fs.readFileSync(file)).keep, true);
    assert.equal(upsertMaster({ scope: 'user', homeDir: root, id: 'fixture', entry: { command: 'node' } }).ok, true);
    const settings = path.join(root, 'settings.json');
    assert.equal(writeSettings({ file: settings, patch: { theme: 'paper' } }).ok, true);
    assert.equal(writeSettings({ file: settings, patch: { sttProvider: 'local' } }).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(settings)).theme, 'paper');
    assert.deepEqual(fs.readdirSync(root).sort(), ['.nami', 'agent.json', 'settings.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
