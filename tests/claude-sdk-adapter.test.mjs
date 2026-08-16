// The claude-sdk adapter, tested against frames a real SDK session produced
// (tests/fixtures/agents/claude-sdk*.jsonl — recorded, sanitised, never
// imagined). handle() is pure enough to feed directly: no query, no process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ClaudeSdkAdapter } = require('../src/main/adapters/claude-sdk.js');
const { EVENT_KINDS, BODY_CAP } = require('../src/main/agent-events.js');

function fixture(name) {
  return fs.readFileSync(new URL(`./fixtures/agents/${name}`, import.meta.url), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
}

function drive(name) {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  for (const rec of fixture(name)) {
    if (rec.kind === 'canUseTool') {
      // Recorded at the callback boundary: replay it the same way.
      a.askPermission(rec.msg.toolName, rec.msg.input, { suggestions: rec.msg.suggestions, ...rec.msg.opts });
    } else {
      a.handle(rec.msg || rec);
    }
  }
  return { a, events };
}

test('every event the adapter emits is in the vocabulary', () => {
  for (const f of ['claude-sdk.jsonl', 'claude-sdk2.jsonl', 'claude-sdk3.jsonl', 'claude-sdk4.jsonl']) {
    for (const e of drive(f).events) {
      assert.ok(EVENT_KINDS.has(e.kind), `${f}: '${e.kind}' is not in the vocabulary`);
      assert.ok(e.id, `${f}: event without an id`);
    }
  }
});

test('a tool_result carries its body — the first build threw it away', () => {
  const { events } = drive('claude-sdk4.jsonl');
  const results = events.filter((e) => e.kind === 'tool_result');
  assert.ok(results.length >= 3, 'expected tool results in the capture');
  assert.ok(results.some((r) => r.body && r.body.length > 0), 'no result kept its body');
  for (const r of results) {
    assert.ok(typeof r.body === 'string');
    assert.ok(r.body.length <= BODY_CAP);
    assert.equal(typeof r.truncated, 'boolean');
  }
});

test('tool events carry the kind the row is keyed to, and the raw input', () => {
  const { events } = drive('claude-sdk4.jsonl');
  const tools = events.filter((e) => e.kind === 'tool');
  assert.ok(tools.length >= 2);
  for (const t of tools) {
    assert.ok(['read', 'edit', 'execute', 'search', 'fetch', 'think', 'checkpoint', 'other'].includes(t.toolKind));
    assert.ok(t.input && typeof t.input === 'object');
    assert.ok(t.toolId);
  }
  assert.ok(tools.some((t) => t.name === 'Bash' && t.toolKind === 'execute'));
});

test('the permission event carries what the agent sent: title, description, options from suggestions', () => {
  const { a, events } = drive('claude-sdk4.jsonl');
  const perms = events.filter((e) => e.kind === 'permission');
  assert.equal(perms.length, 2);

  const bash = perms[0];
  assert.equal(bash.toolName, 'Bash');
  assert.equal(bash.title, 'Bash');
  assert.equal(bash.description, 'Remove build dir and create probe.txt');
  // allow · the agent's own suggestion · deny — never fewer than the channel offered
  assert.equal(bash.options.length, 3);
  assert.equal(bash.options[0].id, 'allow');
  assert.match(bash.options[1].label, /rm -rf build/);
  assert.equal(bash.options.at(-1).id, 'deny');

  const write = perms[1];
  assert.equal(write.toolName, 'Write');
  assert.match(write.options[1].label, /[Aa]ccept edits/);
  // A Write asks with the content it wants to land: the diff rides the event.
  assert.ok(write.diff && typeof write.diff.newText === 'string');
  assert.ok(write.diff.path);

  // Answering with the suggestion resolves allow + that suggestion, and the
  // resolution is announced so the card can settle the row.
  const answered = [];
  a.pendingPermissions.get(bash.permissionId); // exists
  const before = events.length;
  const resolutionPromise = a.pendingResults && null;
  a.resolvePermission(bash.permissionId, bash.options[1].id);
  const resolved = events.slice(before).find((e) => e.kind === 'permission_resolved');
  assert.ok(resolved, 'no permission_resolved emitted');
  assert.equal(resolved.permissionId, bash.permissionId);
  assert.equal(resolved.optionId, bash.options[1].id);
});

test('askPermission resolves to the SDK shape for each option', async () => {
  const a = new ClaudeSdkAdapter({ id: 't2', cwd: '/repo', onEvent: () => {} });
  const sugg = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];

  const p1 = a.askPermission('Write', { file_path: '/repo/x', content: 'hi' }, { suggestions: sugg });
  const perm1 = [...a.pendingPermissions.keys()][0];
  a.resolvePermission(perm1, 'allow');
  assert.deepEqual(await p1, { behavior: 'allow', updatedInput: { file_path: '/repo/x', content: 'hi' } });

  const p2 = a.askPermission('Write', { file_path: '/repo/x', content: 'hi' }, { suggestions: sugg });
  const perm2 = [...a.pendingPermissions.keys()][0];
  a.resolvePermission(perm2, 'sugg:0');
  const r2 = await p2;
  assert.equal(r2.behavior, 'allow');
  assert.deepEqual(r2.updatedPermissions, sugg);

  const p3 = a.askPermission('Bash', { command: 'rm -rf /' }, {});
  const perm3 = [...a.pendingPermissions.keys()][0];
  a.resolvePermission(perm3, 'deny');
  const r3 = await p3;
  assert.equal(r3.behavior, 'deny');
});

test('a rate limit that bites is a note; one that allows is silence', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 'rl', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' } });
  assert.equal(events.filter((e) => e.kind === 'note').length, 0, 'an allowed check is not news');
  a.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1786521600 } });
  const notes = events.filter((e) => e.kind === 'note');
  assert.equal(notes.length, 1, 'a rejection must surface');
  assert.match(notes[0].text, /[Rr]ate limit/);
});

test('init carries the slash commands the agent published', () => {
  const { events } = drive('claude-sdk.jsonl');
  const init = events.find((e) => e.kind === 'init');
  assert.ok(Array.isArray(init.commands) && init.commands.length > 0, 'slash_commands vanished');
  assert.equal(init.capability.commands, true);
});

test('the turn ends with a meter: duration, cost, turns', () => {
  const { events } = drive('claude-sdk.jsonl');
  const ends = events.filter((e) => e.kind === 'turn_end');
  assert.ok(ends.length >= 1);
  assert.ok(ends[0].durationMs > 0);
});

test('todo updates become a plan event', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 't3', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'tu1', name: 'TodoWrite', input: { todos: [{ content: 'do it', status: 'pending' }] } }] },
  });
  const plan = events.find((e) => e.kind === 'plan');
  assert.ok(plan);
  assert.equal(plan.todos[0].text, 'do it');
  assert.equal(plan.todos[0].status, 'pending');
});

test('a sub-agent turn is marked with its parent tool, so the card can fold it', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 't4', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({
    type: 'assistant', parent_tool_use_id: 'task1',
    message: { content: [{ type: 'text', text: 'sub says hi' }] },
  });
  assert.equal(events[0].parentToolId, 'task1');
});

test('init announces the channel and what it can do', () => {
  const { events } = drive('claude-sdk.jsonl');
  const init = events.find((e) => e.kind === 'init');
  assert.ok(init);
  assert.equal(init.capability.drive, true);
  assert.equal(init.capability.ask, true);
  assert.equal(init.capability.interrupt, true);
  assert.equal(init.capability.channel, 'agent sdk');
  assert.ok(init.agentSessionId);
});

// ---- step 20: session-identity parity, one line of the checklist per assert
test('sdkOptions keeps identity parity with the pty path', () => {
  const { sdkOptions } = require('../src/main/adapters/claude-sdk.js');
  const canUseTool = () => {};
  const env = { PATH: '/login/path', COLORFGBG: '0;15' };

  // restored + transcript on disk → --resume, the same conversation
  const resumed = sdkOptions({ cwd: '/repo', env, exe: '/bin/claude', sid: 'ses_1', hasTranscript: true, canUseTool });
  assert.equal(resumed.resume, 'ses_1');
  assert.equal(resumed.extraArgs, undefined);

  // fresh → the id is pinned so the pty can resume it later
  const fresh = sdkOptions({ cwd: '/repo', env, exe: '/bin/claude', sid: 'ses_2', hasTranscript: false, canUseTool });
  assert.equal(fresh.extraArgs['session-id'], 'ses_2');
  assert.equal(fresh.resume, undefined);

  // the env rides through whole — login PATH and all
  assert.equal(fresh.env.PATH, '/login/path');
  // the user's own logged-in binary, never the SDK's vendored copy
  assert.equal(fresh.pathToClaudeCodeExecutable, '/bin/claude');
  // settings come from the same sources the terminal reads
  assert.deepEqual(fresh.settingSources, ['project', 'user']);
  // no sid at all still builds — a tile that never had a conversation
  const bare = sdkOptions({ cwd: '/repo', env: null, exe: '/bin/claude', sid: null, hasTranscript: false, canUseTool });
  assert.equal(bare.resume, undefined);
  assert.equal(bare.extraArgs, undefined);
});

test('classifyFailure catches the 404 hermes sent as prose, and only that shape', () => {
  const { classifyFailure } = require('../src/main/agent-events.js');
  assert.ok(classifyFailure('API call failed after 3 retries: HTTP 404: model: openrouter/x'));
  assert.ok(classifyFailure('HTTP 502'));
  assert.ok(classifyFailure('429 Too Many Requests'));
  assert.equal(classifyFailure('The HTTP 404 status code means not found — here is how to fix your route: ' + 'x'.repeat(400)), null);
  assert.equal(classifyFailure('I fixed the error in your code.'), null);
  assert.equal(classifyFailure(''), null);
});

// ---- where the user's claude actually lives --------------------------------
// The launcher asks the login shell and finds claude wherever it is. The card
// view used to re-derive the location from a fixed list of five paths, so a
// claude installed through a version manager was "ready" in one sheet and
// "isn't installed on this Mac yet" one click later in the other.
const { resolveClaudeExecutable } = require('../src/main/adapters/claude-sdk.js');
const { rememberBins, forgetBins } = require('../src/main/bin-cache.js');

const NVM = '/Users/x/.nvm/versions/node/v22.22.0/bin/claude';
const only = (...ok) => (p) => ok.includes(p);

test('a claude the scan found beats the hardcoded list', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: NVM }]);
  // both exist — the scanned one has to win, it is the one the user's shell runs
  const exe = resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only(NVM, '/Users/x/.local/bin/claude') });
  assert.equal(exe, NVM);
});

test('nvm, volta, bun and mise installs stop reading as missing', () => {
  for (const p of [
    NVM,
    '/Users/x/.volta/bin/claude',
    '/Users/x/.bun/bin/claude',
    '/Users/x/.local/share/mise/installs/node/22/bin/claude',
  ]) {
    forgetBins();
    rememberBins([{ id: 'claude', found: true, path: p }]);
    assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only(p) }), p);
  }
});

test('an explicit CLAUDE_CODE_EXECUTABLE still beats everything', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: NVM }]);
  const env = { CLAUDE_CODE_EXECUTABLE: '/opt/mine/claude' };
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env, exists: only('/opt/mine/claude', NVM) }), '/opt/mine/claude');
});

// The list is the floor, not the ceiling: it answers before the first scan
// lands, and on a machine where the shell probe fails outright.
test('with nothing scanned it behaves exactly as it did before', () => {
  forgetBins();
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only('/Users/x/.local/bin/claude') }), '/Users/x/.local/bin/claude');
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only('/opt/homebrew/bin/claude') }), '/opt/homebrew/bin/claude');
  assert.equal(resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: () => false }), null);
});

// A scan result that has gone stale — the user removed claude — must not win
// over a real file. Otherwise the card view spawns ENOENT instead of falling
// back to whatever is genuinely on disk.
test('a remembered path that no longer exists falls through', () => {
  forgetBins();
  rememberBins([{ id: 'claude', found: true, path: NVM }]);
  const exe = resolveClaudeExecutable({ home: '/Users/x', env: {}, exists: only('/opt/homebrew/bin/claude') });
  assert.equal(exe, '/opt/homebrew/bin/claude');
});

// ---- permission modes -------------------------------------------------------
// The chip offers exactly what the session can enter. Settings — managed,
// user or project — can disable bypass; the list must say so with a reason
// instead of offering a switch that silently fails.
const { permissionModes } = require('../src/main/adapters/claude-sdk.js');

function readerOf(files) {
  return (p) => (p in files ? files[p] : null);
}

test('with no settings anywhere, every SDK mode is available — all six', () => {
  const modes = permissionModes({ cwd: '/repo', home: '/Users/x', readFile: readerOf({}) });
  assert.deepEqual(modes.map((m) => m.id), ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']);
  assert.ok(modes.every((m) => m.available));
});

test('managed settings can take bypass off the menu, with the reason attached', () => {
  const modes = permissionModes({
    cwd: '/repo', home: '/Users/x',
    readFile: readerOf({
      '/Library/Application Support/ClaudeCode/managed-settings.json':
        JSON.stringify({ permissions: { disableBypassPermissionsMode: 'disable' } }),
    }),
  });
  const bypass = modes.find((m) => m.id === 'bypassPermissions');
  assert.equal(bypass.available, false);
  assert.match(bypass.reason, /managed/);
  assert.ok(modes.filter((m) => m.id !== 'bypassPermissions').every((m) => m.available));
});

test('user and project settings disable bypass too, top-level key included', () => {
  for (const [file, body] of [
    ['/Users/x/.claude/settings.json', { disableBypassPermissionsMode: 'disable' }],
    ['/repo/.claude/settings.json', { permissions: { disableBypassPermissionsMode: 'disable' } }],
    ['/repo/.claude/settings.local.json', { permissions: { disableBypassPermissionsMode: 'disable' } }],
  ]) {
    const modes = permissionModes({ cwd: '/repo', home: '/Users/x', readFile: readerOf({ [file]: JSON.stringify(body) }) });
    assert.equal(modes.find((m) => m.id === 'bypassPermissions').available, false, file);
  }
});

test('an unreadable or malformed settings file changes nothing', () => {
  const modes = permissionModes({
    cwd: '/repo', home: '/Users/x',
    readFile: readerOf({ '/Users/x/.claude/settings.json': '{not json' }),
  });
  assert.ok(modes.every((m) => m.available));
});

test('the adapter announces its modes on init', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', permissionMode: 'default', slash_commands: [] });
  const init = events.find((e) => e.kind === 'init');
  assert.ok(Array.isArray(init.modes) && init.modes.length === 6);
});

// ---- the session starts in the mode the terminal would ----------------------
// permissions.defaultMode in settings decides where shift⇥ begins; hardcoding
// 'default' made the card open in a different mode than the terminal.
const { defaultPermissionMode } = require('../src/main/adapters/claude-sdk.js');

test('defaultPermissionMode reads permissions.defaultMode, falling back to default', () => {
  assert.equal(defaultPermissionMode({ cwd: '/repo', home: '/Users/x', readFile: readerOf({}) }), 'default');
  assert.equal(defaultPermissionMode({
    cwd: '/repo', home: '/Users/x',
    readFile: readerOf({ '/Users/x/.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }) }),
  }), 'acceptEdits');
});

test('defaultPermissionMode precedence: managed beats project beats user; junk is ignored', () => {
  assert.equal(defaultPermissionMode({
    cwd: '/repo', home: '/Users/x',
    readFile: readerOf({
      '/Users/x/.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }),
      '/repo/.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'plan' } }),
    }),
  }), 'plan');
  assert.equal(defaultPermissionMode({
    cwd: '/repo', home: '/Users/x',
    readFile: readerOf({
      '/repo/.claude/settings.local.json': JSON.stringify({ permissions: { defaultMode: 'auto' } }),
      '/Library/Application Support/ClaudeCode/managed-settings.json': JSON.stringify({ permissions: { defaultMode: 'plan' } }),
    }),
  }), 'plan');
  // a mode the SDK doesn't know is not a mode — never seed the session with it
  assert.equal(defaultPermissionMode({
    cwd: '/repo', home: '/Users/x',
    readFile: readerOf({ '/Users/x/.claude/settings.json': JSON.stringify({ permissions: { defaultMode: 'yolo' } }) }),
  }), 'default');
});

test('sdkOptions honours bypass at spawn and seeds the settings default mode', () => {
  const { sdkOptions } = require('../src/main/adapters/claude-sdk.js');
  const o = sdkOptions({ cwd: '/repo', exe: '/bin/claude', sid: null, hasTranscript: false, canUseTool: () => {}, mode: 'acceptEdits' });
  // the SDK refuses setPermissionMode('bypassPermissions') without this flag —
  // the picker offered bypass and the switch errored (the original bug)
  assert.equal(o.allowDangerouslySkipPermissions, true);
  assert.equal(o.permissionMode, 'acceptEdits');
  const bare = sdkOptions({ cwd: '/repo', exe: '/bin/claude', sid: null, hasTranscript: false, canUseTool: () => {} });
  assert.equal(bare.permissionMode, 'default');
});

// Silent approvals get named: an execute tool whose result arrives without
// the card ever being asked, in default mode, is a settings rule at work —
// and the note says so, exactly once.
test('the first unasked execute in default mode earns one note, asked tools none', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', permissionMode: 'default', slash_commands: [] });
  // a Read runs unasked — by SDK design, never noteworthy
  a.handle({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }] } });
  a.handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'file' }] } });
  assert.equal(events.filter((e) => e.kind === 'note' && /without asking/.test(e.text)).length, 0);
  // a Bash runs unasked — that is a settings rule, and it is said once
  a.handle({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }] } });
  a.handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }] } });
  a.handle({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'pwd' } }] } });
  a.handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b2', content: 'ok' }] } });
  const notes = events.filter((e) => e.kind === 'note' && /without asking/.test(e.text));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /Bash/);
});

test('a Bash the card was asked about stays silent', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 't1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', permissionMode: 'default', slash_commands: [] });
  a.askPermission('Bash', { command: 'ls' }, {});
  a.handle({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }] } });
  a.handle({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }] } });
  assert.equal(events.filter((e) => e.kind === 'note' && /without asking/.test(e.text)).length, 0);
});

// ---- the quiet stretches get a word: status, compaction ---------------------

test('system/status names the phase so the working line can say it', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 'st1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'system', subtype: 'status', status: 'compacting' });
  const st = events.find((e) => e.kind === 'status');
  assert.ok(st, 'status must be forwarded, not dropped');
  assert.equal(st.state, 'running');
  assert.equal(st.phase, 'compacting');
});

test('system/status with a null status clears the phase but stays running', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 'st2', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'system', subtype: 'status', status: null });
  const st = events.find((e) => e.kind === 'status');
  assert.equal(st.state, 'running');
  assert.ok(!('phase' in st));
});

test('a live compact_boundary becomes the same note the transcript path makes', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 'cb1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'system', subtype: 'compact_boundary',
    compact_metadata: { trigger: 'auto', pre_tokens: 180000, post_tokens: 12000 } });
  const note = events.find((e) => e.kind === 'note');
  assert.match(note.text, /Compacted — 180k → 12k tokens \(auto\)/);
});

test('session_state_changed rides the status channel', () => {
  const events = [];
  const a = new ClaudeSdkAdapter({ id: 'ss1', cwd: '/repo', onEvent: (e) => events.push(e) });
  a.handle({ type: 'system', subtype: 'session_state_changed', state: 'running' });
  a.handle({ type: 'system', subtype: 'session_state_changed', state: 'idle' });
  const sts = events.filter((e) => e.kind === 'status');
  assert.deepEqual(sts.map((s) => s.state), ['running', 'idle']);
});
