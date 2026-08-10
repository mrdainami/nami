// Line-preserving frontmatter round-tripper. The safety property that matters: editing a
// field may only rewrite that field's own lines — every unrecognized key, comment, list,
// and the entire body must survive byte-for-byte. No DOM, no Electron; unit-tested.

const KEY_RE = /^([A-Za-z_][\w-]*):\s?(.*)$/;

// -> { hasFrontmatter, malformed?, entries: [{key?, value?, complex?, lines[]}], body }
export function parseDoc(text) {
  const src = String(text == null ? '' : text);
  if (!src.startsWith('---\n') && !src.startsWith('---\r\n')) {
    return { hasFrontmatter: false, entries: [], body: src };
  }
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { hasFrontmatter: false, malformed: true, entries: [], body: src };
  const entries = [];
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(KEY_RE);
    if (km) { entries.push({ key: km[1], value: km[2], lines: [line] }); continue; }
    const last = entries[entries.length - 1];
    if (last && last.key && (line === '' || /^\s/.test(line) || line.trim().startsWith('-'))) {
      last.lines.push(line); last.complex = true;
    } else {
      entries.push({ lines: [line] }); // opaque: comments, stray text — preserved verbatim
    }
  }
  return { hasFrontmatter: true, entries, body: src.slice(m[0].length) };
}

export function serializeDoc(doc) {
  if (!doc.hasFrontmatter) return doc.body;
  return '---\n' + doc.entries.map((e) => e.lines.join('\n')).join('\n') + '\n---\n' + doc.body;
}

export function getField(doc, key) {
  const e = doc.entries.find((x) => x.key === key);
  if (!e) return '';
  const head = unquote(e.value).replace(/^[>|][+-]?$/, '').trim();
  if (!e.complex) return head;
  const cont = e.lines.slice(1).map((l) => l.trim()).filter(Boolean).join(' ');
  return head ? head + (cont ? ' ' + cont : '') : cont;
}

export function setField(doc, key, value) {
  const line = `${key}: ${quote(value)}`;
  if (!doc.hasFrontmatter) {
    if (doc.malformed) return doc; // never rewrite what we couldn't parse
    doc.hasFrontmatter = true; doc.entries = [];
  }
  const e = doc.entries.find((x) => x.key === key);
  if (e) { e.value = String(value); e.lines = [line]; e.complex = false; }
  else doc.entries.push({ key, value: String(value), lines: [line] });
  return doc;
}

function quote(v) {
  v = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
  if (v === '') return '""';
  if (/[:#"'{}\[\]&*!|>%@`]/.test(v) || /^\s|\s$/.test(v) || /^[?-]\s/.test(v)) return JSON.stringify(v);
  return v;
}
function unquote(v) {
  v = String(v == null ? '' : v).trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) { try { return JSON.parse(v); } catch (_) {} }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}
