// Owner-only, on the operating system that has no 0o600.
//
// On a Mac the mode passed to writeFile and mkdir is the whole story: 0o600 and
// nobody else on the machine can read the key. Windows ignores the mode
// entirely, so a new file simply takes the permissions of the folder it lands
// in. Under C:\Users\<me> that happens to be the owner, SYSTEM and
// Administrators. In a project on D:\work it is not: BUILTIN\Users can read,
// so a project's .mcp.json with a key in it is open to every account on the PC.
//
// This gives Windows the same promise by the only supported, dependency-free
// route, icacls: stop inheriting from the folder, and grant the file to the
// current user and to SYSTEM and to nobody else. SYSTEM stays because backup,
// search indexing and Defender all run as it and a file they cannot open shows
// up as an error in each of them, while leaving it out protects nothing (SYSTEM
// can read any file it likes). Administrators are left out, as other people are
// on a Mac; an administrator can take ownership, exactly as root can there.
//
// Everywhere else this is a no-op that answers true, because the mode already
// did the work. Platform is a parameter, and so is the thing that runs a
// program, which is how a Mac tests the Windows column.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WIN = 'win32';
const SYSTEM_SID = 'S-1-5-18';

// The user is named by SID, never by name: "DOMAIN\first last", an Entra
// account and a localised group name all break a command line in different
// ways, and a SID is the same string on every Windows in every language. It
// cannot change while we run, so whoami is asked once per process.
const CACHE = { sid: '' };

// Both tools are real .exe files, so no shell is involved and an args array
// reaches them untouched. They are run by full path out of System32 rather than
// by name, so a stray icacls.cmd earlier on PATH, or in a project folder, is
// never what gets to decide who can read a key.
function system32(env = process.env) {
  const root = (env && (env.SystemRoot || env.SYSTEMROOT || env.windir)) || 'C:\\Windows';
  return path.win32.join(root, 'System32');
}

// `whoami /user /fo csv /nh` prints one line: "pc\name","S-1-5-21-…".
function parseSid(text) {
  const m = /"(S-1-\d+(?:-\d+)+)"\s*$/.exec(String(text || '').trim());
  return m ? m[1] : '';
}

// /inheritance:r drops everything the folder handed down, /grant:r replaces
// rather than adds to whatever was there for that SID, and the leading * is how
// icacls is told "this is a SID, do not look it up as a name". A folder's grant
// carries (OI)(CI) so the files and folders made inside it later start out
// owner-only too.
function icaclsArgs(target, sid, directory = false) {
  const rights = directory ? '(OI)(CI)(F)' : '(F)';
  return [target, '/inheritance:r', '/grant:r', `*${sid}:${rights}`, `*${SYSTEM_SID}:${rights}`];
}

// icacls cannot be taken at its word. On a share with no permissions to set (a
// Parallels or VirtualBox shared folder, some NAS boxes) it prints "Successfully
// processed 1 files", exits 0 and has changed nothing. So the listing is read
// back. Names in it are localised, but the shape is not: one "who:(flags)" per
// line. Owner-only means there are entries, no more than the two we granted,
// each of them full control, and none of them (I), inherited from the folder.
function isOwnerOnly(listing) {
  const entries = String(listing || '').split(/\r?\n/).map((line) => /:((?:\([A-Za-z,]+\))+)\s*$/.exec(line)).filter(Boolean).map((m) => m[1]);
  return entries.length > 0 && entries.length <= 2 && entries.every((flags) => flags.endsWith('(F)') && !flags.includes('(I)'));
}

// Synchronous on purpose, to match the writers that call it. Measured on an
// idle Windows 11: whoami about 15 ms (once), then about 40 ms for the pair of
// icacls runs, set and read back. The same call took most of a second while the
// machine was busy running other things, since it is the cost of starting two
// programs. That is fine for a settings save and wrong for anything in a loop,
// so callers that write often tighten the folder once when they make it and let
// the files inherit.
function exec(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
}

// Makes `target` readable by its owner alone and says whether it is. Never
// throws: a volume with no permissions (FAT, exFAT, a shared folder) or a
// locked-down PC with no icacls must cost the caller nothing but a false, the
// same way a chmod that did not take would never lose a save on a Mac.
//
// Meant for something just created. Anything it finds granted explicitly to
// someone else is left there, and then the answer is false.
function ownerOnly(target, { directory = false, platform = process.platform, env = process.env, run = exec, cache = CACHE } = {}) {
  if (platform !== WIN) return true;
  try {
    const bin = system32(env);
    if (!cache.sid) cache.sid = parseSid(run(path.win32.join(bin, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']));
    if (!cache.sid) return false;
    const icacls = path.win32.join(bin, 'icacls.exe');
    run(icacls, icaclsArgs(String(target), cache.sid, directory));
    return isOwnerOnly(run(icacls, [String(target)]));
  } catch (_) { return false; }
}

module.exports = { ownerOnly, icaclsArgs, parseSid, isOwnerOnly, system32, SYSTEM_SID };
