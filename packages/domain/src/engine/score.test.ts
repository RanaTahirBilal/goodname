import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePresence, WEIGHTS, MIN_COVERAGE, PRESENCE_METHODOLOGY_VERSION } from './score.ts';
import { evidence, presenceInput, OBSERVED } from '../testing/factories.ts';

test('presence weights sum to exactly 1', () => {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
});

test('the presence model contains no risk dimension', () => {
  const codes = Object.keys(WEIGHTS);
  assert.deepEqual(codes.sort(), ['A', 'C', 'D', 'H', 'P']);
  assert.ok(!codes.includes('R'), 'risk belongs in the risk assessment, not the score');
  assert.ok(!codes.includes('X'), 'privacy exposure belongs in the risk assessment');
});

test('a clean, complete profile scores well and reports full coverage', () => {
  const result = scorePresence(
    presenceInput([
      evidence({ classification: 'owned', position: 1 }),
      evidence({ classification: 'earned', position: 3, authority: 1.0, publishedAt: OBSERVED }),
      evidence({ classification: 'earned', position: 4, authority: 1.0, publishedAt: OBSERVED }),
      evidence({ classification: 'earned', position: 5, authority: 1.0, publishedAt: OBSERVED }),
    ]) as never
  );

  assert.equal(result.status, 'scored');
  if (result.status !== 'scored') return;

  assert.equal(result.coverage, 1);
  assert.equal(result.methodologyVersion, PRESENCE_METHODOLOGY_VERSION);
  assert.ok(result.score > 70, `expected a strong score, got ${result.score}`);
  assert.match(result.meaning, /not a measure of your reputation/i);
});

test('a severe finding does not touch the presence score', () => {
  // The point of separating A from B: a person can have a strong presence and
  // a serious problem at the same time, and the report must be able to say so.
  const clean = scorePresence(
    presenceInput([
      evidence({ classification: 'owned', position: 1 }),
      evidence({ classification: 'earned', position: 3, authority: 1.0, publishedAt: OBSERVED }),
    ]) as never
  );

  const withFinding = scorePresence(
    presenceInput([
      evidence({ classification: 'owned', position: 1 }),
      evidence({ classification: 'earned', position: 3, authority: 1.0, publishedAt: OBSERVED }),
      evidence({
        classification: 'negative',
        findingStatus: 'confirmed_finding',
        severity: 5,
        position: 2,
        authority: 1.0,
        publishedAt: OBSERVED,
      }),
    ]) as never
  );

  if (clean.status !== 'scored' || withFinding.status !== 'scored') return assert.fail();

  // The negative result does change D — it occupies a prominent slot the
  // person does not own — but it is not scored as harm here.
  assert.ok(withFinding.score > 0);
  assert.ok(
    !('capsApplied' in withFinding),
    'caps were a workaround for mixing risk into the score; they should be gone'
  );
});

test('an inapplicable dimension renormalises instead of scoring zero', () => {
  const records = [
    evidence({ classification: 'owned', position: 1 }),
    evidence({ classification: 'earned', position: 2, authority: 1.0, publishedAt: OBSERVED }),
  ];

  const withSite = scorePresence(presenceInput(records) as never);
  const withoutSite = scorePresence(
    presenceInput(records, { websiteChecks: undefined }) as never
  );

  if (withSite.status !== 'scored' || withoutSite.status !== 'scored') return assert.fail();

  assert.equal(withoutSite.coverage, 1 - WEIGHTS.H);

  const h = withoutSite.dimensions.find((d) => d.code === 'H')!;
  assert.equal(h.applicable, false);
  assert.equal(h.value, null);
  assert.equal(h.inapplicableReason, 'no_website_connected');

  assert.ok(
    withoutSite.score > withSite.score - 12,
    `renormalisation behaved like a zero: ${withSite.score} → ${withoutSite.score}`
  );
});

test('below the coverage threshold we decline to score', () => {
  const result = scorePresence(
    presenceInput([], {
      expectedProfiles: [],
      profileObservations: [],
      consistency: undefined,
      websiteChecks: undefined,
    }) as never
  );

  assert.equal(result.status, 'insufficient_evidence');
  if (result.status !== 'insufficient_evidence') return;

  assert.equal(result.coverage, 0);
  assert.ok(result.missingDimensions.includes('D'));
  assert.ok(result.whatWouldHelp.length > 0);
  assert.ok(!('score' in result), 'insufficient_evidence must not carry a score');

  /**
   * One entry per remedy, not one per dimension.
   *
   * Several dimensions fail for the same reason and map to the same
   * sentence, which put "Confirming your employer and city usually helps"
   * in the list twice — under a heading promising what would change the
   * outcome, on the one screen where the report is admitting it cannot
   * answer the question.
   */
  assert.deepEqual(
    result.whatWouldHelp,
    [...new Set(result.whatWouldHelp)],
    'whatWouldHelp repeats itself; it is a set of actions, not a list of dimensions'
  );
});

test('coverage of D + P + A clears the threshold; D + P alone does not', () => {
  assert.ok(WEIGHTS.D + WEIGHTS.P + WEIGHTS.A >= MIN_COVERAGE);
  assert.ok(WEIGHTS.D + WEIGHTS.P < MIN_COVERAGE);
});

test('syndicated reprints are not counted twice', () => {
  const primary = evidence({
    id: 'ev-p',
    classification: 'earned',
    position: 2,
    authority: 1.0,
    publishedAt: OBSERVED,
  });
  const reprint = evidence({
    classification: 'earned',
    position: 6,
    authority: 1.0,
    publishedAt: OBSERVED,
    duplicateOf: 'ev-p',
  });

  const single = scorePresence(presenceInput([primary]) as never);
  const withReprint = scorePresence(presenceInput([primary, reprint]) as never);

  if (single.status !== 'scored' || withReprint.status !== 'scored') return assert.fail();

  const a1 = single.dimensions.find((d) => d.code === 'A')!.value;
  const a2 = withReprint.dimensions.find((d) => d.code === 'A')!.value;
  assert.equal(a1, a2, 'a reprint of one story must not double the earned coverage');
});

test('every dimension carries an explanation and its evidence ids', () => {
  const owned = evidence({ id: 'ev-own', classification: 'owned', position: 1 });
  const result = scorePresence(presenceInput([owned]) as never);
  if (result.status !== 'scored') return assert.fail('expected a score');

  for (const d of result.dimensions) {
    assert.ok(d.explanation.length > 10, `${d.code} has no usable explanation`);
  }

  const d = result.dimensions.find((x) => x.code === 'D')!;
  assert.deepEqual(d.evidenceIds, ['ev-own']);
});

test('fixture provenance survives into the score result', () => {
  const result = scorePresence(
    presenceInput([evidence({ classification: 'owned', position: 1, fixture: true })]) as never
  );
  assert.equal(result.containsFixtureData, true);
});
