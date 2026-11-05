/**
 * Special-category detection and handling.
 *
 * Two things are being tested, and only one of them is the detector.
 *
 * The detector is best-effort and will be replaced by a model classifier
 * (OQ-18). The handling is not best-effort: whatever trips the filter must
 * leave no text behind, must not become a risk finding, and must keep its
 * source link. Those are the tests that matter, and they are written so they
 * still hold when the detector underneath changes completely.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSensitivity,
  WITHHELD_EXCERPT,
  WITHHELD_TITLE,
} from './sensitive.ts';
import { buildEvidence } from './evidence.ts';
import { assessRisk } from './risk.ts';
import type { ProfessionalIdentity, SearchResult } from '../contracts/types.ts';

const identity: ProfessionalIdentity = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  region: 'Illinois',
};

let n = 0;
const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  url: `https://news.example.com/story-${++n}`,
  title: 'Jensen Adoni named partner',
  snippet: 'Adoni Law announced the promotion this week.',
  domain: 'news.example.com',
  sourceName: 'Example News',
  sourceType: 'press',
  observedAt: '2026-11-03T00:00:00Z',
  provider: 'fixture',
  isFixture: true,
  query: 'Jensen Adoni',
  position: 1,
  ...over,
});

const build = (results: SearchResult[]) =>
  buildEvidence({ results, identity, provenance: 'fixture' });

/* ------------------------------------------------------- the detector */

test('a health condition attributed to the person is caught', () => {
  const a = assessSensitivity(
    'Chicago attorney opens up about his cancer treatment',
    'Jensen Adoni was diagnosed with cancer last spring.'
  );

  assert.equal(a.withhold, true);
  assert.deepEqual(a.categories, ['health']);
});

/**
 * The false positive that would wreck the product.
 *
 * Half the customers are physicians. If naming a specialism withheld the
 * result, every oncologist's own practice page would come back blank, and
 * the audit would be useless to exactly the people it is for.
 */
test("a physician's specialism is not their own health data", () => {
  const a = assessSensitivity(
    'Dr Jensen Adoni, cancer specialist',
    'A consultant at the Chicago clinic, Dr Adoni treats patients with diabetes and cancer.'
  );

  assert.equal(a.withhold, false);
  assert.deepEqual(a.categories, []);
  assert.ok(
    a.signals.some((s) => s.includes('professional context')),
    'the considered-and-cleared decision should be recorded, not silent'
  );
});

test("an attorney's caseload is not their own special-category data", () => {
  const a = assessSensitivity(
    'Adoni represents asylum seekers in landmark case',
    'Counsel for the claimants, Jensen Adoni, argued the deportation orders were unlawful.'
  );

  assert.equal(a.withhold, false, 'representing people is not being one of them');
});

test('topic language with no professional framing resolves toward withholding', () => {
  const a = assessSensitivity('Jensen Adoni and the mosque', 'A short piece.');

  assert.equal(a.withhold, true);
  assert.ok(a.signals.some((s) => s.includes('no professional context')));
});

test('ordinary professional coverage trips nothing', () => {
  const a = assessSensitivity(
    'Jensen Adoni named partner at Adoni Law',
    'The firm announced the promotion this week.'
  );

  assert.deepEqual(a.categories, []);
  assert.deepEqual(a.signals, []);
  assert.equal(a.withhold, false);
});

/**
 * The matched word is usually the sensitive fact itself.
 *
 * A signal reading "HIV" would put the datum straight back into the database
 * this module exists to keep it out of — in the field designed to be safe to
 * log and show a reviewer.
 */
test('signals never contain the matched text', () => {
  const a = assessSensitivity(
    'Adoni speaks about his HIV diagnosis',
    'He was diagnosed with HIV in 2019.'
  );

  assert.equal(a.withhold, true);
  for (const signal of a.signals) {
    assert.ok(!/hiv/i.test(signal), `signal leaked the matched term: ${signal}`);
    assert.ok(!/2019/.test(signal), `signal leaked detail from the excerpt: ${signal}`);
  }
});

/* -------------------------------------------------------- the handling */

test('a withheld record keeps no trace of the original text', () => {
  const [record] = build([
    result({
      title: 'Adoni opens up about his depression',
      snippet: 'The attorney said he was diagnosed with depression in 2021.',
    }),
  ]);

  assert.equal(record.title, WITHHELD_TITLE);
  assert.equal(record.excerpt, WITHHELD_EXCERPT);

  // The whole record, not just the two fields we meant to change.
  const serialised = JSON.stringify(record).toLowerCase();
  assert.ok(!serialised.includes('depression'), 'the condition survived somewhere in the record');
  assert.ok(!serialised.includes('2021'), 'detail from the excerpt survived');
});

test('a withheld record keeps its source, so nothing is actually hidden', () => {
  const [record] = build([
    result({
      url: 'https://news.example.com/adoni-health',
      title: 'Adoni opens up about his cancer diagnosis',
      snippet: 'He was diagnosed with cancer last spring.',
      publishedAt: '2026-03-01',
    }),
  ]);

  assert.equal(record.sourceUrl, 'https://news.example.com/adoni-health');
  assert.equal(record.sourceName, 'Example News');
  assert.equal(record.publishedAt, '2026-03-01');
  assert.equal(record.position, 1);
  assert.deepEqual(record.sensitivity?.categories, ['health']);
});

/**
 * The reason redaction runs after clustering rather than before.
 *
 * Every withheld record carries the same two sentences. Redact first and the
 * clusterer reads them as near-identical reprints, collapsing unrelated
 * results into one story — and a story cluster is what promotes an
 * allegation to a finding, so the damage would not stop at the display.
 */
test('two unrelated withheld results are not mistaken for reprints', () => {
  const records = build([
    result({
      url: 'https://a.example.com/one',
      domain: 'a.example.com',
      title: 'Adoni opens up about his cancer diagnosis',
      snippet: 'He was diagnosed with cancer last spring.',
    }),
    result({
      url: 'https://b.example.com/two',
      domain: 'b.example.com',
      title: 'Adoni on practising his faith as a Muslim lawyer',
      snippet: 'He converted to Islam in his twenties.',
    }),
  ]);

  assert.equal(records.length, 2);
  assert.equal(records[0].duplicateOf, undefined);
  assert.equal(records[1].duplicateOf, undefined);
  assert.notDeepEqual(records[0].sensitivity?.categories, records[1].sensitivity?.categories);
});

test('special-category material never becomes a risk finding', () => {
  const records = build([
    result({
      title: 'Adoni opens up about his addiction',
      snippet: 'He was treated for addiction and alcoholism in 2020.',
    }),
  ]);

  const risk = assessRisk({ records, allRecords: records });

  assert.equal(risk.level, 'none');
  assert.equal(risk.findings.length, 0, 'a health disclosure is not a reputation finding');
});

/**
 * The carve-out that keeps this a product.
 *
 * Article 10 material — a disbarment, a conviction — is the single most
 * important thing an audit surfaces. If the privacy filter swallowed it,
 * this would be a tool that politely declines to tell an attorney the one
 * fact ranking for their name.
 */
test('a disciplinary finding is reported, not withheld as sensitive', () => {
  const records = build([
    result({
      url: 'https://www.illinoiscourts.gov/adoni',
      domain: 'illinoiscourts.gov',
      sourceName: 'Illinois Courts',
      sourceType: 'official',
      title: 'In re Jensen Adoni — disbarred',
      snippet: 'The commission ordered that Jensen Adoni be disbarred effective November 2025.',
    }),
  ]);

  assert.equal(records[0].sensitivity?.withhold, false);
  assert.ok(records[0].title.includes('disbarred'), 'the finding was redacted away');

  /**
   * Surfaced, rather than in `findings` specifically.
   *
   * What this test is about is the privacy filter: an official determination
   * must not be suppressed because it brushes a special category. Whether it
   * lands in `findings` or in `needsReview` is the separate question of
   * whether a person has read it yet, and since the classifier stopped
   * confirming findings on its own the answer here is the latter.
   */
  const risk = assessRisk({ records, allRecords: records });
  const surfaced = [...risk.findings, ...risk.needsReview];
  assert.equal(surfaced.length, 1, 'the determination was suppressed by the privacy filter');
  assert.equal(surfaced[0].status, 'requires_review');
  assert.ok(risk.awaitingReview > 0);
});

/**
 * An official record outranks the filter entirely.
 *
 * A disciplinary order that happens to mention a health condition is still a
 * disciplinary order. Withholding it would suppress the most important thing
 * an audit can find, which is not privacy — it is the tool failing.
 */
test('an official record is never withheld, whatever words it contains', () => {
  const records = build([
    result({
      url: 'https://www.illinoiscourts.gov/adoni-order',
      domain: 'illinoiscourts.gov',
      sourceName: 'Illinois Courts',
      sourceType: 'official',
      title: 'In re Jensen Adoni — disbarred',
      snippet:
        'The commission disbarred Jensen Adoni. Mitigation was offered on the basis ' +
        'that he was being treated for addiction at the time.',
    }),
  ]);

  assert.equal(records[0].sensitivity?.withhold, false);
  assert.ok(records[0].title.includes('disbarred'));

  const risk = assessRisk({ records, allRecords: records });
  assert.equal(
    [...risk.findings, ...risk.needsReview].length,
    1,
    'the determination was suppressed by the privacy filter'
  );
});

/**
 * A withheld record must not be queued for a human.
 *
 * Reviewing it would mean opening the source, which is a member of staff
 * reading a customer's health coverage — on a record that feeds into
 * nothing. The queue would manufacture the exposure the withholding exists
 * to prevent.
 */
test('a withheld record is not sent to the review queue', () => {
  const [record] = build([
    result({
      // 'probable' identity, which is normally enough to queue a record.
      title: 'J. Adoni opens up about his depression',
      snippet: 'The Chicago attorney said he was diagnosed with depression.',
    }),
  ]);

  assert.equal(record.sensitivity?.withhold, true);
  assert.equal(record.reviewStatus, 'auto');
});

/**
 * The guarantee stated as a guarantee.
 *
 * Everything above tests one path. This asserts the property across a mixed
 * scan: if any record says it is withheld, its text is gone. A future change
 * that adds a construction path around `redactIfSensitive` fails here.
 */
test('across a mixed scan, every withheld record is textless', () => {
  const records = build([
    result({ title: 'Jensen Adoni named partner' }),
    result({
      title: 'Adoni opens up about his cancer diagnosis',
      snippet: 'Diagnosed with cancer last spring.',
    }),
    result({
      url: 'https://www.illinoiscourts.gov/adoni',
      domain: 'illinoiscourts.gov',
      sourceType: 'official',
      title: 'In re Jensen Adoni — censured',
      snippet: 'The commission censured Jensen Adoni.',
    }),
    result({
      title: 'Adoni campaigned for the Democratic Party',
      snippet: 'He donated to the campaign last year.',
    }),
  ]);

  const withheld = records.filter((r) => r.sensitivity?.withhold);
  assert.ok(withheld.length >= 2, 'expected the health and political records to be withheld');

  for (const record of withheld) {
    assert.equal(record.title, WITHHELD_TITLE);
    assert.equal(record.excerpt, WITHHELD_EXCERPT);
  }

  // And the ones that were not withheld kept their text.
  for (const record of records.filter((r) => !r.sensitivity?.withhold)) {
    assert.notEqual(record.title, WITHHELD_TITLE);
  }
});
