// Nami — fence colouring for the card and Read renderers.
//
// Same stance as md.mjs: zero-dependency, escape-first, no guessing. A
// language this file doesn't know comes back as escaped plain text — never a
// wrong colouring, never raw HTML. Tokens are found on the raw text with one
// alternation per language (leftmost match wins, so a // inside a string
// belongs to the string), and every emitted segment is escaped on the way out.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const kw = (words) => new RegExp('\\b(?:' + words + ')\\b', 'g');

// Each rule: [className, regex]. First leftmost match wins; ties go to the
// earlier rule. `num` deliberately requires a word boundary so `v2` stays plain.
const LANGS = {
  js: [
    ['tok-com', /\/\/[^\n]*|\/\*[\s\S]*?\*\//g],
    ['tok-str', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g],
    ['tok-kw', kw('const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|import|export|from|default|try|catch|finally|throw|async|await|yield|typeof|instanceof|in|of|delete|void|this|null|undefined|true|false')],
    ['tok-num', /\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b/gi],
  ],
  python: [
    ['tok-com', /#[^\n]*/g],
    ['tok-str', /(?:[fFrRbBuU]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g],
    ['tok-kw', kw('def|return|if|elif|else|for|while|break|continue|import|from|as|class|try|except|finally|raise|with|lambda|pass|yield|global|nonlocal|assert|del|not|and|or|in|is|None|True|False|async|await|match|case')],
    ['tok-num', /\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b/gi],
  ],
  sh: [
    ['tok-com', /#[^\n]*/g],
    ['tok-str', /"(?:[^"\\]|\\.)*"|'[^']*'/g],
    ['tok-key', /\$\{?[A-Za-z_]\w*\}?/g],
  ],
  json: [
    ['tok-key', /"(?:[^"\\]|\\.)*"(?=\s*:)/g],
    ['tok-str', /"(?:[^"\\]|\\.)*"/g],
    ['tok-kw', kw('true|false|null')],
    ['tok-num', /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi],
  ],
  css: [
    ['tok-com', /\/\*[\s\S]*?\*\//g],
    ['tok-str', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g],
    ['tok-key', /(?:^|[{;]\s*)[a-z-]+(?=\s*:)/gm],
    ['tok-num', /-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/g],
  ],
  html: [
    ['tok-com', /<!--[\s\S]*?-->/g],
    ['tok-str', /"[^"]*"|'[^']*'/g],
    ['tok-kw', /<\/?[a-zA-Z][\w-]*|\/?>/g],
  ],
};
const ALIAS = {
  javascript: 'js', jsx: 'js', ts: 'js', tsx: 'js', typescript: 'js', mjs: 'js', cjs: 'js', node: 'js',
  py: 'python', python3: 'python',
  bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  jsonc: 'json', json5: 'json',
  scss: 'css', less: 'css',
  xml: 'html', svg: 'html', vue: 'html',
};

// Diff is line-shaped, not token-shaped: the class covers the whole line.
// Classed lines are display:block, which already breaks the line — joining
// them with \n as well double-spaces the block, so plain lines carry their
// own newline and classed lines carry none.
function diffLines(text) {
  const lines = String(text).split('\n');
  return lines.map((line, i) => {
    if (/^\+/.test(line) && !/^\+\+\+/.test(line)) return `<span class="tok-add">${esc(line)}</span>`;
    if (/^-/.test(line) && !/^---/.test(line)) return `<span class="tok-del">${esc(line)}</span>`;
    if (/^@@/.test(line)) return `<span class="tok-hunk">${esc(line)}</span>`;
    return esc(line) + (i < lines.length - 1 ? '\n' : '');
  }).join('');
}

export function highlightCode(lang, text) {
  const raw = String(text == null ? '' : text);
  const name = String(lang || '').toLowerCase();
  if (name === 'diff' || name === 'patch') return diffLines(raw);
  const rules = LANGS[name] || LANGS[ALIAS[name]];
  if (!rules) return esc(raw);

  // Walk left to right, always taking the earliest match that starts at or
  // after the current position — a // consumed by a string never also starts
  // a comment, and the next comment is found fresh after the string ends.
  const out = [];
  let pos = 0;
  while (pos < raw.length) {
    let best = null;
    for (let r = 0; r < rules.length; r++) {
      const [cls, re] = rules[r];
      re.lastIndex = pos;
      const m = re.exec(raw);
      if (m && m[0] && (!best || m.index < best.start)) best = { start: m.index, end: m.index + m[0].length, cls };
      if (best && best.start === pos) break; // cannot do better than here
    }
    if (!best) break;
    out.push(esc(raw.slice(pos, best.start)));
    out.push(`<span class="${best.cls}">${esc(raw.slice(best.start, best.end))}</span>`);
    pos = best.end;
  }
  out.push(esc(raw.slice(pos)));
  return out.join('');
}
