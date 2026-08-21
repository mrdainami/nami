// Who Nami actually writes to, by kind. The create sheet and coverage line
// read this rather than "every installed CLI". Keep it in step with:
//   agent → copyTargets in src/main/agent-master.js
//   skill → contextFile on KNOWN_AGENTS in src/main/agents-detect.js
//   mcp   → notebookTargets in src/main/connections.js
//
// Values: copy / via / announce / write (we do it),
//         none / manual (we don't; name them separately if they are installed),
//         missing from the table (we don't, and we don't mention them).

export const ADAPTERS = {
  agent: {
    claude: 'copy',
    opencode: 'copy',
    gemini: 'copy',
    antigravity: 'copy',
    kimi: 'copy',
    grok: 'copy',
    codex: 'copy',
    cursor: 'via',
    hermes: 'none',
  },
  skill: {
    claude: 'announce',
    codex: 'announce',
    opencode: 'announce',
    grok: 'announce',
    antigravity: 'announce',
    hermes: 'announce',
    kimi: 'announce',
  },
  mcp: {
    claude: 'write',
    cursor: 'write',
    gemini: 'write',
    antigravity: 'write',
    kimi: 'write',
    opencode: 'write',
    codex: 'write',
    hermes: 'manual',
  },
};

const WRITES = new Set(['copy', 'via', 'announce', 'write']);

export function adapterOf(kind, id) {
  const table = ADAPTERS[kind];
  return (table && table[id]) || '';
}

export function receiversOf(kind, installed) {
  return (installed || []).filter((id) => WRITES.has(adapterOf(kind, id)));
}

export function formatNames(names) {
  const n = (names || []).filter(Boolean);
  if (!n.length) return '';
  if (n.length === 1) return n[0];
  return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}

// Plain text for the create / connect sheets. nameOf turns an id into the
// label the rest of the app already uses (Claude Code, not claude).
export function knowsCopy({ kind, installed, nameOf, stubCount } = {}) {
  const ids = receiversOf(kind, installed);
  const name = nameOf || ((id) => id);
  const list = formatNames(ids.map(name));
  const hermes = (installed || []).includes('hermes');
  const many = ids.length !== 1;
  if (kind === 'agent') {
    if (!list) return '';
    return list + (many ? ' get a copy' : ' gets a copy');
  }
  if (kind === 'skill') {
    if (!list) return '';
    const n = stubCount || 0;
    const stub = n ? ` + ${n} stub${n === 1 ? '' : 's'}` : '';
    return list + '. Announced in AGENTS.md' + stub;
  }
  if (kind === 'mcp') {
    if (!list) return hermes ? 'Hermes: `hermes mcp`' : '';
    return list + (many ? ' get this connection' : ' gets this connection') + (hermes ? '. Hermes: `hermes mcp`' : '');
  }
  return list;
}
