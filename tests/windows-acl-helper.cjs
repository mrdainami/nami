// Reads real Windows permissions back, for the tests that prove a key file is
// owner-only there. Shared by owner-only.test.mjs and private-config.test.mjs.
//
// `icacls /save` writes the permissions as SDDL, which names people by SID and
// is the same in every language: D:PAI(A;;FA;;;SY)(A;;FA;;;S-1-5-21-…). P is
// "takes nothing from its folder"; an entry whose flags include ID was
// inherited. SY is SYSTEM, BU is BUILTIN\Users, AU is Authenticated Users.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseSid, system32 } = require('../src/main/owner-only');

const WINDOWS_ONLY = process.platform !== 'win32' && 'icacls and NTFS permissions exist only on Windows';

function parseSddl(sddl) {
  const head = /D:([A-Z]*)/.exec(String(sddl || ''));
  const entries = [...String(sddl || '').matchAll(/\(([^)]*)\)/g)].map((m) => m[1].split(';')).map(([type, flags, rights, , , who]) => ({ type, flags, rights, who }));
  return { sddl, isProtected: !!head && head[1].includes('P'), entries };
}
function readAcl(target) {
  const out = path.join(os.tmpdir(), 'nami-acl-' + process.pid + '-' + Math.random().toString(16).slice(2) + '.txt');
  try {
    execFileSync(path.join(system32(), 'icacls.exe'), [target, '/save', out], { stdio: 'ignore' });
    return parseSddl(fs.readFileSync(out, 'utf16le').split(/\r?\n/)[1] || '');
  } finally { fs.rmSync(out, { force: true }); }
}
function me() { return parseSid(execFileSync(path.join(system32(), 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })); }
// The user and SYSTEM, full control each, granted on the thing itself.
function assertOwnerOnly(target, { directory = false } = {}) {
  const acl = readAcl(target);
  assert.equal(acl.isProtected, true, acl.sddl);
  assert.deepEqual(acl.entries.map((e) => e.who).sort(), ['SY', me()].sort(), acl.sddl);
  for (const e of acl.entries) {
    assert.equal(e.type, 'A', acl.sddl);
    assert.equal(e.rights, 'FA', acl.sddl);
    assert.equal(e.flags, directory ? 'OICI' : '', acl.sddl);
  }
}
module.exports = { WINDOWS_ONLY, parseSddl, readAcl, me, assertOwnerOnly };
