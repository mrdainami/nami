// Session naming: a fresh agent session is born as "Claude session". The first
// real prompt the user submits names it immediately, and claude's own name for
// the conversation takes over once it exists — so the rail reads like a to-do
// list instead of a column of identical labels, and keeps reading like one
// after the work moves on.

// Titles the auto-namer may overwrite. Anything a human or a flow chose
// ("build: dark mode", "improve: my-skill") is not generic and stays.
export function isGenericTitle(title) {
  const t = String(title || '').trim();
  return !t || /\bsession$/i.test(t);
}

// Who chose a tile's name. A stronger source may overwrite a weaker one; an
// equal or weaker one never wins, so a name you typed yourself is permanent
// while claude's name can still upgrade the guessed-from-your-first-line one.
//
//   generic  "Claude session", straight out of the launcher
//   prompt   guessed from the first line typed into the tile (feedNameDraft)
//   flow     chosen by a flow that opened the tile ("build: dark mode")
//   agent    claude's own name, read back out of its transcript
//   user     renamed by hand, here in nami
const TITLE_RANK = { generic: 0, prompt: 1, flow: 2, agent: 2, user: 3 };

export function titleRank(source) {
  const r = TITLE_RANK[source];
  return r === undefined ? 0 : r;
}

// Should `incoming` become the tile's name? Returns the winning
// { title, source }, or null when nothing changes — callers skip the re-render.
export function adoptTitle(current, incoming) {
  const title = String((incoming && incoming.title) || '').trim();
  if (!title) return null;
  if (titleRank(incoming.source) <= titleRank(current && current.source)) return null;
  if (current && current.title === title) return null;
  return { title, source: incoming.source };
}

// A tile whose name nami picked deliberately pushes that name down into claude
// (`--name`), so the session reads the same in `claude --resume`, in
// `claude agents`, and on your phone. A guessed name is never pushed: it is
// usually worse than the one claude works out for itself.
export function shouldPushName(source) {
  return source === 'user' || source === 'flow';
}

const MAX_NAME = 60;
const MAX_DRAFT = 400;

// Feed one chunk of terminal keystrokes into the pending name draft.
// Returns { draft, name } — name is set once Enter commits a draft long
// enough to be a real prompt; menu answers ("y⏎", arrow keys) never name.
export function feedNameDraft(draft, data) {
  let d = String(draft || '');
  // CSI sequences (arrows, bracketed-paste markers) and OSC strings are
  // navigation, not prose — drop them before reading characters.
  const text = String(data || '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[~A-Za-z]/g, '')
    .replace(/\x1b./g, '');
  for (const ch of text) {
    if (ch === '\r' || ch === '\n') {
      const name = d.replace(/\s+/g, ' ').trim();
      d = '';
      if (name.length >= 4) return { draft: '', name: name.length > MAX_NAME ? name.slice(0, MAX_NAME - 1).trimEnd() + '…' : name };
      continue; // an Enter on a menu or prompt — keep listening
    }
    if (ch === '\x7f' || ch === '\b') { d = d.slice(0, -1); continue; }
    if (ch === '\x03' || ch === '\x15') { d = ''; continue; } // ctrl-c / ctrl-u abandon
    if (ch < ' ') continue;
    if (d.length < MAX_DRAFT) d += ch;
  }
  return { draft: d, name: null };
}
