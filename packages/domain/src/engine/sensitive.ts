/**
 * Special-category detection, and what we do about it.
 *
 * `docs/SAFEGUARDS.md` listed this as the last gap blocking real customer
 * data: nothing classified or specially handled sensitive attributes that
 * turned up in search results. A name search does not politely confine
 * itself to professional material. It returns the charity run someone did
 * after their diagnosis, the mosque they help run, the party they donated to,
 * the immigration case they were a party to.
 *
 * ## The decision
 *
 * **We do not store that material, and we do not quote it back.**
 *
 * The record of the result stays — its URL, its source, its date, the fact it
 * ranks for this name. The title and excerpt do not. They are dropped before
 * the record is built, so no special-category text ever reaches the database,
 * the report, or a reviewer's screen.
 *
 * Three reasons this is the right shape rather than the cautious-looking one:
 *
 *   - **Nothing is lost.** The material is public and still one click away at
 *     its source. We are declining to hold a copy, not hiding it from the
 *     person it is about.
 *   - **It makes false positives cheap.** A professional result wrongly
 *     withheld costs the customer an excerpt they can still click through to.
 *     A health condition wrongly quoted puts it in our database with its own
 *     retention story, its own backups, and its own breach surface. The
 *     asymmetry is enormous, so the filter is allowed to be blunt.
 *   - **It is the only version that survives us being wrong about the
 *     detector.** Detection is best-effort; the handling is not.
 *
 * ## What is deliberately NOT in here
 *
 * **Criminal convictions and regulatory findings.** That is the product. An
 * attorney's disbarment is the single most important thing an audit can
 * surface, and GDPR Article 10 treats it separately from the Article 9
 * special categories for good reason. Suppressing it would not be privacy, it
 * would be the tool failing to do the one job it exists for. Risk handles
 * that material, carefully, with the allegation/finding distinction intact.
 *
 * ## What this is not
 *
 * A lexical filter is not a classifier. It cannot read context the way a
 * model can, it will miss euphemism and implication, and a miss is the
 * dangerous direction. It exists so the behaviour is real and testable now,
 * and so the interface an AI classifier has to satisfy is fixed before one is
 * wired in — the same reason `classify.ts` is rule-based today. See
 * `docs/OPEN_QUESTIONS.md` OQ-18. Nothing downstream may treat a clean
 * assessment as proof that a result holds no sensitive material.
 */
import type {
  SearchResult,
  SensitivityAssessment,
  SpecialCategory,
} from '../contracts/types.ts';

/**
 * Language that attributes a condition or affiliation to a person.
 *
 * The attributive requirement is what separates "Dr Adoni, oncologist" from
 * "Dr Adoni, who is being treated for cancer". A bare topic word is not
 * somebody's personal data — most of the time it is their specialism, their
 * beat, or their client's case. Requiring one of these alongside the topic
 * is what keeps a physician's own practice area out of the filter.
 */
const ATTRIBUTIVE = [
  'diagnosed with',
  'diagnosis of',
  'battling',
  'battled',
  'suffers from',
  'suffering from',
  'recovering from',
  'treated for',
  'underwent treatment',
  'his own',
  'her own',
  'their own',
  'opened up about',
  'spoke about his',
  'spoke about her',
  'revealed that',
  'came out as',
  'identifies as',
  'is a member of',
  'converted to',
  'practising',
  'practicing',
  'donated to',
  'campaigned for',
  'voted for',
  'applied for asylum',
  'deportation case',
  'visa status',
];

/**
 * Markers that the topic word is professional rather than personal.
 *
 * A physician's practice area, a journalist's beat and a lawyer's caseload
 * all put these words on the page without any of them being the person's own
 * special-category data. Present without an attributive phrase, they settle
 * the question in the professional direction.
 */
const PROFESSIONAL_CONTEXT = [
  'specialist',
  'specialises',
  'specializes',
  'consultant',
  'practice',
  'clinic',
  'department of',
  'professor',
  'lecturer',
  'research',
  'researcher',
  'study',
  'trial',
  'represents',
  'represented',
  'counsel for',
  'attorney for',
  'treats',
  'treating',
  'surgeon',
  'physician at',
  'reporter',
  'correspondent',
  'author of',
];

/**
 * Topic vocabulary per category.
 *
 * Deliberately short. A long list of conditions is a long list of ways to
 * flag a doctor's own specialism, and the cost of a miss here is paid by the
 * handling rule — we withhold on suspicion, and the source link survives — not
 * by making the vocabulary exhaustive.
 */
const TOPICS: Array<{ category: SpecialCategory; terms: string[] }> = [
  {
    category: 'health',
    terms: [
      'cancer', 'hiv', 'aids', 'diabetes', 'depression', 'bipolar',
      'schizophrenia', 'addiction', 'alcoholism', 'rehab', 'disability',
      'chemotherapy', 'mental health', 'psychiatric', 'terminal illness',
      'miscarriage', 'fertility treatment',
    ],
  },
  {
    category: 'religion',
    terms: [
      'muslim', 'islam', 'christian', 'catholic', 'protestant', 'jewish',
      'judaism', 'hindu', 'sikh', 'buddhist', 'atheist', 'evangelical',
      'mosque', 'synagogue', 'church member', 'congregation',
    ],
  },
  {
    category: 'political_opinion',
    terms: [
      'republican party', 'democratic party', 'labour party', 'conservative party',
      'political donation', 'campaign donation', 'party member', 'activist for',
      'political affiliation',
    ],
  },
  {
    category: 'sexual_orientation',
    terms: ['gay', 'lesbian', 'bisexual', 'transgender', 'lgbt', 'queer', 'same-sex'],
  },
  {
    category: 'racial_or_ethnic_origin',
    terms: ['ethnicity', 'ethnic origin', 'racial background', 'heritage', 'ancestry'],
  },
  {
    category: 'trade_union',
    terms: ['trade union', 'labor union', 'union member', 'union organiser', 'union organizer'],
  },
  {
    category: 'immigration_status',
    terms: [
      'asylum seeker', 'undocumented', 'green card', 'deportation',
      'immigration status', 'residency application', 'visa application',
    ],
  },
];

const norm = (s: string): string => s.toLowerCase();

/**
 * Assesses one result's text for special-category material.
 *
 * Pure, and takes the text rather than the record, so it can be reasoned
 * about and tested without building a scan around it.
 */
export function assessSensitivity(title: string, excerpt: string): SensitivityAssessment {
  const text = norm(`${title} ${excerpt}`);

  const attributive = ATTRIBUTIVE.filter((p) => text.includes(p));
  const professional = PROFESSIONAL_CONTEXT.filter((p) => text.includes(p));

  const categories: SpecialCategory[] = [];
  const signals: string[] = [];

  for (const { category, terms } of TOPICS) {
    if (!terms.some((t) => text.includes(t))) continue;

    /**
     * Language attributing the topic to the person settles it, whatever else
     * is on the page. "Diagnosed with" outranks "clinic".
     */
    if (attributive.length > 0) {
      categories.push(category);
      signals.push(`${category}: topic language with a phrase attributing it to the person`);
      continue;
    }

    /**
     * Professional framing with nothing attributing the topic to the person
     * is somebody's job, not their private life.
     *
     * This clears the physician whose specialism is cancer and the attorney
     * whose clients are asylum seekers. An earlier version treated
     * "asylum seeker" and "union member" as describing a person by
     * themselves, on the reasoning that those phrases name people rather
     * than subjects — which withheld an immigration lawyer's entire
     * practice. A whole profession, filtered out by a privacy control.
     *
     * Recorded rather than silently skipped: "we looked and decided no" is a
     * different statement from "we never looked", and only one of them can
     * be audited.
     */
    if (professional.length > 0) {
      signals.push(`${category}: topic language, but in a professional context`);
      continue;
    }

    /**
     * Topic, no attribution, no professional framing. Ambiguous — and
     * ambiguity resolves toward withholding, because the person keeps the
     * link either way and we do not keep a copy either way.
     */
    categories.push(category);
    signals.push(`${category}: topic language with no professional context to explain it`);
  }

  return {
    categories: [...new Set(categories)],
    signals,
    withhold: categories.length > 0,
  };
}

/** What a withheld title and excerpt are replaced with, verbatim. */
export const WITHHELD_TITLE = 'Withheld: see the source';
export const WITHHELD_EXCERPT =
  'This result appears to touch on personal information we do not store or repeat. ' +
  'It is still public at its source, and the link is above.';

/**
 * Convenience for the pipeline: assess a provider result.
 *
 * Kept beside the assessment rather than in `evidence.ts` so that everything
 * deciding what counts as sensitive lives in one file.
 */
export const assessResult = (result: SearchResult): SensitivityAssessment =>
  assessSensitivity(result.title, result.snippet);
