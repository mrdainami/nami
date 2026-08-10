// What in a terminal line is worth clicking. Pure string work so it can be
// tested without a terminal: the tile hands us one (unwrapped) line of text and
// gets back the spans to underline, each already classified.
//
// URLs are matched FIRST and paths are matched only in the gaps between them.
// That order is the whole point: a path regex left to itself reads
// "https://opencode.ai/docs" as the file "/opencode.ai/docs" and every web link
// in the session dies as "Not found".

// A scheme'd URL, or a bare www. host. Stops at whitespace and at the brackets
// and quotes that wrap links in prose.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`{}|\\^[\]]+/gi;
// A dev server someone printed without a scheme — localhost:3000, 127.0.0.1:8080.
// The port is required: the bare word "localhost" is prose, not a destination.
const LOCALHOST_RE = /\b(?:localhost|127\.0\.0\.1):\d{2,5}(?:\/[^\s<>"'`]*)?/gi;
// Three shapes an agent writes a file in: /abs/path and ~/path and ./path,
// then rel/ative/path, then a bare name.js. The bare branch demands two
// characters before the dot so "e.g." and "i.e." stay prose.
const PATH_RE = /(?:~|\.{1,2})?(?:\/[\w.@+-]+)+|(?:[\w.@+-]+\/)+[\w.@+-]+|\b[\w@+-]{2,}\.[A-Za-z][A-Za-z0-9]{0,7}\b/g;
// Punctuation a link can end next to but never owns.
const TRAIL_RE = /[)\]}>.,;:!?'"«»]+$/;
// The :12 or :12:5 an agent appends to point at a line.
const LINE_RE = /^:(\d+)(?::(\d+))?/;

function overlaps(spans, start, end) {
  return spans.some((s) => start < s.end && end > s.start);
}

// Trim trailing punctuation off a match, returning the shortened end offset.
function trimEnd(text, start, end) {
  const tok = text.slice(start, end);
  const cut = tok.match(TRAIL_RE);
  return cut ? end - cut[0].length : end;
}

function collect(text, re, kind, taken) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = trimEnd(text, start, start + m[0].length);
    if (end - start < 3 || overlaps(taken, start, end)) continue;
    out.push({ kind, text: text.slice(start, end), start, end });
  }
  return out;
}

// One line of terminal text → the links in it, left to right.
// Each link is { kind: 'url' | 'path', text, start, end } and a path may carry
// { line, col } lifted off a trailing :12:5.
export function scanLinks(text) {
  const line = String(text == null ? '' : text);
  const urls = collect(line, URL_RE, 'url', []);
  const hosts = collect(line, LOCALHOST_RE, 'url', urls);
  const taken = urls.concat(hosts);
  const paths = collect(line, PATH_RE, 'path', taken).filter((l) => l.text.includes('/') || l.text.includes('.'));

  for (const p of paths) {
    const after = line.slice(p.end).match(LINE_RE);
    if (!after) continue;
    p.line = Number(after[1]);
    if (after[2]) p.col = Number(after[2]);
  }
  return taken.concat(paths).sort((a, b) => a.start - b.start);
}

// What a URL link should hand to the browser: www.foo.com and localhost:3000
// are destinations, they just left the scheme off.
export function urlTarget(text) {
  if (/^https?:\/\//i.test(text)) return text;
  const local = /^(?:localhost|127\.0\.0\.1)[:/]/.test(text);
  return (local ? 'http://' : 'https://') + text;
}
