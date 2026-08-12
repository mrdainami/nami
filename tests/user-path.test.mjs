// The PATH sessions run with: asked once from the user's login shell, because
// a Dock-launched app inherits `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { userPath, mergePath, pathFromOutput, refreshUserPath, resetForTests } = require('../src/main/user-path.js');

test('the shell answer wins, and the running PATH fills the gaps', () => {
  assert.equal(mergePath('/a:/b', '/b:/c'), '/a:/b:/c');
  // order is the user's intent — a shell entry never gets demoted
  assert.equal(mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin'), '/opt/homebrew/bin:/usr/bin');
  assert.equal(mergePath('', '/usr/bin'), '/usr/bin');
  assert.equal(mergePath('/usr/bin', ''), '/usr/bin');
});

test('a banner printed by .zshrc does not become the PATH', () => {
  assert.equal(pathFromOutput('nvm loaded\nwelcome back\n/opt/homebrew/bin:/usr/bin'), '/opt/homebrew/bin:/usr/bin');
  assert.equal(pathFromOutput('no path here'), '');
  assert.equal(pathFromOutput(''), '');
});

test('the shell is asked once, not once per tile', async () => {
  resetForTests();
  let asked = 0;
  const exec = async () => { asked++; return '/from/shell'; };
  await userPath({ exec, env: { PATH: '/inherited' } });
  await userPath({ exec, env: { PATH: '/inherited' } });
  await userPath({ exec, env: { PATH: '/inherited' } });
  assert.equal(asked, 1);
});

// The one moment the answer goes stale: an installer that just wrote a PATH
// line into .zshrc. Every tile opened afterwards was being handed the PATH from
// before the install, so an agent Nami had itself installed could not be
// spawned until the app was restarted.
test('after an install the shell is asked again', async () => {
  resetForTests();
  let asked = 0;
  const answers = ['/usr/bin', '/Users/x/.local/bin:/usr/bin'];
  const exec = async () => answers[asked++] || '';
  assert.equal(await userPath({ exec, env: { PATH: '' } }), '/usr/bin');

  refreshUserPath();

  assert.equal(await userPath({ exec, env: { PATH: '' } }), '/Users/x/.local/bin:/usr/bin');
  assert.equal(asked, 2);
});

test('a shell that fails to answer leaves the app where it was', async () => {
  resetForTests();
  const exec = async () => { throw new Error('no tty'); };
  assert.equal(await userPath({ exec, env: { PATH: '/inherited' } }), '/inherited');
});
