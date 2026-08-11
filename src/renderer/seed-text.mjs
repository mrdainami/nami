// Seed prompts for sessions that build or improve library items.
// Pure strings, no DOM: unit-tested in tests/seed-text.test.mjs.
// Skills go in the project's own `skills/`, with no agent's name on the folder —
// the moment it reads `.claude/skills` the other six look like guests. They are
// project-scoped only: the pointer works because agents read AGENTS.md when they
// open *this folder*, and there is no equivalent for a machine-wide skill short
// of writing into every agent's global config.
export function targetDirFor({ type, platform, scope, projectPath }) {
  const root = scope === 'project' ? (projectPath || '.') : '~';
  if (type === 'skill') return (projectPath || '.') + '/skills';
  if (platform === 'claude' && type === 'agent') return root + '/.claude/agents';
  if (platform === 'opencode' && type === 'agent') {
    return scope === 'project' ? root + '/.opencode/agent' : '~/.config/opencode/agent';
  }
  return root;
}

// Three beats, not one order: ask → propose → write. The session this seeds is a real
// interactive CLI, so the only thing that stopped it interviewing was being told to write
// immediately. Kept to a single line — the pty seeder types this then presses Enter
// (main.js term:create), and an embedded newline would submit the turn early.
export function buildCreateSeed({ type, platform, scope, name, desc, projectPath }) {
  const dir = targetDirFor({ type, platform, scope, projectPath });
  const naming = name && name.trim()
    ? `Name it "${name.trim()}".`
    : 'Choose a short kebab-case name for it yourself, two or three words, from the description.';
  const shape = type === 'skill'
    ? `a folder under ${dir} holding a SKILL.md`
    : `a markdown file in ${dir}`;
  // A skill is not built "for" any one agent, so saying which platform asked for
  // it would be a lie — and would invite the agent to write something specific
  // to itself, which is precisely what the pointer exists to avoid.
  if (type === 'skill') {
    return `I want a new skill that does this: ${desc.trim()}. ${naming} `
      + 'Do not write any files yet. First, ask me 2 to 4 short numbered questions in one message — '
      + 'when it should be used, which tools it needs, what a good result looks like, and anything '
      + 'else you would otherwise have to guess at. Then show me the plan: the final name, the '
      + 'frontmatter you intend to write, and a short outline of the instructions. Wait for me to '
      + `say go. Only after I say go, write it as ${shape}, with real frontmatter and real `
      + 'instructions and no placeholder text. Keep it agent-agnostic — any coding agent should be '
      + 'able to follow it, so do not mention a specific tool unless the skill is genuinely about '
      + 'one. Then tell me its final name and where it landed.';
  }
  return `I want a new ${platform} ${type} that does this: ${desc.trim()}. ${naming} `
    + 'Do not write any files yet. First, ask me 2 to 4 short numbered questions in one message — '
    + 'when it should be used, which tools it needs, what a good result looks like, and anything '
    + 'else you would otherwise have to guess at. Then show me the plan: the final name, the '
    + 'frontmatter you intend to write, and a short outline of the instructions. Wait for me to '
    + `say go. Only after I say go, write it as ${shape}, with real frontmatter and real `
    + 'instructions and no placeholder text, and then tell me its final name and where it landed.';
}

export function buildImproveSeed({ platform, type, filePath, ask }) {
  return `Edit the ${platform} ${type} at ${filePath}. ${ask.trim()} Keep the file's format valid, and keep its name unless I asked you to rename it.`;
}
