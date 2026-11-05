/**
 * The audit pipeline.
 *
 *   purpose gate → validation → search → evidence → identity → classification
 *   → presence score (A) + risk assessment (B) + confidence (C) → report
 *
 * Orchestration only. The judgement lives in the engine modules, and nothing
 * here touches a database or a network except through the injected provider
 * and store.
 */
import type {
  AuditPurpose,
  ConfidenceReport,
  EvidenceRecord,
  PresenceScore,
  ProfessionalIdentity,
  RiskAssessment,
  SearchProvider,
  SearchQuery,
} from './contracts/types.ts';
import { buildEvidence, attributed, awaitingConfirmation } from './engine/evidence.ts';
import { scorePresence, type ProfileObservation, type WebsiteCheck } from './engine/score.ts';
import { assessRisk } from './engine/risk.ts';
import { buildConfidence } from './engine/confidence.ts';
import { recommend, type Recommendation } from './engine/recommend.ts';
import { buildFindings, type BriefingFinding } from './engine/findings.ts';
import type { Placement } from './contracts/types.ts';
import { gate, type AttemptStore, type GateReason } from './safeguards.ts';

/* -------------------------------------------------------------- validation */

export interface ValidationIssue {
  field: string;
  message: string;
}

export function validateIdentity(identity: Partial<ProfessionalIdentity>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const name = (identity.fullName ?? '').trim();
  if (name.length < 2) {
    issues.push({ field: 'fullName', message: 'Enter the full name you publish under.' });
  } else if (!name.includes(' ')) {
    issues.push({
      field: 'fullName',
      message: 'A first and last name gives us enough to tell you apart from others.',
    });
  }

  const professions = ['attorney', 'physician', 'founder', 'executive', 'other'];
  if (!identity.profession || !professions.includes(identity.profession)) {
    issues.push({ field: 'profession', message: 'Choose the profession that fits best.' });
  }

  if (identity.websiteUrl) {
    try {
      const u = new URL(identity.websiteUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        issues.push({ field: 'websiteUrl', message: 'Enter a web address starting with https://.' });
      }
    } catch {
      issues.push({ field: 'websiteUrl', message: 'That does not look like a web address.' });
    }
  }

  return issues;
}

/* ------------------------------------------------------------- query plan */

/** Narrow by design: every term is anchored to the customer's own name. */
export function buildQueries(identity: ProfessionalIdentity): string[] {
  const name = identity.fullName.trim();
  const terms = [name];
  if (identity.employer) terms.push(`${name} ${identity.employer}`);
  if (identity.city) terms.push(`${name} ${identity.city}`);
  for (const alias of identity.knownAliases ?? []) terms.push(alias);
  return terms;
}

export const EXPECTED_PROFILES: Record<string, string[]> = {
  attorney: ['firm_bio', 'state_bar', 'linkedin', 'personal_site', 'legal_directory'],
  physician: ['practice_bio', 'medical_board', 'linkedin', 'personal_site', 'health_directory'],
  founder: ['company_bio', 'linkedin', 'personal_site', 'crunchbase'],
  executive: ['company_bio', 'linkedin', 'personal_site'],
  other: ['linkedin', 'personal_site'],
};

const PROFILE_HOST_HINTS: Record<string, string[]> = {
  linkedin: ['linkedin'],
  legal_directory: ['avvo', 'martindale', 'justia'],
  health_directory: ['healthgrades', 'zocdoc', 'doximity'],
  crunchbase: ['crunchbase'],
};

function observeProfiles(
  records: EvidenceRecord[],
  expected: string[],
  identity: ProfessionalIdentity
): ProfileObservation[] {
  let declaredHost = '';
  if (identity.websiteUrl) {
    try {
      declaredHost = new URL(identity.websiteUrl).hostname.replace(/^www\./, '');
    } catch {
      declaredHost = '';
    }
  }

  return expected.map((key) => {
    const hints = PROFILE_HOST_HINTS[key] ?? [];
    const match = records.find((r) => {
      if (key === 'personal_site') return declaredHost !== '' && r.domain === declaredHost;
      return hints.length > 0 && hints.some((h) => r.domain.includes(h));
    });

    if (!match) return { key, present: false };

    // Proxy signals until connected accounts give us the real fields. Honest
    // about being a proxy rather than pretending to know.
    const text = `${match.title} ${match.excerpt}`;
    return {
      key,
      present: true,
      hasPhoto: match.classification === 'owned',
      hasBio: text.length > 80,
      hasCredentials: (identity.credentials ?? []).some((c) =>
        text.toLowerCase().includes(c.toLowerCase())
      ),
      hasOutboundLink: match.domain === declaredHost,
    };
  });
}

/**
 * Consistency needs at least two profiles asserting comparable facts. With
 * fewer, the dimension is inapplicable rather than perfect — one profile
 * always agrees with itself.
 */
function deriveConsistency(records: EvidenceRecord[], identity: ProfessionalIdentity) {
  const profiles = records.filter((r) => r.classification === 'owned');
  if (profiles.length < 2) return undefined;

  const former = (identity.formerEmployers ?? []).map((e) => e.toLowerCase());
  const assertsEmployment = profiles.filter((p) =>
    identity.employer
      ? `${p.title} ${p.excerpt}`.toLowerCase().includes(identity.employer.toLowerCase()) ||
        former.some((f) => `${p.title} ${p.excerpt}`.toLowerCase().includes(f))
      : false
  );

  const stale = assertsEmployment.filter((p) => {
    const text = `${p.title} ${p.excerpt}`.toLowerCase();
    const mentionsCurrent = identity.employer
      ? text.includes(identity.employer.toLowerCase())
      : false;
    return !mentionsCurrent && former.some((f) => text.includes(f));
  });

  return {
    comparableFields: profiles.length * 2,
    matchingFields: Math.max(
      0,
      profiles.reduce((s, p) => s + Math.min(2, Math.max(0, p.identitySignals.length - 1)), 0)
    ),
    profilesAssertingEmployment: assertsEmployment.length,
    profilesWithStaleEmployment: stale.length,
  };
}

/* ----------------------------------------------------------------- report */

export interface AuditInput {
  identity: ProfessionalIdentity;
  purpose: AuditPurpose;
  provider: SearchProvider;
  /** Required for the safeguard gate; omit only in unit tests of the engine. */
  requesterId?: string;
  attemptStore?: AttemptStore;
  window?: number;
  websiteChecks?: WebsiteCheck[];
  brokerAssessmentRan?: boolean;
  hasRichEntity?: boolean;
  /**
   * Material published for this customer by us, so the engine can decline
   * to credit itself for it. See `isIndependent` in `engine/score.ts`.
   */
  placements?: Placement[];
}

export type AuditReport =
  | { status: 'invalid_input'; issues: ValidationIssue[] }
  | { status: 'not_permitted'; reason: GateReason; message: string; retryAfterSeconds?: number }
  | {
      status: 'search_failed';
      provider: string;
      reason: 'provider_error' | 'rate_limited';
      message: string;
      retryAfterSeconds?: number;
    }
  | {
      status: 'complete';
      scan: {
        provider: string;
        isFixture: boolean;
        queries: string[];
        window: number;
        observedAt: string;
        resultsObserved: number;
        resultsAttributed: number;
        partialCoverage: boolean;
        coverageNote?: string;
      };
      evidence: EvidenceRecord[];
      awaitingConfirmation: EvidenceRecord[];
      presence: PresenceScore;
      risk: RiskAssessment;
      confidence: ConfidenceReport;
      recommendations: Recommendation[];
      findings: BriefingFinding[];
    };

export interface RescoreInput {
  identity: ProfessionalIdentity;
  /** All evidence for the scan, including results we rejected. */
  evidence: EvidenceRecord[];
  websiteChecks?: WebsiteCheck[];
  brokerAssessmentRan?: boolean;
  hasRichEntity?: boolean;
}

export interface ScoredOutputs {
  presence: PresenceScore;
  risk: RiskAssessment;
  confidence: ConfidenceReport;
  recommendations: Recommendation[];
  findings: BriefingFinding[];
  awaitingConfirmation: EvidenceRecord[];
}

/**
 * Turns evidence into the three outputs.
 *
 * Separated from `runAudit` so a stored scan can be rescored after the
 * customer confirms or rejects an uncertain match, without re-running the
 * search. Re-querying a provider to apply a decision the customer already
 * made would cost money, change the evidence underneath them, and make the
 * report non-reproducible.
 */
export function rescore(input: RescoreInput): ScoredOutputs {
  const mine = attributed(input.evidence);
  const expectedProfiles = EXPECTED_PROFILES[input.identity.profession] ?? EXPECTED_PROFILES.other;

  const presence = scorePresence({
    identity: input.identity,
    records: mine,
    expectedProfiles,
    profileObservations: observeProfiles(mine, expectedProfiles, input.identity),
    consistency: deriveConsistency(mine, input.identity),
    websiteChecks: input.websiteChecks,
    hasRichEntity: input.hasRichEntity,
  });

  const risk = assessRisk({
    records: mine,
    allRecords: input.evidence,
    brokerAssessmentRan: input.brokerAssessmentRan,
  });

  const confidence = buildConfidence(input.evidence, presence.coverage);

  const recommendations = recommend(presence, risk, confidence);

  return {
    presence,
    risk,
    confidence,
    recommendations,
    /**
     * Derived here rather than in the interface.
     *
     * The report opens with a few sentences about what the audit found, and
     * the interface is the worst place to compose them: every input is a
     * number, the output is prose, and nothing downstream can tell a
     * computed sentence from an invented one. `buildFindings` only emits a
     * finding when the engine output that justifies it exists.
     */
    findings: buildFindings(presence, risk, confidence, recommendations),
    awaitingConfirmation: awaitingConfirmation(input.evidence),
  };
}

export async function runAudit(input: AuditInput): Promise<AuditReport> {
  const issues = validateIdentity(input.identity);
  if (issues.length > 0) return { status: 'invalid_input', issues };

  // The gate runs before the provider so a blocked request costs nothing and
  // leaves no search in anyone's logs.
  if (input.attemptStore && input.requesterId) {
    const decision = await gate(
      {
        requesterId: input.requesterId,
        subjectName: input.identity.fullName,
        purpose: input.purpose,
        at: new Date().toISOString(),
      },
      input.attemptStore
    );

    if (!decision.allowed) {
      return {
        status: 'not_permitted',
        reason: decision.reason,
        message: decision.message,
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }
  }

  const window = input.window ?? 10;
  const queries = buildQueries(input.identity);
  const query: SearchQuery = { identity: input.identity, terms: queries, window };

  const outcome = await input.provider.search(query);

  if (outcome.status === 'provider_error') {
    return {
      status: 'search_failed',
      provider: outcome.provider,
      reason: 'provider_error',
      message: outcome.message,
    };
  }

  if (outcome.status === 'rate_limited') {
    return {
      status: 'search_failed',
      provider: outcome.provider,
      reason: 'rate_limited',
      message: 'The search provider is rate limiting us.',
      retryAfterSeconds: outcome.retryAfterSeconds,
    };
  }

  const evidence = buildEvidence({
    results: outcome.results,
    identity: input.identity,
    provenance: input.provider.isFixture ? 'fixture' : 'live_search',
    placements: input.placements,
  });

  const scored = rescore({
    identity: input.identity,
    evidence,
    websiteChecks: input.websiteChecks,
    brokerAssessmentRan: input.brokerAssessmentRan,
    hasRichEntity: input.hasRichEntity,
  });

  const mine = attributed(evidence);

  return {
    status: 'complete',
    scan: {
      provider: input.provider.name,
      isFixture: input.provider.isFixture,
      queries,
      window,
      observedAt: evidence[0]?.retrievedAt ?? new Date().toISOString(),
      resultsObserved: evidence.length,
      resultsAttributed: mine.length,
      partialCoverage: outcome.partial ?? false,
      coverageNote: outcome.coverageNote,
    },
    evidence,
    ...scored,
  };
}
