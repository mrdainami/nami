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

test('a published entry wins over its static twin; native ops still append', () => {
  const cmds = commandsFor('claude', [{ name: 'compact', description: 'from the channel' }]);
  const compact = cmds.find((c) => c.name === 'compact');
  assert.equal(compact.description, 'from the channel'); // the channel's wording wins
  assert.equal(compact.route, 'send'); // executable as text — the channel runs it
  assert.equal(cmds.filter((c) => c.name === 'compact').length, 1); // never doubled
  // the card's own ops ride along even though the channel never named them
  assert.ok(cmds.some((c) => c.name === 'resume' && c.route === 'native-resume'));
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
  const r = routeCommand('codex', [], '/mcp');
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
  for (const n of ['compact', 'undo']) {
    const c = cmds.find((x) => x.name === n);
    assert.ok(c, n + ' kept');
    assert.equal(c.route, 'send'); // the channel executes its own commands as text
  }
  assert.ok(cmds.some((c) => c.name === 'resume')); // natives still append
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

// Conversation ops are native everywhere: /resume opens the card's own
// picker, /clear and /new mint a fresh conversation — including when the
// channel published its own list (claude), where the override wins.
test('/resume and /clear are conversation ops on every agent', () => {
  for (const agent of ['claude', 'codex', 'kimi', 'agy']) {
    assert.equal(routeCommand(agent, [], '/resume').route, 'native-resume', agent);
  }
  assert.equal(routeCommand('claude', [{ name: 'clear' }, { name: 'resume' }], '/clear').route, 'native-clear');
  assert.equal(routeCommand('claude', [{ name: 'resume' }], '/resume').route, 'native-resume');
  assert.equal(routeCommand('codex', [], '/new').route, 'native-clear');
});

test('codex /approvals opens the native mode menu now', () => {
  assert.equal(routeCommand('codex', [], '/approvals').route, 'native-mode');
});

// Calvin hit this live: claude's SDK publishes no 'resume', so /resume fell
// through as text and the channel answered "isn't available in this
// environment." A name the card owns natively is intercepted no matter what
// the channel published — and the menu offers it too.
test('native ops win even when the channel never published the name', () => {
  const published = [{ name: 'compact' }, { name: 'review-pr' }];
  assert.equal(routeCommand('claude', published, '/resume').route, 'native-resume');
  assert.equal(routeCommand('claude', published, '/clear').route, 'native-clear');
  assert.equal(routeCommand('claude', published, '/model').route, 'native-model');
  const names = commandsFor('claude', published).map((c) => c.name);
  assert.ok(names.includes('resume') && names.includes('clear') && names.includes('compact'));
});

// The audit, made permanent: no agent's menu is ever empty, no native-owned
// name ever routes 'send' anywhere, and /mode never mails itself to a
// channel as text — the exact class of bug this sweep kept finding.
test('audit: every agent has a menu and native names never leak as send', () => {
  const NATIVE = ['model', 'mode', 'approvals', 'resume', 'clear', 'new'];
  for (const agent of ['claude', 'codex', 'kimi', 'agy', 'opencode', 'hermes']) {
    assert.ok(commandsFor(agent, []).length > 0, agent + ' menu must never be empty');
    for (const n of NATIVE) {
      const r = routeCommand(agent, [], '/' + n);
      assert.ok(r.route.startsWith('native'), `${agent} /${n} → ${r.route}`);
    }
  }
});
