// Inlines the recorded fixtures into tests/harness-data.js so the replay
// harness runs from file:// without fetch. Adds one synthetic thought
// fixture (marked synthetic) because the adapter did not emit thought
// chunks in the recorded sessions.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIX = path.join(ROOT, 'fixtures');
const OUT = path.join(ROOT, 'tests');
mkdirSync(OUT, { recursive: true });

const fixtures = {};
for (const f of readdirSync(FIX).filter((x) => x.endsWith('.json'))) {
  fixtures[f.replace('.json', '')] = JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
}
fixtures['thought-synthetic'] = [
  { t: 0, dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'The folder has three demo files. ' } } } } },
  { t: 60, dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'A short answer is enough here.' } } } } },
  { t: 120, dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Three files: a page, notes, and a script. Code sample:\n```js\nconst x = 1\n```\nSee [the docs](https://example.com) and `inline`.' } } } } },
];

writeFileSync(path.join(OUT, 'harness-data.js'), 'window.FIXTURES = ' + JSON.stringify(fixtures) + ';\n');
console.log('harness-data.js:', Object.keys(fixtures).join(', '));
