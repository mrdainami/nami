// `~` in the main process, both ways round and on both platforms: expandHome
// turns a registry path into a real one, and shortHome — reached here through
// detectAgents, which is what shows it to anyone — turns a real one back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { expandHome, detectAgents } = require('../src/main/agents-detect.js');

const MAC_HOME = '/Users/cal', WIN_HOME = 'C:\\Users\\Cal';

test('expandHome: the Mac column is what it always was', () => {
  assert.equal(expandHome('~/.claude.json', MAC_HOME, 'darwin'), '/Users/cal/.claude.json');
  assert.equal(expandHome('~', MAC_HOME, 'darwin'), '/Users/cal');
  assert.equal(expandHome('/etc/hosts', MAC_HOME, 'darwin'), '/etc/hosts');
  assert.equal(expandHome('~other/x', MAC_HOME, 'darwin'), '~other/x', 'another user is not this one');
  assert.equal(expandHome('~\\x', MAC_HOME, 'darwin'), '~\\x', 'POSIX: a backslash does not end the tilde');
  assert.equal(expandHome('', MAC_HOME, 'darwin'), '');
});

test('expandHome: Windows takes either separator and answers in its own', () => {
  assert.equal(expandHome('~/.claude.json', WIN_HOME, 'win32'), 'C:\\Users\\Cal\\.claude.json');
  assert.equal(expandHome('~\\.claude.json', WIN_HOME, 'win32'), 'C:\\Users\\Cal\\.claude.json');
  assert.equal(expandHome('~/.config/opencode/opencode.json', WIN_HOME, 'win32'), 'C:\\Users\\Cal\\.config\\opencode\\opencode.json');
  assert.equal(expandHome('~', WIN_HOME, 'win32'), 'C:\\Users\\Cal');
  assert.equal(expandHome('~other\\x', WIN_HOME, 'win32'), '~other\\x');
  assert.equal(expandHome('D:\\tools/x.json', WIN_HOME, 'win32'), 'D:\\tools/x.json', 'no tilde, no touching');
  assert.equal(expandHome('~/x', 'C:\\Users\\$&me', 'win32'), 'C:\\Users\\$&me\\x', 'a home folder is text, not a replacement pattern');
});

const shortOf = async (found, home, platform) => {
  const agents = await detectAgents({ exec: async (bin) => (bin === 'claude' ? found : ''), home, platform, env: {} });
  return agents.find((a) => a.id === 'claude').pathShort;
};

test('shortHome: the Mac column is what it always was', async () => {
  assert.equal(await shortOf('/Users/cal/.local/bin/claude', MAC_HOME, 'darwin'), '~/.local/bin/claude');
  assert.equal(await shortOf('/usr/local/bin/claude', MAC_HOME, 'darwin'), '/usr/local/bin/claude');
  assert.equal(await shortOf('/Users/calvin/bin/claude', MAC_HOME, 'darwin'), '/Users/calvin/bin/claude', 'a longer name is another home');
  assert.equal(await shortOf('/Users/Cal/bin/claude', MAC_HOME, 'darwin'), '/Users/Cal/bin/claude', 'POSIX: case is kept as it was');
});

test('shortHome: a Windows home shortens, whatever its case or separator', async () => {
  assert.equal(await shortOf('C:\\Users\\Cal\\.local\\bin\\claude.exe', WIN_HOME, 'win32'), '~\\.local\\bin\\claude.exe');
  assert.equal(await shortOf('c:\\users\\cal\\.local\\bin\\claude.exe', WIN_HOME, 'win32'), '~\\.local\\bin\\claude.exe');
  assert.equal(await shortOf('C:/Users/Cal/AppData/Roaming/npm/claude.cmd', WIN_HOME, 'win32'), '~/AppData/Roaming/npm/claude.cmd');
  assert.equal(await shortOf('C:\\Users\\Cal\\x.exe', WIN_HOME + '\\', 'win32'), '~\\x.exe', 'a home given with a trailing separator');
  assert.equal(await shortOf('C:\\Users\\Calvin\\bin\\claude.exe', WIN_HOME, 'win32'), 'C:\\Users\\Calvin\\bin\\claude.exe', 'a longer name is another home');
  assert.equal(await shortOf('C:\\Program Files\\nodejs\\claude.cmd', WIN_HOME, 'win32'), 'C:\\Program Files\\nodejs\\claude.cmd');
  assert.equal(await shortOf('', WIN_HOME, 'win32'), '');
});
