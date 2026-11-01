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

test('unhedged harm from an official source is a confirmed finding', () => {
  const c = classify(
    result({
      url: 'https://ilcourts.example/discipline/adoni',
      title: 'In re Jensen Adoni — disbarred',
      snippet: 'The commission ordered that Jensen Adoni be disbarred.',
      sourceType: 'official',
    }),
    ADONI
  );

  assert.equal(c.findingStatus, 'confirmed_finding');
  assert.equal(c.severity, 5);
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
