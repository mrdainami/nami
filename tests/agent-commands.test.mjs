// The composer's slash-command source and router. The contract under test:
// every agent gets a menu (published list or static table), every entry
// carries a route, and /model on a channel with a live picker is intercepted
// rather than sent as prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATIC_COMMANDS, commandsFor, routeCommand } from '../src/renderer/agent-commands.mjs';

test('every one-shot channel has a static table, so its menu is never empty', () => {
  for (const agent of ['codex', 'kimi', 'agy']) {
    const cmds = commandsFor(agent, []);
    assert.ok(cmds.length > 0, agent + ' offers commands');
    for (const c of cmds) assert.ok(c.route, agent + '/' + c.name + ' carries a route');
  }
});

test('a published list wins over the static table', () => {
  const cmds = commandsFor('claude', [{ name: 'compact', description: 'from the channel' }]);
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].description, 'from the channel');
  assert.equal(cmds[0].route, 'send'); // executable as text — the channel runs it
});

test('claude with nothing published still shows the watch-mode table', () => {
  const cmds = commandsFor('claude', []);
  assert.ok(cmds.some((c) => c.name === 'model'));
});

test('/model is intercepted to the native picker even when the channel published it', () => {
  const r = routeCommand('claude', [{ name: 'model', description: 'Set the AI model' }], '/model');
  assert.equal(r.route, 'native-model');
});

test('a terminal-only command routes to the terminal, not into the channel', () => {
  const r = routeCommand('codex', [], '/approvals');
  assert.equal(r.route, 'terminal');
});

test('an unknown slash command falls through as send — the channel may know it', () => {
  const r = routeCommand('claude', [{ name: 'compact' }], '/my-own-skill now');
  assert.equal(r.route, 'send');
});

test('plain prose is not a command at all', () => {
  assert.equal(routeCommand('claude', [], 'fix the bug in app.js'), null);
  assert.equal(routeCommand('claude', [], ''), null);
});

test('string-shaped commands from a channel normalize like the richer shape', () => {
  const cmds = commandsFor('opencode', ['compact', 'undo']);
  assert.deepEqual(cmds.map((c) => c.name), ['compact', 'undo']);
  for (const c of cmds) assert.equal(c.route, 'send');
});

test('agy mode switches natively — its adapter owns the flag', () => {
  assert.equal(routeCommand('agy', [], '/mode').route, 'native-mode');
});

test('static tables never claim a send route on a one-shot channel', () => {
  for (const agent of ['codex', 'kimi']) {
    for (const c of STATIC_COMMANDS[agent]) {
      assert.notEqual(c.route, 'send', agent + '/' + c.name + ' cannot execute over exec/-p');
    }
  }
});

// Calvin's correction, 2026-08-13: a setting that is a spawn flag does not
// need a live process. /model is native on every channel — one-shots ride
// the next turn's --model — and the typed argument IS the control.
test('/model is native on every one-shot channel, not a terminal errand', () => {
  for (const agent of ['codex', 'kimi', 'agy']) {
    assert.equal(routeCommand(agent, [], '/model').route, 'native-model', agent);
  }
});

test('the argument rides along: /model gpt-5.2-codex carries its value', () => {
  const r = routeCommand('codex', [], '/model gpt-5.2-codex');
  assert.equal(r.route, 'native-model');
  assert.equal(r.arg, 'gpt-5.2-codex');
  assert.equal(routeCommand('kimi', [], '/model').arg, '');
});
