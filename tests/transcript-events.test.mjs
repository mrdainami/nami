// A running `claude` writes every turn to ~/.claude/projects/<slug>/<sid>.jsonl
// as it happens — the same conversation the PTY is drawing, in structured form.
// These fixtures are trimmed from a real transcript (CLI 2.1.226, 2026-08-11):
// the prompt, the Read tool call, its result, the answer, and the turn timing.
//
// Every record carries far more than this parser keeps (usage, cache counters,
// git branch, parentUuid chains). Keeping only what a card can show is the
// point: nothing renders that the transcript did not actually say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../src/main/transcript-events.js';

const J = (o) => JSON.stringify(o);

const PROMPT = {
  parentUuid: '4d86b249', isSidechain: false, promptId: '6e5c62ce', type: 'user',
  message: { role: 'user', content: 'read src/main/osc-title.js and tell me what it does' },
  uuid: 'u-1', timestamp: '2026-08-11T20:47:56.327Z', origin: { kind: 'human' },
  promptSource: 'typed', cwd: '/repo', sessionId: 's-1', version: '2.1.226',
};
const TOOL_USE = {
  isSidechain: false, type: 'assistant', uuid: 'a-1', timestamp: '2026-08-11T20:47:58.000Z',
  message: {
    model: 'claude-opus-5', role: 'assistant', type: 'message',
    content: [{ type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/repo/src/main/osc-title.js' } }],
    stop_reason: 'tool_use',
  },
};
const TOOL_RESULT = {
  isSidechain: false, type: 'user', uuid: 'u-2', timestamp: '2026-08-11T20:47:58.400Z',
  message: { role: 'user', content: [{ tool_use_id: 'toolu_01', type: 'tool_result', content: '1\t// the file\n2\t// second line' }] },
  toolUseResult: { type: 'text', file: { filePath: '/repo/src/main/osc-title.js', numLines: 66 } },
};
const ANSWER = {
  isSidechain: false, type: 'assistant', uuid: 'a-2', timestamp: '2026-08-11T20:48:01.000Z',
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'It parses OSC 0/2 titles out of the PTY.' }], stop_reason: 'end_turn' },
};
const TITLE = { type: 'ai-title', aiTitle: 'Review osc-title.js source file', sessionId: 's-1' };
const TURN_END = {
  isSidechain: false, type: 'system', subtype: 'turn_duration', durationMs: 5662,
  uuid: 'sys-1', timestamp: '2026-08-11T20:48:02.005Z', messageCount: 14,
};

const kinds = (evs) => evs.map((e) => e.kind);

test('a whole turn comes back in order, one event per thing that happened', () => {
  const evs = parseTranscript([PROMPT, TITLE, TOOL_USE, TOOL_RESULT, ANSWER, TURN_END].map(J));
  assert.deepEqual(kinds(evs), ['user', 'title', 'tool', 'tool_result', 'assistant', 'turn_end']);
});

test('the prompt keeps its text, its id and its time', () => {
  const [e] = parseTranscript([J(PROMPT)]);
  assert.equal(e.kind, 'user');
  assert.equal(e.text, 'read src/main/osc-title.js and tell me what it does');
  assert.equal(e.id, 'u-1');
  assert.equal(e.at, '2026-08-11T20:47:56.327Z');
});

test('a tool call carries the name and the input the card labels itself from', () => {
  const [e] = parseTranscript([J(TOOL_USE)]);
  assert.equal(e.kind, 'tool');
  assert.equal(e.toolId, 'toolu_01');
  assert.equal(e.name, 'Read');
  assert.equal(e.input.file_path, '/repo/src/main/osc-title.js');
});

test('a tool result carries the body the terminal hides behind ctrl+o', () => {
  const [e] = parseTranscript([J(TOOL_RESULT)]);
  assert.equal(e.kind, 'tool_result');
  assert.equal(e.toolId, 'toolu_01');
  assert.equal(e.isError, false);
  assert.equal(e.body, '1\t// the file\n2\t// second line');
});

test('an errored tool result says so', () => {
  const rec = structuredClone(TOOL_RESULT);
  rec.message.content[0].is_error = true;
  const [e] = parseTranscript([J(rec)]);
  assert.equal(e.isError, true);
});

test('tool_result content also arrives as blocks, not only as a string', () => {
  const rec = structuredClone(TOOL_RESULT);
  rec.message.content[0].content = [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }];
  const [e] = parseTranscript([J(rec)]);
  assert.equal(e.body, 'first\nsecond');
});

test('thinking is its own kind, never folded into the answer', () => {
  const rec = structuredClone(ANSWER);
  rec.message.content = [{ type: 'thinking', thinking: 'two scripts touch releases…' }, { type: 'text', text: 'CI produces a draft.' }];
  assert.deepEqual(kinds(parseTranscript([J(rec)])), ['thinking', 'assistant']);
});

test('an assistant record with several blocks yields one event each, in order', () => {
  const rec = structuredClone(TOOL_USE);
  rec.message.content = [
    { type: 'text', text: 'Reading it now.' },
    { type: 'tool_use', id: 'toolu_02', name: 'Grep', input: { pattern: 'feedOscTitle' } },
  ];
  assert.deepEqual(kinds(parseTranscript([J(rec)])), ['assistant', 'tool']);
});

test('empty and whitespace-only assistant text is dropped, not rendered blank', () => {
  const rec = structuredClone(ANSWER);
  rec.message.content = [{ type: 'text', text: '   \n ' }];
  assert.deepEqual(parseTranscript([J(rec)]), []);
});

test('the title record becomes a title event', () => {
  const [e] = parseTranscript([J(TITLE)]);
  assert.deepEqual(e, { kind: 'title', title: 'Review osc-title.js source file' });
});

test('an explicit name outranks nothing here — both title records come through', () => {
  // Which one wins is session-title.js's job (custom beats ai); the parser only
  // reports what the file said.
  const evs = parseTranscript([J(TITLE), J({ type: 'custom-title', customTitle: 'build: the cards', sessionId: 's-1' })]);
  assert.deepEqual(evs, [
    { kind: 'title', title: 'Review osc-title.js source file' },
    { kind: 'title', title: 'build: the cards' },
  ]);
});

test('a huge tool result is capped, and says that it was', () => {
  // A Read of a big file lands here whole. Handing 500KB per event to the
  // renderer would cost more than the terminal it replaces.
  const rec = structuredClone(TOOL_RESULT);
  rec.message.content[0].content = 'x'.repeat(50000);
  const [e] = parseTranscript([J(rec)]);
  assert.equal(e.truncated, true);
  assert.ok(e.body.length < 50000);
  assert.ok(e.body.length > 1000);
});

test('an ordinary tool result is not marked truncated', () => {
  const [e] = parseTranscript([J(TOOL_RESULT)]);
  assert.equal(e.truncated, false);
});

test('turn_duration is what the meter reads', () => {
  const [e] = parseTranscript([J(TURN_END)]);
  assert.equal(e.kind, 'turn_end');
  assert.equal(e.durationMs, 5662);
});

test('bookkeeping records are skipped entirely', () => {
  const noise = [
    { type: 'attachment', attachment: { type: 'file', path: '/repo/x' }, uuid: 'n1' },
    { type: 'mode', mode: 'default', sessionId: 's-1' },
    { type: 'permission-mode', permissionMode: 'default', sessionId: 's-1' },
    { type: 'bridge-session', sessionId: 's-1', bridgeSessionId: 'b-1' },
    { type: 'file-history-snapshot', messageId: 'm1', snapshot: {} },
    { type: 'last-prompt', leafUuid: 'u-1', sessionId: 's-1' },
    { type: 'system', subtype: 'stop_hook_summary', hookCount: 2, uuid: 'sys-9' },
    { type: 'summary', summary: 'a compaction summary', leafUuid: 'u-9' },
  ];
  assert.deepEqual(parseTranscript(noise.map(J)), []);
});

test('a subagent\'s own turns stay out of the parent card', () => {
  // A Task tool spawns a sidechain that writes into the SAME file. Without this
  // the parent session's cards fill up with another agent's tool calls.
  const rec = structuredClone(TOOL_USE);
  rec.isSidechain = true;
  assert.deepEqual(parseTranscript([J(rec)]), []);
});

test('meta records the CLI injects are not the user speaking', () => {
  const rec = structuredClone(PROMPT);
  rec.isMeta = true;
  rec.message.content = '<system-reminder>do not do that</system-reminder>';
  assert.deepEqual(parseTranscript([J(rec)]), []);
});

test('a slash command reads as the command, not as its XML wrapper', () => {
  const rec = structuredClone(PROMPT);
  rec.message.content = '<command-name>/build</command-name>\n<command-args>the cards</command-args>';
  const [e] = parseTranscript([J(rec)]);
  assert.equal(e.kind, 'user');
  assert.equal(e.text, '/build the cards');
  assert.equal(e.command, true);
});

test('local command output is not a user turn', () => {
  const rec = structuredClone(PROMPT);
  rec.message.content = '<local-command-stdout>on branch master</local-command-stdout>';
  assert.deepEqual(parseTranscript([J(rec)]), []);
});

test('a broken line is skipped and the ones around it still parse', () => {
  // The tailer holds back an incomplete trailing line, but a file truncated by
  // hand — or a flush caught mid-write — can still hand us garbage.
  const evs = parseTranscript([J(PROMPT), '{"type":"assistant","message":{"cont', J(ANSWER)]);
  assert.deepEqual(kinds(evs), ['user', 'assistant']);
});

test('blank lines are not records', () => {
  assert.deepEqual(parseTranscript(['', '   ', J(TITLE)]).length, 1);
});

test('parsed objects are accepted as readily as strings', () => {
  assert.deepEqual(kinds(parseTranscript([PROMPT, ANSWER])), ['user', 'assistant']);
});

// ---- compaction: one honest note, never a wall of summary -------------------

test('the compact summary never renders as a user bubble', () => {
  const events = parseTranscript([
    J({ type: 'user', uuid: 'cs-1', timestamp: '2026-08-11T21:00:00.000Z', isCompactSummary: true,
        message: { role: 'user', content: 'This session is being continued from a previous conversation…' } }),
    J({ type: 'user', uuid: 'cs-2', timestamp: '2026-08-11T21:00:01.000Z', isVisibleInTranscriptOnly: true,
        message: { role: 'user', content: 'transcript-only bookkeeping' } }),
  ]);
  assert.equal(events.length, 0, 'both flags mean: not something the user said');
});

test('a compact_boundary becomes one quiet note with the token counts', () => {
  const events = parseTranscript([
    J({ type: 'system', subtype: 'compact_boundary', uuid: 'cb-1', timestamp: '2026-08-11T21:00:02.000Z',
        content: 'Conversation compacted', level: 'info',
        compactMetadata: { trigger: 'manual', preTokens: 426603, postTokens: 15117 } }),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'note');
  assert.match(events[0].text, /Compacted — 427k → 15k tokens \(manual\)/);
});
