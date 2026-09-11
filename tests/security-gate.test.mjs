import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessAudit, checkSecurity } from '../scripts/check-security.mjs';
const clean = { status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }, vulnerabilities: {} }) };
test('security gate refuses findings, unavailable service, timeout and incomplete reports', () => {
  assert.equal(assessAudit(clean).ok, true);
  for (const result of [{ ...clean, status: 1 }, { ...clean, error: Error('offline') }, { ...clean, signal: 'SIGTERM' }, { status: 0, stdout: '{}' }, { status: 0, stdout: 'not JSON' }, { ...clean, stdout: clean.stdout.replace('"total":0', '"total":1') }, { ...clean, stdout: clean.stdout.replace('"vulnerabilities":{}', '"vulnerabilities":{"fixture":{}}') }]) assert.equal(assessAudit(result).ok, false);
});
test('release check audits both full and runtime dependencies and propagates either failure', () => {
  const calls = [];
  assert.equal(checkSecurity({ run: (_cmd, args) => { calls.push(args); return calls.length === 1 ? { ...clean, status: 1 } : clean; } }), false);
  assert.deepEqual(calls, [['audit', '--json'], ['audit', '--json', '--omit=dev']]);
});
