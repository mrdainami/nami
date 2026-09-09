import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { codexUsage, feedUsage, customUsage, claudeUsage, geminiUsage, grokUsage, claudeOauthUsage, readUsage } = require('../src/main/usage.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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

test('Claude local utilization reports remaining and never treats used percent as remaining', () => {
  const rows = claudeUsage({
    cachedUsageUtilization: {
      fetchedAtMs: 1000000,
      utilization: {
        five_hour: { utilization: 25, resets_at: 2000 },
        seven_day: { utilization: 60, resets_at: 4000 },
      },
    },
  }, 1000000);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.remaining), [75, 40]);
  assert.equal(rows.every((r) => r.status === 'reported'), true);
  assert.equal(rows.every((r) => r.providerId === 'claude'), true);
  assert.equal(rows.some((r) => r.remaining === 25 || r.remaining === 60), false);
});

test('Claude local missing utilization is omitted, never shown as 0 left', () => {
  assert.equal(claudeUsage({ cachedUsageUtilization: { fetchedAtMs: 1000000, utilization: { five_hour: {} } } }, 1000000).length, 0);
  assert.equal(claudeUsage({ cachedUsageUtilization: { fetchedAtMs: 1000000, utilization: {} } }, 1000000).length, 0);
});

test('Claude local stale and expired windows stay labelled stale with no live remaining', () => {
  const stale = claudeUsage({
    cachedUsageUtilization: {
      fetchedAtMs: 1,
      utilization: { five_hour: { utilization: 25, resets_at: 9999999999 } },
    },
  }, 1 + 31 * 60 * 1000);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].remaining, null);
  assert.equal(stale[0].status, 'stale');
  const expired = claudeUsage({
    cachedUsageUtilization: {
      fetchedAtMs: 1000000,
      utilization: { five_hour: { utilization: 25, resets_at: 1 } },
    },
  }, 1000000);
  assert.equal(expired[0].remaining, null);
  assert.equal(expired[0].status, 'stale');
});

test('Gemini local remainingFraction reports remaining and skips unknown buckets', () => {
  const rows = geminiUsage({
    buckets: [
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.4, resetTime: '2026-09-10T00:00:00Z' },
      { modelId: 'gemini-2.5-flash', remainingFraction: 0.93, resetTime: '2026-09-10T00:00:00Z' },
      { modelId: 'unknown-model' },
    ],
  }, Date.parse('2026-09-09T00:00:00Z'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.remaining), [40, 93]);
  assert.equal(rows.every((r) => r.status === 'reported'), true);
  assert.equal(geminiUsage({ buckets: [{ modelId: 'x' }] }, 1000000).length, 0);
});

test('Gemini remainingFraction of 0 is a real empty window, not unknown', () => {
  const rows = geminiUsage({ buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0, resetTime: '2026-09-10T00:00:00Z' }] }, Date.parse('2026-09-09T00:00:00Z'));
  assert.equal(rows[0].remaining, 0);
  assert.equal(rows[0].status, 'reported');
});

test('readUsage prefers Claude local state and keeps the status-line feed as a supplement', async () => {
  const home = tmpDir('nami-usage-home-');
  const directory = tmpDir('nami-usage-feeds-');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    cachedUsageUtilization: {
      fetchedAtMs: 1000000,
      utilization: { five_hour: { utilization: 10, resets_at: 5000 } },
    },
  }));
  fs.writeFileSync(path.join(directory, 'claude.json'), JSON.stringify({
    at: 1000000,
    rate_limits: { seven_day: { used_percentage: 40, resets_at: 8000 } },
  }));
  const result = await readUsage({
    agents: [{ id: 'claude', name: 'Claude Code', found: true, path: '/bin/claude' }],
    directory, home, now: 1000000,
  });
  assert.deepEqual(result.accounts.map((r) => r.windowLabel).sort(), ['5 hours', 'seven day']);
  assert.deepEqual(result.accounts.map((r) => r.remaining).sort(), [60, 90]);
  assert.equal(result.accounts.every((r) => r.providerId === 'claude'), true);
});

test('readUsage reports Gemini local quota from a fixture file', async () => {
  const home = tmpDir('nami-usage-gemini-');
  const directory = tmpDir('nami-usage-feeds-');
  fs.mkdirSync(path.join(home, '.gemini'));
  fs.writeFileSync(path.join(home, '.gemini', 'quota.json'), JSON.stringify({
    buckets: [{ modelId: 'gemini-2.5-pro', remainingFraction: 0.55, resetTime: '2026-09-10T00:00:00Z' }],
  }));
  const result = await readUsage({
    agents: [{ id: 'antigravity', name: 'Antigravity', found: true, path: '/bin/agy' }],
    directory, home, now: Date.parse('2026-09-09T00:00:00Z'),
  });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].remaining, 55);
  assert.equal(result.accounts[0].providerId, 'antigravity');
});

test('Claude oauth usage maps remaining from the live account endpoint', () => {
  const rows = claudeOauthUsage({
    five_hour: { used_percentage: 20, resets_at: '2030-01-01T00:00:00Z' },
    seven_day: { used_percentage: 55, resets_at: '2030-01-08T00:00:00Z' },
  }, Date.parse('2026-09-10T00:00:00Z'));
  assert.deepEqual(rows.map((r) => r.remaining), [80, 45]);
});

test('Grok billing percent becomes remaining and never invents 0 from a missing body', () => {
  const rows = grokUsage({ creditUsagePercent: 30 }, 1000, { name: 'Grok' });
  assert.equal(rows[0].remaining, 70);
  assert.equal(grokUsage({}, 1000, { name: 'Grok' }).length, 0);
});

test('unavailable CLIs ask to sign in and never invent 0', async () => {
  const home = tmpDir('nami-usage-empty-');
  const directory = tmpDir('nami-usage-feeds-');
  const result = await readUsage({
    agents: [
      { id: 'grok', name: 'Grok', found: true, path: '/bin/grok' },
      { id: 'opencode', name: 'OpenCode', found: true, path: '/bin/opencode' },
      { id: 'claude', name: 'Claude Code', found: true, path: '/bin/claude' },
    ],
    directory, home, now: 1000000,
  });
  assert.equal(result.accounts.length, 3);
  for (const row of result.accounts) {
    assert.equal(row.status, 'unavailable');
    assert.equal(row.remaining, null);
    assert.match(row.detail, /sign in with/i);
    assert.doesNotMatch(row.detail, /status-line|JSON|adapter|feed format|0%/i);
  }
});
