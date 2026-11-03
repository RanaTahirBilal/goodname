/**
 * The fixture search provider.
 *
 * No search provider credentials exist yet, so this stands in. Every row it
 * returns carries `isFixture: true`, and that flag rides through evidence,
 * scoring and risk into the report payload.
 *
 * The flag lives in the data rather than only in the interface on purpose. A
 * banner on a screen is lost the moment someone screenshots a report or
 * exports a PDF; a field on the record survives.
 *
 * The scenarios are chosen to be adversarial: each one is a way the pipeline
 * could plausibly say something false about a real person.
 */
import type {
  SearchOutcome,
  SearchProvider,
  SearchQuery,
  SearchResult,
} from '../contracts/types.ts';

/**
 * Every scenario, in one list, with the type derived from it.
 *
 * It used to be the other way round — a union here, and a hand-kept copy of
 * the same names in the website's audit route. Adding `sensitive` to the
 * union did nothing: the route did not recognise the name, fell back to
 * `strong` without complaining, and served a confident report of the wrong
 * scenario. A silent fallback hid it, so the engine and the app disagreed
 * and neither said so.
 *
 * Deriving the type from the array makes the array the only place a
 * scenario is named, and `scenarios.test.ts` holds the app to it.
 */
export const FIXTURE_SCENARIOS = [
  'strong',
  'official_finding',
  'allegation',
  'syndicated',
  'corroborated',
  'retracted',
  'employer_collision',
  'ambiguous',
  'sensitive',
  'sparse',
  'empty',
  'provider_error',
  'rate_limited',
] as const;

export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

/** Fixed so tests are deterministic rather than drifting with the clock. */
export const FIXTURE_OBSERVED_AT = '2026-10-29T00:00:00.000Z';

type Row = Omit<SearchResult, 'provider' | 'isFixture' | 'query' | 'observedAt' | 'domain'>;

const OWN_SITE: Row = {
  url: 'https://adoni-law.example/about',
  sourceName: 'Adoni Law',
  title: 'Jensen Adoni — Partner | Adoni Law',
  snippet:
    'Jensen Adoni is a partner at Adoni Law in Chicago, practising healthcare regulatory law. JD, Northwestern.',
  position: 1,
  sourceType: 'owned',
  publishedAt: '2025-03-01T00:00:00.000Z',
};

const LINKEDIN: Row = {
  url: 'https://www.linkedin.com/in/jensenadoni',
  sourceName: 'LinkedIn',
  title: 'Jensen Adoni - Partner - Adoni Law | LinkedIn',
  snippet: 'Chicago, Illinois. Healthcare regulatory attorney. JD Northwestern.',
  position: 3,
  sourceType: 'profile',
  publishedAt: '2026-01-10T00:00:00.000Z',
};

const PRESS_POSITIVE: Row = {
  url: 'https://crainschicago.example/40-under-40-2024',
  sourceName: "Crain's Chicago",
  title: "Crain's 40 Under 40: Jensen Adoni",
  snippet:
    'Adoni, a partner at Adoni Law in Chicago, led the firm’s healthcare compliance practice.',
  position: 4,
  sourceType: 'press',
  publishedAt: '2024-06-14T00:00:00.000Z',
};

const BROKER: Row = {
  url: 'https://www.spokeo.example/Jensen-Adoni',
  sourceName: 'Spokeo',
  title: 'Jensen Adoni — Address, Phone, Relatives',
  snippet:
    'Jensen Adoni, Chicago IL. Age, current address, phone number and relatives.',
  position: 9,
  sourceType: 'aggregator',
};

const SCENARIOS: Record<
  Exclude<FixtureScenario, 'empty' | 'provider_error' | 'rate_limited'>,
  Row[]
> = {
  strong: [
    OWN_SITE,
    LINKEDIN,
    PRESS_POSITIVE,
    {
      url: 'https://healthlawreview.example/interview-adoni',
      sourceName: 'Health Law Review',
      title: 'Interview: Jensen Adoni on hospital compliance',
      snippet: 'We spoke with Chicago attorney Jensen Adoni about regulatory risk.',
      position: 5,
      sourceType: 'press',
      publishedAt: '2026-02-02T00:00:00.000Z',
    },
    {
      url: 'https://www.avvo.example/attorneys/jensen-adoni',
      sourceName: 'Avvo',
      title: 'Jensen Adoni - Chicago, IL Attorney profile and reviews',
      snippet: 'Jensen Adoni, Chicago IL. Healthcare law. Licensed in Illinois since 2012.',
      position: 7,
      sourceType: 'profile',
      publishedAt: '2023-09-01T00:00:00.000Z',
    },
    BROKER,
  ],

  /** An official determination: the one case a single source settles it. */
  official_finding: [
    OWN_SITE,
    {
      url: 'https://ilcourts.example/discipline/adoni-2025',
      sourceName: 'Illinois Courts',
      title: 'In re Jensen Adoni — disbarred',
      snippet:
        'The Illinois disciplinary commission ordered that Jensen Adoni, Chicago, be disbarred effective November 2025.',
      position: 2,
      sourceType: 'official',
      publishedAt: '2025-11-01T00:00:00.000Z',
    },
    LINKEDIN,
    PRESS_POSITIVE,
  ],

  /** Hedged language. Must never be reported as an established finding. */
  allegation: [
    OWN_SITE,
    {
      url: 'https://chicagoledger.example/adoni-probe',
      sourceName: 'Chicago Ledger',
      title: 'Chicago attorney accused of fraud charges in billing probe',
      snippet:
        'Jensen Adoni, a Chicago attorney, has been accused of fraud charges. The allegations are disputed and no finding has been made.',
      position: 2,
      sourceType: 'press',
      publishedAt: '2026-08-01T00:00:00.000Z',
    },
    LINKEDIN,
  ],

  /**
   * One wire story in three outlets. Three domains, but one account — this
   * must not count as corroboration.
   */
  syndicated: [
    OWN_SITE,
    {
      url: 'https://wireservice.example/adoni-suspended',
      sourceName: 'Wire Service',
      title: 'Attorney Jensen Adoni suspended from practice',
      snippet:
        'The Illinois commission suspended Jensen Adoni from practice for two years following a hearing in Chicago.',
      position: 2,
      sourceType: 'press',
      publishedAt: '2026-03-01T00:00:00.000Z',
    },
    {
      url: 'https://regionalnews.example/adoni-suspended',
      sourceName: 'Regional News',
      title: 'Attorney Jensen Adoni suspended from practice',
      snippet:
        'The Illinois commission suspended Jensen Adoni from practice for two years following a hearing in Chicago.',
      position: 5,
      sourceType: 'press',
      publishedAt: '2026-03-01T00:00:00.000Z',
    },
    {
      url: 'https://localpaper.example/adoni-suspended',
      sourceName: 'Local Paper',
      title: 'Attorney Jensen Adoni suspended from practice',
      snippet:
        'The Illinois commission suspended Jensen Adoni from practice for two years following a hearing in Chicago.',
      position: 6,
      sourceType: 'press',
      publishedAt: '2026-03-01T00:00:00.000Z',
    },
  ],

  /** Two outlets, independently written. This is real corroboration. */
  corroborated: [
    OWN_SITE,
    {
      url: 'https://chicagoledger.example/adoni-suspension',
      sourceName: 'Chicago Ledger',
      title: 'Illinois commission suspends attorney Jensen Adoni from practice',
      snippet:
        'The Illinois disciplinary commission suspended Jensen Adoni from practice for two years following a hearing in Chicago.',
      position: 2,
      sourceType: 'press',
      publishedAt: '2026-03-01T00:00:00.000Z',
    },
    {
      url: 'https://legaltrade.example/adoni-two-years',
      sourceName: 'Legal Trade Weekly',
      title: 'Chicago lawyer suspended from practice after commission hearing',
      snippet:
        'Jensen Adoni was suspended from practice for two years, the Illinois commission said after its hearing.',
      position: 4,
      sourceType: 'press',
      publishedAt: '2026-03-03T00:00:00.000Z',
    },
  ],

  /** The source withdrew it. A retracted claim is not a finding. */
  retracted: [
    OWN_SITE,
    {
      url: 'https://chicagoledger.example/adoni-indicted',
      sourceName: 'Chicago Ledger',
      title: 'Jensen Adoni indicted in billing investigation',
      snippet: 'Chicago attorney Jensen Adoni was indicted on Tuesday, according to filings.',
      position: 2,
      sourceType: 'press',
      publishedAt: '2026-05-01T00:00:00.000Z',
    },
    {
      url: 'https://chicagoledger.example/adoni-retraction',
      sourceName: 'Chicago Ledger',
      title: 'Retraction: our report that Jensen Adoni was indicted',
      snippet:
        'We retract our earlier report that Chicago attorney Jensen Adoni was indicted. The filings referred to another person.',
      position: 3,
      sourceType: 'press',
      publishedAt: '2026-05-08T00:00:00.000Z',
      correctsUrl: 'https://chicagoledger.example/adoni-indicted',
      isRetraction: true,
    },
  ],

  /** Firm-wide coverage that never names the person. */
  employer_collision: [
    OWN_SITE,
    {
      url: 'https://chicagobusiness.example/adoni-law-expands',
      sourceName: 'Chicago Business',
      title: 'Adoni Law expands its Chicago office',
      snippet:
        'Adoni Law has opened a second Chicago office, adding twelve staff to its healthcare team.',
      position: 2,
      sourceType: 'press',
      publishedAt: '2026-04-01T00:00:00.000Z',
    },
    {
      url: 'https://legalwire.example/adoni-law-sanctioned',
      sourceName: 'Legal Wire',
      title: 'Adoni Law sanctioned over discovery failures',
      snippet:
        'A judge sanctioned Adoni Law in Chicago over repeated discovery failures in a healthcare matter.',
      position: 3,
      sourceType: 'press',
      publishedAt: '2026-06-01T00:00:00.000Z',
    },
  ],

  /** A different Jensen Adoni dominates the results. */
  ambiguous: [
    {
      url: 'https://adoniphoto.example/',
      sourceName: 'Adoni Photography',
      title: 'Jensen Adoni Photography — Lisbon',
      snippet: 'Wedding photographer Jensen Adoni, based in Lisbon, Portugal.',
      position: 1,
      sourceType: 'unknown',
      publishedAt: '2024-04-01T00:00:00.000Z',
    },
    {
      url: 'https://weddingblog.example/lisbon-photographers',
      sourceName: 'Wedding Blog',
      title: 'Ten Lisbon wedding photographers worth booking',
      snippet: 'Jensen Adoni shoots in a documentary style across Portugal.',
      position: 2,
      sourceType: 'press',
      publishedAt: '2025-05-20T00:00:00.000Z',
    },
    BROKER,
  ],

  /**
   * A name search that wanders out of professional life.
   *
   * Three of these must be withheld and two must not, and the two that must
   * not are the point: a cancer specialist's practice page and an
   * immigration attorney's casework both read as special-category material
   * to anything matching on topic words alone. A filter that swallowed them
   * would quietly empty the report of exactly the professionals this product
   * is for.
   */
  sensitive: [
    {
      url: 'https://adoni-law.example/team/jensen-adoni',
      sourceName: 'Adoni Law',
      title: 'Jensen Adoni — Partner, Immigration',
      snippet:
        'Jensen Adoni is counsel for claimants in asylum and deportation matters, ' +
        'and represents families through the residency application process.',
      position: 1,
      sourceType: 'owned',
    },
    {
      url: 'https://chicagoherald.example/adoni-recovery',
      sourceName: 'Chicago Herald',
      title: 'Chicago attorney opens up about his cancer diagnosis',
      snippet:
        'Jensen Adoni was diagnosed with cancer last spring and spoke about his ' +
        'treatment at a fundraiser this week.',
      position: 2,
      sourceType: 'press',
      publishedAt: '2026-04-11',
    },
    {
      url: 'https://communitynews.example/adoni-faith',
      sourceName: 'Community News',
      title: 'Adoni on practising his faith',
      snippet: 'The attorney, who converted to Islam in his twenties, helps run the mosque.',
      position: 4,
      sourceType: 'press',
      publishedAt: '2025-11-02',
    },
    {
      url: 'https://statepolitics.example/donors-2025',
      sourceName: 'State Politics',
      title: 'Who funded the 2025 races',
      snippet: 'Jensen Adoni donated to the Democratic Party campaign last year.',
      position: 6,
      sourceType: 'press',
      publishedAt: '2025-12-20',
    },
    {
      url: 'https://chicagohealth.example/oncology-team',
      sourceName: 'Chicago Health',
      title: 'Dr Priya Adoni, cancer specialist',
      snippet:
        'A consultant at the clinic, Dr Adoni treats patients with diabetes and cancer ' +
        'and leads research into early detection.',
      position: 9,
      sourceType: 'press',
    },
  ],

  sparse: [
    {
      url: 'https://directory.example/listing/8821',
      sourceName: 'Directory',
      title: 'Business directory listing',
      snippet: 'Adoni — Chicago.',
      position: 8,
      sourceType: 'unknown',
    },
  ],
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export class FixtureSearchProvider implements SearchProvider {
  readonly name = 'fixture';
  readonly isFixture = true;

  // An explicit field rather than a constructor parameter property: Node runs
  // these files by stripping types, and a parameter property would need real
  // code generation.
  private readonly scenario: FixtureScenario;

  constructor(scenario: FixtureScenario = 'strong') {
    this.scenario = scenario;
  }

  async search(query: SearchQuery): Promise<SearchOutcome> {
    if (this.scenario === 'provider_error') {
      return { status: 'provider_error', provider: this.name, message: 'Simulated upstream failure.' };
    }

    if (this.scenario === 'rate_limited') {
      return { status: 'rate_limited', provider: this.name, retryAfterSeconds: 60 };
    }

    if (this.scenario === 'empty') {
      return {
        status: 'ok',
        results: [],
        coverageNote: 'No results were returned for the queries we ran.',
      };
    }

    const term = query.terms[0] ?? query.identity.fullName;
    const results: SearchResult[] = SCENARIOS[this.scenario]
      .filter((r) => (r.position ?? Infinity) <= query.window)
      .map((r) => ({
        ...r,
        provider: this.name,
        isFixture: true,
        query: term,
        domain: hostOf(r.url),
        observedAt: FIXTURE_OBSERVED_AT,
      }));

    return {
      status: 'ok',
      results,
      coverageNote: `Fixture data for the "${this.scenario}" scenario. Not live search results.`,
    };
  }
}
