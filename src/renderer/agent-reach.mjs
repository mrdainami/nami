// Which tools an agent can run on, and which one its row launches.
//
// Nothing here is stored. Reach falls out of two facts that already exist —
// where the file sits (the library's `platform`) and which binaries this Mac
// has (`detectAgents`). The launch tool falls out of a resolution order whose
// every step is a default and none of which is a lock.
//
// Pure by design, like seed-text.mjs and claude-args.js: no DOM, no app state,
// so the rules are tested rather than remembered.

// The library names folders; agents-detect names binaries. They agree
// everywhere except Antigravity, which replaced Gemini CLI and still reads
// ~/.gemini — so the folder is `gemini` and the tool is `antigravity`.
export const PLATFORM_TO_TOOL = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  gemini: 'antigravity',
  kimi: 'kimi',
};

// A master lives in the project's own drawer and wears no tool's name.
export const MASTER_PLATFORM = 'project';

// Every tool agent-master.js can render a dialect for. Hermes is absent because
// it reads no agent format at all; Cursor is absent because it reads Claude's
// copy and is not a binary Nami detects.
export const WRITERS = ['claude', 'codex', 'opencode', 'antigravity', 'kimi'];

export function isMaster(item) {
  return !!item && item.platform === MASTER_PLATFORM;
}

// A master is this folder's file. Anything else is a file in
// one tool's own folder, and that tool is the whole answer.
export function reachOf(item) {
  if (!item) return [];
  if (isMaster(item)) return [...WRITERS];
  const tool = PLATFORM_TO_TOOL[item.platform];
  return tool ? [tool] : [];
}

export function canRunOn(item, toolId) {
  return reachOf(item).includes(toolId);
}

// Four candidates, best first, each one skipped unless the agent can speak it
// and this Mac has it. Claude breaks the final tie only because it is the one
// tool Nami can assume something about.
export function resolveTool({ item, remembered, focusedTool, installed } = {}) {
  const reach = reachOf(item);
  const have = new Set(installed || []);
  const ok = (id) => !!id && reach.includes(id) && have.has(id);

  const declared = item && item.meta ? item.meta.tool : '';
  for (const candidate of [remembered, declared, focusedTool]) {
    if (ok(candidate)) return candidate;
  }
  const rest = reach.filter((id) => have.has(id));
  if (!rest.length) return null;
  return rest.includes('claude') ? 'claude' : rest[0];
}

// The one line under the name. It answers "where did this come from", which is
// also the answer to "why can it only run there".
export function originLine(item, nameOf = (id) => id) {
  if (!item) return '';
  if (isMaster(item)) return 'this folder';
  const tool = nameOf(PLATFORM_TO_TOOL[item.platform] || item.platform);
  if (item.scope === 'plugin') return `from a plugin · ${tool} · read-only`;
  if (item.scope === 'user') return `yours in every folder · ${tool}`;
  return `${tool} only · hand-made, never overwritten`;
}

// Masters first — they are the ones that go anywhere. Then this folder's own,
// then the ones that follow you between folders, then somebody else's.
export function sortKey(item) {
  if (isMaster(item)) return 0;
  if (item && item.scope === 'project') return 1;
  if (item && item.scope === 'user') return 2;
  return 3;
}
