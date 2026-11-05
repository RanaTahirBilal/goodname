import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProfessionalIdentity, SearchResult } from '../contracts/types.ts';
import { matchResult, statusFor, BANDS } from './identity.ts';

const IDENTITY: ProfessionalIdentity = {
  fullName: 'Jensen Adoni',
  profession: 'attorney',
  employer: 'Adoni Law',
  city: 'Chicago',
  credentials: ['JD'],
  websiteUrl: 'https://adoni-law.example',
};

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  provider: 'test',
  isFixture: true,
  query: 'Jensen Adoni',
  url: 'https://news.example/story',
  domain: 'news.example',
  title: '',
  snippet: '',
  sourceType: 'press',
  observedAt: '2026-10-29T00:00:00.000Z',
  ...over,
});

test('status bands follow the thresholds exactly', () => {
  assert.equal(statusFor(BANDS.confirmed), 'confirmed');
  assert.equal(statusFor(BANDS.confirmed - 0.001), 'probable');
  assert.equal(statusFor(BANDS.probable), 'probable');
  assert.equal(statusFor(BANDS.probable - 0.001), 'uncertain');
  assert.equal(statusFor(BANDS.uncertain), 'uncertain');
  assert.equal(statusFor(BANDS.uncertain - 0.001), 'rejected');
  assert.equal(statusFor(0), 'rejected');
});

test("the customer's own declared domain short-circuits to confirmed", () => {
  const m = matchResult(
    result({ url: 'https://adoni-law.example/about', title: 'About', snippet: '' }),
    IDENTITY
  );
  assert.equal(m.status, 'confirmed');
  assert.ok(m.confidence > 0.95);
  assert.match(m.signals[0], /your own website/i);
});

test('a result that never mentions the name is rejected outright', () => {
  const m = matchResult(
    result({
      title: 'Chicago healthcare law update',
      snippet: 'Adoni Law filed a brief in Chicago. JD required.',
    }),
    IDENTITY
  );

  // Employer, city and credential all appear. None of it matters: the person
  // is not named, so there is nothing to attribute.
  assert.equal(m.confidence, 0);
  assert.equal(m.status, 'rejected');
});

test('a surname alone is weak and stays below the counting threshold', () => {
  const m = matchResult(
    result({ title: 'Adoni appointed to the board', snippet: 'Adoni joins the board.' }),
    IDENTITY
  );
  assert.ok(m.confidence < BANDS.uncertain, `got ${m.confidence}`);
  assert.match(m.signals[0], /weak/i);
});

test('full corroboration reaches confirmed', () => {
  const m = matchResult(
    result({
      title: 'Jensen Adoni named partner at Adoni Law',
      snippet: 'Chicago attorney Jensen Adoni, JD, joins the partnership.',
    }),
    IDENTITY
  );
  assert.equal(m.status, 'confirmed');
  assert.ok(m.signals.length >= 4);
});

test('the same name in a different life stays uncertain rather than counting', () => {
  const m = matchResult(
    result({
      url: 'https://adoniphoto.example/',
      title: 'Jensen Adoni Photography — Lisbon',
      snippet: 'Wedding photographer based in Lisbon, Portugal.',
    }),
    IDENTITY
  );

  assert.equal(m.status, 'uncertain');
  assert.ok(m.confidence < BANDS.probable);
});

test('an alias counts, slightly below the full name', () => {
  const withAlias: ProfessionalIdentity = {
    ...IDENTITY,
    websiteUrl: undefined,
    knownAliases: ['J. Adoni-Reyes'],
  };
  const m = matchResult(
    result({ title: 'J. Adoni-Reyes on compliance', snippet: 'Chicago attorney.' }),
    withAlias
  );
  assert.ok(m.confidence > 0);
  assert.match(m.signals[0], /also publish under/i);
});

test('confidence never reaches certainty from corroboration alone', () => {
  const m = matchResult(
    result({
      title: 'Jensen Adoni, Adoni Law, Chicago',
      snippet: 'Jensen Adoni JD attorney Chicago Adoni Law partner.',
    }),
    { ...IDENTITY, websiteUrl: undefined }
  );
  assert.ok(m.confidence <= 0.99, 'only a declared domain should approach certainty');
});

/* ------------------------------------------------- name forms (OQ-29 F3) */

/**
 * Surname-first names.
 *
 * Found by the first fulfillment rehearsal, in the worst possible pairing:
 * the American Board of Internal Medicine record for "Okonkwo, Amara" scored
 * 0.10 and was rejected as somebody else — while the same record was being
 * classified as a disciplinary finding about her. The record that would have
 * cleared her was thrown away, and the misreading of it was kept.
 *
 * Bars, medical boards, courts and faculty directories publish surname-first
 * almost without exception, and those are the sources the presence score
 * weights most heavily.
 */
const DOCTOR: ProfessionalIdentity = {
  fullName: 'Amara Okonkwo',
  profession: 'physician',
  employer: "St Martin's Health",
  city: 'Boston',
  region: 'Massachusetts',
  credentials: ['MD', 'FACC'],
  websiteUrl: 'https://stmartins-health.example',
};

/** A URL carrying the name would match on its own and hide the bug. */
const neutral = (title: string, snippet = 'Certification is current.') =>
  result({ url: 'https://abim.example/verify/12345', domain: 'abim.example', title, snippet });

test('both written orders of a name are worth the same', () => {
  const givenFirst = matchResult(neutral('Amara Okonkwo — Board certified'), DOCTOR);
  const familyFirst = matchResult(neutral('Okonkwo, Amara — Board certified'), DOCTOR);

  assert.equal(
    familyFirst.confidence,
    givenFirst.confidence,
    'a registry writing the name surname first is scored lower than a newspaper writing it the other way'
  );
  assert.equal(familyFirst.status, givenFirst.status);
});

test('surname first is not scored as a bare surname', () => {
  // The exact regression: this used to be 0.10, "only your surname appears".
  const m = matchResult(neutral('Okonkwo, Amara — Board certified'), DOCTOR);

  assert.ok(m.confidence > 0.3, `surname-first scored ${m.confidence}`);
  assert.match(m.signals.join(' '), /surname first/);
});

test('a name alone still does not establish identity', () => {
  /**
   * The correction that must not be undone by the correction above. Fixing a
   * false rejection by lowering the bar would buy it back as a false
   * attribution, which is the more damaging direction: rule 11.
   */
  for (const title of [
    'Amara Okonkwo — Board certified',
    'Okonkwo, Amara — Board certified',
  ]) {
    const m = matchResult(neutral(title, 'No other detail.'), DOCTOR);
    assert.ok(
      m.confidence < BANDS.probable,
      `${title} reached ${m.confidence} on a name and nothing else`
    );
  }
});

test('an initial narrows the field without closing it', () => {
  const full = matchResult(neutral('Amara Okonkwo — Board certified'), DOCTOR);
  const initialled = matchResult(neutral('A. Okonkwo — Board certified'), DOCTOR);
  const surname = matchResult(neutral('Okonkwo — Board certified'), DOCTOR);

  assert.ok(initialled.confidence < full.confidence, 'an initial is treated as a given name');
  assert.ok(initialled.confidence > surname.confidence, 'an initial adds nothing over a surname');
});

test('titles and post-nominals do not become the surname', () => {
  // "Okonkwo, MD, FACC" must not leave a family name of "facc", which would
  // make every comparison afterwards a comparison against the wrong word.
  const m = matchResult(neutral('Dr Amara Okonkwo, MD, FACC — Board certified'), DOCTOR);

  assert.ok(m.confidence >= 0.35, `stacked post-nominals broke the match: ${m.confidence}`);
});

test('a hyphenated longer surname is offered rather than assumed', () => {
  /**
   * "Amara Okonkwo-Hale" is probably a different person, and hyphens are
   * flattened because URL slugs carry names that way. So it matches, at a
   * confidence that asks the customer rather than deciding for them. Written
   * down because it looks like a bug until you know why the flattening is
   * there.
   */
  const m = matchResult(neutral('Amara Okonkwo-Hale joins the board', 'No other detail.'), DOCTOR);

  assert.ok(m.confidence < BANDS.probable, 'a different surname was attributed without asking');
});

test('the board record the rehearsal rejected now reaches the customer', () => {
  // End to end on the real fixture text, with the corroboration a board page
  // actually carries.
  const m = matchResult(
    neutral(
      'Okonkwo, Amara — Board certified, Cardiovascular Disease',
      'Certification in Cardiovascular Disease is current. No disciplinary actions are recorded against this certificate.'
    ),
    DOCTOR
  );

  assert.notEqual(m.status, 'rejected', 'the official record about her is still somebody else');
});
