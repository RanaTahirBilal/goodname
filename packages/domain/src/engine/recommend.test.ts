/**
 * What the recommendations must keep straight.
 *
 * Two things are easy to get wrong here and expensive to notice later.
 *
 * The first is sequence. Importance and startability are different
 * questions, and a list sorted only on importance puts the months-long
 * item above the afternoon's work — a report that is right and reads as
 * useless. The ordering tests pin the rule that priority leads and
 * control breaks ties, so neither can quietly swallow the other.
 *
 * The second is invention. `why` is the engine's own sentence about this
 * customer; `how` is general practice, the same for everybody. If `how`
 * ever starts varying with the audit, it has become an interpretation
 * nobody computed, which is the failure `findings.ts` exists to prevent
 * and this file prevents on the other path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from './recommend.ts';
import type {
  ConfidenceReport,
  PresenceScore,
  RiskAssessment,
} from '../contracts/types.ts';

const dimension = (code: string, value: number, weight: number) => ({
  code: code as 'D' | 'P' | 'A' | 'C' | 'H',
  label: `Dimension ${code}`,
  value,
  applicable: true,
  weight,
  explanation: `Explanation for ${code}.`,
  evidenceIds: [`ev-${code}`],
});

const presenceWith = (dimensions: ReturnType<typeof dimension>[]) =>
  ({
    status: 'scored',
    score: 55,
    coverage: 1,
    methodologyVersion: '2.0.0-draft',
    meaning: 'A measure of observable presence.',
    containsFixtureData: true,
    computedAt: '2026-11-05T00:00:00.000Z',
    dimensions,
  }) as PresenceScore;

const quietRisk = () =>
  ({
    level: 'none',
    levelRationale: 'Nothing substantiated.',
    findings: [],
    privacy: { level: 'none', note: 'None.', exposedListings: 0, evidenceIds: [] },
    methodologyVersion: '1.8.0-provisional',
  }) as unknown as RiskAssessment;

const settled = () =>
  ({
    identityConfidence: 0.95,
    band: 'high',
    attributed: 5,
    awaitingConfirmation: 0,
    rejected: 0,
    evidenceCoverage: 1,
    sourceReliabilityMix: { official: 0, high: 1, moderate: 4, low: 0, unknown: 0 },
    needsHumanReview: [],
    note: 'Attributable.',
  }) as ConfidenceReport;

/* ------------------------------------------------------------ sequence */

test('within a band, what the customer can start comes first', () => {
  // Source authority is the weaker dimension and the heavier one, so an
  // importance-only sort would put it first. It is also the one thing on
  // the list that waits on somebody else.
  const presence = presenceWith([
    dimension('A', 0.2, 0.25),
    dimension('P', 0.45, 0.25),
  ]);

  const out = recommend(presence, quietRisk(), settled()).filter((r) =>
    r.id.startsWith('presence-')
  );

  assert.equal(out[0].id, 'presence-P', 'the slowest item was put first');
  assert.equal(out[0].control, 'yours');
  assert.equal(out[1].control, 'not_yours');
});

test('priority still outranks control', () => {
  const risk = {
    ...quietRisk(),
    findings: [
      {
        evidenceId: 'ev-1',
        headline: 'An official determination',
        sourceName: 'A regulator',
        sourceUrl: 'https://example.test',
        status: 'confirmed_finding',
        severity: 0.9,
        severityRationale: 'Official.',
        prominence: 0.9,
        recencyWeight: 1,
        reliability: 'official',
      },
    ],
  } as unknown as RiskAssessment;

  const presence = presenceWith([dimension('P', 0.3, 0.2)]);
  const out = recommend(presence, risk, settled());

  // The established finding is `now` and only `shared`; the profile work is
  // `yours` but `soon`. Urgency wins.
  assert.equal(out[0].priority, 'now');
  assert.equal(out[0].control, 'shared');
});

/* ---------------------------------------------------------- invariants */

test('every recommendation says who decides whether it happens', () => {
  const presence = presenceWith([
    dimension('D', 0.3, 0.2),
    dimension('A', 0.3, 0.2),
    dimension('C', 0.3, 0.2),
  ]);

  for (const r of recommend(presence, quietRisk(), settled())) {
    assert.ok(
      ['yours', 'shared', 'not_yours'].includes(r.control),
      `${r.id} has no control value`
    );
  }
});

test('the tactic does not vary with the audit', () => {
  const low = presenceWith([dimension('A', 0.05, 0.25)]);
  const high = presenceWith([dimension('A', 0.45, 0.25)]);

  const a = recommend(low, quietRisk(), settled()).find((r) => r.id === 'presence-A');
  const b = recommend(high, quietRisk(), settled()).find((r) => r.id === 'presence-A');

  assert.ok(a && b);
  assert.equal(
    a.how,
    b.how,
    'the tactic changed with the score, which makes it an interpretation rather than practice'
  );
  assert.notEqual(
    a.why,
    undefined,
    'the per-customer sentence disappeared when the fixed one was added'
  );
});

test('the one thing nobody controls carries the ceiling, on the recommendation', () => {
  const presence = presenceWith([dimension('A', 0.2, 0.25)]);
  const [coverage] = recommend(presence, quietRisk(), settled()).filter(
    (r) => r.id === 'presence-A'
  );

  assert.equal(coverage.control, 'not_yours');
  assert.match(
    coverage.caveat ?? '',
    /nobody can promise coverage/i,
    'the one recommendation the customer cannot deliver does not say so'
  );
});

test('nothing promises a ranking, a removal or a score', () => {
  const risk = {
    ...quietRisk(),
    privacy: {
      level: 'high',
      note: 'Listings found.',
      exposedListings: 7,
      evidenceIds: ['ev-b'],
    },
    findings: [
      {
        evidenceId: 'ev-1',
        headline: 'Something',
        sourceName: 'Somewhere',
        sourceUrl: 'https://example.test',
        status: 'confirmed_finding',
        severity: 0.8,
        severityRationale: 'Established.',
        prominence: 0.7,
        recencyWeight: 1,
        reliability: 'high',
      },
    ],
  } as unknown as RiskAssessment;

  const presence = presenceWith([
    dimension('D', 0.3, 0.2),
    dimension('A', 0.3, 0.2),
  ]);

  const text = recommend(presence, risk, settled())
    .flatMap((r) => [r.title, r.why, r.how ?? '', r.caveat ?? ''])
    .join(' ')
    .toLowerCase();

  for (const banned of [
    'guarantee',
    'guaranteed',
    'we will remove',
    'first page',
    'top of google',
    'improve your score by',
  ]) {
    assert.ok(!text.includes(banned), `a recommendation promises: "${banned}"`);
  }
});
