/**
 * The shared vocabulary of the audit pipeline.
 *
 * The audit produces three outputs that are deliberately kept apart:
 *
 *   A. Online Presence Score — how well established the professional presence
 *      is. A number, because the thing it measures is genuinely aggregate.
 *   B. Reputation Risk Assessment — significant negative content and privacy
 *      exposure. Never reduced to a single number, because the detail is the
 *      product: a "68" cannot distinguish an allegation from a finding, and a
 *      customer cannot act on a ceiling.
 *   C. Confidence — how sure we are that any of this is about this person,
 *      and how much of the model we could actually evaluate.
 *
 * Every record carries its provenance. A result that has lost its source,
 * timestamp and fixture flag cannot be explained, and an unexplainable
 * finding must not reach a customer.
 */

/* --------------------------------------------------- special categories */

/**
 * The GDPR Article 9 categories, as they turn up in a name search.
 *
 * Named for the category rather than for the word that matched, because the
 * matched word is frequently the sensitive datum itself. Criminal and
 * regulatory findings are deliberately absent: that material is the product,
 * and `engine/sensitive.ts` explains why suppressing it would be the tool
 * failing rather than the tool being careful.
 */
export type SpecialCategory =
  | 'health'
  | 'religion'
  | 'political_opinion'
  | 'sexual_orientation'
  | 'racial_or_ethnic_origin'
  | 'trade_union'
  | 'immigration_status';

export interface SensitivityAssessment {
  categories: SpecialCategory[];
  /**
   * Why it tripped, as pattern names — never the matched text. Safe to
   * store, safe to log, safe to put in front of a reviewer.
   */
  signals: string[];
  /** True when the title and excerpt must be dropped before storage. */
  withhold: boolean;
}

/* ----------------------------------------------------------- the customer */

export interface ProfessionalIdentity {
  fullName: string;
  /** Other forms the same person publishes under: maiden name, initials. */
  knownAliases?: string[];
  profession: Profession;
  employer?: string;
  /** Employers they have left. Drives staleness, and collision handling. */
  formerEmployers?: string[];
  city?: string;
  region?: string;
  /** Degrees, bar admissions, board certifications. Stated, not inferred. */
  credentials?: string[];
  websiteUrl?: string;
}

export type Profession =
  | 'attorney'
  | 'physician'
  | 'founder'
  | 'executive'
  | 'other';

/** Why this audit is being run. Recorded, not merely asserted. */
export interface AuditPurpose {
  /** The only purpose this product supports today. */
  kind: 'self_audit';
  /** Exact words shown to the customer when they confirmed. */
  attestationText: string;
  attestedAt: string;
  /** How the claim was corroborated beyond the attestation itself. */
  verification: VerificationLevel;
}

export type VerificationLevel =
  | 'none'
  | 'email_domain_match'
  | 'verified_email'
  | 'connected_account'
  | 'document_verified';

/* ------------------------------------------------------------- the search */

export type SourceType =
  | 'owned'
  | 'profile'
  | 'press'
  | 'official'     // court, regulator, licensing board
  | 'aggregator'
  | 'social'
  | 'unknown';

export interface SearchResult {
  provider: string;
  isFixture: boolean;
  query: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  position?: number;
  sourceType: SourceType;
  /** ISO 8601. When we observed it, not when it was published. */
  observedAt: string;
  publishedAt?: string;
  /** Publisher name as given by the provider, when available. */
  sourceName?: string;
  /**
   * Set by the source when it is a correction or retraction of another
   * story. Carried through so a corrected finding is not reported as live.
   */
  correctsUrl?: string;
  isRetraction?: boolean;
}

export interface SearchQuery {
  identity: ProfessionalIdentity;
  terms: string[];
  window: number;
}

/** Providers report failure explicitly; an empty array means "nothing found". */
export type SearchOutcome =
  | { status: 'ok'; results: SearchResult[]; coverageNote?: string; partial?: boolean }
  | { status: 'provider_error'; provider: string; message: string }
  | { status: 'rate_limited'; provider: string; retryAfterSeconds?: number };

export interface SearchProvider {
  readonly name: string;
  readonly isFixture: boolean;
  search(query: SearchQuery): Promise<SearchOutcome>;
}

/* ----------------------------------------------------------- the evidence */

export type IdentityStatus = 'confirmed' | 'probable' | 'uncertain' | 'rejected';

export type Classification =
  | 'owned'
  | 'earned'
  | 'commentary'   // negative or critical opinion — present, never "harm"
  | 'negative'     // asserts something damaging; status says how settled it is
  | 'exposure'     // a data-broker listing of personal information
  | 'unclassified';

/**
 * How settled a negative claim is.
 *
 * This distinction is the difference between a product that informs and one
 * that defames. "Accused" is not "convicted", and a retracted story is not a
 * finding at all.
 */
export type FindingStatus =
  | 'confirmed_finding'  // official record, or several independent reliable sources
  | 'allegation'         // asserted, not adjudicated
  | 'disputed'           // contradicted by another source we hold
  | 'corrected'          // the source published a correction
  | 'retracted'          // the source withdrew it
  | 'opinion'            // criticism, not a factual claim
  | 'unverified';        // we cannot tell; excluded from the risk level

export type SourceReliability = 'official' | 'high' | 'moderate' | 'low' | 'unknown';

export type Provenance = 'live_search' | 'fixture' | 'customer_supplied' | 'connected_account';

export type ReviewStatus =
  | 'auto'
  | 'needs_human_review'
  | 'customer_confirmed'
  | 'customer_rejected'
  /** A reviewer looked and let the finding stand as classified. */
  | 'reviewer_upheld'
  /** A reviewer looked and softened it — a finding became an allegation. */
  | 'reviewer_downgraded'
  /** A reviewer looked and took it out: wrong person, or not harm. */
  | 'reviewer_rejected';

/**
 * What a reviewer concluded about a flagged record.
 *
 * `rejected` is deliberately split by reason. "This is not the customer" and
 * "this is not harm" are different mistakes by the classifier, and only
 * separating them makes it possible to see which one it keeps making.
 */
export type ReviewOutcome =
  | 'uphold'
  | 'downgrade_to_allegation'
  | 'reject_not_this_person'
  | 'reject_not_harm';

/**
 * The traceable record behind every material finding.
 *
 * If a claim reaches a customer, one of these is what justifies it.
 */
export interface EvidenceRecord {
  id: string;
  sourceUrl: string;
  sourceName: string;
  domain: string;
  retrievedAt: string;
  publishedAt?: string;
  title: string;
  /** Short excerpt as returned by the provider. Never paraphrased into a claim. */
  excerpt: string;
  position?: number;

  provenance: Provenance;
  providerName: string;

  identityConfidence: number;
  identityStatus: IdentityStatus;
  identitySignals: string[];

  sourceReliability: SourceReliability;
  /** Numeric authority in [0,1], derived from reliability and source type. */
  authority: number;

  classification: Classification;
  classificationConfidence: number;
  classificationRationale: string;

  findingStatus?: FindingStatus;
  severity?: number;
  severityRationale?: string;

  reviewStatus: ReviewStatus;

  /** Ids of evidence that contradict this record. */
  contradictedBy?: string[];
  /** Id of the record this one corrects or retracts. */
  correctionOf?: string;
  /** Several outlets carrying one story share a cluster id. */
  storyClusterId?: string;
  /** Set when this record is a near-identical reprint of another. */
  duplicateOf?: string;
  /**
   * Distinct domains that reported this story independently, reprints
   * excluded. Syndication is not corroboration, so this is the number that
   * may promote an allegation to a finding.
   */
  independentSourcesInCluster?: number;

  /**
   * Set when the result appears to carry special-category personal data.
   *
   * Its presence means `title` and `excerpt` have already been replaced:
   * the original text is dropped before the record exists, so it never
   * reaches storage, a report or a reviewer. See `engine/sensitive.ts`.
   */
  sensitivity?: SensitivityAssessment;
}

/* -------------------------------------------- A. Online Presence Score */

/** Risk and privacy are NOT dimensions here. They are output B. */
export type PresenceDimension = 'D' | 'P' | 'A' | 'C' | 'H';

export interface DimensionResult {
  code: PresenceDimension;
  label: string;
  value: number | null;
  applicable: boolean;
  inapplicableReason?: string;
  weight: number;
  explanation: string;
  evidenceIds: string[];
}

export type PresenceScore =
  | {
      status: 'scored';
      methodologyVersion: string;
      score: number;
      dimensions: DimensionResult[];
      coverage: number;
      containsFixtureData: boolean;
      computedAt: string;
      /** Stated on every report, so the number is never read as a verdict. */
      meaning: string;
    }
  | {
      status: 'insufficient_evidence';
      methodologyVersion: string;
      coverage: number;
      missingDimensions: PresenceDimension[];
      whatWouldHelp: string[];
      containsFixtureData: boolean;
      computedAt: string;
    };

/* --------------------------------------- B. Reputation Risk Assessment */

export type RiskLevel = 'none' | 'low' | 'elevated' | 'high' | 'severe';

export interface RiskFinding {
  evidenceId: string;
  headline: string;
  sourceName: string;
  sourceUrl: string;
  status: FindingStatus;
  severity: number;
  severityRationale: string;
  /** Rank weight at the time of observation. */
  prominence: number;
  recencyWeight: number;
  reliability: SourceReliability;
  /** Independent sources in the same story cluster. */
  corroboratingSources: number;
  contradictingSources: number;
  requiresHumanReview: boolean;
  /** Plain-language note for the customer: what this is and is not. */
  note: string;
}

export interface PrivacyExposure {
  assessed: boolean;
  exposedListings: number;
  level: RiskLevel;
  evidenceIds: string[];
  note: string;
}

/**
 * Deliberately has no aggregate 0–100. A level plus the findings behind it is
 * actionable; a number is not, and a number is what lets a severe finding
 * disappear into an average.
 */
export interface RiskAssessment {
  methodologyVersion: string;
  level: RiskLevel;
  levelRationale: string;
  findings: RiskFinding[];
  /** Surfaced separately: present in the results, not counted as harm. */
  commentary: RiskFinding[];
  privacy: PrivacyExposure;
  /** Findings we could not settle, shown but excluded from the level. */
  needsReview: RiskFinding[];
  containsFixtureData: boolean;
  assessedAt: string;
}

/* ------------------------------------------------- C. Confidence report */

export interface ConfidenceReport {
  /** Prominence-weighted, over everything bearing the person's name. */
  identityConfidence: number;
  band: 'high' | 'moderate' | 'low';
  attributed: number;
  awaitingConfirmation: number;
  rejected: number;
  /** Share of the presence model we could evaluate, 0–1. */
  evidenceCoverage: number;
  sourceReliabilityMix: Record<SourceReliability, number>;
  /** Evidence ids a human should look at before this is shown as settled. */
  needsHumanReview: string[];
  note: string;
}
