/**
 * Identity matching.
 *
 * A name match is not an identity match. People share names, cities and
 * professions, and the cost of getting this wrong is not a slightly off score
 * — it is telling an attorney that a different person's disciplinary record is
 * theirs. So corroboration is additive and explicit, every signal that fired
 * is recorded in words, and anything we are unsure about is excluded from the
 * score and handed back to the customer to confirm or reject.
 */
import type { IdentityStatus, ProfessionalIdentity, SearchResult } from '../contracts/types.ts';
import { clamp } from './metrics.ts';

/** Thresholds from docs/SCORING_SPEC.md §6. */
export const BANDS = {
  confirmed: 0.85,
  probable: 0.6,
  uncertain: 0.3,
} as const;

export const statusFor = (confidence: number): IdentityStatus => {
  if (confidence >= BANDS.confirmed) return 'confirmed';
  if (confidence >= BANDS.probable) return 'probable';
  if (confidence >= BANDS.uncertain) return 'uncertain';
  return 'rejected';
};

const PROFESSION_TERMS: Record<string, string[]> = {
  attorney: ['attorney', 'lawyer', 'counsel', 'partner', 'esq', 'law firm'],
  physician: ['physician', 'doctor', 'md', 'surgeon', 'clinic', 'practice'],
  founder: ['founder', 'co-founder', 'cofounder', 'startup'],
  executive: ['ceo', 'chief', 'president', 'executive', 'director'],
  other: [],
};

const norm = (s: string): string => s.toLowerCase().normalize('NFKD');

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export interface MatchOutcome {
  confidence: number;
  status: IdentityStatus;
  signals: string[];
}

/**
 * Scores one result against the declared identity.
 *
 * A result on the customer's own declared domain short-circuits to near
 * certainty — they told us it is theirs, and corroborating that against a
 * snippet adds nothing.
 */
export function matchResult(result: SearchResult, identity: ProfessionalIdentity): MatchOutcome {
  const haystack = norm(`${result.title} ${result.snippet} ${result.url}`);
  const signals: string[] = [];

  if (identity.websiteUrl) {
    const declared = hostOf(identity.websiteUrl);
    if (declared && hostOf(result.url) === declared) {
      return {
        confidence: 0.98,
        status: 'confirmed',
        signals: ['This is your own website, which you told us about.'],
      };
    }
  }

  let confidence = 0;

  /**
   * Separators become spaces on both sides of the comparison.
   *
   * URL slugs carry names in hyphen form — "/adoni-law-sanctioned",
   * "/j-adoni-reyes" — so the text is flattened before matching. The needles
   * have to be flattened too: an alias written "J. Adoni-Reyes" would
   * otherwise never match the flattened text and would fall through to the
   * weak surname rule.
   */
  const flat = (s: string): string =>
    s.replace(/[-_/.+]+/g, ' ').replace(/\s+/g, ' ').trim();

  const fullName = flat(norm(identity.fullName));
  const surname = fullName.split(/\s+/).at(-1) ?? '';
  const aliases = (identity.knownAliases ?? []).map((a) => flat(norm(a)));

  /**
   * Names are detected against the text with the employer removed.
   *
   * Professionals are routinely named after their own firms. Without this,
   * "Adoni Law filed a brief in Chicago" reads as a surname match plus an
   * employer match plus a city match, and a story that never mentions the
   * person scores as probably them. The employer is scored on its own below,
   * so letting it also satisfy the name test counts it twice.
   */
  const employer = identity.employer ? flat(norm(identity.employer)) : '';
  const flattened = flat(haystack);
  const nameText = employer ? flattened.split(employer).join(' ') : flattened;

  /** Whole-word match, so "adoni" does not fire inside "adoniphoto". */
  const hasWord = (text: string, word: string): boolean => {
    if (!word) return false;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
  };

  if (hasWord(nameText, fullName)) {
    confidence += 0.35;
    signals.push(`Your full name appears in the result.`);
  } else if (aliases.some((a) => hasWord(nameText, a))) {
    confidence += 0.3;
    signals.push('A name you also publish under appears in the result.');
  } else if (hasWord(nameText, surname)) {
    confidence += 0.1;
    signals.push('Only your surname appears, which is weak on its own.');
  } else {
    // Nothing to attach this to. No amount of other corroboration should
    // rescue a result that does not mention the person at all.
    return { confidence: 0, status: 'rejected', signals: ['Your name does not appear.'] };
  }

  if (identity.employer && haystack.includes(norm(identity.employer))) {
    confidence += 0.25;
    signals.push(`Mentions your employer, ${identity.employer}.`);
  }

  if (identity.city && haystack.includes(norm(identity.city))) {
    confidence += 0.15;
    signals.push(`Mentions ${identity.city}.`);
  }

  // Region matters most where it is the only geographic signal available.
  // Official records — a bar order, a licensing decision — routinely name the
  // state and nothing else, and without this they fall short of attribution
  // even when they are plainly about the person.
  if (identity.region && haystack.includes(norm(identity.region))) {
    confidence += 0.12;
    signals.push(`Mentions ${identity.region}.`);
  }

  const matchedCredential = (identity.credentials ?? []).find((c) => haystack.includes(norm(c)));
  if (matchedCredential) {
    confidence += 0.15;
    signals.push(`Mentions your ${matchedCredential}.`);
  }

  const terms = PROFESSION_TERMS[identity.profession] ?? [];
  if (terms.some((t) => haystack.includes(t))) {
    confidence += 0.1;
    signals.push('Uses language consistent with your profession.');
  }

  confidence = clamp(confidence, 0, 0.99);

  return { confidence, status: statusFor(confidence), signals };
}

/** Attaches a match outcome to each result, leaving classification to the caller. */
export function matchAll(
  results: SearchResult[],
  identity: ProfessionalIdentity
): Array<{ result: SearchResult; identity: MatchOutcome }> {
  return results.map((result) => ({ result, identity: matchResult(result, identity) }));
}

