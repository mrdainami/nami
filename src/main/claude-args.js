// How a claude panel's CLI args are chosen — extracted pure so the restore
// matrix stays tested. sid is the panel's own conversation id (minted in the
// renderer at first spawn); cont marks a restored panel; hasTranscript says
// whether that conversation ever got a first message.
//
//   fresh + sid            → --session-id sid   (pin the conversation id)
//   restored + sid + file  → --resume sid       (that tile's own conversation)
//   restored + sid, no file→ --session-id sid   (was never used; start it now)
//   restored, no sid       → --continue         (legacy snapshot migration)
//
// `name` rides along whenever nami picked the tile's name deliberately — it
// writes a custom-title into the transcript, so the session reads the same in
// `claude --resume` and `claude agents` as it does in the rail. Verified to
// work alongside --resume, not only on a fresh spawn.
function claudeSpawnArgs({ cont, sid, hasTranscript, name }) {
  const named = String(name || '').trim();
  const tail = named ? ['--name', named] : [];
  if (cont) {
    if (!sid) return ['--continue', ...tail];
    return hasTranscript ? ['--resume', sid, ...tail] : ['--session-id', sid, ...tail];
  }
  return sid ? ['--session-id', sid, ...tail] : tail;
}

// ~/.claude/projects/<slug>/<sid>.jsonl — claude's transcript naming.
function projectSlug(cwd) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

// One argument, safe to type into a shell. Only needed on the fallback path,
// where there is no resolvable binary and the command is typed rather than
// spawned — a spawn passes an array and none of this arises.
//
// Single quotes, because inside them a shell expands nothing at all: no $, no
// backtick, no glob, no history bang. The one character single quotes cannot
// carry is a single quote, which is why it is closed, escaped and reopened.
// A session named "Cal's export button" is an ordinary thing to have.
function shellQuote(arg) {
  const s = String(arg == null ? '' : arg);
  if (s === '') return "''";
  // plain enough to need nothing — keeps the common command readable in the tile
  if (/^[A-Za-z0-9_\-./:=@]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

module.exports = { claudeSpawnArgs, projectSlug, shellQuote };
