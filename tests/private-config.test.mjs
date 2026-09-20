import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { upsertMcpJson } = require('../src/main/mcp-config');
const { upsertMaster } = require('../src/main/connections');
const { writeSettings, readSettings } = require('../src/main/settings');
const { readMaster } = require('../src/main/connections');
const { writePrivateConfig } = require('../src/main/private-config');
const { WINDOWS_ONLY, readAcl, assertOwnerOnly } = require('./windows-acl-helper.cjs');
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

// The Windows column, driven from any machine: platform is forced and the two
// programs it would run are stood in for, so what is checked is the order of
// events around the temporary file.
const SID = 'S-1-5-21-1-2-3-1001';
const TIGHT = 'x NT AUTHORITY\\SYSTEM:(F)\r\n  PC\\me:(F)\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n';
test('on Windows the temporary file is closed to everyone else while it is still empty, then filled and renamed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-private-config-'));
  try {
    const file = path.join(root, 'made', 'here', 'agent.json'), seen = [];
    const run = (program, args) => {
      if (/whoami/.test(program)) return `"pc\\me","${SID}"`;
      if (args.length > 1) seen.push({ target: args[0], grant: args[3], text: fs.statSync(args[0]).isDirectory() ? null : fs.readFileSync(args[0], 'utf8'), targetThere: fs.existsSync(file) });
      return TIGHT;
    };
    assert.equal(writePrivateConfig(file, '{"key":"not-a-real-key"}', { platform: 'win32', run, cache: {} }), true);
    // First the topmost folder it had to make, then the temporary file.
    assert.equal(seen.length, 2);
    assert.equal(fs.realpathSync(seen[0].target.replace(/^\\\\\?\\/, '')), fs.realpathSync(path.join(root, 'made')));
    assert.equal(seen[0].grant, `*${SID}:(OI)(CI)(F)`);
    assert.match(seen[1].target, /agent\.json\.[0-9a-f]{24}\.tmp$/);
    assert.equal(seen[1].grant, `*${SID}:(F)`);
    assert.equal(seen[1].text, '', 'the key must not be in the file before it is owner-only');
    assert.equal(seen[1].targetThere, false);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"key":"not-a-real-key"}');
    // A folder that was already there is not ours to close; every save tightens its own file.
    seen.length = 0;
    assert.equal(writePrivateConfig(file, '{"key":"second"}', { platform: 'win32', run, cache: {} }), true);
    assert.deepEqual(seen.map((s) => s.grant), [`*${SID}:(F)`]);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"key":"second"}');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['agent.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('a volume that cannot hold permissions costs a false, never the save', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-private-config-'));
  try {
    const file = path.join(root, 'agent.json');
    const noAcl = (program) => /whoami/.test(program) ? `"pc\\me","${SID}"` : 'x  No permissions are set. All users have full control.\r\n';
    assert.equal(writePrivateConfig(file, 'one', { platform: 'win32', run: noAcl, cache: {} }), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'one');
    const missing = () => { throw new Error('spawnSync C:\\Windows\\System32\\whoami.exe ENOENT'); };
    assert.equal(writePrivateConfig(file, 'two', { platform: 'win32', run: missing, cache: {} }), false);
    assert.equal(fs.readFileSync(file, 'utf8'), 'two');
    assert.deepEqual(fs.readdirSync(root), ['agent.json']);
    // And where the mode does the work, the answer is simply yes.
    if (process.platform !== 'win32') assert.equal(writePrivateConfig(file, 'three'), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
// The same promise as the 0o600 test at the top, asked of real NTFS permissions:
// the saves Nami really makes, read back with icacls. The user's temp folder
// hands down Administrators as well as the user, so there is something to lose.
test('on a real Windows configuration saves keep fake keys readable by the user and SYSTEM alone', { skip: WINDOWS_ONLY }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-private-config-'));
  try {
    const file = path.join(root, 'agent.json');
    fs.writeFileSync(file, JSON.stringify({ keep: true }));
    assert.ok(readAcl(file).entries.every((e) => e.flags.includes('ID')), 'before: only what the folder hands down');
    upsertMcpJson({ file, id: 'fixture', entry: { env: { FIXTURE_KEY: 'not-a-real-key' } } });
    assertOwnerOnly(file);
    assert.equal(JSON.parse(fs.readFileSync(file)).keep, true);
    // A second save must not lock itself out, and must not loosen the file either.
    upsertMcpJson({ file, id: 'second', entry: { env: { FIXTURE_KEY: 'not-a-real-key-2' } } });
    assertOwnerOnly(file);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file)).mcpServers), ['fixture', 'second']);
    const master = upsertMaster({ scope: 'user', homeDir: root, id: 'fixture', entry: { command: 'node' } });
    assert.equal(master.ok, true);
    assertOwnerOnly(master.file);
    assertOwnerOnly(path.join(root, '.nami'), { directory: true });
    assert.deepEqual(Object.keys(readMaster({ scope: 'user', homeDir: root })), ['fixture']);
    const settings = path.join(root, 'settings.json');
    assert.equal(writeSettings({ file: settings, patch: { theme: 'paper' } }).ok, true);
    assert.equal(writeSettings({ file: settings, patch: { sttProvider: 'local' } }).ok, true);
    assertOwnerOnly(settings);
    assert.deepEqual(readSettings({ file: settings }), { theme: 'paper', sttProvider: 'local' });
    assert.deepEqual(fs.readdirSync(root).sort(), ['.nami', 'agent.json', 'settings.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
