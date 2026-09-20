import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { exitNote, signalName } = require('../src/main/exit-note.js');

// 128+n is a POSIX habit, so the tests that lean on it say which platform they
// are asking about. Everything else here reads the same on both.
const MAC = 'darwin';

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
  assert.equal(signalName({ code: 129 }, MAC), 'SIGHUP');
  assert.equal(exitNote({ code: 129 }, MAC), 'terminal closed');
});

test('ctrl-C reads as stopped, not as a failure', () => {
  assert.equal(exitNote({ code: 130 }, MAC), 'stopped');
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
  assert.equal(exitNote({ code: 137 }, MAC), 'stopped · SIGKILL');
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

test('node-pty signal zero means no signal and preserves the exit code', () => {
  assert.equal(exitNote({ code: 0, signal: 0 }), 'finished');
  assert.equal(exitNote({ code: 7, signal: 0 }), 'exited · 7');
  assert.equal(exitNote({ code: 130, signal: 0 }, MAC), 'stopped');
});

// ---- Windows ---------------------------------------------------------------
// There are no signals. A process that dies badly exits with an NTSTATUS value,
// and node-pty hands it over as a signed 32-bit number: Ctrl+C measured on a
// real Windows 11 pty is -1073741510, which is 0xC000013A read as signed. Some
// callers report the same value unsigned, so both spellings are asked about.
const WIN = 'win32';

test('windows: ctrl-C reads as stopped, signed or unsigned', () => {
  assert.equal(exitNote({ code: -1073741510 }, WIN), 'stopped');
  assert.equal(exitNote({ code: 3221225786 }, WIN), 'stopped');
});

test('windows: a crash is named in words, never as a ten-digit number', () => {
  assert.equal(exitNote({ code: 3221225477 }, WIN), 'crashed · access violation');
  assert.equal(exitNote({ code: -1073741819 }, WIN), 'crashed · access violation');
  assert.equal(exitNote({ code: 3221226505 }, WIN), 'crashed · stack buffer overrun');
  assert.equal(exitNote({ code: 3221225725 }, WIN), 'crashed · stack overflow');
  for (const code of [3221225786, 3221225477, 3221225781, 3221226505, -1073741819]) {
    assert.ok(!/\d{6,}/.test(exitNote({ code }, WIN)), `${code} must not reach the tile as a number`);
  }
});

test('windows: a program that could not start says what was missing', () => {
  assert.equal(exitNote({ code: 3221225781 }, WIN), 'could not start · a DLL it needs is missing');
  assert.equal(exitNote({ code: 3221225794 }, WIN), 'could not start · a DLL failed to load');
  assert.equal(exitNote({ code: 9009 }, WIN), 'exited · command not recognized');
});

test('windows: a status nobody has named keeps its hex, which is what people search for', () => {
  assert.equal(exitNote({ code: 3221225622 }, WIN), 'crashed · 0xC0000096');
  assert.equal(exitNote({ code: -1073741674 }, WIN), 'crashed · 0xC0000096');
});

test('windows: the ordinary endings are the same words as on a Mac', () => {
  assert.equal(exitNote({ code: 0 }, WIN), 'finished');
  assert.equal(exitNote({ code: 1 }, WIN), 'exited · 1');
  assert.equal(exitNote({ code: -1073741510, deliberate: true }, WIN), 'session closed');
  assert.equal(exitNote({}, WIN), 'exited · ?');
});

test('windows: 129 and 130 are plain exit codes, because 128+n means nothing there', () => {
  assert.equal(exitNote({ code: 129 }, WIN), 'exited · 129');
  assert.equal(exitNote({ code: 130 }, WIN), 'exited · 130');
  assert.equal(signalName({ code: 130 }, WIN), '');
});

test('the Mac column does not learn Windows codes', () => {
  assert.equal(exitNote({ code: 3221225786 }, 'darwin'), 'exited · 3221225786');
  assert.equal(exitNote({ code: 9009 }, 'darwin'), 'exited · 9009');
  assert.equal(exitNote({ code: 130 }, 'darwin'), 'stopped');
});
