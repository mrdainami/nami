// Is PowerShell 7 on this PC, and where?
//
// platform.js knows where it might be and does no I/O; this does the looking
// and nothing else, so paneShell can stay a pure function of what was found.
//
// Asked again for every pane rather than remembered: it is a handful of lstat
// calls, and someone who installs PowerShell 7 because a pane told them to
// should get it in the next pane, not after a restart.
//
// lstat, not exists. The Store build of PowerShell is reached through an app
// execution alias in %LOCALAPPDATA%\Microsoft\WindowsApps — a reparse point
// Node cannot stat (EACCES, so fs.existsSync says false; measured on Windows
// 11) but Windows starts without complaint.

const fs = require('fs');
const { pwshCandidates } = require('./platform.js');

function isThere(p) {
  try { fs.lstatSync(p); return true; } catch (_) { return false; }
}

function findPwsh({ env = process.env, pathValue, platform = process.platform, exists = isThere } = {}) {
  for (const p of pwshCandidates({ env, pathValue, platform })) if (exists(p)) return p;
  return '';
}

module.exports = { findPwsh };
