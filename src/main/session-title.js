// Where a session tile's name comes from — pure, no IO.
//
// Claude Code names its own conversations and writes that name into the
// transcript, twice over (captured on CLI 2.1.226):
//
//   {"type":"ai-title","aiTitle":"Investigate session naming alignment"}
//       prose, sentence case, written a dozen lines into the session — this is
//       exactly the string `claude --resume` shows in its picker.
//   {"type":"custom-title","customTitle":"build: dark mode"}
//       an explicit name: what `--name` writes, and what /rename sets. It
//       outranks the ai-title everywhere claude displays a session.
//
// Both records repeat on nearly every turn, so the tail of the file always
// carries the current one. That matters: transcripts reach hundreds of
// megabytes, and reading one whole to learn its name would stall the app.
// Widest gap measured between the last title record and EOF was 31KB.
const TAIL_BYTES = 96 * 1024;

// The last title of each kind in a slab of transcript. Partial first line (a
// tail read lands mid-line) simply fails to parse and is skipped.
function scanTitles(text) {
  const out = { ai: null, custom: null };
  for (const line of String(text || '').split('\n')) {
    // cheap reject before the parse — most lines are big message records
    if (line.indexOf('-title"') < 0) continue;
    let rec;
    try { rec = JSON.parse(line); } catch (_) { continue; }
    if (rec.type === 'ai-title' && rec.aiTitle) out.ai = String(rec.aiTitle);
    else if (rec.type === 'custom-title' && rec.customTitle) out.custom = String(rec.customTitle);
  }
  return out;
}

// The one name claude would show for this conversation.
function claudeTitle(text) {
  const t = scanTitles(text);
  return t.custom || t.ai || null;
}

// The name claude currently shows for the conversation in `file`, or null if it
// has not titled it yet (or the transcript does not exist — a session spawned
// seconds ago). Only the tail is read: measured at 0.5ms against a 205MB
// transcript, where reading the whole file would stall the main process.
function readTailTitle(file) {
  const fs = require('fs');
  let fd = null;
  try {
    const size = fs.statSync(file).size;
    const buf = Buffer.alloc(Math.min(size, TAIL_BYTES));
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - TAIL_BYTES));
    return claudeTitle(buf.toString('utf8'));
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (_) {}
  }
}

// Which of the two names wins, and whether nami may overwrite a tile's label
// with it, is the renderer's call — see adoptTitle in session-name.mjs.
module.exports = { scanTitles, claudeTitle, readTailTitle, TAIL_BYTES };
