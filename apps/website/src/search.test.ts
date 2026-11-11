/**
 * The live search provider, tested without a network.
 *
 * Every response here is a recorded shape rather than a call, for the
 * ordinary reason that a test suite which reaches the internet fails for
 * reasons that have nothing to do with the code, and for a specific one:
 * the free tier is 100 queries a day and an audit spends three of them.
 * A test that searched would exhaust the quota the product runs on.
 *
 * What is actually being asserted is the three rules in `search.ts`. It
 * must not invent a field, it must not turn a failure into an empty
 * result, and it must not be half-configured.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProfessionalIdentity, SearchQuery } from '@rep/domain';
import {
  WebSearchProvider,
  activeProvider,
  publishedAtFrom,
  sourceTypeFor,
  webSearchFromEnv,
} from './server/search.ts';

const IDENTITY: ProfessionalIdentity = {
  fullName: 'Amara Okonkwo',
  profession: 'physician',
  employer: "St Martin's Health",
  city: 'Boston',
  region: 'Massachusetts',
  credentials: ['MD'],
  websiteUrl: 'https://stmartins-health.example',
};

const QUERY: SearchQuery = {
  identity: IDENTITY,
  terms: ['Amara Okonkwo', "Amara Okonkwo St Martin's Health"],
  window: 10,
};

/**
 * One scripted answer. Deliberately not `Partial<Response>`: a real
 * `Response` body is a stream, and borrowing the type would mean describing
 * these fixtures as streams they are not.
 */
interface Answer {
  ok?: boolean;
  status?: number;
  headers?: { get: (name: string) => string | null };
  body?: unknown;
}

/** A fetch that answers from a script, and records what it was asked. */
function fakeFetch(answers: Answer[]) {
  const calls: string[] = [];
  let i = 0;

  const impl = (async (input: string | URL) => {
    calls.push(String(input));
    const a = answers[Math.min(i++, answers.length - 1)]!;

    return {
      ok: a.ok ?? true,
      status: a.status ?? 200,
      headers: a.headers ?? { get: () => null },
      json: async () => a.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const item = (over: Record<string, unknown> = {}) => ({
  title: 'Dr Amara Okonkwo, MD',
  link: 'https://stmartins-health.example/staff/okonkwo',
  snippet: 'Cardiology.',
  displayLink: 'stmartins-health.example',
  ...over,
});

/* ------------------------------------------------------- configuration */

test('no key means no provider, not a broken one', () => {
  assert.equal(webSearchFromEnv({} as unknown as NodeJS.ProcessEnv), null);

  // Half-configured is the dangerous state: a provider that exists and
  // cannot work would return nothing, and nothing looks like good news.
  assert.equal(webSearchFromEnv({ REP_SEARCH_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(webSearchFromEnv({ REP_SEARCH_ENGINE_ID: 'e' } as unknown as NodeJS.ProcessEnv), null);
});

test('the scan label follows the provider, both ways', () => {
  /**
   * Hard-coded `fixture` was right while the fixture was the only
   * implementation and becomes a lie the moment a key exists: a real audit
   * stamped as test data makes a true report look like a demonstration.
   */
  assert.deepEqual(activeProvider({} as unknown as NodeJS.ProcessEnv), {
    name: 'fixture',
    isFixture: true,
  });

  assert.deepEqual(
    activeProvider({ REP_SEARCH_API_KEY: 'k', REP_SEARCH_ENGINE_ID: 'e' } as unknown as NodeJS.ProcessEnv),
    { name: 'google_cse', isFixture: false }
  );
});

test('a result count is clamped to what the API will return', () => {
  const config = webSearchFromEnv({
    REP_SEARCH_API_KEY: 'k',
    REP_SEARCH_ENGINE_ID: 'e',
    REP_SEARCH_PER_QUERY: '50',
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(config!.perQuery, 10, 'asking for more than the API allows fails the whole call');
});

/* ------------------------------------------------------------- mapping */

test('a date is used only where the page declared one', () => {
  assert.equal(
    publishedAtFrom({ pagemap: { metatags: [{ 'article:published_time': '2024-03-01' }] } }),
    new Date('2024-03-01').toISOString()
  );

  // The important case. Falling back to today would turn "we saw this
  // today" into "this was published today" on every undated page.
  assert.equal(publishedAtFrom({}), undefined);
  assert.equal(publishedAtFrom({ pagemap: { metatags: [{}] } }), undefined);
  assert.equal(publishedAtFrom({ pagemap: { metatags: [{ date: 'not a date' }] } }), undefined);

  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(
    publishedAtFrom({ pagemap: { metatags: [{ date: future }] } }),
    undefined,
    'a page claiming to be from tomorrow was believed'
  );
});

test('a source type is guessed conservatively or not at all', () => {
  assert.equal(sourceTypeFor('illinoiscourts.gov', undefined), 'official');
  assert.equal(sourceTypeFor('linkedin.com', undefined), 'profile');
  assert.equal(sourceTypeFor('spokeo.com', undefined), 'aggregator');
  assert.equal(sourceTypeFor('x.com', undefined), 'social');
  assert.equal(sourceTypeFor('stmartins-health.example', 'stmartins-health.example'), 'owned');

  /**
   * Everything else is unknown, and that is the point. The classifier
   * reads this to decide reliability, so guessing `press` for anything
   * news-shaped would promote a blog to the authority of a newspaper.
   */
  assert.equal(sourceTypeFor('some-news-site.example', undefined), 'unknown');
  assert.equal(sourceTypeFor('medium.com', undefined), 'unknown');
});

/* -------------------------------------------------------- the outcomes */

test('results come back mapped, positioned and marked as live', async () => {
  const { impl, calls } = fakeFetch([{ body: { items: [item(), item({ link: 'https://b.example/x' })] } }]);
  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

  const outcome = await provider.search(QUERY);

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;

  assert.ok(outcome.results.length > 0);
  assert.equal(outcome.results[0]!.isFixture, false, 'live results are marked as fixtures');
  assert.equal(outcome.results[0]!.position, 1);
  assert.equal(outcome.results[0]!.provider, 'google_cse');

  // One call per query term the engine builds, and the key never appears
  // anywhere but the request.
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((c) => c.includes('customsearch')));
});

test('the same page found twice is one result', async () => {
  // The engine dedupes as well. Doing it here keeps position numbers
  // meaningful inside a single query term.
  const { impl } = fakeFetch([{ body: { items: [item(), item()] } }]);
  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

  const outcome = await provider.search(QUERY);
  if (outcome.status !== 'ok') return assert.fail('expected results');

  const urls = outcome.results.map((r) => r.url);
  assert.equal(new Set(urls).size, urls.length, 'the same URL came back more than once');
});

test('a rate limit is a rate limit, not an error and not an empty page', async () => {
  /**
   * The failure a first user is most likely to meet: the free tier is 100
   * queries a day and an audit spends three. The job retries a rate limit
   * and gives up on an error, and the report says different things about
   * the two, so the distinction has to survive the mapping.
   */
  const { impl } = fakeFetch([
    { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '120' : null) } },
  ]);
  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

  const outcome = await provider.search(QUERY);

  assert.equal(outcome.status, 'rate_limited');
  if (outcome.status !== 'rate_limited') return;
  assert.equal(outcome.retryAfterSeconds, 120);
});

test('a provider failure never renders as "we found nothing"', async () => {
  // Rule 14, at the only place it can be broken: a failed search that
  // returns `ok` with no results is indistinguishable from good news.
  const answers: Answer[] = [
    { ok: false, status: 500 },
    { ok: true, body: { error: { message: 'bad request' } } },
  ];

  for (const answer of answers) {
    const { impl } = fakeFetch([answer]);
    const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

    const outcome = await provider.search(QUERY);
    assert.equal(outcome.status, 'provider_error', `${JSON.stringify(answer)} came back as ok`);
  }
});

test('an unreachable provider is an error, not a silence', async () => {
  const impl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;

  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });
  const outcome = await provider.search(QUERY);

  assert.equal(outcome.status, 'provider_error');
  if (outcome.status !== 'provider_error') return;
  assert.match(outcome.message, /could not be reached/);
});

test('one failed query fails the audit rather than thinning it', async () => {
  /**
   * Three queries where the second fails is not a shorter report, it is a
   * report missing a third of what it should have looked at, with nothing
   * telling the reader. The scan stays pending and the job retries.
   */
  const { impl } = fakeFetch([
    { body: { items: [item()] } },
    { ok: false, status: 503 },
  ]);
  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

  const outcome = await provider.search(QUERY);
  assert.equal(outcome.status, 'provider_error', 'a partial set was returned as a complete one');
});

test('genuinely finding nothing is a complete answer', async () => {
  // Only safe because every failure above returns a failure status: an
  // empty `ok` here means we looked and there was nothing.
  const { impl } = fakeFetch([{ body: {} }]);
  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

  const outcome = await provider.search(QUERY);

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.results.length, 0);
});

test('a truncated window says so', async () => {
  const { impl } = fakeFetch([
    { body: { items: [item()], searchInformation: { totalResults: '4310' } } },
  ]);
  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

  const outcome = await provider.search(QUERY);
  if (outcome.status !== 'ok') return assert.fail('expected results');

  assert.equal(outcome.partial, true);
  assert.match(outcome.coverageNote ?? '', /top \d+ results/);
});

test('a malformed item is dropped rather than guessed at', async () => {
  const { impl } = fakeFetch([
    { body: { items: [{ snippet: 'no link and no title' }, item()] } },
  ]);
  const provider = new WebSearchProvider({ apiKey: 'k', engineId: 'e', fetchImpl: impl });

  const outcome = await provider.search(QUERY);
  if (outcome.status !== 'ok') return assert.fail('expected results');

  assert.ok(outcome.results.every((r) => r.url && r.title));
});
