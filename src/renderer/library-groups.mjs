// Where a library item sits on the rail: this project vs this Mac, by type.
// Pure — no DOM — so the grouping is tested without a window.
//
// "Mac" in a key or a flag here means "this machine, not this project". Those
// are names in the code and in saved state, and they stay; only the label a
// person reads changes with the platform (platform-words.mjs).
import { currentPlatform } from './paths.mjs';
import { words } from './platform-words.mjs';

export function shelfGroups(platform = currentPlatform()) {
  const here = words(platform).thisMac;
  return [
    { key: 'agents', label: 'Agents' },
    { key: 'skills', label: 'Skills' },
    { key: 'services', label: 'MCP' },
    { key: 'mac-agents', label: 'Agents on ' + here, mac: true },
    { key: 'mac-skills', label: 'Skills on ' + here, mac: true },
    { key: 'mac-services', label: 'MCP on ' + here, mac: true },
    { key: 'mac-commands', label: 'Commands on ' + here, mac: true },
  ];
}

export const SHELF_GROUPS = shelfGroups();

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

// Walk ~/.claude/plugins (and the other CLI homes) only when a Mac group is
// open, or when the filter box has something to look for. Opening Library
// itself stays a folder scan.
export function shouldLoadMac({ openGroups, query, macLoaded } = {}) {
  if (macLoaded) return false;
  if (String(query || '').trim()) return true;
  const open = openGroups instanceof Set ? openGroups : new Set(openGroups || []);
  return MAC_GROUP_KEYS.some((k) => open.has(k));
}

export function macCountLabel({ loaded, n } = {}) {
  return loaded ? String(n || 0) : '…';
}

// ⌘K launches what this folder owns: masters and hand-made in-project files.
export function isPickerAgent(item) {
  return !!item && item.type === 'agent' && item.scope === 'project' && !item.shadows;
}
