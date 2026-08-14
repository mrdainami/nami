// The launch table: for each tool, exactly how a clicked agent becomes a live
// session. Two mechanics exist, and the table never blurs them:
//
//   flag — the tool has a native launch-as-agent flag; the session opens
//          already being the agent. Nothing is typed.
//   seed — no such flag; Nami opens a plain session and types one summoning
//          sentence in that tool's own idiom.
//
// Every entry is backed by a probe transcript in
// specs/2026-08-13-agents-universal.md, Appendix A — run on this machine,
// answer checked for the agent's own identity line. Change an entry only with
// new probe evidence; the tests pin each string on purpose.
//
//   claude      A.1  `claude --agent <slug>`  reads .claude/agents/
//   opencode    A.2  `opencode --agent <slug>`  header even names the agent
//   antigravity A.4  `agy --agent <slug>`  discovers ~/.gemini/agents only
//   codex       A.5  seeded "Spawn <slug> …" → native SpawnAgent delegation
//   kimi        A.3  0.35/0.36 TUI ignores --agent/--agent-file (headless
//                    honors them) — seeded to read its delivered copy; flip
//                    to the flag the release the TUI starts honoring it
//   hermes      —    no custom agents

const TABLE = {
  claude: { kind: 'flag', status: 'verified', argv: (slug) => ['--agent', slug] },
  opencode: { kind: 'flag', status: 'verified', argv: (slug) => ['--agent', slug] },
  antigravity: { kind: 'flag', status: 'verified', argv: (slug) => ['--agent', slug] },
  codex: {
    kind: 'seed', status: 'seeded',
    seed: (slug) => `Spawn ${slug} to take the task I describe next.`,
  },
  kimi: {
    kind: 'seed', status: 'seeded',
    seed: (slug) => `Read .kimi-code/agents/${slug}.md and adopt it as your role for this entire session.`,
  },
};

const NONE = Object.freeze({ kind: 'none', status: 'none', argv: Object.freeze([]), seed: '' });

export function agentLaunch(toolId, slug) {
  const t = TABLE[toolId];
  if (!t) return NONE;
  if (t.kind === 'flag') return { kind: 'flag', status: t.status, argv: t.argv(slug), seed: '' };
  return { kind: 'seed', status: t.status, argv: [], seed: t.seed(slug) };
}
