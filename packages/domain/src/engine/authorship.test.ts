/**
 * The engine declining to credit itself.
 *
 * A reputation service that also scores reputations can inflate the number
 * it sells against: publish a release for a customer, watch it land on a
 * third-party domain, and every field on the resulting record — source
 * type, reliability, the `earned` classification — reads as independent
 * coverage. Nothing in a search result distinguishes it from the real
 * thing, which is why the distinction has to be declared and then obeyed.
 *
 * These tests are the obedience. They are deliberately written as "the
 * score did not go up", because that is the failure a customer would
 * eventually find and nobody internally would.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePresence } from './score.ts';
import { buildEvidence } from './evidence.ts';
import { evidence, presenceInput } from '../testing/factories.ts';
import type {
  Authorship,
  EvidenceRecord,
  Placement,
  ProfessionalIdentity,
  SearchResult,
} from '../contracts/types.ts';

const OURS: Authorship = {
  createdBy: 'us',
  distribution: 'syndicated',
  editorialIndependence: 'not_verified',
};

const THEIRS: Authorship = {
  createdBy: 'third_party',
  distribution: 'editorial',
  editorialIndependence: 'not_verified',
};

const authorityOf = (records: EvidenceRecord[]) => {
  const presence = scorePresence(presenceInput(records));
  if (presence.status !== 'scored') throw new Error('expected a scored presence');
  return presence.dimensions.find((d) => d.code === 'A');
};

/* ------------------------------------------------------- the core rule */

test('coverage we placed does not raise source authority', () => {
  const independent = [
    evidence({ classification: 'earned', authority: 0.8, authorship: THEIRS }),
    evidence({ classification: 'earned', authority: 0.8, authorship: THEIRS }),
  ];

  const withOurs = [
    ...independent,
    evidence({ classification: 'earned', authority: 0.8, authorship: OURS }),
    evidence({ classification: 'earned', authority: 0.8, authorship: OURS }),
  ];

  const before = authorityOf(independent)?.value;
  const after = authorityOf(withOurs)?.value;

  assert.equal(
    after,
    before,
    'placing two more releases raised the independence score, which is the thing this must never do'
  );
});

test('paid placement does not count, whoever wrote it', () => {
  const paid = [
    evidence({
      classification: 'earned',
      authority: 0.9,
      authorship: {
        createdBy: 'third_party',
        distribution: 'paid',
        editorialIndependence: 'not_verified',
      },
    }),
  ];

  assert.equal(authorityOf(paid)?.value, 0, 'a bought placement scored as earned coverage');
});

test('our words, somebody else’s decision, counts only once that is established', () => {
  const unverified = [
    evidence({
      classification: 'earned',
      authority: 0.9,
      authorship: {
        createdBy: 'us',
        distribution: 'editorial',
        editorialIndependence: 'not_verified',
      },
    }),
  ];

  const verified = [
    evidence({
      classification: 'earned',
      authority: 0.9,
      authorship: {
        createdBy: 'us',
        distribution: 'editorial',
        editorialIndependence: 'verified',
      },
    }),
  ];

  assert.equal(
    authorityOf(unverified)?.value,
    0,
    'a piece we wrote counted as independent before anybody checked that it was'
  );
  assert.ok(
    (authorityOf(verified)?.value ?? 0) > 0,
    'a piece a publication actually chose to run was refused, which under-reports a real outcome'
  );
});

/* ----------------------------------------------------------- the words */

test('the report says we declined to credit ourselves', () => {
  const mixed = [
    evidence({ classification: 'earned', authority: 0.8, authorship: THEIRS }),
    evidence({ classification: 'earned', authority: 0.8, authorship: OURS }),
  ];

  const explanation = authorityOf(mixed)?.explanation ?? '';

  assert.match(
    explanation,
    /placed on your behalf/i,
    'the customer is not told that some results were excluded as ours'
  );
  assert.match(explanation, /1 independent piece/);
});

/* -------------------------------------------------------- the defaults */

test('an audit for somebody we have never worked for is unchanged', () => {
  const records = [
    evidence({ classification: 'earned', authority: 0.7 }),
    evidence({ classification: 'earned', authority: 0.7 }),
  ];

  const dimension = authorityOf(records);

  assert.ok((dimension?.value ?? 0) > 0);
  assert.doesNotMatch(
    dimension?.explanation ?? '',
    /placed on your behalf/i,
    'an ordinary audit mentions placements that do not exist'
  );
});

/* ------------------------------------------------------------ matching */

const result = (url: string, domain: string): SearchResult => ({
  provider: 'fixture',
  isFixture: true,
  query: 'q',
  url,
  domain,
  title: 'A title',
  snippet: 'An excerpt.',
  position: 1,
  sourceType: 'press',
  observedAt: '2026-11-05T00:00:00.000Z',
});

const identity = { fullName: 'Jensen Adoni' } as ProfessionalIdentity;

test('a placement matches by exact URL before it matches by domain', () => {
  // A firm's own site may host one page we wrote and twenty they did. Only
  // the URL can tell those apart, so it has to win.
  const placements: Placement[] = [
    { domain: 'firm.test', createdBy: 'customer', distribution: 'owned' },
    {
      url: 'https://firm.test/news/release',
      createdBy: 'us',
      distribution: 'syndicated',
      campaignId: 'c-1',
    },
  ];

  const records = buildEvidence({
    results: [
      result('https://firm.test/news/release', 'firm.test'),
      result('https://firm.test/team/adoni', 'firm.test'),
    ],
    identity,
    provenance: 'fixture',
    placements,
  });

  const placed = records.find((r) => r.sourceUrl.endsWith('/news/release'));
  const theirs = records.find((r) => r.sourceUrl.endsWith('/team/adoni'));

  assert.equal(placed?.authorship.createdBy, 'us');
  assert.equal(placed?.authorship.campaignId, 'c-1');
  assert.equal(theirs?.authorship.createdBy, 'customer', 'the domain rule did not apply');
});

test('nothing is guessed at when no placement is declared', () => {
  const [record] = buildEvidence({
    results: [result('https://somewhere.test/a', 'somewhere.test')],
    identity,
    provenance: 'fixture',
  });

  assert.equal(record.authorship.createdBy, 'third_party');
  assert.equal(record.authorship.distribution, 'editorial');
  assert.equal(record.authorship.editorialIndependence, 'not_verified');
  assert.equal(record.authorship.campaignId, undefined);
});
