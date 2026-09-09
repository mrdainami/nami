import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { groupUsage, usageContent } from '../src/renderer/usage-pane.mjs';
import { browserSettingsContent } from '../src/renderer/browser-settings.mjs';
const require = createRequire(import.meta.url);
const { codexUsage, customUsage } = require('../src/main/usage.js');

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

test('a provider card collapses to the tightest window and expands for the rest', () => {
  const rows = codexUsage({ rateLimitsByLimitId: {
    codex: {
      primary: { usedPercent: 70, windowDurationMins: 300, resetsAt: 2000 },
      secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 3000 },
    },
  } }, 1000000);
  const html = usageContent({ accounts: rows });
  assert.match(html, /class="usage-card"/);
  const more = html.match(/<details class="usage-more"[^>]*>[\s\S]*?<\/details>/);
  assert.ok(more, 'extra windows belong in a closed details');
  assert.doesNotMatch(more[0], /\sopen/);
  assert.match(more[0], /90% left/);
  assert.doesNotMatch(more[0], /30% left/);
  const head = html.slice(0, html.indexOf('class="usage-more"'));
  assert.match(head, /Codex/);
  assert.match(head, /30% left/);
  assert.doesNotMatch(head, /90% left/);
});

test('default usage screen has no status-line or JSON-feed homework', () => {
  const html = usageContent({
    accounts: [{ id: 'grok', name: 'Grok', providerId: 'grok', providerName: 'Grok', status: 'unavailable', remaining: null, detail: 'No quota on this Mac yet' }],
    claudeCommand: 'ELECTRON_RUN_AS_NODE=1 node usage-statusline.js /tmp/usage',
    feedDirectory: '/tmp/usage',
  });
  const def = html.split('id="usage-advanced"')[0];
  assert.match(def, /no quota on this Mac yet/i);
  assert.doesNotMatch(def, /Copy feed format|Copy status-line command|status-line|my-provider\.json|Connect the Claude/i);
  assert.match(html, /id="usage-advanced"/);
  assert.doesNotMatch(html, /id="usage-advanced"[^>]*\sopen/);
  assert.match(html, /Copy feed format/);
});

test('browser settings distinguish configured permission from connection and escape profiles', () => {
  const html = browserSettingsContent({ enabled: true, sessions: [{ id: 's', title: 'Codex', views: ['v'], peers: [] }], profiles: [{ id: 'p', name: '<private>', active: true }] }, { onProfiles() {} });
  assert.match(html, /Access configured/);
  assert.match(html, /does not confirm that a client is connected/);
  assert.match(html, /&lt;private&gt;/);
  assert.doesNotMatch(html, /data-browser-settings="import"/);
});
