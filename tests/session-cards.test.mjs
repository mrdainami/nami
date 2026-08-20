// Turning transcript events into the rows a card tile draws. Pure — the DOM
// half lives in app.js, so everything decided here (what pairs with what, what
// a row is called, what a row can prove) is testable on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, toolLabel, fmtDuration } from '../src/renderer/session-cards.mjs';

const use = (toolId, name, input) => ({ kind: 'tool', id: 'a' + toolId, at: '1', toolId, name, input });
const result = (toolId, body, extra = {}) => ({ kind: 'tool_result', id: 'r' + toolId, at: '2', toolId, isError: false, body, truncated: false, ...extra });

test('a tool call and its result are one row, not two', () => {
  const rows = buildRows([use('t1', 'Read', { file_path: '/repo/src/app.js' }), result('t1', 'the file')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'tool');
  assert.equal(rows[0].body, 'the file');
  assert.equal(rows[0].pending, false);
});

test('a tool still running is a row that says so', () => {
  const [row] = buildRows([use('t1', 'Bash', { command: 'npm test' })]);
  assert.equal(row.pending, true);
  assert.equal(row.body, '');
});

test('a result whose call is older than the window still shows its output', () => {
  // A large transcript opens on its last screenful, so the tool_use that
  // started a result can be off the top. Dropping it would hide real output.
  const [row] = buildRows([result('t9', 'output with no visible call')]);
  assert.equal(row.kind, 'tool');
  assert.equal(row.name, '');
  assert.equal(row.label, 'Tool result');
  assert.equal(row.body, 'output with no visible call');
});

test('an errored result marks the row', () => {
  const [row] = buildRows([use('t1', 'Bash', { command: 'npm test' }), result('t1', 'FAIL', { isError: true })]);
  assert.equal(row.isError, true);
});

test('a capped body brings its flag with it, so the card can admit the cut', () => {
  const [row] = buildRows([use('t1', 'Read', { file_path: '/a/b.js' }), result('t1', 'xxx', { truncated: true })]);
  assert.equal(row.truncated, true);
});

test('a finished turn folds its work; the prose and the meter stay out', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', text: 'do it' },
    { kind: 'thinking', id: 'k1', text: 'weighing it up' },
    use('t1', 'Read', { file_path: '/a/b.js' }),
    result('t1', 'ok'),
    { kind: 'assistant', id: 'a1', text: 'done' },
    { kind: 'turn_end', id: 'e1', durationMs: 5662 },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'fold', 'assistant', 'turn_end']);
  const fold = rows[1];
  assert.equal(fold.count, 2, 'the thought and the read fold');
  assert.deepEqual(fold.children.map((c) => c.kind), ['thinking', 'tool']);
  assert.match(fold.label, /read 1 file/, 'the chip says what the work was');
  assert.match(fold.label, /thought/);
});

test('the live turn never folds — you watch it happen', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', text: 'do it' },
    use('t1', 'Read', { file_path: '/a/b.js' }),
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'tool']);
});

test('edits in a finished turn become an Edited-files card; errors stay visible', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', text: 'go' },
    { kind: 'tool', id: 'a', toolId: 't1', name: 'Edit', input: { file_path: '/repo/app.js', old_string: 'a', new_string: 'b\nc' } },
    { kind: 'tool_result', id: 'b', toolId: 't1', body: '' },
    { kind: 'error', id: 'err', message: 'HTTP 500' },
    { kind: 'turn_end', id: 'e1', durationMs: 1000 },
  ]);
  // a lone edit stays inline (runs of one never fold); the Edited card and
  // the error keep their places
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'tool', 'error', 'edits', 'turn_end']);
  assert.equal(rows[3].files.length, 1);
  assert.equal(rows[3].files[0].path, '/repo/app.js');
  assert.ok(rows[3].files[0].diff);
});

test('an unresolved approval never folds; a resolved one does', () => {
  const mk = (resolved) => buildRows([
    { kind: 'user', id: 'u1', text: 'go' },
    { kind: 'permission', id: 'p', permissionId: 'pp', toolName: 'Bash', title: 'Bash', options: [] },
    ...(resolved ? [{ kind: 'permission_resolved', id: 'q', permissionId: 'pp', optionId: 'allow' }] : []),
    { kind: 'turn_end', id: 'e1', durationMs: 1000 },
  ]);
  assert.deepEqual(mk(false).map((r) => r.kind), ['user', 'permission', 'turn_end']);
  // a lone resolved approval tucks away as activity but has no run to join
  assert.deepEqual(mk(true).map((r) => r.kind), ['user', 'permission', 'turn_end']);
});

test('a turn_end row carries a duration a person can read', () => {
  const [row] = buildRows([{ kind: 'turn_end', id: 'e1', durationMs: 5662 }]);
  assert.equal(row.duration, '5.7s');
});

test('durations read as seconds, then as minutes', () => {
  assert.equal(fmtDuration(900), '0.9s');
  assert.equal(fmtDuration(5662), '5.7s');
  assert.equal(fmtDuration(62000), '1m 2s');
  assert.equal(fmtDuration(0), '0.0s');
});

test('a tool is labelled by what it did, in the words the tile uses elsewhere', () => {
  assert.equal(toolLabel('Read', { file_path: '/repo/src/main/osc-title.js' }), 'Read osc-title.js');
  assert.equal(toolLabel('Write', { file_path: '/repo/notes.md' }), 'Write notes.md');
  assert.equal(toolLabel('Grep', { pattern: 'feedOscTitle' }), 'Grep feedOscTitle');
  assert.equal(toolLabel('Glob', { pattern: '**/*.test.mjs' }), 'Glob **/*.test.mjs');
  assert.equal(toolLabel('WebFetch', { url: 'https://example.com/docs' }), 'Fetch https://example.com/docs');
  assert.equal(toolLabel('Task', { description: 'sweep the tests' }), 'sweep the tests');
});

test('Bash is labelled by its description, and keeps the command as the detail', () => {
  const [row] = buildRows([use('t1', 'Bash', { command: 'npm test -- passkey', description: 'Run the passkey tests' })]);
  assert.equal(row.label, 'Run the passkey tests');
  assert.equal(row.detail, 'npm test -- passkey');
});

test('a Bash call with no description falls back to the command itself', () => {
  assert.equal(toolLabel('Bash', { command: 'git status --short' }), 'git status --short');
});

test('an edit says how much it changed', () => {
  // Derived from the strings the call actually carries, not from a diff we
  // never saw: the lines going out and the lines coming in.
  const [row] = buildRows([use('t1', 'Edit', {
    file_path: '/repo/a.js',
    old_string: 'one\ntwo',
    new_string: 'one\ntwo\nthree\nfour',
  })]);
  assert.equal(row.label, 'Edit a.js');
  assert.equal(row.detail, '+4 −2');
});

test('a Read does not repeat the path its label already named', () => {
  // Seen on a real session: the label collapsed to nothing and a 70-character
  // absolute path took the whole row, pushing the card wider than the tile.
  const [row] = buildRows([use('t1', 'Read', { file_path: '/Users/x/work/repo/src/main/transcript-tail.js' })]);
  assert.equal(row.label, 'Read transcript-tail.js');
  assert.equal(row.detail, '');
});

test('an unknown tool is named, never hidden', () => {
  // MCP tools arrive with names this build has never heard of.
  assert.equal(toolLabel('mcp__github__create_pull_request', {}), 'mcp__github__create_pull_request');
});

test('a long label is cut rather than allowed to push the row wide', () => {
  const long = 'x'.repeat(200);
  assert.ok(toolLabel('Grep', { pattern: long }).length < 90);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(buildRows([]), []);
  assert.deepEqual(buildRows(undefined), []);
});

// ---- the kinds the agent-cards build added ---------------------------------

test('a tool row wears the glyph of its kind, never its name', () => {
  const rows = buildRows([
    { kind: 'tool', id: 'a', toolId: 't1', name: 'Read', input: { file_path: '/x/y.js' } },
    { kind: 'tool', id: 'b', toolId: 't2', name: 'Bash', input: { command: 'ls' } },
    { kind: 'tool', id: 'c', toolId: 't3', name: 'mcp__weird__thing', input: {} },
  ]);
  assert.equal(rows[0].glyph, '◧');
  assert.equal(rows[1].glyph, '▸');
  assert.equal(rows[2].glyph, '•');
  assert.equal(rows[2].label, 'mcp__weird__thing');
});

test('an adapter that already typed its call wins over the name mapping', () => {
  const rows = buildRows([{ kind: 'tool', id: 'a', toolId: 't1', name: 'shell', toolKind: 'execute', input: {} }]);
  assert.equal(rows[0].toolKind, 'execute');
  assert.equal(rows[0].glyph, '▸');
});

test('an edit row carries the diff the call itself holds', () => {
  const rows = buildRows([{
    kind: 'tool', id: 'a', toolId: 't1', name: 'Edit',
    input: { file_path: '/repo/app.js', old_string: 'a\nb', new_string: 'a\nc\nd' },
  }]);
  assert.equal(rows[0].detail, '+3 −2');
  assert.deepEqual(rows[0].diff, { path: '/repo/app.js', oldText: 'a\nb', newText: 'a\nc\nd' });
});

test('a read that returned tells how much came back', () => {
  const rows = buildRows([
    { kind: 'tool', id: 'a', toolId: 't1', name: 'Read', input: { file_path: '/x/y.js' } },
    { kind: 'tool_result', id: 'b', toolId: 't1', body: 'l1\nl2\nl3', truncated: false },
  ]);
  assert.equal(rows[0].detail, '3 lines');
});

test('a sub-agent folds under the Task row that spawned it', () => {
  const rows = buildRows([
    { kind: 'tool', id: 'a', toolId: 'task1', name: 'Task', input: { description: 'explore' } },
    { kind: 'assistant', id: 'b', text: 'sub thinking out loud', parentToolId: 'task1' },
    { kind: 'tool', id: 'c', toolId: 't2', name: 'Read', input: { file_path: '/x.js' }, parentToolId: 'task1' },
    { kind: 'assistant', id: 'd', text: 'main again' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children.length, 2);
  assert.equal(rows[1].text, 'main again');
});

test('an approval row renders what the agent sent and settles when resolved', () => {
  const events = [{
    kind: 'permission', id: 'p', permissionId: 'pp1', toolName: 'Bash',
    title: 'Bash', description: 'Remove build dir',
    options: [{ id: 'allow', label: 'Allow' }, { id: 'sugg:0', label: 'Always allow `rm -rf build`' }, { id: 'deny', label: 'Deny' }],
  }];
  let rows = buildRows(events);
  assert.equal(rows[0].kind, 'permission');
  assert.equal(rows[0].options.length, 3);
  assert.equal(rows[0].resolved, null);
  rows = buildRows([...events, { kind: 'permission_resolved', id: 'q', permissionId: 'pp1', optionId: 'sugg:0' }]);
  assert.equal(rows[0].resolved, 'sugg:0');
});

test('plans, notes and errors are rows of their own kind', () => {
  const rows = buildRows([
    { kind: 'plan', id: 'a', todos: [{ text: 'one', status: 'completed' }] },
    { kind: 'note', id: 'b', text: 'Rate limit reached.' },
    { kind: 'error', id: 'c', message: 'HTTP 404' },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['plan', 'note', 'error']);
  assert.equal(rows[2].text, 'HTTP 404');
});

test('a turn_end never carries dollars — channels report running totals, not per-turn spend', () => {
  const rows = buildRows([{ kind: 'turn_end', id: 'a', durationMs: 5000, costUsd: 0.13, tokens: 900 }]);
  assert.equal(rows[0].duration, '5.0s');
  assert.equal(rows[0].tokens, 900);
  assert.ok(!('costUsd' in rows[0]), 'cost must not survive into the row');
});

test('init and status shape the tile, not the list', () => {
  const rows = buildRows([
    { kind: 'init', id: 'a', capability: {} },
    { kind: 'status', id: 'b', state: 'running' },
  ]);
  assert.equal(rows.length, 0);
});

test('the meter carries tokens and chips for the files the turn touched', () => {
  const rows = buildRows([
    { kind: 'tool', id: 'a', toolId: 't1', name: 'Edit', input: { file_path: '/repo/app.js', old_string: 'a', new_string: 'b' } },
    { kind: 'tool_result', id: 'b', toolId: 't1', body: '' },
    { kind: 'tool', id: 'c', toolId: 't2', name: 'Read', input: { file_path: '/repo/other.js' } },
    { kind: 'turn_end', id: 'd', durationMs: 4000, tokens: 12345 },
    { kind: 'tool', id: 'e', toolId: 't3', name: 'Write', input: { file_path: '/repo/new.js', content: 'x' } },
    { kind: 'turn_end', id: 'f', durationMs: 1000 },
  ]);
  const meters = rows.filter((r) => r.kind === 'turn_end');
  assert.deepEqual(meters[0].files, ['/repo/app.js'], 'edits chip, reads do not');
  assert.equal(meters[0].tokens, 12345);
  assert.deepEqual(meters[1].files, ['/repo/new.js'], 'chips reset per turn');
});

test('a turn ended by the next user turn folds too — SDK transcripts carry no turn_end', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', text: 'first' },
    use('t1', 'Read', { file_path: '/a.js' }),
    result('t1', 'ok'),
    { kind: 'assistant', id: 'a1', text: 'done' },
    { kind: 'user', id: 'u2', text: 'second' },
    use('t2', 'Read', { file_path: '/b.js' }),
  ]);
  // the lone read stays inline; the second (live) turn is watched raw
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'tool', 'assistant', 'user', 'tool']);
});

test('events without ids never collide — each still gets its own row', () => {
  const rows = buildRows([
    { kind: 'user', text: 'hi' },
    { kind: 'assistant', text: 'one' },
    { kind: 'assistant', text: 'two' },
  ]);
  assert.equal(rows.length, 3);
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, 3, 'ids must be unique');
  assert.ok(ids.every((id) => id != null), 'no undefined ids');
});

test('turn footer math comes only from what the events carry', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', at: 1000, text: 'go' },
    { kind: 'assistant', id: 'a1', at: 1800, text: 'ok' },
    { kind: 'turn_end', id: 'e9', at: 9000, durationMs: 8000, tokens: 1200 },
  ]);
  const end = rows.find((r) => r.kind === 'turn_end');
  assert.equal(end.tokPerSec, 150, '1200 tok over 8s');
  assert.equal(end.ttftMs, 800, 'first reply at minus user at');

  const bare = buildRows([
    { kind: 'user', id: 'u1', text: 'go' },
    { kind: 'assistant', id: 'a1', text: 'ok' },
    { kind: 'turn_end', id: 'e9', durationMs: 0, tokens: 0 },
  ]).find((r) => r.kind === 'turn_end');
  assert.equal(bare.tokPerSec, undefined, 'no invented stats');
  assert.equal(bare.ttftMs, undefined);
});

test('turn footer timestamps accept ISO strings', () => {
  const end = buildRows([
    { kind: 'user', id: 'u1', at: '2026-08-20T10:00:00.000Z', text: 'go' },
    { kind: 'thinking', id: 't1', at: '2026-08-20T10:00:01.500Z', text: 'hm' },
    { kind: 'turn_end', id: 'e9', durationMs: 4000, tokens: 100 },
  ]).find((r) => r.kind === 'turn_end');
  assert.equal(end.ttftMs, 1500);
  assert.equal(end.tokPerSec, 25);
});

test('a finished turn folds runs in place — the story keeps its order', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', text: 'go' },
    { kind: 'assistant', id: 'a1', text: 'first thought' },
    { kind: 'tool', id: 't1', toolId: 'x1', name: 'Read', input: { file_path: '/p/a.md' } },
    { kind: 'tool', id: 't2', toolId: 'x2', name: 'Bash', input: { command: 'ls' } },
    { kind: 'assistant', id: 'a2', text: 'second thought' },
    { kind: 'tool', id: 't3', toolId: 'x3', name: 'Grep', input: { pattern: 'x' } },
    { kind: 'turn_end', id: 'e1', durationMs: 5000 },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'assistant', 'fold', 'assistant', 'tool', 'turn_end'],
    'run of 2 folds in place between the thoughts; a lone tool stays inline');
  const fold = rows.find((r) => r.kind === 'fold');
  assert.equal(fold.count, 2);
  assert.match(fold.label, /read 1 file/);
  assert.match(fold.label, /ran 1 command/);
});

test('the meter says what kind of work the turn was', () => {
  const end = buildRows([
    { kind: 'user', id: 'u1', text: 'go' },
    { kind: 'tool', id: 't1', toolId: 'x1', name: 'Read', input: { file_path: '/p/a.md' } },
    { kind: 'tool', id: 't2', toolId: 'x2', name: 'Read', input: { file_path: '/p/b.md' } },
    { kind: 'tool', id: 't3', toolId: 'x3', name: 'Bash', input: { command: 'ls' } },
    { kind: 'turn_end', id: 'e1', durationMs: 5000 },
  ]).find((r) => r.kind === 'turn_end');
  assert.match(end.work, /read 2 files/);
  assert.match(end.work, /ran 1 command/);
});

test('read and edit rows carry their file path for the click-through', () => {
  const rows = buildRows([
    { kind: 'tool', id: 't1', toolId: 'x1', name: 'Read', input: { file_path: '/p/a.md' } },
  ]);
  assert.equal(rows[0].file, '/p/a.md');
});

test('live turns fold as they go — only the trailing run stays raw', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', text: 'go' },
    { kind: 'tool', id: 't1', toolId: 'x1', name: 'Read', input: { file_path: '/a.md' } },
    { kind: 'tool', id: 't2', toolId: 'x2', name: 'Bash', input: { command: 'ls' } },
    { kind: 'assistant', id: 'a1', text: 'progress note' },
    { kind: 'tool', id: 't3', toolId: 'x3', name: 'Read', input: { file_path: '/b.md' } },
    { kind: 'tool', id: 't4', toolId: 'x4', name: 'Read', input: { file_path: '/c.md' } },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'fold', 'assistant', 'tool', 'tool'],
    'the finished run folds live; the still-active trailing run is watched raw');
});
