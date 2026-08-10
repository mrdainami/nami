// A tile is a new top-level agent. It is never a child of whatever launched
// Nami — and claude decides which it is purely from the environment.
//
// Launch Nami from a shell that is itself inside a claude session (`open -a
// Nami` from a claude tile, `npm start` in one) and that conversation's
// variables land in Nami's environment, and from there in every session Nami
// spawns. claude reads CLAUDE_CODE_CHILD_SESSION, concludes it is nested, and
// turns transcript saving off so two processes do not write one file. The only
// sign is a grey warning line inside the tile — and the transcript is what
// `--resume`, the session rail and the title watcher all read, so the loss is
// silent and complete.
//
// Only handles on a live conversation are dropped. Setup that describes the
// machine — CLAUDE_CONFIG_DIR, an API key — is the user's and stays: stripping
// it would change which claude the tile runs as.
const INHERITED_SESSION_KEYS = [
  'CLAUDE_CODE_CHILD_SESSION',    // the one that disables transcript saving
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET', // a socket belonging to the launching process
  'CLAUDE_PID',
  'CLAUDECODE',                   // "you are running inside claude" — a tile is not
  'CLAUDE_CODE_ENTRYPOINT',
];

// Returns a copy; the caller's own environment is never touched.
function stripInheritedClaude(env) {
  const out = Object.assign({}, env);
  for (const k of INHERITED_SESSION_KEYS) delete out[k];
  return out;
}

module.exports = { stripInheritedClaude, INHERITED_SESSION_KEYS };
