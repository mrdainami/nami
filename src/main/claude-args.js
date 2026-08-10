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

module.exports = { claudeSpawnArgs, projectSlug };
