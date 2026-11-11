/**
 * A real search provider, against a free tier.
 *
 * Until now the only implementation of `SearchProvider` was the fixture, so
 * the engine had never done the one thing it exists to do. This is the
 * other implementation: Google's Programmable Search JSON API, which gives
 * 100 queries a day free, needs no card, and takes about five minutes to
 * set up. `docs/SEARCH_PROVIDERS.md` has the paid options for when 100 a
 * day stops being enough; this is for getting the first real audit run.
 *
 * ## Why it lives here and not in `packages/domain`
 *
 * The engine is free of I/O on purpose, which is what makes it
 * exhaustively testable (rule 3). `SearchProvider` is the seam, the fixture
 * is the pure implementation, and anything that opens a socket belongs on
 * this side of it. The worker injects whichever one is configured.
 *
 * ## The three things this file must not do
 *
 * **It must not invent a field.** A search API returns a title, a link and
 * a snippet. It does not reliably return a publication date, a publisher
 * name or what kind of source something is. Where the response carries one
 * it is used; where it does not, the field is left undefined and the engine
 * treats it as unknown. Filling a gap with a plausible guess is how a
 * report ends up asserting that something was published on a date nobody
 * checked.
 *
 * **It must not turn a failure into an empty result.** Rule 14: a failed
 * search that renders as "we found nothing about you" is the worst output
 * this product can produce, because it is indistinguishable from good news.
 * Every failure path returns `provider_error` or `rate_limited`, and the
 * report has branches for both.
 *
 * **It must not leak the key.** Read from the environment, used server
 * side, never serialised into anything that reaches a browser.
 */
import type {
  SearchOutcome,
  SearchProvider,
  SearchQuery,
  SearchResult,
  SourceType,
} from '@rep/domain';

/* ------------------------------------------------------------ the config */

export interface WebSearchConfig {
  apiKey: string;
  /** The Programmable Search Engine id, configured to search the whole web. */
  engineId: string;
  /** Results per query. Google's maximum for one call is 10. */
  perQuery?: number;
  /** Injected so tests never open a socket. */
  fetchImpl?: typeof fetch;
}

/**
 * Reads the configuration, or returns null.
 *
 * Null is a first-class answer and the current one: without a key there is
 * no provider, the worker keeps using the fixture, and every screen goes on
 * saying so. A half-configured provider that returns nothing would be worse
 * than no provider at all.
 */
export function webSearchFromEnv(env: NodeJS.ProcessEnv = process.env): WebSearchConfig | null {
  const apiKey = env.REP_SEARCH_API_KEY?.trim();
  const engineId = env.REP_SEARCH_ENGINE_ID?.trim();

  if (!apiKey || !engineId) return null;

  const perQuery = Number(env.REP_SEARCH_PER_QUERY ?? 10);

  return {
    apiKey,
    engineId,
    perQuery: Number.isFinite(perQuery) ? Math.min(Math.max(perQuery, 1), 10) : 10,
  };
}

/**
 * What the scan should record about where its evidence came from.
 *
 * The scan row is written when the audit is queued, before the job runs,
 * and it used to hard-code `fixture`. Once a key exists that becomes a lie
 * in the other direction: a real audit stamped as test data, which would
 * make a true report look like a demonstration.
 *
 * One definition, read by the route that creates the scan and the worker
 * that fulfils it, so the label and the provider cannot disagree.
 */
export function activeProvider(env: NodeJS.ProcessEnv = process.env): {
  name: string;
  isFixture: boolean;
} {
  return webSearchFromEnv(env)
    ? { name: 'google_cse', isFixture: false }
    : { name: 'fixture', isFixture: true };
}

/* ----------------------------------------------------------- the mapping */

/**
 * Hosts whose results are a determination rather than reporting.
 *
 * Deliberately short and deliberately conservative. Calling something
 * `official` raises how much weight the engine gives it and lets a single
 * source settle a question, so the cost of a wrong guess here is high and
 * the cost of a missed one is that a court record is merely treated as
 * ordinary coverage. The second is the error worth making.
 */
const OFFICIAL = ['.gov', '.courts.', 'statebar', 'medicalboard', 'uscourts'];
const PROFILE = ['linkedin.com', 'avvo.com', 'martindale.com', 'justia.com',
  'healthgrades.com', 'zocdoc.com', 'doximity.com', 'crunchbase.com', 'scholar.google'];
const SOCIAL = ['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com', 'threads.net'];
const AGGREGATOR = ['spokeo', 'whitepages', 'beenverified', 'radaris',
  'peoplefinders', 'intelius', 'truthfinder'];

/**
 * What kind of source this is, from the host alone.
 *
 * `unknown` is the default and is used often. The classifier reads this to
 * decide reliability, so guessing `press` for every news-looking domain
 * would quietly promote a blog to the authority of a newspaper. A list we
 * can defend, and `unknown` for everything else.
 */
export function sourceTypeFor(host: string, declaredSite: string | undefined): SourceType {
  const h = host.toLowerCase();

  if (declaredSite && h === declaredSite.toLowerCase().replace(/^www\./, '')) return 'owned';
  if (OFFICIAL.some((o) => h.includes(o))) return 'official';
  if (AGGREGATOR.some((a) => h.includes(a))) return 'aggregator';
  if (SOCIAL.some((s) => h === s || h.endsWith(`.${s}`))) return 'social';
  if (PROFILE.some((p) => h.includes(p))) return 'profile';

  return 'unknown';
}

/** One item of Google's Custom Search JSON response, as far as we read it. */
interface CseItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
  pagemap?: {
    metatags?: Array<Record<string, string>>;
  };
}

/**
 * A publication date, only where the page actually declared one.
 *
 * Google surfaces whatever Open Graph and article metadata a page carries.
 * When a page says nothing, this returns undefined and the record has no
 * published date, which the report renders as unknown. The alternative,
 * falling back to the date we observed it, would turn "we saw this today"
 * into "this was published today" on every undated page in the set.
 */
export function publishedAtFrom(item: CseItem): string | undefined {
  const tags = item.pagemap?.metatags?.[0];
  if (!tags) return undefined;

  const raw =
    tags['article:published_time'] ??
    tags['og:article:published_time'] ??
    tags['datepublished'] ??
    tags['date'];

  if (!raw) return undefined;

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;

  // A date in the future is a page lying or a parser misreading; either way
  // it is not something to put in front of a customer as a fact.
  if (at > Date.now()) return undefined;

  return new Date(at).toISOString();
}

/* ---------------------------------------------------------- the provider */

export class WebSearchProvider implements SearchProvider {
  readonly name = 'google_cse';
  readonly isFixture = false;

  private readonly config: WebSearchConfig;
  private readonly doFetch: typeof fetch;

  constructor(config: WebSearchConfig) {
    this.config = config;
    this.doFetch = config.fetchImpl ?? fetch;
  }

  async search(query: SearchQuery): Promise<SearchOutcome> {
    /**
     * The terms the engine already built, not a second derivation of them.
     * `buildQueries` is the one statement of what gets searched; a provider
     * computing its own would make the queries shown on the report and the
     * queries actually run two different things.
     */
    const terms = query.terms;
    const observedAt = new Date().toISOString();
    const declaredSite = hostOf(query.identity.websiteUrl ?? '');

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    let partial = false;
    const notes: string[] = [];

    for (const term of terms) {
      const outcome = await this.one(term, observedAt, declaredSite);

      /**
       * A failure on any one query fails the audit.
       *
       * Three queries where the second returned nothing is not a thinner
       * report, it is a report missing a third of what it should have
       * looked at, with no way for the reader to tell. The scan stays
       * `pending` and the job retries, which is rule 16l.
       */
      if (outcome.status !== 'ok') return outcome;

      if (outcome.partial) {
        partial = true;
        if (outcome.coverageNote) notes.push(outcome.coverageNote);
      }

      for (const r of outcome.results) {
        // The same page for two query terms is one piece of evidence. The
        // engine dedupes too; doing it here keeps the position numbers
        // meaningful within a single term.
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        results.push(r);
      }
    }

    return {
      status: 'ok',
      results,
      partial: partial || undefined,
      coverageNote: notes.length > 0 ? notes.join(' ') : undefined,
    };
  }

  /** One query term. Separated so a failure is attributable to a term. */
  private async one(
    term: string,
    observedAt: string,
    declaredSite: string | undefined
  ): Promise<SearchOutcome & { partial?: boolean }> {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.config.apiKey);
    url.searchParams.set('cx', this.config.engineId);
    url.searchParams.set('q', term);
    url.searchParams.set('num', String(this.config.perQuery ?? 10));

    let response: Response;
    try {
      response = await this.doFetch(url, { headers: { accept: 'application/json' } });
    } catch (cause) {
      return {
        status: 'provider_error',
        provider: this.name,
        message: `the search provider could not be reached: ${describe(cause)}`,
      };
    }

    /**
     * The free tier is 100 queries a day and an audit spends three of them,
     * so this is the failure a first user is most likely to meet. It has to
     * be `rate_limited` rather than `provider_error`: the job retries a
     * rate limit later and gives up on an error, and the report says
     * different things about the two.
     */
    if (response.status === 429) {
      return {
        status: 'rate_limited',
        provider: this.name,
        retryAfterSeconds: retryAfter(response) ?? 60 * 60,
      };
    }

    if (!response.ok) {
      return {
        status: 'provider_error',
        provider: this.name,
        message: `the search provider returned ${response.status}`,
      };
    }

    let body: { items?: CseItem[]; searchInformation?: { totalResults?: string }; error?: unknown };
    try {
      body = (await response.json()) as typeof body;
    } catch (cause) {
      return {
        status: 'provider_error',
        provider: this.name,
        message: `the search provider returned something that is not JSON: ${describe(cause)}`,
      };
    }

    if (body.error) {
      return {
        status: 'provider_error',
        provider: this.name,
        message: 'the search provider reported an error for this query',
      };
    }

    /**
     * No items is a real answer, and a different one from a failure.
     *
     * A name nobody has written about returns an empty list, and the report
     * is entitled to say so. That is only safe because every failure above
     * this line returns a failure status: an empty `ok` here means we
     * looked and there was nothing, and nothing else in this file produces
     * one.
     */
    const items = body.items ?? [];

    const results = items.flatMap((item, i) => {
      if (!item.link || !item.title) return [];

      const host = hostOf(item.link);
      if (!host) return [];

      return [
        {
          provider: this.name,
          isFixture: false,
          query: term,
          url: item.link,
          domain: host,
          title: item.title,
          snippet: item.snippet ?? '',
          position: i + 1,
          sourceType: sourceTypeFor(host, declaredSite),
          observedAt,
          publishedAt: publishedAtFrom(item),
          sourceName: item.displayLink ?? host,
        } satisfies SearchResult,
      ];
    });

    /**
     * More results exist than we asked for.
     *
     * Worth declaring rather than hiding: the score is computed over what
     * we looked at, and a customer reading "86% coverage" should be able to
     * find out that the window was ten results and not the whole internet.
     */
    const total = Number(body.searchInformation?.totalResults ?? '0');
    const partial = Number.isFinite(total) && total > results.length;

    return {
      status: 'ok',
      results,
      partial,
      coverageNote: partial
        ? `Searched the top ${results.length} results for "${term}".`
        : undefined,
    };
  }
}

/* ----------------------------------------------------------------- bits */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function retryAfter(response: Response): number | undefined {
  const header = response.headers?.get?.('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** A cause, without assuming it is an Error. */
const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
