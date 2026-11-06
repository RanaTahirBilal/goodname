/**
 * Two records the evidence model cannot tell apart.
 *
 * The report must not imply that material adverse uncertainty has been
 * resolved when it has not. That invariant is engineering's. Deciding which
 * unresolved records are *material* is not: it is a product policy about
 * attribution, and inventing a heuristic for it and calling it a bug fix is
 * how a reputation tool becomes an allegation amplifier.
 *
 * So this file does not implement the policy. It establishes, by
 * construction, that the policy is needed — and names the data that would
 * settle it. The two acceptance cases are:
 *
 *   1. The surname-first board record about the customer, identity and
 *      meaning both unresolved, should reach a pending headline.
 *   2. A same-named stranger's disciplinary record should not.
 *
 * Both are official sources. Both carry adverse language. Neither is
 * attributable. Run them through the engine and every field the model holds
 * comes back identical, so no rule over those fields can satisfy both.
 *
 * `docs/OPEN_QUESTIONS.md` OQ-30 holds the decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProfessionalIdentity, SearchResult } from '../contracts/types.ts';
import { buildEvidence } from './evidence.ts';

const DOCTOR: ProfessionalIdentity = {
  fullName: 'Amara Okonkwo',
  profession: 'physician',
  employer: "St Martin's Health",
  city: 'Boston',
  region: 'Massachusetts',
  credentials: ['MD', 'FACC'],
  websiteUrl: 'https://stmartins-health.example',
};

const official = (over: Partial<SearchResult>): SearchResult => ({
  provider: 'test',
  isFixture: true,
  query: 'Amara Okonkwo',
  observedAt: '2026-11-05T00:00:00.000Z',
  sourceType: 'official',
  url: '',
  domain: '',
  sourceName: '',
  title: '',
  snippet: '',
  ...over,
});

/** Hers: a clean certification, misread as a disciplinary finding. */
const HERS = official({
  url: 'https://abim.example/verify/12345',
  domain: 'abim.example',
  sourceName: 'American Board of Internal Medicine',
  position: 2,
  title: 'Okonkwo, Amara — Board certified, Cardiovascular Disease',
  snippet:
    'Certification in Cardiovascular Disease is current. No disciplinary actions are recorded against this certificate.',
});

/** Somebody else's: a real suspension, belonging to a different person. */
const A_STRANGERS = official({
  url: 'https://tmb.example/orders/98765',
  domain: 'tmb.example',
  sourceName: 'Texas Medical Board',
  position: 5,
  title: 'Okonkwo, Amara — Order of suspension',
  snippet:
    'The Board ordered that the licence of Amara Okonkwo be suspended following a disciplinary action.',
});

const build = (r: SearchResult) =>
  buildEvidence({ results: [r], identity: DOCTOR, provenance: 'fixture' })[0]!;

test('both cases are unresolved adverse candidates', () => {
  // The premise. If either stopped being a candidate the acceptance cases
  // would be about something else.
  for (const [name, result] of [
    ['the board record', HERS],
    ["the stranger's suspension", A_STRANGERS],
  ] as const) {
    const r = build(result);
    assert.equal(r.findingStatus, 'requires_review', `${name} is not awaiting review`);
    assert.equal(r.identityStatus, 'uncertain', `${name} is not unresolved`);
    assert.equal(r.reviewStatus, 'needs_human_review', `${name} is not queued`);
  }
});

test('the evidence model holds nothing that separates them', () => {
  /**
   * The finding, asserted rather than described. Every modelled field is
   * equal, so a materiality rule written over this record shape must either
   * promote both — the allegation amplifier, where one stranger's record
   * holds a customer's whole assessment hostage — or neither, which is the
   * reassuring headline the correction was meant to remove.
   */
  const hers = build(HERS);
  const theirs = build(A_STRANGERS);

  const modelled = (r: typeof hers) => ({
    identityStatus: r.identityStatus,
    identityConfidence: r.identityConfidence,
    sourceReliability: r.sourceReliability,
    authority: r.authority,
    classification: r.classification,
    findingStatus: r.findingStatus,
    severity: r.severity,
    reviewStatus: r.reviewStatus,
  });

  assert.deepEqual(
    modelled(hers),
    modelled(theirs),
    'these are now distinguishable — which means the attribution policy in OQ-30 can be written, and should be'
  );
});

test('what differs is not something the engine can judge', () => {
  /**
   * The three fields that are not equal, and why none of them is a rule.
   *
   * The domain differs, but "abim.example is her board and tmb.example is
   * not" is a statement about which registries govern a Massachusetts
   * cardiologist. We do not hold that mapping, and a customer's licensing
   * jurisdiction is not something we currently ask for.
   *
   * The position differs, and rank is a statement about Google, not about
   * whether a record is hers.
   *
   * The name form differs — surname-first against given-first — and that is
   * a fact about how a registry writes names, not about whose name it is.
   * Using it would mean deciding that registries which invert names are more
   * likely to be about the customer, which is nonsense.
   */
  const hers = build(HERS);
  const theirs = build(A_STRANGERS);

  assert.notEqual(hers.domain, theirs.domain);
  assert.notEqual(hers.position, theirs.position);
  assert.notEqual(hers.identitySignals[0], theirs.identitySignals[0]);

  // Neither carries corroboration beyond the name. This is the point: the
  // one signal that *would* be a legitimate basis — region, employer,
  // licence jurisdiction — is absent from both.
  for (const r of [hers, theirs]) {
    assert.equal(
      r.identitySignals.length,
      1,
      'a corroborating signal appeared; the materiality rule may now be writable'
    );
  }
});
