// Which conversation is a running claude ACTUALLY in?
//
// Nami pins a conversation id at spawn (`claude --session-id <uuid>`) and builds
// the transcript path from it. That holds right up until the user types /resume
// inside the tile and picks an older conversation: claude switches to that
// conversation's id and never writes a line to the pinned one. Measured on a
// real pty (CLI 2.1.226):
//
//   pinned  c602aba0-3040-4c24-82be-04807276ea15
//   live    dddf8560-3aad-4b62-9184-33ad8101ba20   after /resume + Enter
//   pinned transcript exists: false
//
// Two things then break silently. The title sweep stats a file that will never
// exist and gives up on every pass, so the tile keeps whatever the first typed
// line guessed (a tile named "/resume" is the tell). And on the next launch
// hasTranscript is false, so claude-args picks --session-id over --resume and
// the restored tile comes back as an empty conversation.
//
// Claude publishes the truth in ~/.claude/sessions/<pid>.json, written within
// seconds of spawn and kept current. Nami owns the pty, so it knows the pid.
// IO is injected so this stays testable without a live claude.
const fs = require('fs');
const os = require('os');
const path = require('path');

const fsIo = {
  read: (f) => fs.readFileSync(f, 'utf8'),
};

function registryFile(pid) {
  return path.join(os.homedir(), '.claude', 'sessions', String(pid) + '.json');
}

// { sessionId, status, name } for a live claude, or null if there is nothing
// usable yet. Absence is normal and must stay quiet: every shell tile has no
// record at all, and a claude tile has none for the first second or two.
function readLiveSession(pid, io = fsIo) {
  let doc;
  try {
    doc = JSON.parse(io.read(registryFile(pid)));
  } catch (_) {
    return null; // missing, half-written, or not ours
  }
  if (!doc || typeof doc !== 'object') return null;
  const sessionId = typeof doc.sessionId === 'string' ? doc.sessionId : '';
  if (!sessionId) return null;
  // `name` is a folder-derived slug ("dainami-cli-ff") unless something actually
  // chose it, and that slug is worse than any label nami already has.
  const chosen = doc.nameSource && doc.nameSource !== 'derived' && doc.name;
  return {
    sessionId,
    status: typeof doc.status === 'string' ? doc.status : null,
    name: chosen ? String(doc.name) : null,
  };
}

// Rebind only on a real move. A missing reading is not a change — treating it as
// one would drop the pinned id every time the file is briefly unreadable.
function liveSessionChanged(pinned, live) {
  if (!live) return false;
  return pinned !== live;
}

module.exports = { readLiveSession, liveSessionChanged, registryFile, fsIo };
