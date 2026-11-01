import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk } from './risk.ts';
import { evidence, OBSERVED } from '../testing/factories.ts';

const assess = (records: ReturnType<typeof evidence>[], brokerRan = false) =>
  assessRisk({ records, allRecords: records, brokerAssessmentRan: brokerRan });

test('the risk assessment has no aggregate score', () => {
  const r = assess([evidence({ classification: 'owned', position: 1 })]);
  assert.ok(!('score' in r), 'a single number is what lets a severe finding disappear');
  assert.equal(r.level, 'none');
});

test('nothing negative means no risk, stated plainly', () => {
  const r = assess([
    evidence({ classification: 'owned', position: 1 }),
    evidence({ classification: 'earned', position: 2 }),
  ]);
  assert.equal(r.level, 'none');
  assert.equal(r.findings.length, 0);
  assert.match(r.levelRationale, /Nothing in the results/i);
});

test('an official confirmed finding at severity 5 is severe', () => {
  const r = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'confirmed_finding',
      severity: 5,
      position: 2,
      reliability: 'official',
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(r.level, 'severe');
  assert.equal(r.findings[0].status, 'confirmed_finding');
  assert.match(r.levelRationale, /established finding/i);
});

test('an allegation is never reported at the same level as a finding', () => {
  const allegation = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 5,
      position: 2,
      publishedAt: OBSERVED,
    }),
  ]);

  const finding = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'confirmed_finding',
      severity: 5,
      position: 2,
      reliability: 'official',
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(finding.level, 'severe');
  assert.equal(allegation.level, 'elevated');
  assert.match(allegation.findings[0].note, /not established/i);
});

test('syndication does not promote an allegation', () => {
  // Three outlets, one wire story: independentSourcesInCluster is 1.
  const r = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 4,
      position: 2,
      reliability: 'high',
      independentSources: 1,
      storyClusterId: 'c1',
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(r.findings[0].status, 'allegation');
  assert.equal(r.findings[0].corroboratingSources, 1);
});

test('two independent sources do promote an allegation', () => {
  const r = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 4,
      position: 2,
      reliability: 'high',
      independentSources: 2,
      storyClusterId: 'c1',
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(r.findings[0].status, 'confirmed_finding');
  assert.match(r.findings[0].severityRationale, /Corroborated by 2/);
  assert.equal(r.level, 'high');
});

test('a contradicted allegation is never promoted', () => {
  const r = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 4,
      position: 2,
      reliability: 'high',
      independentSources: 3,
      contradictedBy: ['ev-x'],
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(r.findings[0].status, 'allegation');
});

test('a low-reliability source cannot corroborate its way to a finding', () => {
  const r = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 5,
      position: 1,
      reliability: 'low',
      independentSources: 5,
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(r.findings[0].status, 'allegation');
});

test('retracted and corrected claims leave the level and go to review', () => {
  const r = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'retracted',
      severity: 5,
      position: 2,
      publishedAt: OBSERVED,
    }),
    evidence({
      classification: 'negative',
      findingStatus: 'corrected',
      severity: 4,
      position: 3,
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(r.level, 'none');
  assert.equal(r.findings.length, 0);
  assert.equal(r.needsReview.length, 2);
  assert.match(r.needsReview[0].note, /withdrew|correction/i);
});

test('criticism is reported separately and never affects the level', () => {
  const r = assess([
    evidence({ classification: 'commentary', findingStatus: 'opinion', position: 1 }),
    evidence({ classification: 'commentary', findingStatus: 'opinion', position: 2 }),
  ]);

  assert.equal(r.level, 'none');
  assert.equal(r.commentary.length, 2);
  assert.equal(r.findings.length, 0);
  assert.match(r.commentary[0].note, /Not counted as reputational harm/i);
});

test('old and buried findings get one level of relief, severe ones do not', () => {
  const recentProminent = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'confirmed_finding',
      severity: 4,
      position: 2,
      reliability: 'official',
      publishedAt: OBSERVED,
    }),
  ]);

  const oldBuried = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'confirmed_finding',
      severity: 4,
      position: 9,
      reliability: 'official',
      publishedAt: '2008-01-01T00:00:00.000Z',
    }),
  ]);

  assert.equal(recentProminent.level, 'high');
  assert.equal(oldBuried.level, 'elevated', 'age and obscurity should soften, not erase');

  const oldSevere = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'confirmed_finding',
      severity: 5,
      position: 9,
      reliability: 'official',
      publishedAt: '2008-01-01T00:00:00.000Z',
    }),
  ]);
  assert.equal(oldSevere.level, 'severe', 'a conviction does not expire');
});

test('duplicates are not counted as separate findings', () => {
  const records = [
    evidence({
      id: 'ev-p',
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 4,
      position: 2,
      publishedAt: OBSERVED,
    }),
    evidence({
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 4,
      position: 6,
      duplicateOf: 'ev-p',
      publishedAt: OBSERVED,
    }),
  ];

  const r = assess(records);
  assert.equal(r.findings.length, 1);
});

test('privacy exposure is assessed separately from findings', () => {
  const r = assess(
    [
      evidence({ classification: 'exposure', position: 8 }),
      evidence({ classification: 'exposure', position: 9 }),
      evidence({ classification: 'exposure', position: 10 }),
    ],
    true
  );

  assert.equal(r.privacy.exposedListings, 3);
  assert.equal(r.privacy.level, 'elevated');
  assert.equal(r.findings.length, 0, 'broker listings are not reputational findings');
  assert.equal(r.privacy.evidenceIds.length, 3);
});

test('an unassessed privacy picture says so rather than claiming zero', () => {
  const r = assess([evidence({ classification: 'owned', position: 1 })], false);
  assert.equal(r.privacy.assessed, false);
  assert.match(r.privacy.note, /No broker assessment has run/i);
});

test('findings are ordered worst first', () => {
  const r = assess([
    evidence({
      classification: 'negative',
      findingStatus: 'allegation',
      severity: 2,
      position: 1,
      publishedAt: OBSERVED,
    }),
    evidence({
      classification: 'negative',
      findingStatus: 'confirmed_finding',
      severity: 5,
      position: 8,
      reliability: 'official',
      publishedAt: OBSERVED,
    }),
  ]);

  assert.equal(r.findings[0].status, 'confirmed_finding');
});
