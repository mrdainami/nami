import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { codexUsage, feedUsage, customUsage } = require('../src/main/usage.js');
test('multi-bucket Codex quotas are not counted twice and expose both windows', () => {
  const bucket = { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000 }, secondary: { usedPercent: 70, windowDurationMins: 10080, resetsAt: 3000 } };
  const rows = codexUsage({ rateLimits: bucket, rateLimitsByLimitId: { codex: bucket } }, 1000000);
  assert.equal(rows.length, 2); assert.deepEqual(rows.map((r) => r.remaining), [75, 30]);
});
test('custom providers accept reported windows, and reject stale or invalid percentages', () => {
  const data = { at: 1000000, name: 'My provider', source: 'Provider API', windows: [{ label: 'Weekly', remainingPercent: 42, resetsAt: 2000000 }] };
  assert.equal(customUsage('custom', data, 1000000)[0].remaining, 42);
  assert.equal(customUsage('custom', data, 1500000)[0].remaining, null);
  assert.equal(customUsage('custom', { ...data, windows: [{ remainingPercent: 101 }] }, 1000000)[0].remaining, null);
});
test('unknown and expired feed values cannot look like live allowance', () => {
  assert.equal(feedUsage({ at: 1, rate_limits: { five_hour: { used_percentage: 25, resets_at: 1 } } }, 1000000)[0].remaining, null);
  assert.equal(feedUsage({ at: 1000000, rate_limits: { five_hour: { used_percentage: '25' } } }, 1000000).length, 0);
  assert.equal(codexUsage({ rateLimits: { primary: {} } }).length, 0);
});
