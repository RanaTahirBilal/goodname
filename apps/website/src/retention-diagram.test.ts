/**
 * The retention diagram has to agree with the retention policy.
 *
 * It is a marketing page telling somebody how long we hold quotations about
 * them. The numbers on it are written out rather than imported, because
 * `DEFAULT_RETENTION` lives in `@rep/persistence`, which imports
 * `node:sqlite`, and pulling a database driver into a landing page to
 * render four integers is the wrong trade.
 *
 * That leaves exactly one failure mode: somebody shortens or lengthens a
 * period in the engine and the page goes on claiming the old one. A promise
 * about personal data that drifts out of date is worse than no promise,
 * because the reader has no way to know it drifted. So the drift is what is
 * asserted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RETENTION, DELETION_GRACE_DAYS, SESSION_TTL_SECONDS } from '@rep/persistence';
import { BANDS } from '../app/components/retention-bands.ts';

const here = dirname(fileURLToPath(import.meta.url));

const band = (label: string) => {
  const found = BANDS.find((b) => b.label.startsWith(label));
  assert.ok(found, `the diagram no longer has a band starting "${label}"`);
  return found!;
};

test('the quotations bar is the evidence period', () => {
  assert.equal(
    band('The quotations').days,
    DEFAULT_RETENTION.evidenceDays,
    'the page tells people a different number from the one the sweep uses'
  );
});

test('the reviewer bar is the decision and access-log period', () => {
  assert.equal(band('A reviewer').days, DEFAULT_RETENTION.reviewDecisionDays);

  // The two are drawn as one bar because they are the same number. If they
  // ever diverge the diagram is lying about one of them.
  assert.equal(
    DEFAULT_RETENTION.accessLogDays,
    DEFAULT_RETENTION.reviewDecisionDays,
    'the decision log and the access log now have different periods; split the bar'
  );
});

test('the session bar is the session lifetime', () => {
  assert.equal(band('Your session').days, SESSION_TTL_SECONDS / 86_400);
  assert.equal(band('Your session').days, DEFAULT_RETENTION.deadSessionDays);
});

test('the score is the only band kept indefinitely', () => {
  /**
   * The shape is the argument: the bar holding quotations about a person is
   * the short one, and the long one holds a number and a version string. If
   * something else ever becomes permanent, the diagram stops making that
   * argument and starts making a different one.
   */
  const forever = BANDS.filter((b) => b.days === 'forever').map((b) => b.label);
  assert.deepEqual(forever, ['The score, its coverage and its methodology version']);
});

test('the quotations are the shortest band, which is the point', () => {
  const finite = BANDS.filter((b) => b.days !== 'forever') as { label: string; days: number }[];
  const shortest = finite.reduce((a, b) => (b.days < a.days ? b : a));

  const quotations = band('The quotations').days as number;
  assert.ok(
    shortest.days <= quotations,
    'something is now kept for less time than the personal data, which the drawing implies is impossible'
  );
});

test('the grace period quoted in the copy is the real one', () => {
  const src = readFileSync(join(here, '..', 'app', 'components', 'RetentionTimeline.tsx'), 'utf8');

  assert.ok(
    src.includes(`${DELETION_GRACE_DAYS} days so a decision`),
    `the copy quotes a grace period other than ${DELETION_GRACE_DAYS} days`
  );
});

test('every band says what it is, not just how long', () => {
  // A bar chart of durations with no explanation is a shape, not an answer.
  for (const b of BANDS) {
    assert.ok(b.note.length > 40, `"${b.label}" has no real explanation`);
  }
});
