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
// Makes `root` hand a read for BUILTIN\Users down to whatever is made inside
// it: the loose starting point these tests need, built rather than assumed. A
// PC's temp folder hands things down by itself; a build server's does not, and
// a new file there starts with entries of its own instead.
function handDownAReadForUsers(root) {
  execFileSync(path.join(system32(), 'icacls.exe'), [root, '/grant', '*S-1-5-32-545:(OI)(CI)(RX)'], { stdio: 'ignore' });
}
// SDDL writes some accounts by a two-letter alias rather than by SID. The one
// that matters here is LA, the machine's built-in Administrator (…-500), which
// is who a build server runs as — so "LA" and the user's own SID can be the
// same person.
function isMe(who) { const mine = me(); return who === mine || (who === 'LA' && /-500$/.test(mine)); }
function whoHas(acl) { return acl.entries.map((e) => (isMe(e.who) ? 'me' : e.who)).sort(); }
function me() { return parseSid(execFileSync(path.join(system32(), 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' })); }
// The user and SYSTEM, full control each, granted on the thing itself.
function assertOwnerOnly(target, { directory = false } = {}) {
  const acl = readAcl(target);
  assert.equal(acl.isProtected, true, acl.sddl);
  assert.deepEqual(whoHas(acl), ['SY', 'me'], acl.sddl);
  for (const e of acl.entries) {
    assert.equal(e.type, 'A', acl.sddl);
    assert.equal(e.rights, 'FA', acl.sddl);
    assert.equal(e.flags, directory ? 'OICI' : '', acl.sddl);
  }
}
module.exports = { WINDOWS_ONLY, parseSddl, readAcl, me, assertOwnerOnly, handDownAReadForUsers, whoHas };
