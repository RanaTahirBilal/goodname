/**
 * Output A — the Online Presence Score.
 *
 * Measures how well established a professional online presence is. It does
 * **not** measure reputation, and it contains no risk dimension: negative
 * content is output B, assessed separately and never averaged in.
 *
 * That separation is the whole design. An earlier version folded risk into
 * this number and used caps to stop a severe finding disappearing — but a cap
 * is lossy: it tells a customer their ceiling, not what happened. Keeping the
 * two apart means a person can have a strong presence *and* a serious problem,
 * which is both a common situation and an unrepresentable one in a single
 * aggregate.
 *
 * Two invariants hold throughout:
 *   1. Missing data is never 0 and never 100. It is inapplicable, and the
 *      remaining weights renormalise around it.
 *   2. Every number that reaches a customer carries its evidence ids.
 */
import type {
  DimensionResult,
  EvidenceRecord,
  PresenceDimension,
  PresenceScore,
  ProfessionalIdentity,
} from '../contracts/types.ts';
import { clamp, prominence, ageInDays, recencyDecay, meanOrNull } from './metrics.ts';

export const PRESENCE_METHODOLOGY_VERSION = '3.0.0-provisional';

/**
 * Frozen for this major version and stored with every snapshot.
 * Provisional: these are reasoned, not empirically validated.
 */
export const WEIGHTS: Record<PresenceDimension, number> = {
  D: 0.30,
  P: 0.24,
  A: 0.20,
  H: 0.14,
  C: 0.12,
};

const LABELS: Record<PresenceDimension, string> = {
  D: 'Discoverability & Ownership',
  P: 'Professional Profile Completeness',
  A: 'Source Authority & Relevance',
  H: 'Digital Asset Health',
  C: 'Information Consistency',
};

export const MIN_COVERAGE = 0.55;

export const SCORE_MEANING =
  'This measures how well established your professional presence is in the results we searched. ' +
  'It is not a measure of your reputation, character or competence, and negative content is assessed separately.';

/* ------------------------------------------------------------------ input */

export interface ProfileObservation {
  key: string;
  present: boolean;
  hasPhoto?: boolean;
  hasBio?: boolean;
  hasCredentials?: boolean;
  hasOutboundLink?: boolean;
}

export interface ConsistencyObservation {
  comparableFields: number;
  matchingFields: number;
  profilesAssertingEmployment: number;
  profilesWithStaleEmployment: number;
}

export interface WebsiteCheck {
  key: string;
  passed: boolean;
}

export interface PresenceInput {
  identity: ProfessionalIdentity;
  /** Attributed evidence only. */
  records: EvidenceRecord[];
  expectedProfiles: string[];
  profileObservations: ProfileObservation[];
  consistency?: ConsistencyObservation;
  websiteChecks?: WebsiteCheck[];
  hasRichEntity?: boolean;
}

/* -------------------------------------------------------------- helpers */

/** Syndicated copies are one story; counting each would inflate every total. */
const primaries = (records: EvidenceRecord[]): EvidenceRecord[] =>
  records.filter((r) => r.duplicateOf === undefined);

const decayOf = (r: EvidenceRecord): number =>
  recencyDecay(ageInDays(r.publishedAt, r.retrievedAt));

const ids = (records: EvidenceRecord[]): string[] => records.map((r) => r.id);

const dimension = (
  code: PresenceDimension,
  value: number | null,
  explanation: string,
  evidenceIds: string[] = [],
  inapplicableReason?: string
): DimensionResult => ({
  code,
  label: LABELS[code],
  value,
  applicable: value !== null,
  inapplicableReason: value === null ? inapplicableReason : undefined,
  weight: WEIGHTS[code],
  explanation,
  evidenceIds,
});

/* ----------------------------------------------------------- dimensions */

function discoverability(records: EvidenceRecord[], hasRichEntity: boolean): DimensionResult {
  if (records.length === 0) {
    return dimension('D', null, 'No results were attributed to you.', [], 'no_results_attributed');
  }

  const total = records.reduce((s, r) => s + prominence(r.position), 0);
  const owned = records.filter((r) => r.classification === 'owned');
  const ownedProminence = owned.reduce((s, r) => s + prominence(r.position), 0);

  const ownedShare = total === 0 ? 0 : ownedProminence / total;
  const ranked = records.some((r) => r.position !== undefined);
  const entity = hasRichEntity ? 0.15 : 0;

  return dimension(
    'D',
    clamp(0.55 * ownedShare + 0.35 * (ranked ? 1 : 0.3) + entity),
    `${Math.round(ownedShare * 100)}% of prominent results are pages you own or control` +
      (hasRichEntity ? ', and a rich entity is present.' : '.'),
    ids(owned)
  );
}

function profileCompleteness(
  expected: string[],
  observations: ProfileObservation[]
): DimensionResult {
  if (expected.length === 0) {
    return dimension('P', null, 'No expected profiles configured.', [], 'no_expected_profiles');
  }

  const present = observations.filter((o) => o.present);
  const coverage = clamp(present.length / expected.length);

  const completeness =
    meanOrNull(
      present.map((o) => {
        const fields = [o.hasPhoto, o.hasBio, o.hasCredentials, o.hasOutboundLink];
        return fields.filter(Boolean).length / fields.length;
      })
    ) ?? 0;

  const missing = expected.filter((k) => !present.some((o) => o.key === k));

  return dimension(
    'P',
    clamp(0.5 * coverage + 0.5 * completeness),
    `${present.length} of ${expected.length} expected profiles found` +
      (missing.length ? `; missing: ${missing.join(', ')}.` : '.')
  );
}

function sourceAuthority(records: EvidenceRecord[]): DimensionResult {
  if (records.length === 0) {
    return dimension('A', null, 'No results were attributed to you.', [], 'no_results_attributed');
  }

  const earned = records.filter((r) => r.classification === 'earned');
  const total = earned.reduce((s, r) => s + r.authority * decayOf(r), 0);

  // Caps at roughly three solid, recent mentions. Not scaling past that is
  // deliberate: this must not reward press-release spam.
  return dimension(
    'A',
    clamp(total / 3.0),
    earned.length === 0
      ? 'No earned third-party coverage was found.'
      : `${earned.length} independent piece${earned.length > 1 ? 's' : ''} of earned coverage.`,
    ids(earned)
  );
}

function consistency(obs?: ConsistencyObservation): DimensionResult {
  if (!obs || obs.comparableFields === 0) {
    return dimension(
      'C',
      null,
      'Not enough profiles to compare information across.',
      [],
      'insufficient_comparable_fields'
    );
  }

  const agreement = obs.matchingFields / obs.comparableFields;
  const staleShare =
    obs.profilesAssertingEmployment === 0
      ? 0
      : obs.profilesWithStaleEmployment / obs.profilesAssertingEmployment;

  return dimension(
    'C',
    clamp(agreement - 0.5 * staleShare),
    `${Math.round(agreement * 100)}% of comparable details agree across your profiles` +
      (staleShare > 0 ? `; ${obs.profilesWithStaleEmployment} still list a previous role.` : '.')
  );
}

function assetHealth(checks?: WebsiteCheck[]): DimensionResult {
  if (!checks || checks.length === 0) {
    return dimension('H', null, 'No website is connected.', [], 'no_website_connected');
  }
  const passed = checks.filter((c) => c.passed);
  return dimension(
    'H',
    clamp(passed.length / checks.length),
    `${passed.length} of ${checks.length} technical checks pass.`
  );
}

/* ------------------------------------------------------------ composition */

export function scorePresence(input: PresenceInput): PresenceScore {
  const records = primaries(input.records);
  const computedAt = new Date().toISOString();
  const containsFixtureData = input.records.some((r) => r.provenance === 'fixture');

  const dimensions: DimensionResult[] = [
    discoverability(records, input.hasRichEntity ?? false),
    profileCompleteness(input.expectedProfiles, input.profileObservations),
    sourceAuthority(records),
    assetHealth(input.websiteChecks),
    consistency(input.consistency),
  ];

  const applicable = dimensions.filter((d) => d.applicable);
  const coverage = applicable.reduce((s, d) => s + d.weight, 0);

  if (coverage < MIN_COVERAGE) {
    return {
      status: 'insufficient_evidence',
      methodologyVersion: PRESENCE_METHODOLOGY_VERSION,
      coverage,
      missingDimensions: dimensions.filter((d) => !d.applicable).map((d) => d.code),
      /**
       * One entry per thing to do, not one per dimension.
       *
       * Several dimensions fail for the same reason — with no attributable
       * results, both discoverability and source authority are
       * unevaluable — and `helpFor` maps them to the same sentence. Listing
       * it once per dimension produced "Confirming your employer and city
       * usually helps" twice in a row, under a heading promising what would
       * change the outcome. A list of actions that repeats itself reads as
       * carelessness in the one place the report is admitting it cannot
       * answer the question.
       *
       * De-duplicated here rather than in the view because the duplication
       * is wrong in the data: this is a set of remedies, and a remedy done
       * twice is still one remedy.
       */
      whatWouldHelp: [
        ...new Set(
          dimensions.filter((d) => !d.applicable).map((d) => helpFor(d.inapplicableReason))
        ),
      ],
      containsFixtureData,
      computedAt,
    };
  }

  const weighted = applicable.reduce((s, d) => s + d.weight * (d.value as number), 0);

  return {
    status: 'scored',
    methodologyVersion: PRESENCE_METHODOLOGY_VERSION,
    score: Math.round(100 * (weighted / coverage)),
    dimensions,
    coverage,
    containsFixtureData,
    computedAt,
    meaning: SCORE_MEANING,
  };
}

const helpFor = (reason?: string): string => {
  switch (reason) {
    case 'no_results_attributed':
      return 'We found no search results we could confidently attribute to you. Confirming your employer and city usually helps.';
    case 'no_website_connected':
      return 'Connect your website so we can audit it.';
    case 'insufficient_comparable_fields':
      return 'We need at least two of your professional profiles to compare information across.';
    case 'no_expected_profiles':
      return 'Tell us your profession so we know which profiles to look for.';
    default:
      return 'More evidence is needed.';
  }
};
