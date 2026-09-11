import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessAudit, assessElectron, checkSecurity } from '../scripts/check-security.mjs';
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
