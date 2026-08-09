import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { exitNote, signalName } = require('../src/main/exit-note.js');

// The bug this replaces: quitting Nami killed every pty with SIGHUP, the tile
// printed "[process exited · 129]", and that reads as a crash. It is the most
// ordinary event in the app.
test('a session Nami closed says so, and never shows a number', () => {
  assert.equal(exitNote({ code: 129, signal: 1, deliberate: true }), 'session closed');
  assert.equal(exitNote({ code: 0, deliberate: true }), 'session closed');
  assert.ok(!/129/.test(exitNote({ code: 129, deliberate: true })));
});

test('129 with no signal field is still recognised as a hangup', () => {
  // node-pty reports signal deaths as 128+n on some platforms, with no signal
  assert.equal(signalName({ code: 129 }), 'SIGHUP');
  assert.equal(exitNote({ code: 129 }), 'terminal closed');
});

test('ctrl-C reads as stopped, not as a failure', () => {
  assert.equal(exitNote({ code: 130 }), 'stopped');
  assert.equal(exitNote({ signal: 2 }), 'stopped');
});

test('a program that ended on its own says finished', () => {
  assert.equal(exitNote({ code: 0 }), 'finished');
});

test('a real failure keeps its number, because there the number is the point', () => {
  assert.equal(exitNote({ code: 1 }), 'exited · 1');
  assert.equal(exitNote({ code: 127 }), 'exited · 127');
});

test('an unusual signal is named rather than left as arithmetic', () => {
  assert.equal(exitNote({ code: 137 }), 'stopped · SIGKILL');
  assert.equal(exitNote({ signal: 'SIGSEGV' }), 'stopped · SIGSEGV');
});

test('a missing code never renders as undefined', () => {
  assert.equal(exitNote({}), 'exited · ?');
  assert.equal(exitNote(), 'exited · ?');
});

test('an exit code above the signal range stays a plain exit code', () => {
  // 160+ is not 128+signal on any platform we run on
  assert.equal(exitNote({ code: 200 }), 'exited · 200');
});
