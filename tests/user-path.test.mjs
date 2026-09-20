import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { userPath, mergePath, pathFromOutput, refreshUserPath, resetForTests } = require('../src/main/user-path.js');

// A Dock-launched app is handed launchd's stump and nothing else. Everything
// here is about turning that back into the PATH the user actually has.
const LAUNCHD = '/usr/bin:/bin:/usr/sbin:/sbin';
// Every PATH in this file is a Mac one, so every call says so. Left to default,
// a PC would split these on ';' and look for a drive letter. The Windows column
// is in windows-shell.test.mjs.
const MAC = 'darwin';

test('the login shell wins, because its order is the user intent', () => {
  const merged = mergePath('/opt/homebrew/bin:/usr/bin', LAUNCHD, MAC);
  assert.equal(merged.split(':')[0], '/opt/homebrew/bin');
});

test('nothing the process already had is dropped', () => {
  const merged = mergePath('/opt/homebrew/bin', '/only/here', MAC);
  assert.ok(merged.split(':').includes('/only/here'));
});

test('a directory in both lists appears once', () => {
  const merged = mergePath('/usr/bin:/bin', LAUNCHD, MAC);
  assert.equal(merged.split(':').filter((p) => p === '/usr/bin').length, 1);
});

test('empty segments never become an entry, which would mean "current directory"', () => {
  // a stray colon in PATH is a real security footgun: it resolves as "."
  const merged = mergePath('/a::/b:', ':/c', MAC);
  assert.ok(merged.split(':').every(Boolean), merged);
});

test('a shell that says nothing leaves the process PATH untouched', () => {
  assert.equal(mergePath('', LAUNCHD, MAC), LAUNCHD);
});

test('the PATH is read past whatever the rc file printed first', () => {
  assert.equal(pathFromOutput('nvm: v22\nhello\n/opt/homebrew/bin:/usr/bin\n', MAC), '/opt/homebrew/bin:/usr/bin');
  assert.equal(pathFromOutput('just a greeting\n', MAC), '');
  assert.equal(pathFromOutput('', MAC), '');
});

test('userPath asks the shell once and reuses the answer', async () => {
  resetForTests();
  let calls = 0;
  const exec = async () => { calls++; return '/opt/homebrew/bin'; };
  const a = await userPath({ exec, env: { PATH: LAUNCHD }, platform: MAC });
  const b = await userPath({ exec, env: { PATH: LAUNCHD }, platform: MAC });
  assert.equal(calls, 1, 'the probe costs a second — it must not run per tile');
  assert.equal(a, b);
  assert.ok(a.startsWith('/opt/homebrew/bin'));
});

test('a shell that throws degrades to the PATH we already had, not to nothing', async () => {
  resetForTests();
  const out = await userPath({ exec: async () => { throw new Error('no tty'); }, env: { PATH: LAUNCHD }, platform: MAC });
  assert.equal(out, LAUNCHD);
});

test('a shell that hangs and returns empty still yields a usable PATH', async () => {
  resetForTests();
  const out = await userPath({ exec: async () => '', env: { PATH: LAUNCHD }, platform: MAC });
  assert.equal(out, LAUNCHD);
});

// One probe per app run is right for a PATH that does not move — and wrong for
// the one moment it does. An installer run inside Nami writes a PATH line into
// the rc file, and every tile opened afterwards was still being handed the
// answer from before the install, so an agent Nami had just installed could not
// be spawned until the app was restarted.
test('after an install the shell is asked again', async () => {
  resetForTests();
  let asked = 0;
  const answers = ['/usr/bin', '/Users/x/.local/bin:/usr/bin'];
  const exec = async () => answers[asked++] || '';
  assert.equal(await userPath({ exec, env: { PATH: '' }, platform: MAC }), '/usr/bin');

  refreshUserPath();

  assert.equal(await userPath({ exec, env: { PATH: '' }, platform: MAC }), '/Users/x/.local/bin:/usr/bin');
  assert.equal(asked, 2, 'the memo must actually have been dropped');
});
