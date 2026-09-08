import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'src/renderer/acp-pane.mjs'), 'utf8');

test('Chat names it when a send arrives before the agent is connected', () => {
  assert.doesNotMatch(src, /if \(!state.connected \|\| state.busy\) return;/);
  assert.match(src, /if \(!state.connected\)/);
  assert.match(src, /The agent isn.t connected yet/);
});

test('a sent message names the card once, through the prompt hook', () => {
  const onSend = src.slice(src.indexOf('onSend: (text, attachments) => {'), src.indexOf('sendPrompt(full'));
  assert.match(onSend, /hooks\.prompt\(p, text\)/, 'onSend reports the display text to the namer');
  assert.equal((onSend.match(/hooks\.prompt\(/g) || []).length, 1, 'exactly once per send');
});
