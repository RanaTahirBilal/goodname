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

/**
 * Words that reverse or discharge the claim they sit beside.
 *
 * **This is a hint for a reviewer, not a safeguard.** The safeguard is that
 * nothing in this file confirms a finding any more; this only changes how
 * loudly the record asks to be read, and how much confidence we admit to.
 *
 * Writing it the other way round — trusting a word list to decide whether an
 * allegation is live — is how the rehearsal defect would come back in a form
 * that passes its own regression test. Language has more ways to negate a
 * claim than any list holds: "the complaint was withdrawn", "cleared of",
 * "the record shows none", "found to have no case to answer".
 */
const NEGATORS = [
  'no', 'not', 'never', 'none', 'without', 'free of', 'clear of', 'cleared of',
  'dismissed', 'withdrawn', 'expunged', 'overturned', 'vacated', 'exonerated',
  'acquitted', 'unfounded', 'dropped', 'rescinded',
];

/**
 * Whether a negator sits close enough to the matched term to be about it.
 *
 * A window rather than the whole document: "No disciplinary actions are
 * recorded" should count, while a page that says "no" somewhere in a
 * paragraph about something else should not. Returns the word found, for the
 * rationale a reviewer reads.
 */
function negationAround(text: string, term: string, window = 60): string | null {
  const at = text.indexOf(term);
  if (at < 0) return null;

  const around = text.slice(Math.max(0, at - window), at + term.length + window);

  for (const n of NEGATORS) {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'u').test(around)) return `"${n}"`;
  }

  return null;
}

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

    /**
     * An official source used to short-circuit to `confirmed_finding` here.
     * That is the line that produced the rehearsal defect, and it is gone.
     *
     * The sentence was: "Certification in Cardiovascular Disease is current.
     * No disciplinary actions are recorded against this certificate." It
     * contains the term `disciplinary action`, it carries no hedge, and it
     * sits on a medical board's domain — so every test this branch applied
     * passed, and a clean certification became the most damaging thing the
     * system can say about a doctor.
     *
     * The fix is not a negation keyword. "no", "not" and "without" would
     * catch this exact sentence and fail on the next one, and a guard that
     * works on the example in front of you is how the defect got here. The
     * fix is structural: **this classifier does not confirm anything.** An
     * official source with unhedged adverse language is the strongest signal
     * it can produce, and the strongest signal it can produce is "a person
     * needs to read this".
     *
     * Promotion to `confirmed_finding` now has exactly two routes, both of
     * which require evidence beyond one document's wording: corroboration
     * across independent domains, decided in risk.ts, or a reviewer
     * upholding it in writing.
     */
    if (reliability === 'official') {
      const negated = negationAround(text, worst.term);

      return {
        ...base,
        classification: 'negative',
        findingStatus: 'requires_review',
        severity: worst.severity,
        severityRationale: negated
          ? `An official record where "${worst.term}" appears next to ${negated}, which may reverse its meaning.`
          : `An official record mentioning "${worst.term}". What it establishes has not been read.`,
        confidence: negated ? 0.3 : 0.6,
        rationale: negated
          ? 'Adverse language on an official record, in a context that may deny it. Not a finding until somebody reads the source.'
          : 'Adverse language on an official record. Detected, not established.',
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
