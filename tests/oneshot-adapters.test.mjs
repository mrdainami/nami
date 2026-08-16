// The one-shot three — Codex, Kimi, Antigravity — tested against the streams
// the real CLIs produced. handleLine() takes parsed frames directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CodexAdapter, unwrapShell } = require('../src/main/adapters/codex.js');
const { KimiAdapter } = require('../src/main/adapters/kimi.js');
const { AgyAdapter, agyToolKind } = require('../src/main/adapters/agy.js');
const { EVENT_KINDS } = require('../src/main/agent-events.js');

function frames(name) {
  return fs.readFileSync(new URL(`./fixtures/agents/${name}`, import.meta.url), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
}
function replay(Adapter, fixture) {
  const events = [];
  const a = new Adapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  for (const f of frames(fixture)) a.handleLine(f);
  a.finishTurn();
  return { a, events };
}

test('every event from every one-shot replay is in the vocabulary', () => {
  for (const [A, f] of [[CodexAdapter, 'codex.jsonl'], [KimiAdapter, 'kimi.jsonl'], [AgyAdapter, 'agy.jsonl'], [AgyAdapter, 'agy2.jsonl']]) {
    for (const e of replay(A, f).events) {
      assert.ok(EVENT_KINDS.has(e.kind), `${f}: '${e.kind}' not in vocabulary`);
    }
  }
});

// ---- codex ------------------------------------------------------------------

test('codex: rows are commands with exit codes, prose interleaves, tokens not dollars', () => {
  const { a, events } = replay(CodexAdapter, 'codex.jsonl');
  const tools = events.filter((e) => e.kind === 'tool');
  assert.ok(tools.length >= 2);
  for (const t of tools) assert.equal(t.toolKind, 'execute');
  // the zsh -lc wrapper is unwrapped so the row reads as the command
  assert.ok(tools.some((t) => t.input.command.startsWith('sed -n')), 'wrapper must be stripped');
  const results = events.filter((e) => e.kind === 'tool_result');
  assert.ok(results.some((r) => r.body.includes('hello ${name}')));
  const prose = events.filter((e) => e.kind === 'assistant');
  assert.ok(prose.length >= 3, 'prose interleaves between commands');
  const end = events.find((e) => e.kind === 'turn_end');
  assert.ok(end.tokens > 0, 'tokens ride the meter');
  assert.ok(!('costUsd' in end), 'dollars stay off turn_end everywhere');
  assert.equal(a.threadId, 'ses_test', 'the thread id is kept for resume');
});

test('codex: the same command item is one row started and completed', () => {
  const { events } = replay(CodexAdapter, 'codex.jsonl');
  const toolIds = events.filter((e) => e.kind === 'tool').map((e) => e.toolId);
  assert.equal(new Set(toolIds).size, toolIds.length, 'no duplicate rows per item');
});

test('unwrapShell leaves a bare command alone', () => {
  assert.equal(unwrapShell('ls -la'), 'ls -la');
  assert.equal(unwrapShell('/bin/zsh -lc "ls -la"'), 'ls -la');
});

// ---- kimi -------------------------------------------------------------------

test('kimi: OpenAI-shaped calls become kind-typed rows and results pair by id', () => {
  const { a, events } = replay(KimiAdapter, 'kimi.jsonl');
  const tool = events.find((e) => e.kind === 'tool');
  assert.equal(tool.name, 'Read');
  assert.equal(tool.toolKind, 'read');
  assert.deepEqual(tool.input, { path: 'src/greet.js' });
  const result = events.find((e) => e.kind === 'tool_result');
  assert.equal(result.toolId, tool.toolId);
  assert.ok(result.body.includes('greet'));
  const prose = events.find((e) => e.kind === 'assistant');
  assert.match(prose.text, /greet/);
});

test('kimi: the resume hint becomes the session id the composer continues with', () => {
  const { a, events } = replay(KimiAdapter, 'kimi.jsonl');
  assert.equal(a.sessionId, 'session_ses_test');
  const init = events.filter((e) => e.kind === 'init').at(-1);
  assert.equal(init.agentSessionId, 'session_ses_test');
});

// ---- antigravity ------------------------------------------------------------

test('agy: the step timeline becomes tool rows with outputs and errors', () => {
  const { events } = replay(AgyAdapter, 'agy2.jsonl');
  const tools = events.filter((e) => e.kind === 'tool');
  assert.ok(tools.some((t) => t.name === 'list_dir' && t.toolKind === 'search'));
  assert.ok(tools.some((t) => t.name === 'view_file' && t.toolKind === 'read'));
  const results = events.filter((e) => e.kind === 'tool_result');
  assert.ok(results.some((r) => r.body.includes('README.md')), 'tool output lands on the row');
});

test('agy: an ERROR step is an errored row, not silence', () => {
  const { events } = replay(AgyAdapter, 'agy.jsonl');
  const errs = events.filter((e) => e.kind === 'tool_result' && e.isError);
  assert.ok(errs.length >= 2, 'the capture has two failing tools');
  assert.ok(errs.some((r) => r.body.length > 0), 'the error message rides the body');
});

test('agy: checkpoints are their own kind of row', () => {
  const { events } = replay(AgyAdapter, 'agy.jsonl');
  const cp = events.find((e) => e.kind === 'tool' && e.toolKind === 'checkpoint');
  assert.ok(cp, 'checkpoint step must surface');
});

test('agy: response deltas grow one row, and the final response is not said twice', () => {
  const { events } = replay(AgyAdapter, 'agy2.jsonl');
  const deltas = events.filter((e) => e.kind === 'assistant' && e.id.includes(':r'));
  assert.ok(deltas.length >= 2, 'deltas re-emit the growing text');
  assert.equal(new Set(deltas.map((e) => e.id)).size, 1, 'one growing row per step');
  const finals = events.filter((e) => e.kind === 'assistant' && !e.id.includes(':r'));
  assert.equal(finals.length, 0, 'the result.response was already streamed');
  assert.match(deltas.at(-1).text, /greet/);
});

test('agy: a run that never streamed prose says the result once', () => {
  const { events } = replay(AgyAdapter, 'agy.jsonl');
  // agy.jsonl has an empty response and no deltas — nothing to say, no error
  const finals = events.filter((e) => e.kind === 'assistant');
  assert.equal(finals.length, 0);
  const end = events.find((e) => e.kind === 'turn_end');
  assert.equal(end.ok, true);
  assert.ok(end.tokens > 0);
  assert.ok(end.durationMs > 8000, 'duration comes from the result frame');
});

test('agy: tool kinds map by what the tool does', () => {
  assert.equal(agyToolKind('run_command'), 'execute');
  assert.equal(agyToolKind('grep_search'), 'search');
  assert.equal(agyToolKind('view_file'), 'read');
  assert.equal(agyToolKind('write_to_file'), 'edit');
  assert.equal(agyToolKind('read_url_content'), 'fetch');
  assert.equal(agyToolKind('browser_click_element'), 'fetch');
  assert.equal(agyToolKind('totally_new'), 'other');
});

// ---- the shared one-shot contract ------------------------------------------

test('one-shots declare their channel honestly: no ask, one-shot badge', () => {
  for (const [A, f] of [[CodexAdapter, 'codex.jsonl'], [KimiAdapter, 'kimi.jsonl'], [AgyAdapter, 'agy.jsonl']]) {
    const { events } = replay(A, f);
    const init = events.find((e) => e.kind === 'init');
    assert.equal(init.capability.ask, false, `${f}: headless cannot be asked`);
    assert.equal(init.capability.channel, 'one-shot');
    assert.ok(init.capability.note, `${f}: the limitation must be said`);
  }
});

// ---- every adapter spawns the program the scan found -----------------------
// These four used to spawn a bare name against a login PATH captured once at
// app start. Install an agent inside Nami and its card view kept failing with
// ENOENT until the app was restarted, while the launcher — which re-probes the
// shell on every ⌘N — insisted it was ready. Checked at the source so an
// adapter added next year cannot quietly reintroduce it.
test('no adapter spawns a bare program name any more', () => {
  const files = ['acp.js', 'codex.js', 'kimi.js', 'agy.js'];
  let checked = 0;
  for (const f of files) {
    // comments stripped first — these files explain spawn() in prose, and prose
    // about a call is not a call
    const src = fs.readFileSync(new URL(`../src/main/adapters/${f}`, import.meta.url), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const m of src.matchAll(/(?:=|await)\s*spawn\(([^,]+),/g)) {
      const arg = m[1].trim();
      checked++;
      assert.ok(
        arg.includes('knownBin('),
        `${f} spawns ${arg} without consulting the scan — see src/main/bin-cache.js`,
      );
    }
  }
  // a guard that inspects nothing passes forever; these four each spawn once
  assert.equal(checked, 4, 'expected one spawn call per adapter — did one move?');
});

// The fallback is what keeps this safe: before the first scan lands, and on a
// machine where the shell probe fails entirely, the bare name is still used.
test('the known-path lookup always falls back to the bare name', () => {
  const { knownBin, forgetBins } = require('../src/main/bin-cache.js');
  forgetBins();
  assert.equal(knownBin('opencode') || 'opencode', 'opencode');
  assert.equal(knownBin('codex') || 'codex', 'codex');
});

// Displayed state is sent state: the welcome shows accept-edits, so the first
// turn must spawn with that mode — before the seed, the chip said one thing
// and the flags said nothing.
test('agy seeds its mode on start, and announces every mode as available', async () => {
  const events = [];
  const a = new AgyAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  await a.start({ prompt: null, sid: null });
  assert.equal(a.mode, 'accept-edits');
  const init = events.find((e) => e.kind === 'init');
  assert.deepEqual(init.modes.map((m) => m.id), ['accept-edits', 'plan', 'skip-permissions']);
  assert.ok(init.modes.every((m) => m.available));
  assert.equal(init.mode, 'accept-edits');
});

// /model on the one-shot channels: the choice is kept on the adapter and
// every following turn spawns with the flag — no live process required.
test('codex keeps a chosen model and spawns the next turn with --model', () => {
  const events = [];
  const a = new CodexAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  assert.deepEqual(a.turnArgs('hi'), ['exec', '--json', '--skip-git-repo-check', 'hi']);
  a.setConfigOption('model', 'gpt-5.2-codex');
  assert.deepEqual(a.turnArgs('hi'), ['exec', '--json', '--skip-git-repo-check', '--model', 'gpt-5.2-codex', 'hi']);
  a.threadId = 'th_1';
  assert.deepEqual(a.turnArgs('hi'), ['exec', 'resume', 'th_1', '--json', '--skip-git-repo-check', '--model', 'gpt-5.2-codex', 'hi']);
  const init = events.filter((e) => e.kind === 'init').at(-1);
  assert.equal(init.model, 'gpt-5.2-codex');
});

test('kimi keeps a chosen model; -m sits before -p so it is never swallowed', () => {
  const events = [];
  const a = new KimiAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.setConfigOption('model', 'kimi-k2.6-turbo');
  assert.deepEqual(a.turnArgs('hi'), ['-m', 'kimi-k2.6-turbo', '-p', 'hi', '--output-format', 'stream-json']);
  a.sessionId = 's1';
  assert.deepEqual(a.turnArgs('hi'), ['-r', 's1', '-m', 'kimi-k2.6-turbo', '-p', 'hi', '--output-format', 'stream-json']);
  const init = events.filter((e) => e.kind === 'init').at(-1);
  assert.equal(init.model, 'kimi-k2.6-turbo');
});

// codex's approval story wears the CLI's own preset names (probed on 0.147.0:
// Auto / Read Only / Full Access), expressed as next-turn flags: auto passes
// nothing (the CLI's default), read-only maps to --sandbox, full access is the
// dangerously- flag.
test('codex modes ride the next turn: auto-nothing, read-only sandbox, full-access bypass', () => {
  const a = new CodexAdapter({ id: 't1', cwd: '/repo', onEvent: () => {} });
  assert.ok(!a.turnArgs('hi').join(' ').match(/sandbox|dangerously/));
  a.setConfigOption('mode', 'read-only');
  assert.deepEqual(a.turnArgs('hi'), ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', 'hi']);
  a.setConfigOption('mode', 'full-access');
  assert.ok(a.turnArgs('hi').includes('--dangerously-bypass-approvals-and-sandbox'));
  a.setConfigOption('mode', 'auto');
  assert.ok(!a.turnArgs('hi').join(' ').match(/sandbox|dangerously/));
  a.setConfigOption('mode', 'nonsense'); // unknown value falls back, never a bad flag
  assert.ok(!a.turnArgs('hi').join(' ').match(/sandbox|dangerously|nonsense/));
});

test('codex announces the CLI presets on init, all available', () => {
  const events = [];
  const a = new CodexAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.emitInit();
  const init = events.find((e) => e.kind === 'init');
  assert.deepEqual(init.modes.map((m) => m.id), ['auto', 'read-only', 'full-access']);
  assert.equal(init.mode, 'auto');
  assert.ok(init.modes.every((m) => m.available));
});

// The picker's options are honest per channel: kimi reads the user's own
// config aliases; codex's curated list always includes the configured
// current model, even one it has never heard of.
const { readModelOptions } = require('../src/main/adapters/kimi.js');
const { modelOptions, CODEX_MODELS } = require('../src/main/adapters/codex.js');

test('kimi model options come from the config\'s [models] sections', () => {
  const toml = [
    'default_model = "moonshot-ai/kimi-k2.6"',
    '[models."moonshot-ai/kimi-k2.6"]', 'model = "kimi-k2.6"',
    '[models."moonshot-ai/kimi-k3"]', 'model = "kimi-k3"',
  ].join('\n');
  const opts = readModelOptions(toml);
  assert.deepEqual(opts.map((o) => o.value), ['moonshot-ai/kimi-k2.6', 'moonshot-ai/kimi-k3']);
  assert.equal(opts[0].name, 'kimi-k2.6'); // display drops the provider prefix
  assert.deepEqual(readModelOptions(''), []);
});

test('codex options always contain the configured current model', () => {
  const known = modelOptions(CODEX_MODELS[1].value);
  assert.equal(known.length, CODEX_MODELS.length);
  const custom = modelOptions('my-own-alias');
  assert.equal(custom[0].value, 'my-own-alias');
  assert.match(custom[0].desc, /config/);
});
