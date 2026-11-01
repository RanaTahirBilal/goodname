import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prominence,
  recencyDecay,
  ageInDays,
  authorityOf,
  meanOrNull,
  RECENCY_UNKNOWN,
} from './metrics.ts';

const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !== ${b} (±${tol})`);

test('prominence decays with rank and is zero when unranked', () => {
  close(prominence(1), 1.0);
  close(prominence(3), 0.5);
  close(prominence(10), 0.289);

  // Unranked is not "rank zero" — it contributes nothing at all.
  assert.equal(prominence(undefined), 0);
  assert.equal(prominence(0), 0);
});

test('recency decay floors at 0.5 rather than vanishing', () => {
  close(recencyDecay(0), 1.0);
  close(recencyDecay(1095), 0.5 + 0.5 * Math.exp(-1));

  // Twenty years old still weighs half. Old harm is still harm.
  assert.ok(recencyDecay(7300) >= 0.5);
  assert.ok(recencyDecay(7300) < 0.51);
});

test('an undated artifact gets the midpoint, not a guess in either direction', () => {
  assert.equal(recencyDecay(null), RECENCY_UNKNOWN);
  assert.equal(RECENCY_UNKNOWN, 0.75);
});

test('ageInDays returns null for missing or unparseable dates', () => {
  assert.equal(ageInDays(undefined, '2026-10-29T00:00:00.000Z'), null);
  assert.equal(ageInDays('not a date', '2026-10-29T00:00:00.000Z'), null);
  close(ageInDays('2026-10-19T00:00:00.000Z', '2026-10-29T00:00:00.000Z')!, 10);
});

test('publication dates in the future clamp to zero age rather than going negative', () => {
  assert.equal(ageInDays('2027-01-01T00:00:00.000Z', '2026-10-29T00:00:00.000Z'), 0);
});

test('unknown domains get a middling authority, not zero', () => {
  assert.equal(authorityOf('national_press'), 1.0);
  assert.equal(authorityOf('aggregator'), 0.2);
  assert.equal(authorityOf('something we have never seen'), 0.3);
});

test('meanOrNull distinguishes "no data" from "zero"', () => {
  assert.equal(meanOrNull([]), null);
  assert.equal(meanOrNull([0, 0]), 0);
  close(meanOrNull([1, 0.5])!, 0.75);
});
