import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shelfOf, cliKey, isMacItem, serviceShelf, SHELF_GROUPS, MAC_GROUP_KEYS, isPickerAgent } from '../src/renderer/library-groups.mjs';

const item = (over) => ({ type: 'agent', platform: 'project', scope: 'project', slug: 'x', ...over });

test('a master and an in-folder Claude agent sit on the project Agents shelf', () => {
  assert.equal(shelfOf(item()), 'agents');
  assert.equal(shelfOf(item({ platform: 'claude' })), 'agents');
  assert.equal(isMacItem(item()), false);
});

test('user and plugin agents sit on Agents on this Mac', () => {
  assert.equal(shelfOf(item({ scope: 'user', platform: 'claude' })), 'mac-agents');
  assert.equal(shelfOf(item({ scope: 'plugin', platform: 'claude' })), 'mac-agents');
  assert.equal(cliKey(item({ scope: 'plugin', platform: 'claude' })), 'claude');
});

test('project skills vs Mac skills', () => {
  assert.equal(shelfOf(item({ type: 'skill', platform: 'project' })), 'skills');
  assert.equal(shelfOf(item({ type: 'skill', platform: 'claude', scope: 'project' })), 'skills');
  assert.equal(shelfOf(item({ type: 'skill', platform: 'codex', scope: 'user' })), 'mac-skills');
  assert.equal(cliKey(item({ type: 'skill', platform: 'codex', scope: 'user' })), 'codex');
});

test('OpenCode commands are not Skills', () => {
  assert.equal(shelfOf(item({ type: 'command', platform: 'opencode', scope: 'project' })), 'mac-commands');
  assert.equal(shelfOf(item({ type: 'command', platform: 'opencode', scope: 'user' })), 'mac-commands');
});

test('gemini folder maps to antigravity; a master has no cli key', () => {
  assert.equal(cliKey(item({ platform: 'gemini', scope: 'project' })), 'antigravity');
  assert.equal(cliKey(item()), '');
});

test('a service with a project scope is the project Services shelf', () => {
  assert.equal(serviceShelf({ scopes: ['project'] }), 'services');
  assert.equal(serviceShelf({ scopes: ['user'] }), 'mac-services');
  assert.equal(serviceShelf({ scopes: ['project', 'user'] }), 'services');
});

test('Mac groups are named so the rail can collapse them by default', () => {
  assert.ok(MAC_GROUP_KEYS.includes('mac-agents'));
  assert.ok(SHELF_GROUPS.some((g) => g.key === 'agents' && !g.mac));
});

test('⌘K lists a master and an in-folder Claude agent, not a plugin or ~/.claude file', () => {
  assert.equal(isPickerAgent(item()), true);
  assert.equal(isPickerAgent(item({ platform: 'claude', scope: 'project' })), true);
  assert.equal(isPickerAgent(item({ scope: 'plugin', platform: 'claude' })), false);
  assert.equal(isPickerAgent(item({ scope: 'user', platform: 'claude' })), false);
  assert.equal(isPickerAgent(item({ type: 'skill', scope: 'project' })), false);
  assert.equal(isPickerAgent(item({ shadows: 'x' })), false);
});
