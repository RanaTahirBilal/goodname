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

/* ------------------------------------------------------------ name forms */

/**
 * Honorifics and post-nominals, stripped before a name is taken apart.
 *
 * Without this, "Amara Okonkwo, MD" yields a family name of "md" and every
 * comparison afterwards is against the wrong token.
 */
const TITLES = new Set([
  'dr', 'doctor', 'mr', 'mrs', 'ms', 'miss', 'mx', 'prof', 'professor',
  'hon', 'rev', 'sir', 'dame',
]);

const SUFFIXES = new Set([
  'jr', 'sr', 'ii', 'iii', 'iv', 'v',
  'md', 'do', 'jd', 'esq', 'phd', 'dds', 'dvm', 'rn', 'np', 'pa',
  'mba', 'cpa', 'facc', 'facs', 'faap', 'facp', 'llm', 'ma', 'msc', 'bsc',
]);

export interface NameParts {
  given: string;
  middles: string[];
  family: string;
  /** Every token, titles and post-nominals removed. */
  tokens: string[];
}

/**
 * Splits a declared name into components.
 *
 * Deliberately conservative: with one token there is no given/family
 * distinction to draw, and guessing one would make a surname-only match
 * look like a full-name match.
 */
export function nameParts(raw: string): NameParts {
  const tokens = norm(raw)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Leading honorifics.
  while (tokens.length > 1 && TITLES.has(tokens[0]!)) tokens.shift();

  // Trailing post-nominals, however many are stacked: "Okonkwo, MD, FACC".
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();

  const given = tokens[0] ?? '';
  const family = tokens.length > 1 ? tokens[tokens.length - 1]! : '';
  const middles = tokens.slice(1, -1);

  return { given, middles, family, tokens };
}

/**
 * The written forms of one name that a professional registry might publish.
 *
 * The case this exists for: bars, medical boards, courts and faculty
 * directories publish "Okonkwo, Amara" almost without exception, and those
 * are the sources the presence score weights most heavily. Before this, that
 * form scored 0.10 — "only your surname appears" — and the official record
 * about the customer was rejected as somebody else, while the same record was
 * being classified as a finding about them.
 *
 * Returned as a tier, not a boolean, because the forms are not equally
 * informative. Both *orders* of a full name are worth the same, which is the
 * fix; an initial is not worth the same as a given name, which would be a
 * different bug.
 */
export type NameForm = 'full' | 'initialled' | 'surname' | 'none';

export interface NameMatch {
  form: NameForm;
  /** The form as written, for the signal shown to the customer. */
  description: string;
}

/**
 * Matches a declared name against already-flattened, lower-cased text.
 *
 * `text` must have been through `flat()`: separators collapsed to spaces, so
 * "Okonkwo, Amara" and "okonkwo-amara" both arrive as "okonkwo amara".
 */
export function matchName(text: string, parts: NameParts): NameMatch {
  const { given, middles, family } = parts;

  if (!family) {
    // A single token. It is a surname at best, and treating it as a full
    // name would make every namesake a confirmed match.
    return given && hasWord(text, given)
      ? { form: 'surname', description: 'Only your name as a single word appears, which is weak on its own.' }
      : { form: 'none', description: '' };
  }

  const initial = given.slice(0, 1);
  const middleInitials = middles.map((m) => m.slice(0, 1));

  const seq = (...tokens: string[]) => tokens.filter(Boolean).join(' ');

  /** Both orders of the same name, which is the whole point of this. */
  const fullForms: Array<[string, string]> = [
    [seq(given, ...middles, family), 'Your full name appears in the result.'],
    [seq(given, family), 'Your full name appears in the result.'],
    [seq(family, given), 'Your name appears surname first, as registries write it.'],
    [seq(family, given, ...middles), 'Your name appears surname first, as registries write it.'],
  ];

  for (const [form, description] of fullForms) {
    if (form && hasWord(text, form)) return { form: 'full', description };
  }

  /**
   * An initial is weaker than a given name and stronger than a bare surname.
   * "A. Okonkwo" narrows the field; it does not close it.
   */
  const initialForms: string[] = [
    seq(initial, family),
    seq(family, initial),
    seq(initial, ...middleInitials, family),
    seq(given, ...middleInitials, family),
  ];

  for (const form of initialForms) {
    if (form && form !== family && hasWord(text, form)) {
      return {
        form: 'initialled',
        description: 'Your name appears initialled, which narrows it without settling it.',
      };
    }
  }

  if (hasWord(text, family)) {
    return { form: 'surname', description: 'Only your surname appears, which is weak on its own.' };
  }

  return { form: 'none', description: '' };
}

/** Whole-word match, so "adoni" does not fire inside "adoniphoto". */
function hasWord(text: string, word: string): boolean {
  if (!word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

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
    s.replace(/[-_/.+,;:|]+/g, ' ').replace(/\s+/g, ' ').trim();

  const parts = nameParts(identity.fullName);
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

  /**
   * How the name appears, if it appears.
   *
   * Both written orders of a full name score the same — that is the whole
   * correction. What does *not* change is that a name, in any order, is only
   * ever worth 0.35: it cannot on its own reach `probable` at 0.6, let alone
   * `confirmed` at 0.85. Name compatibility and person identity stay separate
   * quantities, and corroboration is still what moves the second one.
   */
  const name = matchName(nameText, parts);

  if (name.form === 'full') {
    confidence += 0.35;
    signals.push(name.description);
  } else if (aliases.some((a) => hasWord(nameText, a))) {
    confidence += 0.3;
    signals.push('A name you also publish under appears in the result.');
  } else if (name.form === 'initialled') {
    confidence += 0.2;
    signals.push(name.description);
  } else if (name.form === 'surname') {
    confidence += 0.1;
    signals.push(name.description);
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

