import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ownerOnly, icaclsArgs, parseSid, isOwnerOnly, system32, SYSTEM_SID } = require('../src/main/owner-only');
const { storePng } = require('../src/main/pasted-images');
const { WINDOWS_ONLY, parseSddl, readAcl, assertOwnerOnly, handDownAReadForUsers, whoHas } = require('./windows-acl-helper.cjs');

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const WHOAMI = `"desktop-pc\\ana","${SID}"\r\n`;
// Copied from a real Windows 11: a new file in C:\proj as the folder leaves it,
// the same file once tightened, a folder once tightened, a file made inside
// that folder afterwards, and a Parallels shared folder, where icacls reports
// success and sets nothing.
const LOOSE = 'C:\\proj\\x.json BUILTIN\\Administrators:(I)(F)\r\n                NT AUTHORITY\\SYSTEM:(I)(F)\r\n                BUILTIN\\Users:(I)(RX)\r\n                NT AUTHORITY\\Authenticated Users:(I)(M)\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n';
const TIGHT = 'C:\\proj\\x.json NT AUTHORITY\\SYSTEM:(F)\r\n                DESKTOP-PC\\ana:(F)\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n';
const TIGHT_DIR = '\\\\?\\C:\\proj\\a NT AUTHORITY\\SYSTEM:(OI)(CI)(F)\r\n               DESKTOP-PC\\ana:(OI)(CI)(F)\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n';
const INHERITED = 'C:\\proj\\a\\new.txt NT AUTHORITY\\SYSTEM:(I)(F)\r\n                   DESKTOP-PC\\ana:(I)(F)\r\n\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n';
const NO_ACL = '\\\\Mac\\Home\\share.txt  No permissions are set. All users have full control.\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n';

// Stands in for execFileSync: records what was run and answers from a script.
function recorder(listing = TIGHT) {
  const calls = [];
  const run = (file, args) => { calls.push([file, ...args]); return /whoami/.test(file) ? WHOAMI : args.length === 1 ? listing : 'processed file'; };
  return { calls, run };
}

test('off Windows there is nothing to do: the mode already made it owner-only', () => {
  for (const platform of ['darwin', 'linux']) {
    const { calls, run } = recorder();
    assert.equal(ownerOnly('/tmp/key.json', { platform, run, cache: {} }), true);
    assert.equal(ownerOnly('/tmp/keys', { directory: true, platform, run, cache: {} }), true);
    assert.deepEqual(calls, []);
  }
});

test('on Windows a file is cut off from its folder and granted to the user and SYSTEM by SID', () => {
  const { calls, run } = recorder();
  const env = { SystemRoot: 'D:\\WinNT' };
  assert.equal(ownerOnly('C:\\proj\\x.json.tmp', { platform: 'win32', env, run, cache: {} }), true);
  assert.deepEqual(calls, [
    ['D:\\WinNT\\System32\\whoami.exe', '/user', '/fo', 'csv', '/nh'],
    ['D:\\WinNT\\System32\\icacls.exe', 'C:\\proj\\x.json.tmp', '/inheritance:r', '/grant:r', `*${SID}:(F)`, '*S-1-5-18:(F)'],
    ['D:\\WinNT\\System32\\icacls.exe', 'C:\\proj\\x.json.tmp'],
  ]);
});

test('a folder is granted so that what is made inside it later is owner-only too', () => {
  const { calls, run } = recorder(TIGHT_DIR);
  assert.equal(ownerOnly('\\\\?\\C:\\proj\\a', { directory: true, platform: 'win32', env: {}, run, cache: {} }), true);
  assert.deepEqual(calls[1], ['C:\\Windows\\System32\\icacls.exe', '\\\\?\\C:\\proj\\a', '/inheritance:r', '/grant:r', `*${SID}:(OI)(CI)(F)`, '*S-1-5-18:(OI)(CI)(F)']);
  assert.deepEqual(icaclsArgs('C:\\k', SID, true).slice(3), [`*${SID}:(OI)(CI)(F)`, `*${SYSTEM_SID}:(OI)(CI)(F)`]);
});

test('the user is looked up once and remembered', () => {
  const { calls, run } = recorder();
  const cache = {};
  ownerOnly('C:\\a.tmp', { platform: 'win32', env: {}, run, cache });
  ownerOnly('C:\\b.tmp', { platform: 'win32', env: {}, run, cache });
  assert.equal(cache.sid, SID);
  assert.equal(calls.filter(([file]) => /whoami/.test(file)).length, 1);
  assert.equal(calls.length, 5);
});

test('the tools come from System32 by full path, never from PATH', () => {
  assert.equal(system32({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32');
  assert.equal(system32({ SYSTEMROOT: 'E:\\W' }), 'E:\\W\\System32');
  assert.equal(system32({ windir: 'E:\\W' }), 'E:\\W\\System32');
  assert.equal(system32({ PATH: 'C:\\evil' }), 'C:\\Windows\\System32');
  assert.equal(system32(null), 'C:\\Windows\\System32');
});

test('a SID is read from whoami whatever the account is called', () => {
  assert.equal(parseSid(WHOAMI), SID);
  assert.equal(parseSid('"CORP\\Ana María de la O","S-1-5-21-1-2-3-500"'), 'S-1-5-21-1-2-3-500');
  assert.equal(parseSid('"AzureAD\\ana","S-1-12-1-1111-2222-3333-4444"\n'), 'S-1-12-1-1111-2222-3333-4444');
  assert.equal(parseSid('"nt authority\\system","S-1-5-18"'), 'S-1-5-18');
  assert.equal(parseSid('ERROR: Unable to get user information.'), '');
  assert.equal(parseSid(''), '');
  assert.equal(parseSid(undefined), '');
});

test('the listing is believed, not the exit code', () => {
  assert.equal(isOwnerOnly(TIGHT), true);
  assert.equal(isOwnerOnly(TIGHT_DIR), true);
  assert.equal(isOwnerOnly(LOOSE), false);
  assert.equal(isOwnerOnly(INHERITED), false);
  assert.equal(isOwnerOnly(NO_ACL), false);
  assert.equal(isOwnerOnly(TIGHT.replace('(F)', '(R)')), false);
  assert.equal(isOwnerOnly(TIGHT.replace('\r\n\r\n', '\r\n                BUILTIN\\Users:(RX)\r\n\r\n')), false);
  assert.equal(isOwnerOnly(''), false);
  assert.equal(isOwnerOnly(undefined), false);
});

test('it never throws into the caller, and says false when it could not be done', () => {
  const opts = { platform: 'win32', env: {} };
  // A shared folder with no permissions: icacls "succeeds" and nothing changed.
  assert.equal(ownerOnly('\\\\Mac\\Home\\share.txt', { ...opts, ...recorder(NO_ACL), cache: {} }), false);
  // No icacls, access denied, or it hung and was timed out.
  const broken = (file) => { if (/whoami/.test(file)) return WHOAMI; throw new Error('spawnSync icacls.exe ENOENT'); };
  assert.equal(ownerOnly('C:\\x.tmp', { ...opts, run: broken, cache: {} }), false);
  // whoami answered with something that is not a user.
  const cache = {};
  const { calls, run } = recorder();
  assert.equal(ownerOnly('C:\\x.tmp', { ...opts, run: (file, args) => /whoami/.test(file) ? 'ERROR' : run(file, args), cache }), false);
  assert.deepEqual(calls, []);
  assert.equal(cache.sid, '');
  // Asked to be Windows on a machine that is not: no System32 to run.
  if (process.platform !== 'win32') assert.equal(ownerOnly(path.join(os.tmpdir(), 'nope'), { platform: 'win32', cache: {} }), false);
});

test('entries set on the file itself are replaced, not added to', () => {
  // A folder that hands nothing down leaves a new file with entries of its own
  // (the token's defaults: on a build server, Administrators; elsewhere it can be
  // Users). /inheritance:r has nothing to remove and /grant:r only adds ours, so
  // the first read-back still shows a stranger. Then the whole list is written
  // in one go, and read back again.
  const STRANGER = TIGHT.replace('\r\n\r\n', '\r\n                BUILTIN\\Users:(R)\r\n\r\n');
  const calls = []; let reads = 0;
  const run = (file, args, env, timeout) => {
    calls.push({ file, args, env, timeout });
    if (/whoami/.test(file)) return WHOAMI;
    if (/icacls/.test(file) && args.length === 1) return ++reads === 1 ? STRANGER : TIGHT;
    return 'ok';
  };
  assert.equal(ownerOnly("C:\\proj\\it's; $(calc).json", { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, run, cache: {} }), true);
  const ps = calls.find((c) => /powershell\.exe$/i.test(c.file));
  assert.ok(ps, 'the exact form was used');
  assert.equal(ps.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');   // by full path, never found on PATH
  // the file name and the SID travel as data, never as part of the script
  assert.equal(ps.env.NAMI_ACL_TARGET, "C:\\proj\\it's; $(calc).json");
  assert.equal(ps.env.NAMI_ACL_SID, SID);
  assert.ok(!ps.args.join(' ').includes('calc'), 'nothing of the path is in the command line');
  assert.equal(reads, 2, 'and it was read back again afterwards');
  // a cold PowerShell on a busy machine needs longer than icacls ever does
  assert.ok(ps.timeout >= 20000, 'the exact form is given time to start: ' + ps.timeout);
});

test('a volume with no permissions at all is not worth a second try', () => {
  const calls = [];
  const run = (file, args) => { calls.push(file); return /whoami/.test(file) ? WHOAMI : args.length === 1 ? NO_ACL : 'ok'; };
  assert.equal(ownerOnly('\\\\Mac\\Home\\share.txt', { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, run, cache: {} }), false);
  assert.ok(!calls.some((f) => /powershell/i.test(f)), 'three quarters of a second per save, for nothing');
});

test('the usual case never pays for the exact form', () => {
  const { calls, run } = recorder();
  assert.equal(ownerOnly('C:\\proj\\x.json', { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, run, cache: {} }), true);
  assert.ok(!calls.some((c) => /powershell/i.test(c[0])));
});

test('the SDDL that icacls saves is read the same way on any machine', () => {
  const loose = parseSddl('D:AI(A;ID;FA;;;BA)(A;ID;FA;;;SY)(A;ID;0x1200a9;;;BU)(A;ID;0x1301bf;;;AU)');
  assert.equal(loose.isProtected, false);
  assert.deepEqual(loose.entries.map((e) => e.who), ['BA', 'SY', 'BU', 'AU']);
  assert.ok(loose.entries.every((e) => e.flags === 'ID'));
  const tight = parseSddl(`D:PAI(A;;FA;;;SY)(A;;FA;;;${SID})`);
  assert.equal(tight.isProtected, true);
  assert.deepEqual(tight.entries, [{ type: 'A', flags: '', rights: 'FA', who: 'SY' }, { type: 'A', flags: '', rights: 'FA', who: SID }]);
});

// Everything below runs the real icacls, so it can only run where there is one.
test('on a real Windows a file and a folder end up with the user and SYSTEM and nobody else', { skip: WINDOWS_ONLY }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-owner-only-'));
  try {
    handDownAReadForUsers(root);
    const file = path.join(root, 'key.json'), dir = path.join(root, 'keys');
    fs.writeFileSync(file, 'not-a-real-key');
    fs.mkdirSync(dir);
    assert.ok(readAcl(file).entries.some((e) => e.who === 'BU' && e.flags.includes('ID')), 'a new file starts readable by Users, handed down by its folder');
    assert.equal(ownerOnly(file), true);
    assertOwnerOnly(file);
    assert.equal(ownerOnly(dir, { directory: true }), true);
    assertOwnerOnly(dir, { directory: true });
    // Still ours to read, change and replace.
    assert.equal(fs.readFileSync(file, 'utf8'), 'not-a-real-key');
    fs.writeFileSync(file, 'changed');
    assertOwnerOnly(file);
    // What is made inside the folder afterwards inherits exactly that and no more.
    const inside = path.join(dir, 'later.json');
    fs.writeFileSync(inside, '{}');
    const acl = readAcl(inside);
    assert.deepEqual(whoHas(acl), ['SY', 'me'], acl.sddl);
    assert.equal(ownerOnly(path.join(root, 'missing.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The case a build server found: a folder that hands nothing down, so what a
// new file starts with is set on the file itself and icacls alone cannot take it
// off. Built here on purpose, with a read for Users standing in for whatever a
// token's defaults might be, and a folder name chosen to be trouble.
test('on a real Windows entries set on the file itself are replaced too', { skip: WINDOWS_ONLY }, () => {
  const { execFileSync } = require('node:child_process');
  const icacls = (...a) => execFileSync(path.join(process.env.SystemRoot, 'System32', 'icacls.exe'), a, { stdio: 'ignore' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nami own'er; $(calc) "));
  try {
    const file = path.join(root, 'key file.json'), dir = path.join(root, 'keys');
    fs.writeFileSync(file, 'not-a-real-key');
    fs.mkdirSync(dir);
    icacls(file, '/inheritance:r', '/grant', '*S-1-5-32-545:(R)');
    icacls(dir, '/inheritance:r', '/grant', '*S-1-5-32-545:(OI)(CI)(R)');
    assert.ok(readAcl(file).entries.some((e) => e.who === 'BU' && !e.flags.includes('ID')), 'Users can read it, and not by inheritance');
    assert.equal(ownerOnly(file), true);
    assertOwnerOnly(file);
    assert.equal(ownerOnly(dir, { directory: true }), true);
    assertOwnerOnly(dir, { directory: true });
    assert.equal(fs.readFileSync(file, 'utf8'), 'not-a-real-key');
    fs.writeFileSync(path.join(dir, 'later.json'), '{}');
    assert.deepEqual(whoHas(readAcl(path.join(dir, 'later.json'))), ['SY', 'me']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zR8AAAAASUVORK5CYII=', 'base64');
test('on a real Windows the folder Nami makes for pasted images is owner-only, and so is each image in it', { skip: WINDOWS_ONLY }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-owner-only-'));
  try {
    const dir = path.join(root, 'pastes');
    const file = storePng(dir, png);
    assertOwnerOnly(dir, { directory: true });
    const acl = readAcl(file);
    assert.deepEqual(whoHas(acl), ['SY', 'me'], acl.sddl);
    assert.deepEqual(fs.readFileSync(file), png);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
