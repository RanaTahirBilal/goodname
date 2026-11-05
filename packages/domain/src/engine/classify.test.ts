import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SearchResult } from '../contracts/types.ts';
import { classify, assessReliability } from './classify.ts';
import { ADONI, OBSERVED } from '../testing/factories.ts';

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  provider: 'test',
  isFixture: true,
  query: 'Jensen Adoni',
  url: 'https://news.example/story',
  domain: 'news.example',
  title: '',
  snippet: '',
  sourceType: 'press',
  observedAt: OBSERVED,
  ...over,
});

test('reliability is a property of the source, not of the sentiment', () => {
  const praise = result({ title: 'Jensen Adoni honoured', sourceType: 'press' });
  const criticism = result({ title: 'Jensen Adoni criticised', sourceType: 'press' });
  assert.equal(assessReliability(praise), assessReliability(criticism));
});

test('a court domain is official', () => {
  assert.equal(
    assessReliability(result({ url: 'https://ilcourts.example/discipline/x', sourceType: 'official' })),
    'official'
  );
});

test('a people-search site is low reliability and classified as exposure', () => {
  const c = classify(
    result({ url: 'https://www.spokeo.example/Jensen-Adoni', sourceType: 'aggregator' }),
    ADONI
  );
  assert.equal(c.classification, 'exposure');
  assert.equal(c.reliability, 'low');
});

test('the declared website is owned', () => {
  const c = classify(result({ url: 'https://adoni-law.example/bio' }), ADONI);
  assert.equal(c.classification, 'owned');
});

/* ------------------------------------------- the distinction that matters */

test('unhedged harm from a non-official source is an allegation, not a finding', () => {
  const c = classify(
    result({
      title: 'Jensen Adoni disbarred',
      snippet: 'The attorney was disbarred, according to the report.',
      sourceType: 'press',
    }),
    ADONI
  );

  assert.equal(c.classification, 'negative');
  assert.equal(
    c.findingStatus,
    'allegation',
    'one newspaper is not an adjudication, however confidently it is written'
  );
  assert.match(c.rationale, /pending corroboration/i);
});

/**
 * This test used to assert that an official source with unhedged harm
 * language was a `confirmed_finding`, and that assertion was the defect.
 *
 * The first fulfillment rehearsal put this sentence through it:
 *
 *   "Certification in Cardiovascular Disease is current. No disciplinary
 *    actions are recorded against this certificate."
 *
 * An official domain, no hedging, and the term `disciplinary action` present
 * — so every condition this branch tested was satisfied, and a clean board
 * certification came back as a severity-3 established finding about a
 * physician. Detection and confirmation were one step, so a misreading
 * arrived already settled.
 *
 * What the classifier now owes is detection. Confirmation is a person's,
 * in writing, or corroboration's across independent sources.
 */
test('an official source is the strongest detection, and still not a finding', () => {
  const c = classify(
    result({
      url: 'https://ilcourts.example/discipline/adoni',
      title: 'In re Jensen Adoni — disbarred',
      snippet: 'The commission ordered that Jensen Adoni be disbarred.',
      sourceType: 'official',
    }),
    ADONI
  );

  assert.equal(c.classification, 'negative');
  assert.equal(
    c.findingStatus,
    'requires_review',
    'the classifier settled a professional record on its own reading of one sentence'
  );
  assert.equal(c.severity, 5, 'severity is what it would mean if established');
});

test('nothing in the classifier confirms a finding, whatever the input', () => {
  /**
   * The structural guarantee, asserted structurally. A future contributor
   * adding a branch that looks certain enough has to fail this to do it.
   */
  const inputs = [
    { url: 'https://ilcourts.example/d/a', title: 'Adoni disbarred', snippet: 'Disbarred.', sourceType: 'official' as const },
    { url: 'https://statebar.example/x', title: 'Order', snippet: 'Jensen Adoni was sanctioned and censured.', sourceType: 'official' as const },
    { url: 'https://news.example/x', title: 'Convicted', snippet: 'Pleaded guilty.', sourceType: 'press' as const },
    { url: 'https://medicalboard.example/x', title: 'Licence revoked', snippet: 'The licence was revoked.', sourceType: 'official' as const },
  ];

  for (const over of inputs) {
    const c = classify(result(over), ADONI);
    assert.notEqual(
      c.findingStatus,
      'confirmed_finding',
      `"${over.snippet}" was confirmed by the classifier alone`
    );
  }
});

test('the sentence that produced the defect does not become a finding', () => {
  // Verbatim from the rehearsal, on a board's own domain.
  const c = classify(
    result({
      url: 'https://abim.example/verify/okonkwo-amara',
      title: 'Okonkwo, Amara — Board certified, Cardiovascular Disease',
      snippet:
        'Certification in Cardiovascular Disease is current. No disciplinary actions are recorded against this certificate.',
      sourceType: 'official',
    }),
    ADONI
  );

  assert.notEqual(c.findingStatus, 'confirmed_finding');
  assert.equal(c.findingStatus, 'requires_review');
  assert.match(
    c.rationale,
    /may deny it|not a finding/i,
    'the reviewer is given no hint that the sentence may say the opposite'
  );
  assert.ok(
    c.confidence <= 0.4,
    `claimed ${c.confidence} confidence in a reading that is probably backwards`
  );
});

test('a negation hint is a hint, not the safeguard', () => {
  /**
   * The negation window catches the easy half of the problem. The hard half
   * — "the complaint was found to have no case to answer", "cleared after a
   * review" — it will miss, and that is exactly why the protection is that
   * the classifier cannot confirm anything rather than that it can spot a
   * denial.
   *
   * So: a sentence with no negator anywhere near the term still comes back
   * unconfirmed.
   */
  const c = classify(
    result({
      url: 'https://statebar.example/orders/adoni',
      title: 'In the matter of Jensen Adoni',
      snippet: 'The tribunal concluded its review. Jensen Adoni was sanctioned.',
      sourceType: 'official',
    }),
    ADONI
  );

  assert.equal(c.findingStatus, 'requires_review');
});

test('hedged harm is an allegation even from an official domain', () => {
  const c = classify(
    result({
      url: 'https://ilcourts.example/filings/adoni',
      title: 'Complaint filed: attorney accused of fraud charges',
      snippet: 'The complaint alleges fraud charges. No finding has been made.',
      sourceType: 'official',
    }),
    ADONI
  );

  assert.equal(c.findingStatus, 'allegation');
});

test('criticism is commentary, never a harm claim', () => {
  const c = classify(
    result({
      title: 'A controversial ruling, and the lawyer behind it',
      snippet: 'Jensen Adoni drew backlash for the filing.',
    }),
    ADONI
  );

  assert.equal(c.classification, 'commentary');
  assert.equal(c.findingStatus, 'opinion');
  assert.equal(c.severity, undefined);
});

test('a retraction is marked as one and never counted as a finding', () => {
  const c = classify(
    result({
      title: 'Retraction: our report that Jensen Adoni was indicted',
      snippet: 'We retract our earlier report. The filings referred to another person.',
      isRetraction: true,
    }),
    ADONI
  );

  assert.equal(c.findingStatus, 'retracted');
  assert.equal(c.isRetraction, true);
});

test('a correction is distinguished from a retraction', () => {
  const c = classify(
    result({
      title: 'Correction: Jensen Adoni was censured, not disbarred',
      snippet: 'A correction to our earlier story which said he was disbarred.',
      correctsUrl: 'https://news.example/original',
    }),
    ADONI
  );

  assert.equal(c.findingStatus, 'corrected');
  assert.equal(c.isCorrection, true);
});

test('severity reflects the worst term present, not the first', () => {
  const c = classify(
    result({
      url: 'https://ilcourts.example/x',
      sourceType: 'official',
      title: 'Sanctioned and later disbarred',
      snippet: 'Disciplinary action followed; the attorney was disbarred.',
    }),
    ADONI
  );
  assert.equal(c.severity, 5);
});

test('an unclassifiable result is unclassified, not quietly earned', () => {
  const c = classify(
    result({ title: 'Listing 8821', snippet: 'Adoni', sourceType: 'unknown' }),
    ADONI
  );
  assert.equal(c.classification, 'unclassified');
  assert.ok(c.confidence < 0.5, 'and it should say it is unsure');
});

test('ordinary press with no harm or criticism is earned coverage', () => {
  const c = classify(
    result({ title: 'Jensen Adoni on hospital compliance', snippet: 'An interview.' }),
    ADONI
  );
  assert.equal(c.classification, 'earned');
});

test('every outcome carries a rationale a human can audit', () => {
  const cases = [
    result({ title: 'Jensen Adoni on compliance', snippet: 'An interview.' }),
    result({ title: 'Adoni disbarred', snippet: 'Disbarred.', sourceType: 'official', url: 'https://ilcourts.example/a' }),
    result({ title: 'Adoni accused', snippet: 'Alleged fraud charges.' }),
    result({ title: 'Controversial', snippet: 'Backlash followed.' }),
  ];

  for (const r of cases) {
    const c = classify(r, ADONI);
    assert.ok(c.rationale.length > 10, `no rationale for "${r.title}"`);
    assert.ok(c.confidence > 0 && c.confidence <= 1);
  }
});
