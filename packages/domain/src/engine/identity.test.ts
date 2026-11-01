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
