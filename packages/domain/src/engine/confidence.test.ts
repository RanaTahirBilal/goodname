/**
 * The number that says whether the report is about the right person.
 *
 * This is the one metric in the product that can be confidently wrong. A
 * presence score built on thin evidence announces its own coverage; a risk
 * level says what it is based on. Identity confidence is a single word —
 * high, moderate, low — sitting above a page of findings, and if it says
 * high while most of the evidence is somebody else's, nothing anywhere
 * else on the page corrects it.
 *
 * It did say exactly that. The filter was `identityConfidence > 0`, which
 * reads as "results that bear the name" and behaves as "results we did not
 * reject", because a rejection scores zero. The average was taken over the
 * matches and so could not fall. The first test here is that case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityConfidence, buildConfidence, CONFIDENCE_BANDS } from './confidence.ts';
import { evidence } from '../testing/factories.ts';
import type { EvidenceRecord } from '../contracts/types.ts';

/** `confidence` drives identityStatus in the factory; position drives weight. */
const match = (position: number, confidence = 0.95) =>
  evidence({ position, confidence });
const notMe = (position: number) => evidence({ position, confidence: 0 });
const unsure = (position: number) => evidence({ position, confidence: 0.45 });

/* --------------------------------------------------------- the defect */

test('one confident match among five rejections is not a confident report', () => {
  const records = [match(1, 0.98), notMe(2), notMe(3), notMe(4), notMe(5), notMe(9)];

  const c = identityConfidence(records);

  assert.ok(
    c < CONFIDENCE_BANDS.moderate,
    `a single self-claimed result produced ${c.toFixed(2)}, which still reads as moderate or better`
  );
});

test('rejections actually enter the calculation', () => {
  const alone = [match(1, 0.98)];
  const contested = [match(1, 0.98), notMe(2), notMe(3)];

  assert.ok(
    identityConfidence(contested) < identityConfidence(alone),
    'adding results that are explicitly not this person did not lower the figure'
  );
});

test('a report built on nothing attributable is zero, not an average of nothing', () => {
  assert.equal(identityConfidence([notMe(1), notMe(2), unsure(3)]), 0);
  assert.equal(identityConfidence([]), 0);
});

/* ------------------------------------------------------- what it keeps */

test('an uncontested set still reads high', () => {
  const records = [match(1), match(2), match(3), match(4)];

  assert.ok(
    identityConfidence(records) >= CONFIDENCE_BANDS.high,
    'a clean attribution was demoted, which would make the fix worse than the defect'
  );
});

test('one low-prominence unresolved result does not sink a good report', () => {
  // The broker listing at position nine is the common real case: it carries
  // the name, nobody has said either way, and it is the last thing anybody
  // sees. It should be visible in the counts and barely move the figure.
  const records = [match(1), match(2), match(3), match(4), match(5), unsure(9)];

  assert.ok(
    identityConfidence(records) >= CONFIDENCE_BANDS.moderate,
    'a single low-ranked unresolved result dropped the report to low'
  );
});

test('prominence weights how much a result matters, not whether it is you', () => {
  const contestedAtTop = [match(1, 0.95), notMe(2)];
  const contestedAtBottom = [match(1, 0.95), notMe(30)];

  assert.ok(
    identityConfidence(contestedAtTop) < identityConfidence(contestedAtBottom),
    'a wrong-person result at position two counted the same as one at position thirty'
  );
});

test('both halves have to hold', () => {
  // Five tentative matches, nothing against them: the share is perfect and
  // the quality is not, so the answer must not be high.
  const tentative = [
    match(1, 0.62),
    match(2, 0.62),
    match(3, 0.62),
    match(4, 0.62),
  ];

  assert.ok(
    identityConfidence(tentative) < CONFIDENCE_BANDS.high,
    'uniformly weak matches produced a confident report because nothing contradicted them'
  );
});

test('a provider that reports no positions still produces an answer', () => {
  const records = [
    evidence({ confidence: 0.95 }),
    evidence({ confidence: 0.95 }),
    evidence({ confidence: 0 }),
  ].map((r) => ({ ...r, position: undefined }) as EvidenceRecord);

  const c = identityConfidence(records);

  assert.ok(c > 0 && c < 1, `expected a usable figure, got ${c}`);
});

/* ---------------------------------------------------------- the words */

test('a low band caused by other people says so, and does not ask for confirmations', () => {
  const records = [match(1, 0.98), notMe(2), notMe(3), notMe(4), notMe(5)];

  const report = buildConfidence(records, 1);

  assert.equal(report.band, 'low');
  assert.match(report.note, /about somebody else/i);
  assert.doesNotMatch(
    report.note,
    /confirming or rejecting them will change this report/i,
    'the customer was told to confirm results, which cannot fix evidence that is not theirs'
  );
});

test('a low band caused by unresolved results asks for the confirmations', () => {
  const records = [match(1, 0.95), unsure(2), unsure(3), unsure(4), unsure(5)];

  const report = buildConfidence(records, 1);

  assert.equal(report.band, 'low');
  assert.match(report.note, /confirming or rejecting/i);
});

test('nothing attributable and nothing to ask says exactly that', () => {
  const report = buildConfidence([notMe(1), notMe(2)], 1);

  assert.equal(report.identityConfidence, 0);
  assert.match(report.note, /nothing we found is attributable/i);
});

/**
 * The branch I got wrong first time, kept as a test because the arithmetic
 * does not distinguish these two and the customer very much does.
 */
test('nothing attributable but something to ask asks instead of despairing', () => {
  const report = buildConfidence([notMe(1), unsure(2), unsure(3)], 1);

  assert.equal(report.identityConfidence, 0);
  assert.match(report.note, /may not be you/i);
  assert.doesNotMatch(
    report.note,
    /no report to be confident about/i,
    'the report was called empty while a question from the customer would fill it'
  );
});

test('the counts still describe the same records the figure came from', () => {
  const records = [match(1), match(2), notMe(3), unsure(4)];
  const report = buildConfidence(records, 1);

  assert.equal(report.attributed, 2);
  assert.equal(report.rejected, 1);
  // `awaitingConfirmation` deliberately overlaps `attributed`: a probable
  // match is both in the score and worth asking about.
  assert.ok(report.awaitingConfirmation >= 1);
});

/* ------------------------------------------- what answering actually does */

/**
 * The report told the customer that confirming a result would move a
 * figure, next to a figure that in some cases cannot move.
 *
 * A `probable` match is already inside the attribution count. Confirming it
 * raises how sure we are and leaves "3 of 4" at "3 of 4", so the customer
 * answers, watches nothing happen, and has been given a small reason to
 * doubt the arithmetic on the one screen asking them to trust it.
 *
 * Found by the first fulfillment rehearsal (F8) and left alone through two
 * milestones because it is cosmetic. It is not: it is the report making a
 * claim about itself that it does not keep.
 */
test('a probable result is not promised to move the count', () => {
  // Confirmed plus two probables: everything waiting is already counted.
  const records = [
    evidence({ position: 1, confidence: 0.95 }),
    evidence({ position: 2, confidence: 0.7 }),
    evidence({ position: 3, confidence: 0.65 }),
  ];

  const note = buildConfidence(records, 1).note;

  assert.doesNotMatch(note, /moves this figure/, 'it still promises a figure that cannot move');
  assert.match(note, /will not change the count/);
  assert.match(note, /how sure/, 'it does not say what answering is actually worth');
});

test('an uncertain result is promised to move it, because it does', () => {
  // The third is uncertain, so it sits outside the count and answering
  // about it genuinely moves the number.
  const records = [
    evidence({ position: 1, confidence: 0.95 }),
    evidence({ position: 2, confidence: 0.7 }),
    evidence({ position: 3, confidence: 0.4 }),
  ];

  const note = buildConfidence(records, 1).note;

  assert.match(note, /moves this figure/, 'the true version of the claim has gone too');
});

test('the count in the sentence is the count on the screen', () => {
  // Both cases quote `awaiting`, which is what the report prints as "Need
  // confirming". A different number in the sentence directly above that
  // figure reads as an arithmetic error, whichever number is right.
  const records = [
    evidence({ position: 1, confidence: 0.95 }),
    evidence({ position: 2, confidence: 0.7 }),
    evidence({ position: 3, confidence: 0.65 }),
  ];

  const built = buildConfidence(records, 1);
  const note = built.note;

  assert.match(
    note,
    new RegExp(`\\b${built.awaitingConfirmation}\\b`),
    `the sentence does not quote ${built.awaitingConfirmation}, which is the printed figure`
  );
});
