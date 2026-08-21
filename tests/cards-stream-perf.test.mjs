// The stress fixture: a growing reply fed in many small appends must cost
// linear total parse work through the streaming renderer, and buildRows must
// stay comfortably fast on a thousand-event conversation (the opencode
// post-interrupt turn produced exactly that shape live).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownStream } from '../src/renderer/md.mjs';
import { buildRows } from '../src/renderer/session-cards.mjs';

test('600-append stream: total parse work stays linear', () => {
  let state = null, text = '', total = 0;
  for (let i = 0; i < 600; i++) {
    text += (i % 7 === 0 ? '\n\n## section ' + i + '\n\n' : '') + 'delta ' + i + ' words arrive. ';
    const r = renderMarkdownStream(text, state, { streaming: true });
    state = r.state;
    total += r.state.parsedLines;
  }
  const fullLines = text.split('\n').length;
  assert.ok(total < fullLines * 30, `total parsed ${total} lines for a ${fullLines}-line doc — must not be quadratic`);
});

test('a thousand-event conversation builds rows fast and stable', () => {
  const events = [{ kind: 'user', id: 'u1', at: 1000, text: 'count' }];
  for (let i = 0; i < 500; i++) {
    events.push({ kind: 'tool', id: 't' + i, toolId: 'x' + i, name: 'Bash', toolKind: 'execute', input: { command: 'echo ' + i } });
    events.push({ kind: 'tool_result', id: 'r' + i, toolId: 'x' + i, body: String(i) });
  }
  events.push({ kind: 'turn_end', id: 'e1', at: 60000, durationMs: 59000, tokens: 9000 });
  const t0 = process.hrtime.bigint();
  const rows = buildRows(events);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const fold = rows.find((r) => r.kind === 'fold');
  assert.equal(rows.length, 3, 'a long tool run folds to one row (user, fold, turn_end)');
  assert.ok(fold, 'the run lives in a fold row');
  assert.ok(ms < 200, `buildRows took ${ms.toFixed(1)}ms — must stay well under a frame budget at this scale`);
});
