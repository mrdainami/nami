import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortAge } from '../src/renderer/rel-time.mjs';

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0); // Sun 9 Aug 2026, noon
const ago = (ms) => NOW - ms;

test('a row with no timestamp shows nothing rather than a fake age', () => {
  assert.equal(shortAge(0, NOW), '');
  assert.equal(shortAge(undefined, NOW), '');
});

test('the last minute reads as now', () => {
  assert.equal(shortAge(ago(0), NOW), 'now');
  assert.equal(shortAge(ago(59e3), NOW), 'now');
});

test('minutes, then hours', () => {
  assert.equal(shortAge(ago(12 * 60e3), NOW), '12m');
  assert.equal(shortAge(ago(3 * 3600e3), NOW), '3h');
  assert.equal(shortAge(ago(23 * 3600e3), NOW), '23h');
});

test('inside the week it names the day, past it a date', () => {
  const weekday = shortAge(ago(3 * 86400e3), NOW);
  assert.match(weekday, /^[A-Za-z]{3,}\.?$/, `expected a weekday, got ${weekday}`);
  const older = shortAge(ago(40 * 86400e3), NOW);
  assert.match(older, /\d/, `expected a date with a number, got ${older}`);
  assert.notEqual(older, weekday);
});

test('a clock that jumped backwards never prints a negative age', () => {
  assert.equal(shortAge(NOW + 5 * 3600e3, NOW), 'now');
});
