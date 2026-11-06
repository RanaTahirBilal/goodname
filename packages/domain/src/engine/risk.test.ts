import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk, riskHeadline } from './risk.ts';
import type { RiskAssessment } from '../contracts/types.ts';
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

/* ------------------------------------------------- the primary status */

/**
 * Three situations that used to share two words.
 *
 * The risk card showed **None found**, in success green, above a sentence
 * explaining that one result mentioned something adverse and had not been
 * read by a person yet. The qualification was accurate. Nobody reads the
 * qualification: the two most prominent words on the card said the opposite
 * of the paragraph beneath them.
 */
const assessment = (over: Partial<RiskAssessment> = {}): RiskAssessment =>
  ({
    methodologyVersion: 'test',
    level: 'none',
    levelRationale: 'Nothing in the results we searched asserts substantiated harm.',
    findings: [],
    commentary: [],
    privacy: { level: 'none', exposedListings: 0, note: '' },
    needsReview: [],
    awaitingReview: 0,
    unattributedAdverse: 0,
    recordsAssessed: 4,
    containsFixtureData: false,
    assessedAt: '2026-11-05T00:00:00.000Z',
    ...over,
  }) as RiskAssessment;

test('an unread adverse record is not reported as a clean result', () => {
  const h = riskHeadline(assessment({ awaitingReview: 1 }));

  assert.equal(h.label, 'Review pending');
  assert.equal(h.settled, false, 'an unfinished assessment is presented as settled');
  assert.match(h.support, /has not been verified/);
  assert.match(h.support, /none has been ruled out/, 'it reads as a soft clean bill');
});

test('an actual clean result says so, and only then', () => {
  const h = riskHeadline(assessment());

  assert.equal(h.label, 'No confirmed adverse findings');
  assert.equal(h.settled, true);
});

test('nothing to assess is not nothing found', () => {
  // A search that returned nothing attributable and a search that returned
  // a clean record must not produce the same sentence. Rule 14.
  const h = riskHeadline(assessment({ recordsAssessed: 0 }));

  assert.equal(h.label, 'Not assessed');
  assert.equal(h.settled, false);
  assert.match(h.support, /not the same as finding nothing/i);
});

test('an established finding outranks a pending one', () => {
  /**
   * The same mistake upside down. Something unread does not make a
   * disbarment we have confirmed any less confirmed, and burying a severe
   * level under "Review pending" would understate it.
   */
  const h = riskHeadline(
    assessment({ level: 'severe', levelRationale: '1 established finding.', awaitingReview: 2 })
  );

  assert.equal(h.label, 'Severe');
  assert.equal(h.settled, false, 'the outstanding records vanished from the status');
  assert.match(h.support, /2 further results/);
});

test('the three cases never share a label', () => {
  const labels = [
    riskHeadline(assessment()).label,
    riskHeadline(assessment({ awaitingReview: 1 })).label,
    riskHeadline(assessment({ recordsAssessed: 0 })).label,
  ];

  assert.equal(new Set(labels).size, 3, `"${labels.join('", "')}" are not all distinct`);
});

/* ---------------------------------- candidates nobody could attribute */

/**
 * The third door into the reassuring headline.
 *
 * An adverse record we cannot attribute to anybody is dropped before the
 * assessment begins, which is correct — an uncertain match must not
 * contribute to somebody's risk. The defect was what the card said
 * afterwards: "No confirmed adverse findings", with no hint that anything
 * had been set aside.
 *
 * Excluded from scoring and irrelevant to interpreting the score are
 * different things. The count is reported; which of them is *material*
 * enough to change the headline is an attribution policy, not a rule the
 * engine gets to invent. See `materiality.test.ts` and OQ-30.
 */
test('a set-aside adverse record is disclosed, not swallowed', () => {
  const h = riskHeadline(assessment({ unattributedAdverse: 1 }));

  assert.equal(h.label, 'No confirmed adverse findings', 'the headline was promoted by a rule');
  assert.match(h.support, /could not be attributed to you/);
  assert.match(h.support, /may belong to somebody else who shares your name/);
});

test('setting something aside withdraws the claim of completeness', () => {
  // The point ChatGPT made and I had missed: whether the assessment is
  // finished and whether it found anything are separate facts, and only one
  // of them is answered by "no confirmed adverse findings".
  const open = riskHeadline(assessment({ unattributedAdverse: 2 }));
  const done = riskHeadline(assessment());

  assert.equal(open.settled, false, 'an assessment with material set aside claims to be complete');
  assert.equal(done.settled, true);
  assert.equal(open.label, done.label, 'the two are being distinguished by the headline instead');
});

test('an established finding still outranks set-aside material', () => {
  const h = riskHeadline(assessment({ level: 'high', levelRationale: '1 finding.', unattributedAdverse: 1 }));

  assert.equal(h.label, 'High');
  assert.equal(h.settled, false);
  assert.match(h.support, /could not be attributed/);
});

test('nothing set aside says nothing about it', () => {
  // The sentence has to be absent, not empty. A report that mentions
  // unattributed material every time teaches the reader to skip the line.
  assert.doesNotMatch(riskHeadline(assessment()).support, /attributed/);
});
