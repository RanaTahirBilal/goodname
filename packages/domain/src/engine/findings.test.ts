/**
 * What the briefing is allowed to say.
 *
 * These tests are mostly about what must *not* appear. A findings layer is
 * the easiest place in this product to invent a conclusion: the inputs are
 * all numbers, the output is prose, and nobody downstream can tell whether a
 * sentence was computed or composed. So the assertions are that a finding
 * never exists without the input that justifies it, that its detail is text
 * the engine produced, and that a quiet audit stays quiet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings, splitFindings, DIMENSION_ATTENTION } from './findings.ts';
import type {
  ConfidenceReport,
  PresenceScore,
  RiskAssessment,
} from '../contracts/types.ts';
import type { Recommendation } from './recommend.ts';

const dimension = (code: string, value: number | null, explanation: string) => ({
  code: code as 'D' | 'P' | 'A' | 'C' | 'H',
  label: `Dimension ${code}`,
  value,
  applicable: value !== null,
  weight: 0.2,
  explanation,
  evidenceIds: value === null ? [] : [`ev-${code}`],
});

const scored = (overrides: Partial<Extract<PresenceScore, { status: 'scored' }>> = {}) =>
  ({
    status: 'scored',
    score: 65,
    coverage: 1,
    methodologyVersion: '2.0.0-draft',
    meaning: 'A measure of observable presence.',
    containsFixtureData: true,
    computedAt: '2026-11-04T00:00:00.000Z',
    dimensions: [
      dimension('D', 0.73, 'Most prominent results are pages you own.'),
      dimension('P', 0.6, 'Three of five profiles found.'),
    ],
    ...overrides,
  }) as PresenceScore;

const quietRisk = (): RiskAssessment =>
  ({
    level: 'none',
    levelRationale: 'Nothing substantiated.',
    findings: [],
    privacy: { level: 'none', note: 'No broker listings.', exposedListings: 0, evidenceIds: [] },
    methodologyVersion: '1.8.0-provisional',
  }) as unknown as RiskAssessment;

const settledConfidence = (): ConfidenceReport =>
  ({
    identityConfidence: 0.95,
    band: 'high',
    attributed: 5,
    awaitingConfirmation: 0,
    rejected: 0,
    evidenceCoverage: 1,
    sourceReliabilityMix: { official: 0, high: 1, moderate: 4, low: 0, unknown: 0 },
    needsHumanReview: [],
    note: 'The results are confidently attributable to you.',
  }) as ConfidenceReport;

/* -------------------------------------------------------------- nothing */

test('a clean audit produces no findings rather than filler', () => {
  const findings = buildFindings(scored(), quietRisk(), settledConfidence(), []);

  assert.deepEqual(findings, [], 'a quiet audit invented something to say');
});

test('a quiet audit still splits into empty halves rather than throwing', () => {
  const { narrative, remaining } = splitFindings([]);

  assert.deepEqual(narrative, []);
  assert.deepEqual(remaining, []);
});

/* ------------------------------------------------------------- identity */

test('unresolved identity produces a finding, and carries the engine note', () => {
  const confidence = {
    ...settledConfidence(),
    band: 'low' as const,
    awaitingConfirmation: 2,
    note: 'Several prominent results carrying your name may not be you.',
  };

  const [finding] = buildFindings(scored(), quietRisk(), confidence, []);

  assert.equal(finding.kind, 'identity_unresolved');
  assert.equal(finding.severity, 'priority');
  assert.match(finding.headline, /2 results carry your name/);
  assert.equal(
    finding.detail,
    confidence.note,
    'the detail was rewritten rather than carried from the engine'
  );
});

test('a settled identity produces no identity finding', () => {
  const findings = buildFindings(scored(), quietRisk(), settledConfidence(), []);

  assert.equal(findings.filter((f) => f.kind === 'identity_unresolved').length, 0);
});

/* ------------------------------------------------------------ dimension */

test('a dimension below the threshold is named, one above it is not', () => {
  const presence = scored({
    dimensions: [
      dimension('A', DIMENSION_ATTENTION - 0.05, 'One independent source found.'),
      dimension('D', DIMENSION_ATTENTION + 0.05, 'Most results are yours.'),
    ],
  } as never);

  const findings = buildFindings(presence, quietRisk(), settledConfidence(), []);
  const weak = findings.filter((f) => f.kind === 'dimension_weak');

  assert.equal(weak.length, 1, 'both dimensions, or neither, produced a finding');
  assert.equal(weak[0].id, 'dimension-A');
  assert.equal(
    weak[0].detail,
    'One independent source found.',
    'the dimension explanation was not carried verbatim'
  );
});

test('an inapplicable dimension never becomes a weakness', () => {
  const presence = scored({
    dimensions: [dimension('C', null, 'Not enough profiles to compare.')],
  } as never);

  const findings = buildFindings(presence, quietRisk(), settledConfidence(), []);

  assert.equal(
    findings.filter((f) => f.kind === 'dimension_weak').length,
    0,
    'missing data was reported as a low score, which is rule 6'
  );
});

/* ----------------------------------------------------------------- risk */

test('an abstention is not reported as a finding', () => {
  const risk = {
    ...quietRisk(),
    findings: [
      {
        evidenceId: 'ev-1',
        headline: 'A hedged story',
        sourceName: 'Somewhere',
        sourceUrl: 'https://example.test',
        status: 'uncertain',
        severity: 0.4,
        severityRationale: 'The classifier was not sure.',
        prominence: 0.5,
        recencyWeight: 1,
        reliability: 'moderate',
      },
    ],
  } as unknown as RiskAssessment;

  const findings = buildFindings(scored(), risk, settledConfidence(), []);

  assert.equal(
    findings.length,
    0,
    'an uncertain classification was told to the customer as a finding'
  );
});

test('an allegation and an established finding are separate kinds', () => {
  const risk = {
    ...quietRisk(),
    findings: [
      {
        evidenceId: 'ev-a',
        headline: 'Alleged something',
        sourceName: 'A paper',
        sourceUrl: 'https://example.test/a',
        status: 'allegation',
        severity: 0.5,
        severityRationale: 'Reported, not established.',
        prominence: 0.5,
        recencyWeight: 1,
        reliability: 'moderate',
      },
      {
        evidenceId: 'ev-b',
        headline: 'Disbarred',
        sourceName: 'Illinois Courts',
        sourceUrl: 'https://example.test/b',
        status: 'confirmed_finding',
        severity: 0.9,
        severityRationale: 'An official determination.',
        prominence: 0.9,
        recencyWeight: 1,
        reliability: 'official',
      },
    ],
  } as unknown as RiskAssessment;

  const findings = buildFindings(scored(), risk, settledConfidence(), []);
  const kinds = findings.map((f) => f.kind);

  assert.ok(kinds.includes('unsettled_allegation'));
  assert.ok(kinds.includes('established_finding'));

  // The established one outranks the allegation, whatever order risk gave them.
  assert.ok(
    kinds.indexOf('established_finding') < kinds.indexOf('unsettled_allegation'),
    'an allegation was placed above an established finding'
  );
});

/* -------------------------------------------------------------- linkage */

test('a finding links the recommendation that shares its evidence', () => {
  const recommendations: Recommendation[] = [
    {
      id: 'earn-coverage',
      priority: 'soon',
      title: 'Earn independent coverage',
      why: 'Two independent pieces of earned coverage.',
      evidenceIds: ['ev-A'],
    },
    {
      id: 'unrelated',
      priority: 'later',
      title: 'Something else',
      why: 'Unconnected.',
      evidenceIds: ['ev-zzz'],
    },
  ];

  const presence = scored({
    dimensions: [dimension('A', 0.2, 'One independent source found.')],
  } as never);

  const [finding] = buildFindings(presence, quietRisk(), settledConfidence(), recommendations);

  assert.deepEqual(
    finding.recommendationIds,
    ['earn-coverage'],
    'a finding was linked to a recommendation that shares no evidence with it'
  );
});

/* ---------------------------------------------------------------- shape */

test('every finding carries a meaning, and meanings do not vary by customer', () => {
  const confidence = { ...settledConfidence(), awaitingConfirmation: 1 };

  const a = buildFindings(scored(), quietRisk(), confidence, []);
  const b = buildFindings(
    scored({ score: 12 } as never),
    quietRisk(),
    { ...confidence, awaitingConfirmation: 1 },
    []
  );

  for (const f of [...a, ...b]) {
    assert.ok(f.meaning.length > 0, `${f.id} has no meaning`);
  }

  const meaningFor = (list: typeof a, kind: string) =>
    list.find((f) => f.kind === kind)?.meaning;

  assert.equal(
    meaningFor(a, 'identity_unresolved'),
    meaningFor(b, 'identity_unresolved'),
    'the meaning changed with the customer, which makes it an interpretation'
  );
});

test('insufficient evidence reports coverage and never a weak dimension', () => {
  const presence = {
    status: 'insufficient_evidence',
    methodologyVersion: '2.0.0-draft',
    coverage: 0.38,
    missingDimensions: ['A', 'C'],
    whatWouldHelp: ['Confirm your employer and city.'],
    containsFixtureData: true,
    computedAt: '2026-11-04T00:00:00.000Z',
  } as PresenceScore;

  const findings = buildFindings(presence, quietRisk(), settledConfidence(), []);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'coverage_limited');
  assert.match(findings[0].detail, /38%/);
});

test('the briefing shows at most three at length, and lists the rest', () => {
  const risk = {
    ...quietRisk(),
    findings: Array.from({ length: 6 }, (_, i) => ({
      evidenceId: `ev-${i}`,
      headline: `Finding ${i}`,
      sourceName: 'Somewhere',
      sourceUrl: 'https://example.test',
      status: 'allegation',
      severity: 0.5,
      severityRationale: 'Reported, not established.',
      prominence: 0.5,
      recencyWeight: 1,
      reliability: 'moderate',
    })),
  } as unknown as RiskAssessment;

  const all = buildFindings(scored(), risk, settledConfidence(), []);
  const { narrative, remaining } = splitFindings(all);

  assert.equal(narrative.length, 3);
  assert.equal(remaining.length, all.length - 3);
  assert.ok(remaining.length > 0, 'the split did not actually split anything');
});
