// findOnDisk against a real Microsoft Store execution alias, and agents-detect's
// shortHome as main.js uses it.
//
// The alias is the awkward file on Windows: a reparse point in
// %LOCALAPPDATA%\Microsoft\WindowsApps that Windows starts without complaint
// and Node cannot stat (EACCES — fs.existsSync says false; pwsh-find.js looks
// with lstat for that reason). findOnDisk asks access(), not stat, and measured
// on Windows 11 with Node 24 and Electron 43 access() answers yes for an alias.
// So there is nothing to fix in it; this test is here so that if a Node upgrade
// ever changes that answer, an agent installed from the Store does not quietly
// go missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findOnDisk, shortHome } = require('../src/main/agents-detect.js');

// Every Windows 11 has aliases here (the Store, Media Player, winget…); which
// ones is the machine's business, so the test takes the first it finds. An
// alias is told from an ordinary .exe by exactly the oddity above.
const appsDir = process.platform === 'win32' && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps') : '';
let alias = '';
if (appsDir) {
  try {
    alias = fs.readdirSync(appsDir).find((name) => {
      if (!/\.exe$/i.test(name)) return false;
      try { fs.lstatSync(path.join(appsDir, name)); } catch (_) { return false; }
      return !fs.existsSync(path.join(appsDir, name));
    }) || '';
  } catch (_) {}
}
test('findOnDisk finds a real Store execution alias, which stat cannot see', { skip: !alias && 'needs Windows with an app execution alias in %LOCALAPPDATA%\\Microsoft\\WindowsApps' }, async () => {
  const found = await findOnDisk(alias.replace(/\.exe$/i, ''), { home: 'C:\\nowhere', env: { PATH: appsDir }, platform: 'win32' });
  assert.equal(found.toLowerCase(), path.join(appsDir, alias).toLowerCase());
});

test('shortHome is exported for main.js, both columns', () => {
  assert.equal(shortHome('/Users/cal/.claude/agents/x.md', '/Users/cal', 'darwin'), '~/.claude/agents/x.md');
  assert.equal(shortHome('c:\\users\\cal\\.claude\\agents\\x.md', 'C:\\Users\\Cal', 'win32'), '~\\.claude\\agents\\x.md');
  assert.equal(shortHome('C:\\Users\\Calvin\\x', 'C:\\Users\\Cal', 'win32'), 'C:\\Users\\Calvin\\x');
});
