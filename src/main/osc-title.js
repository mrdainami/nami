// Claude's own name for the live conversation, taken straight out of the PTY.
//
// Claude sets the terminal title on nearly every frame:
//
//   \x1b]0;✳ Claude Code\x07                       before it has named anything
//   \x1b]0;⠐ Calculate basic arithmetic problem\x07 once it has
//
// Nami already receives these bytes, so this costs no file reads and no polling.
// More importantly it is the ONLY title source that stays correct when the user
// runs /resume inside a tile: the transcript path nami watches is built from the
// session id it pinned at spawn, and /resume moves claude to a different
// conversation entirely (measured: pinned c602aba0… → live dddf8560…, with the
// pinned transcript never created). The title in the stream always belongs to
// whatever conversation claude is in right now.
//
// Pure on purpose — main.js owns the pty, this owns the parsing.

// OSC 0 (icon + window title) and OSC 2 (window title) both carry it; OSC 1 is
// the icon name alone and never holds the session name. Terminated by BEL or ST.
const OSC_RE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

function oscTitles(chunk) {
  const out = [];
  const re = new RegExp(OSC_RE.source, 'g'); // fresh lastIndex per call
  let m;
  while ((m = re.exec(String(chunk || '')))) out.push(m[1]);
  return out;
}

// The status glyph claude prefixes: ✳ when idle, a braille frame while working.
// It changes several times a second, so it must come off before comparing.
const GLYPH_RE = /^[⠀-⣿✳✴·•●○∙*+\-]+\s*/;

// What claude shows before it has titled the conversation. Adopting it would
// replace a useful prompt-derived label with a generic one, so it is not a name.
const PLACEHOLDER = /^claude code$/i;

const MAX = 60;

function cleanAgentTitle(raw) {
  // Control bytes first: this string is headed for the rail label, and an
  // unterminated or nested escape in the stream must never reach the DOM.
  const t = String(raw || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(GLYPH_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || PLACEHOLDER.test(t)) return null;
  return t.length > MAX ? t.slice(0, MAX - 1).trimEnd() + '…' : t;
}

// Feed one chunk of pty output. Returns a title only when the NAME changed —
// the spinner glyph alone must not re-render the rail thirty times a second.
// `st` is a per-session { last } scratchpad owned by the caller.
function feedOscTitle(st, chunk) {
  let found = null;
  for (const raw of oscTitles(chunk)) {
    const t = cleanAgentTitle(raw);
    if (t) found = t; // last one in the chunk wins
  }
  if (!found || found === st.last) return null;
  st.last = found;
  return found;
}

module.exports = { oscTitles, cleanAgentTitle, feedOscTitle };
