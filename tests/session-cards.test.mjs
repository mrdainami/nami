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

test('rows keep the order things happened in', () => {
  const rows = buildRows([
    { kind: 'user', id: 'u1', text: 'do it' },
    { kind: 'thinking', id: 'k1', text: 'weighing it up' },
    use('t1', 'Read', { file_path: '/a/b.js' }),
    result('t1', 'ok'),
    { kind: 'assistant', id: 'a1', text: 'done' },
    { kind: 'turn_end', id: 'e1', durationMs: 5662 },
  ]);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'thinking', 'tool', 'assistant', 'turn_end']);
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
