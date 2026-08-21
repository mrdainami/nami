// Where a library item sits on the rail: this project vs this Mac, by type.
// Pure — no DOM — so the grouping is tested without a window.

export const SHELF_GROUPS = [
  { key: 'agents', label: 'Agents' },
  { key: 'skills', label: 'Skills' },
  { key: 'services', label: 'Services' },
  { key: 'mac-agents', label: 'Agents on this Mac', mac: true },
  { key: 'mac-skills', label: 'Skills on this Mac', mac: true },
  { key: 'mac-services', label: 'Services on this Mac', mac: true },
  { key: 'mac-commands', label: 'Commands on this Mac', mac: true },
];

export const CLI_ORDER = [
  'claude', 'codex', 'opencode', 'grok', 'kimi', 'antigravity', 'hermes', 'cursor', 'agents',
];

export function isMacItem(item) {
  return !!item && (item.scope === 'user' || item.scope === 'plugin');
}

export function shelfOf(item) {
  if (!item) return '';
  if (item.type === 'command') return 'mac-commands';
  const mac = isMacItem(item);
  if (item.type === 'agent') return mac ? 'mac-agents' : 'agents';
  if (item.type === 'skill') return mac ? 'mac-skills' : 'skills';
  return '';
}

// Which CLI a Mac (or in-folder leftover) row belongs to. Empty for a project master.
export function cliKey(item) {
  if (!item) return '';
  if (item.scope === 'plugin') return 'claude';
  const p = item.platform;
  if (!p || p === 'project') return '';
  if (p === 'gemini') return 'antigravity';
  return p;
}

export function serviceShelf(sv) {
  const scopes = (sv && sv.scopes) || [];
  return scopes.includes('project') ? 'services' : 'mac-services';
}

export const MAC_GROUP_KEYS = SHELF_GROUPS.filter((g) => g.mac).map((g) => g.key);

// ⌘K launches what this folder owns: masters and hand-made in-project files.
export function isPickerAgent(item) {
  return !!item && item.type === 'agent' && item.scope === 'project' && !item.shadows;
}
