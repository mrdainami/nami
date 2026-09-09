import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { usageContent } from '../src/renderer/usage-pane.mjs';
const require = createRequire(import.meta.url);
const { claudeOauthUsage, readUsage } = require('../src/main/usage.js');

const NOW = Date.parse('2026-09-10T12:00:00Z');
const MINUTE = 60 * 1000;

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function claudeHome(utilization, fetchedAtMs) {
  const home = tmpDir('nami-fidelity-home-');
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }));
  fs.writeFileSync(path.join(home, '.claude', 'usage-limits.json'), JSON.stringify({ cachedUsageUtilization: { fetchedAtMs, utilization } }));
  return home;
}

function accountFetch(payload) {
  return async () => ({ ok: true, json: async () => payload });
}

function outsideDetails(html) {
  return html.replace(/<details[\s\S]*?<\/details>/g, '');
}

test('a quota window the account reports outside the known five still reaches the pane', () => {
  const rows = claudeOauthUsage({
    five_hour: { used_percentage: 20, resets_at: '2030-01-01T00:00:00Z' },
    seven_day_haiku: { used_percentage: 35, resets_at: '2030-01-08T00:00:00Z' },
    seven_day_opus: { used_percentage: 10, resets_at: '2030-01-08T00:00:00Z' },
  }, NOW);
  assert.deepEqual(rows.map((r) => r.windowKey).sort(), ['five_hour', 'seven_day_haiku', 'seven_day_opus']);
  const haiku = rows.find((r) => r.windowKey === 'seven_day_haiku');
  assert.equal(haiku.remaining, 65);
  assert.equal(haiku.windowLabel, 'Haiku · 7 days');
  assert.equal(rows.find((r) => r.windowKey === 'five_hour').windowLabel, 'Session · 5 hours');
  assert.equal(rows.find((r) => r.windowKey === 'seven_day_opus').windowLabel, 'Opus · 7 days');
});

test('local and account reports merge, and the fresher report wins a shared window', async () => {
  const home = claudeHome({ five_hour: { utilization: 90, resets_at: NOW + 3600_000 } }, NOW - MINUTE);
  const result = await readUsage({
    agents: [{ id: 'claude', name: 'Claude Code', found: true, path: '/bin/claude' }],
    directory: tmpDir('nami-fidelity-feeds-'), home, now: NOW,
    fetchFn: accountFetch({
      five_hour: { used_percentage: 20, resets_at: '2030-01-01T00:00:00Z' },
      seven_day_opus: { used_percentage: 30, resets_at: '2030-01-08T00:00:00Z' },
    }),
  });
  assert.deepEqual(result.accounts.map((r) => r.windowKey).sort(), ['five_hour', 'seven_day_opus']);
  assert.equal(result.accounts.find((r) => r.windowKey === 'five_hour').remaining, 80);
  assert.equal(result.accounts.find((r) => r.windowKey === 'seven_day_opus').remaining, 70);
});

test('every window a provider reports is a visible meter, not a disclosure triangle', () => {
  const rows = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'].map((key, i) => ({
    id: 'claude:' + key, providerId: 'claude', providerName: 'Claude', accountId: 'claude:account',
    windowKey: key, windowLabel: 'Window ' + key, remaining: 20 + i * 10, status: 'reported', checkedAt: NOW,
  }));
  const html = usageContent({ accounts: rows });
  const visible = outsideDetails(html);
  for (const row of rows) assert.match(visible, new RegExp(row.windowLabel));
  assert.equal((visible.match(/aria-valuenow=/g) || []).length, rows.length);
  assert.doesNotMatch(html, /Other windows/);
});

test('a stale local window still shows a number when the account has a fresh one', async () => {
  const home = claudeHome({ five_hour: { utilization: 90, resets_at: NOW + 3600_000 } }, NOW - 40 * MINUTE);
  const result = await readUsage({
    agents: [{ id: 'claude', name: 'Claude Code', found: true, path: '/bin/claude' }],
    directory: tmpDir('nami-fidelity-feeds-'), home, now: NOW,
    fetchFn: accountFetch({ five_hour: { used_percentage: 25, resets_at: '2030-01-01T00:00:00Z' } }),
  });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].remaining, 75);
  assert.equal(result.accounts[0].status, 'reported');
});
