/**
 * Per-document classification.
 *
 * This is a conservative rule-based classifier, not a finished one. It exists
 * so the pipeline is end-to-end testable without a model provider, and so the
 * interface an AI classifier must satisfy is fixed before one is wired in.
 *
 * Its central job is a distinction the product cannot get wrong: **an
 * allegation is not a finding.** "Accused of fraud" and "convicted of fraud"
 * describe very different situations, and conflating them turns a reputation
 * tool into a defamation engine. So harm language alone never produces a
 * confirmed finding here. It produces an `allegation`, and promotion to
 * `confirmed_finding` requires either an official source or independent
 * corroboration — a judgement made across documents, in risk.ts, not here.
 *
 * When signals conflict, the answer is `unverified`. Declining to judge is a
 * valid output; guessing about someone's professional record is not.
 */
import type {
  Classification,
  FindingStatus,
  ProfessionalIdentity,
  SearchResult,
  SourceReliability,
} from '../contracts/types.ts';

/** Unambiguous harm language, with the severity it implies if established. */
const HARM_TERMS: Array<{ term: string; severity: number }> = [
  { term: 'disbarred', severity: 5 },
  { term: 'struck off', severity: 5 },
  { term: 'convicted', severity: 5 },
  { term: 'conviction', severity: 5 },
  { term: 'pleaded guilty', severity: 5 },
  { term: 'mugshot', severity: 5 },
  { term: 'license revoked', severity: 5 },
  { term: 'licence revoked', severity: 5 },
  { term: 'indicted', severity: 4 },
  { term: 'malpractice verdict', severity: 4 },
  { term: 'malpractice settlement', severity: 4 },
  { term: 'censured', severity: 4 },
  { term: 'suspended from practice', severity: 4 },
  { term: 'fraud charges', severity: 4 },
  { term: 'disciplinary action', severity: 3 },
  { term: 'sanctioned', severity: 3 },
  { term: 'reprimanded', severity: 3 },
];

/** Language that marks a claim as unsettled. */
const HEDGE_TERMS = [
  'alleged',
  'allegedly',
  'allegation',
  'accused',
  'accusation',
  'claims',
  'reportedly',
  'faces',
  'under investigation',
  'investigating',
  'denies',
  'disputed',
  'lawsuit filed',
];

/** Negative, but opinion — present in the report, never counted as harm. */
const OPINION_TERMS = [
  'controversial',
  'criticised',
  'criticized',
  'criticism',
  'backlash',
  'complaint',
  'unpopular',
  'questioned',
];

const CORRECTION_TERMS = ['correction', 'corrects', 'clarification'];
const RETRACTION_TERMS = ['retraction', 'retracted', 'withdrawn', 'we withdraw'];

/** Sources whose records are determinations rather than reporting. */
const OFFICIAL_HINTS = ['courts', 'court', '.gov', 'ilcourts', 'statebar', 'medicalboard', 'regulator'];

const AGGREGATOR_HOSTS = [
  'spokeo',
  'whitepages',
  'beenverified',
  'radaris',
  'peoplefinders',
  'intelius',
  'truthfinder',
];

const DIRECTORY_HOSTS = [
  'linkedin',
  'avvo',
  'martindale',
  'justia',
  'healthgrades',
  'zocdoc',
  'doximity',
  'crunchbase',
];

const norm = (s: string): string => s.toLowerCase();

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Reliability is a property of the source, never of whether we like it. */
export function assessReliability(result: SearchResult): SourceReliability {
  const host = hostOf(result.url);
  if (result.sourceType === 'official' || OFFICIAL_HINTS.some((h) => host.includes(h))) {
    return 'official';
  }
  if (AGGREGATOR_HOSTS.some((h) => host.includes(h)) || result.sourceType === 'aggregator') {
    return 'low';
  }
  if (DIRECTORY_HOSTS.some((h) => host.includes(h))) return 'moderate';
  if (result.sourceType === 'press') return 'high';
  if (result.sourceType === 'owned' || result.sourceType === 'profile') return 'moderate';
  return 'unknown';
}

const AUTHORITY: Record<SourceReliability, number> = {
  official: 1.0,
  high: 0.8,
  moderate: 0.55,
  low: 0.2,
  unknown: 0.3,
};

export const authorityFor = (r: SourceReliability): number => AUTHORITY[r];

export interface ClassificationOutcome {
  classification: Classification;
  /** Only set for `negative` and `commentary`. */
  findingStatus?: FindingStatus;
  severity?: number;
  severityRationale?: string;
  confidence: number;
  rationale: string;
  reliability: SourceReliability;
  authority: number;
  /** The source says it corrects or withdraws something. */
  isCorrection: boolean;
  isRetraction: boolean;
}

export function classify(
  result: SearchResult,
  identity: ProfessionalIdentity
): ClassificationOutcome {
  const reliability = assessReliability(result);
  const authority = authorityFor(reliability);
  const text = norm(`${result.title} ${result.snippet}`);
  const host = hostOf(result.url);

  const isRetraction =
    result.isRetraction === true || RETRACTION_TERMS.some((t) => text.includes(t));
  const isCorrection =
    result.correctsUrl !== undefined || CORRECTION_TERMS.some((t) => text.includes(t));

  const base = { reliability, authority, isCorrection, isRetraction };

  const declaredHost = identity.websiteUrl ? hostOf(identity.websiteUrl) : '';
  if ((declaredHost && host === declaredHost) || result.sourceType === 'owned') {
    return {
      ...base,
      classification: 'owned',
      confidence: 0.95,
      rationale: 'Published on a domain the customer told us they control.',
    };
  }

  if (reliability === 'low' && AGGREGATOR_HOSTS.some((h) => host.includes(h))) {
    return {
      ...base,
      classification: 'exposure',
      confidence: 0.9,
      rationale: 'A people-search aggregator listing personal details.',
    };
  }

  if (result.sourceType === 'profile' || result.sourceType === 'social') {
    return {
      ...base,
      classification: 'owned',
      confidence: 0.8,
      rationale: 'A profile surface the person controls.',
    };
  }

  const harm = HARM_TERMS.filter((h) => text.includes(h.term));
  const hedges = HEDGE_TERMS.filter((t) => text.includes(t));
  const opinions = OPINION_TERMS.filter((t) => text.includes(t));

  if (harm.length > 0) {
    const worst = harm.reduce((a, b) => (b.severity > a.severity ? b : a));

    if (isRetraction) {
      return {
        ...base,
        classification: 'negative',
        findingStatus: 'retracted',
        severity: worst.severity,
        severityRationale: `Mentions "${worst.term}", but the source withdrew the story.`,
        confidence: 0.8,
        rationale: 'A retraction. Reported for completeness; not treated as a finding.',
      };
    }

    if (isCorrection) {
      return {
        ...base,
        classification: 'negative',
        findingStatus: 'corrected',
        severity: worst.severity,
        severityRationale: `Mentions "${worst.term}" in a story the source has since corrected.`,
        confidence: 0.75,
        rationale: 'A correction. The original claim should not stand unexamined.',
      };
    }

    // Hedged language means the claim is not settled, whoever published it.
    if (hedges.length > 0) {
      return {
        ...base,
        classification: 'negative',
        findingStatus: 'allegation',
        severity: worst.severity,
        severityRationale: `Mentions "${worst.term}" alongside hedging ("${hedges[0]}").`,
        confidence: 0.7,
        rationale:
          'An unsettled claim. Reported as an allegation, never as an established finding.',
      };
    }

    // Unhedged on an official record is the one case we treat as settled
    // from a single source. Everything else needs corroboration, decided
    // across documents rather than here.
    if (reliability === 'official') {
      return {
        ...base,
        classification: 'negative',
        findingStatus: 'confirmed_finding',
        severity: worst.severity,
        severityRationale: `An official record stating "${worst.term}".`,
        confidence: 0.9,
        rationale: 'An official determination, not reporting about one.',
      };
    }

    return {
      ...base,
      classification: 'negative',
      findingStatus: 'allegation',
      severity: worst.severity,
      severityRationale: `States "${worst.term}" without an official source.`,
      confidence: 0.6,
      rationale:
        'A single non-official source. Held as an allegation pending corroboration.',
    };
  }

  if (opinions.length > 0) {
    return {
      ...base,
      classification: 'commentary',
      findingStatus: 'opinion',
      confidence: 0.7,
      rationale: 'Critical commentary. Legitimate coverage, not a factual harm claim.',
    };
  }

  if (result.sourceType === 'press' || result.sourceType === 'official') {
    return {
      ...base,
      classification: 'earned',
      confidence: 0.75,
      rationale: 'Third-party coverage with no harm or criticism language.',
    };
  }

  return {
    ...base,
    classification: 'unclassified',
    confidence: 0.3,
    rationale: 'Not enough signal to classify. Excluded from risk.',
  };
}
