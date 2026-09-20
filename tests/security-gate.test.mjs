import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessAudit, assessElectron, checkSecurity, startTool } from '../scripts/check-security.mjs';
const clean = { status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }, vulnerabilities: {} }) };
test('security gate refuses findings, unavailable service, timeout and incomplete reports', () => {
  assert.equal(assessAudit(clean).ok, true);
  for (const result of [{ ...clean, status: 1 }, { ...clean, error: Error('offline') }, { ...clean, signal: 'SIGTERM' }, { status: 0, stdout: '{}' }, { status: 0, stdout: 'not JSON' }, { ...clean, stdout: clean.stdout.replace('"total":0', '"total":1') }, { ...clean, stdout: clean.stdout.replace('"vulnerabilities":{}', '"vulnerabilities":{"fixture":{}}') }]) assert.equal(assessAudit(result).ok, false);
});
test('release check audits both full and runtime dependencies and propagates either failure', () => {
  const calls = [];
  assert.equal(checkSecurity({ electronVersion: '43.7.0', run: (_cmd, args) => {
    if (args[0] === 'view') return { status: 0, stdout: JSON.stringify(args[1] === 'electron' ? '44.3.0' : ['43.3.0', '43.7.0']) };
    calls.push(args); return calls.length === 1 ? { ...clean, status: 1 } : clean;
  } }), false);
  assert.deepEqual(calls, [['audit', '--json'], ['audit', '--json', '--omit=dev']]);
});
test('Electron gate rejects stale minors, unsupported majors and invalid release metadata', () => {
  assert.equal(assessElectron('43.7.0', ['43.7.0', '43.3.0'], '44.3.0').ok, true);
  assert.equal(assessElectron('43.3.0', ['43.7.0', '43.3.0'], '44.3.0').ok, false);
  assert.equal(assessElectron('43.7.0', ['43.7.0'], '46.0.0').ok, false);
  assert.equal(assessElectron('43.7.0', [], '44.3.0').ok, false);
  assert.equal(assessElectron('43.7.0', ['43.7.0'], {}).ok, false);
});
test('clean dependency audits cannot hide an unavailable Electron release check', () => {
  assert.equal(checkSecurity({ electronVersion: '43.7.0', run: (_cmd, args) => args[0] === 'audit' ? clean : { status: 1 } }), false);
});
// npm is npm.cmd on Windows and Node refuses to start one by name, so the gate
// used to fail there with ENOENT before auditing anything. The Mac column must
// not move: same file, same arguments, same options.
test('npm is started through cmd.exe on Windows and exactly as before on a Mac', () => {
  const seen = [];
  const spawn = (file, args, options) => { seen.push({ file, args, options }); return clean; };
  const options = { cwd: '/repo', encoding: 'utf8' };
  startTool({ spawn, platform: 'darwin' })('npm', ['audit', '--json'], options);
  assert.deepEqual(seen[0], { file: 'npm', args: ['audit', '--json'], options });
  startTool({ spawn, platform: 'win32' })('npm', ['view', 'electron@43', 'version', '--json'], options);
  assert.match(seen[1].file, /cmd\.exe$/i);
  assert.deepEqual(seen[1].args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(seen[1].args[3], /^"set NoDefaultCurrentDirectoryInExePath=1&& npm /);
  assert.match(seen[1].args[3], /electron@43/);
  assert.equal(seen[1].options.windowsVerbatimArguments, true);
  assert.equal(seen[1].options.cwd, '/repo');
});
test('the gate hands its runner plain npm arguments on every platform', () => {
  const files = [];
  checkSecurity({ electronVersion: '43.7.0', run: (file, args) => { files.push(file); return args[0] === 'audit' ? clean : { status: 1 }; } });
  assert.deepEqual([...new Set(files)], ['npm']);
});
