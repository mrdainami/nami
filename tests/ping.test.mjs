import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pingPlan, sendPing, PING_URL } = require('../src/main/ping.js');

// A valid UUID the way the server checks it (worker/index.ts isUuid).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const base = () => ({
  settings: {},
  isPackaged: true,
  env: {},
  version: '0.2.0',
  arch: 'arm64',
  randomUUID: () => '11111111-2222-4333-8444-555566667777',
});

// --- the decision: what to send, if anything ---------------------------------

test('first launch mints an id and flags first', () => {
  const plan = pingPlan(base());
  assert.equal(plan.url, PING_URL);
  assert.match(plan.payload.id, UUID_RE);
  assert.equal(plan.payload.first, true);
  assert.equal(plan.mintedId, plan.payload.id);
});

test('a later launch reuses the stored id, un-flagged', () => {
  const plan = pingPlan({ ...base(), settings: { pingId: 'aaaabbbb-cccc-4ddd-8eee-ffff00001111' } });
  assert.equal(plan.payload.id, 'aaaabbbb-cccc-4ddd-8eee-ffff00001111');
  assert.equal(plan.payload.first, false);
  assert.equal(plan.mintedId, null);
});

test('the payload is exactly the four fields', () => {
  const plan = pingPlan(base());
  assert.deepEqual(Object.keys(plan.payload).sort(), ['arch', 'first', 'id', 'version']);
  assert.equal(plan.payload.version, '0.2.0');
  assert.equal(plan.payload.arch, 'arm64');
});

test('a dev run sends nothing', () => {
  // Unpackaged = someone building Nami; their launches must not count as users.
  assert.equal(pingPlan({ ...base(), isPackaged: false }), null);
});

test('NAMI_PING_URL lets a dev run ping anyway — at that url', () => {
  const plan = pingPlan({ ...base(), isPackaged: false, env: { NAMI_PING_URL: 'http://localhost:8788/api/ping' } });
  assert.equal(plan.url, 'http://localhost:8788/api/ping');
});

// --- the send: fire-and-forget, never a throw --------------------------------

test('sendPing posts the payload and persists a minted id', async () => {
  const saved = [];
  const calls = [];
  const r = await sendPing({
    ...base(),
    saveSettings: (patch) => saved.push(patch),
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
  });
  assert.equal(r.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PING_URL);
  const body = JSON.parse(calls[0].opts.body);
  assert.match(body.id, UUID_RE);
  assert.equal(body.first, true);
  assert.deepEqual(saved, [{ pingId: body.id }]);
});

test('a stored id is not re-saved', async () => {
  const saved = [];
  const r = await sendPing({
    ...base(),
    settings: { pingId: 'aaaabbbb-cccc-4ddd-8eee-ffff00001111' },
    saveSettings: (patch) => saved.push(patch),
    fetchImpl: async () => ({ ok: true }),
  });
  assert.equal(r.sent, true);
  assert.deepEqual(saved, []);
});

test('a dead network resolves silently, never throws', async () => {
  const r = await sendPing({
    ...base(),
    saveSettings: () => {},
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(r.sent, false);
});

test('a dev run resolves without fetching', async () => {
  let fetched = 0;
  const r = await sendPing({
    ...base(),
    isPackaged: false,
    saveSettings: () => {},
    fetchImpl: async () => { fetched++; return { ok: true }; },
  });
  assert.equal(r.sent, false);
  assert.equal(fetched, 0);
});

test('even a throwing saveSettings cannot break the launch', async () => {
  const r = await sendPing({
    ...base(),
    saveSettings: () => { throw new Error('disk full'); },
    fetchImpl: async () => ({ ok: true }),
  });
  // The id could not be persisted, so the ping is skipped rather than sent
  // with an id that would be different again tomorrow.
  assert.equal(r.sent, false);
});
