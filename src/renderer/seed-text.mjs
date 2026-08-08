// Seed prompts for sessions that build or improve library items.
// Pure strings, no DOM: unit-tested in tests/seed-text.test.mjs.
export function targetDirFor({ type, platform, scope, projectPath }) {
  const root = scope === 'project' ? (projectPath || '.') : '~';
  if (platform === 'claude' && type === 'agent') return root + '/.claude/agents';
  if (platform === 'claude' && type === 'skill') return root + '/.claude/skills';
  if (platform === 'opencode' && type === 'agent') {
    return scope === 'project' ? root + '/.opencode/agent' : '~/.config/opencode/agent';
  }
  return root;
}

export function buildCreateSeed({ type, platform, scope, name, desc, projectPath }) {
  const dir = targetDirFor({ type, platform, scope, projectPath });
  const naming = name && name.trim()
    ? `Name it "${name.trim()}".`
    : 'Choose a short kebab-case name for it yourself, two or three words, from the description.';
  const shape = type === 'skill'
    ? `Create the skill as a folder under ${dir} holding a SKILL.md`
    : `Create the ${platform} ${type} as a markdown file in ${dir}`;
  return `${shape} that does this: ${desc.trim()}. ${naming} Write real frontmatter and real instructions, no placeholder text. When it is written, tell me its final name and where it landed.`;
}

export function buildImproveSeed({ platform, type, filePath, ask }) {
  return `Edit the ${platform} ${type} at ${filePath}. ${ask.trim()} Keep the file's format valid, and keep its name unless I asked you to rename it.`;
}
