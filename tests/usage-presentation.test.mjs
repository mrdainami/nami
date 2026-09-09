import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { groupUsage, usageContent } from '../src/renderer/usage-pane.mjs';
import { browserSettingsContent } from '../src/renderer/browser-settings.mjs';
const require = createRequire(import.meta.url);
const { codexUsage, customUsage } = require('../src/main/usage.js');

test('usage pane does not paint a nested paper slab', () => {
  const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/usage-pane.css'), 'utf8');
  const block = css.match(/\.usage-settings\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(block, /background:\s*var\(--paper\)/);
});
test('shared and model buckets stay separate windows of one known account', () => {
  const rows = codexUsage({ rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 2000 } },
    spark: { limitName: 'Spark', primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 2000 } },
  } }, 1000000);
  const { groups } = groupUsage(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].windows.length, 2);
  assert.deepEqual(groups[0].windows.map((row) => row.scopeLabel), ['Shared account allowance', 'Spark']);
  assert.deepEqual(groups[0].windows.map((row) => row.remaining), [60, 100]);
});

test('same displayed provider name never merges separate custom account feeds', () => {
  const feed = { name: 'Same provider', at: 1000000, windows: [{ label: 'Weekly', remainingPercent: 20 }] };
  const rows = [...customUsage('work', feed, 1000000), ...customUsage('personal', feed, 1000000)];
  assert.equal(groupUsage(rows).groups.length, 2);
});

test('stale reports remain visible in their account with no false live meter', () => {
  const rows = customUsage('work', { at: 1, windows: [{ remainingPercent: 75 }] }, 1000000);
  const grouped = groupUsage(rows);
  assert.equal(grouped.groups.length, 1);
  assert.equal(grouped.unavailable.length, 0);
  const html = usageContent({ accounts: rows });
  assert.match(html, /Stale report/);
  assert.doesNotMatch(html, /aria-valuenow/);
  assert.doesNotMatch(html, /75% left/);
});

test('malformed percentages and source labels cannot become active markup', () => {
  const html = usageContent({ accounts: [{ id: 'x', accountId: 'x', providerName: '<img onerror=alert(1)>', windowLabel: '<script>bad</script>', remaining: '20;display:none' }] });
  assert.doesNotMatch(html, /<img|<script|aria-valuenow/);
  assert.match(html, /&lt;script&gt;/);
});

test('a provider card leads with its tightest window and shows the others beside it', () => {
  const rows = codexUsage({ rateLimitsByLimitId: {
    codex: {
      primary: { usedPercent: 70, windowDurationMins: 300, resetsAt: 2000 },
      secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 3000 },
    },
  } }, 1000000);
  const html = usageContent({ accounts: rows });
  assert.match(html, /class="usage-card"/);
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /class="usage-windows"/);
  assert.match(html, /90% left/);
  const head = html.slice(0, html.indexOf('class="usage-windows"'));
  assert.match(head, /Codex/);
  assert.match(head, /30% left/);
  assert.doesNotMatch(head, /90% left/);
  assert.equal((html.match(/aria-valuenow=/g) || []).length, 2);
});

test('a spend limit and an expired window fold away behind a summary that names them', () => {
  const html = usageContent({ accounts: [
    { id: 'a', providerId: 'claude', providerName: 'Claude', accountId: 'claude:account', windowKey: 'five_hour', windowLabel: 'Session · 5 hours', remaining: 30, status: 'reported' },
    { id: 'b', providerId: 'claude', providerName: 'Claude', accountId: 'claude:account', windowKey: 'seven_day_opus', windowLabel: 'Opus · 7 days', remaining: 80, status: 'reported' },
    { id: 'c', providerId: 'claude', providerName: 'Claude', accountId: 'claude:account', windowKey: 'spend_limit', windowLabel: 'Spend limit', remaining: 95, status: 'reported' },
  ] });
  const folded = html.match(/<details class="usage-more">[\s\S]*?<\/details>/);
  assert.ok(folded);
  assert.doesNotMatch(folded[0], /\sopen/);
  assert.match(folded[0], /<summary>Spend limit<\/summary>/);
  assert.match(html.slice(0, html.indexOf('usage-more')), /Opus · 7 days/);
});

test('default usage screen has no status-line or JSON-feed homework', () => {
  const html = usageContent({
    accounts: [{ id: 'grok', name: 'Grok', providerId: 'grok', providerName: 'Grok', status: 'unavailable', remaining: null, detail: 'Sign in with Grok' }],
  });
  assert.match(html, /sign in with grok/i);
  assert.doesNotMatch(html, /Copy feed format|Copy status-line command|status-line|my-provider\.json|usage-advanced|Connect the Claude/i);
});

test('empty CLI cards collapse behind one closed line instead of filling the pane', () => {
  const html = usageContent({
    accounts: [
      { id: 'codex', accountId: 'codex', providerId: 'codex', providerName: 'Codex', remaining: 40, windowLabel: '5 hours', status: 'reported' },
      { id: 'grok', name: 'Grok', providerId: 'grok', providerName: 'Grok', status: 'unavailable', remaining: null, detail: 'No quota on this Mac yet' },
      { id: 'hermes', name: 'Hermes', providerId: 'hermes', providerName: 'Hermes', status: 'unavailable', remaining: null, detail: 'No quota on this Mac yet' },
    ],
  });
  const closed = html.match(/<details class="usage-unavailable">[\s\S]*?<\/details>/);
  assert.ok(closed);
  assert.doesNotMatch(closed[0], /\sopen/);
  assert.match(closed[0], /2 CLIs have nothing to show yet/);
  assert.match(html.slice(0, html.indexOf('usage-unavailable')), /Codex/);
});

test('browser settings lead with downloads and import, with no agent-access sheet', () => {
  const html = browserSettingsContent({ enabled: true, sessions: [{ id: 's', title: 'Codex', views: ['v'], peers: [] }], profiles: [{ id: 'p', name: '<private>', active: true }] }, { onProfiles() {}, onImportCookies() {} });
  assert.match(html, /id="browser-blank-heading"/);
  assert.match(html, /id="browser-download-heading"/);
  assert.match(html, /Import from Chrome/);
  assert.match(html, /&lt;private&gt;/);
  assert.doesNotMatch(html, /Agent browser access|Access configured|browser-agent-details|Enable local browser/);
});
