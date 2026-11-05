/**
 * Briefing findings.
 *
 * The report wants to open with a few sentences about what the audit found,
 * in the reader's language rather than the model's. The tempting way to get
 * them is to write the sentences in the interface from whatever numbers are
 * to hand — "almost everything findable about you, you published" reads well
 * and is a conclusion nobody computed.
 *
 * So findings are derived here, under three rules:
 *
 *   1. **A finding exists only when its inputs do.** Each one names the
 *      engine output that justifies it. No input, no finding — there is no
 *      filler, and an audit that produced nothing worth saying says nothing.
 *   2. **The detail is the engine's own words.** `detail` is copied from a
 *      dimension explanation, a risk rationale or the confidence note. This
 *      module does not paraphrase them into a claim.
 *   3. **The meaning is about the category, not the person.** `meaning` is
 *      one fixed sentence per kind, the same for every customer who trips
 *      it. It explains what this *kind* of finding implies, which is a
 *      product statement we can stand behind, rather than an interpretation
 *      of an individual's situation that nothing computed.
 *
 * Everything carries `evidenceIds` and `recommendationIds`, so a reader who
 * asks "why are you telling me this, and what do I do about it" can be
 * answered by following a link rather than by trusting the sentence.
 */
import type {
  ConfidenceReport,
  PresenceScore,
  RiskAssessment,
} from '../contracts/types.ts';
import type { Recommendation } from './recommend.ts';

export type FindingKind =
  | 'identity_unresolved'
  | 'established_finding'
  | 'unsettled_allegation'
  | 'privacy_exposure'
  | 'dimension_weak'
  | 'coverage_limited';

export type FindingSeverity = 'priority' | 'attention' | 'info';

export interface BriefingFinding {
  id: string;
  kind: FindingKind;
  severity: FindingSeverity;
  /** One line, in the reader's language. Derived, never interpreted. */
  headline: string;
  /** The engine's own explanation, carried verbatim. */
  detail: string;
  /** What this kind of finding implies. Fixed per kind. */
  meaning: string;
  evidenceIds: string[];
  recommendationIds: string[];
}

/**
 * The line below which a dimension is worth mentioning on its own.
 *
 * A provisional product rule, not a validated threshold — the same standing
 * as the 55% coverage floor, and recorded in `docs/OPEN_QUESTIONS.md` as
 * needing the same sign-off. It is a constant rather than a literal so that
 * when somebody does validate it, there is one place to change.
 */
export const DIMENSION_ATTENTION = 0.5;

/** How many narrative findings the briefing shows before it summarises. */
export const NARRATIVE_FINDINGS = 3;

/**
 * What each kind of finding means, said once.
 *
 * These are statements about the category. "Material you published yourself
 * is easier to change and counts for less with a sceptical reader" is true
 * of owned sources generally; it is not a claim about this customer, and
 * that is exactly why it is safe to render without having computed it.
 */
const MEANING: Record<FindingKind, string> = {
  identity_unresolved:
    'A name match is not an identity match. Until you tell us, these results are kept out of every figure here, and the report is calculated as though they are not yours.',
  established_finding:
    'An established finding is rarely removable, and we do not promise to remove it. The realistic work is accurate material around it, so a reader sees the whole picture rather than one page.',
  unsettled_allegation:
    'An allegation is a claim somebody made, not something we have established. It is reported as what it is, and a single source never becomes a finding on its own.',
  privacy_exposure:
    'Broker listings republish personal details from public records. They are reported because the exposure is the thing worth knowing about, not because the material itself is a reputation problem.',
  dimension_weak:
    'A low dimension is the part of your presence with the most room in it. It does not mean something is wrong; it means there is less there than the model expects.',
  coverage_limited:
    'Less evidence means a less settled number. The score will move as more of it arrives, which is why we say how much of the model we could evaluate rather than presenting one figure as final.',
};

/** Recommendations whose evidence overlaps a finding, so the two can be linked. */
const linkedRecommendations = (
  recommendations: Recommendation[],
  evidenceIds: string[],
  ids: string[]
): string[] =>
  recommendations
    .filter(
      (r) =>
        ids.includes(r.id) || r.evidenceIds.some((e) => evidenceIds.includes(e))
    )
    .map((r) => r.id);

/**
 * Ordered by what the reader should deal with first.
 *
 * Identity leads, because every other figure is conditional on the report
 * being about the right person. Then what is being said about them, then
 * what is thin. Severity breaks ties within that order.
 */
const KIND_ORDER: FindingKind[] = [
  'identity_unresolved',
  'established_finding',
  'unsettled_allegation',
  'privacy_exposure',
  'coverage_limited',
  'dimension_weak',
];

const SEVERITY_ORDER: FindingSeverity[] = ['priority', 'attention', 'info'];

export function buildFindings(
  presence: PresenceScore,
  risk: RiskAssessment,
  confidence: ConfidenceReport,
  recommendations: Recommendation[]
): BriefingFinding[] {
  const out: BriefingFinding[] = [];

  /* ------------------------------------------------------------ identity */

  if (confidence.awaitingConfirmation > 0) {
    const n = confidence.awaitingConfirmation;
    out.push({
      id: 'identity-unresolved',
      kind: 'identity_unresolved',
      severity: confidence.band === 'low' ? 'priority' : 'attention',
      headline: `${n} result${n === 1 ? '' : 's'} carr${n === 1 ? 'ies' : 'y'} your name and may not be you`,
      detail: confidence.note,
      meaning: MEANING.identity_unresolved,
      evidenceIds: [],
      recommendationIds: linkedRecommendations(recommendations, [], [
        'confirm-identity',
      ]),
    });
  }

  /* ---------------------------------------------------------------- risk */

  for (const f of risk.findings) {
    const kind: FindingKind =
      f.status === 'confirmed_finding' ? 'established_finding' : 'unsettled_allegation';

    // Only the two settled states get a finding. `uncertain` means the
    // classifier abstained, and an abstention is not something to tell a
    // customer about themselves.
    if (f.status !== 'confirmed_finding' && f.status !== 'allegation') continue;

    out.push({
      id: `risk-${f.evidenceId}`,
      kind,
      severity: kind === 'established_finding' ? 'priority' : 'attention',
      headline: f.headline,
      // The engine's own severity rationale, not a sentence written here.
      detail: f.severityRationale,
      meaning: MEANING[kind],
      evidenceIds: [f.evidenceId],
      recommendationIds: linkedRecommendations(recommendations, [f.evidenceId], []),
    });
  }

  if (risk.privacy.level !== 'none') {
    out.push({
      id: 'privacy-exposure',
      kind: 'privacy_exposure',
      severity: 'attention',
      headline: 'Personal details are listed by data brokers',
      detail: risk.privacy.note,
      meaning: MEANING.privacy_exposure,
      evidenceIds: risk.privacy.evidenceIds,
      recommendationIds: linkedRecommendations(
        recommendations,
        risk.privacy.evidenceIds,
        ['privacy-exposure']
      ),
    });
  }

  /* ------------------------------------------------------------ presence */

  if (presence.status === 'insufficient_evidence') {
    out.push({
      id: 'coverage-limited',
      kind: 'coverage_limited',
      severity: 'priority',
      headline: 'There was not enough evidence to produce a score',
      detail: `We could evaluate ${Math.round(presence.coverage * 100)}% of the model.`,
      meaning: MEANING.coverage_limited,
      evidenceIds: [],
      recommendationIds: [],
    });
  } else {
    for (const d of presence.dimensions) {
      if (!d.applicable || d.value === null) continue;
      if (d.value >= DIMENSION_ATTENTION) continue;

      out.push({
        id: `dimension-${d.code}`,
        kind: 'dimension_weak',
        severity: 'attention',
        headline: `${d.label} is the thinnest part of your presence`,
        // The engine's own sentence for this dimension, not a rewrite of it.
        detail: d.explanation,
        meaning: MEANING.dimension_weak,
        evidenceIds: d.evidenceIds,
        recommendationIds: linkedRecommendations(recommendations, d.evidenceIds, []),
      });
    }

    if (presence.coverage < 1) {
      out.push({
        id: 'coverage-partial',
        kind: 'coverage_limited',
        severity: 'info',
        headline: `${Math.round(presence.coverage * 100)}% of the model could be evaluated`,
        detail: `${presence.dimensions.filter((d) => !d.applicable).length} dimension(s) had nothing to assess and were left out rather than counted as zero.`,
        meaning: MEANING.coverage_limited,
        evidenceIds: [],
        recommendationIds: [],
      });
    }
  }

  return out.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );
}

/**
 * The split the briefing renders: a few at length, the rest listed.
 *
 * Three editorial chapters look considered. Twelve of them is a document
 * nobody finishes, and padding a quiet audit up to three is the invention
 * this module exists to prevent — so `narrative` is however many of the
 * first three actually exist, and `remaining` is everything after them.
 */
export function splitFindings(findings: BriefingFinding[]): {
  narrative: BriefingFinding[];
  remaining: BriefingFinding[];
} {
  return {
    narrative: findings.slice(0, NARRATIVE_FINDINGS),
    remaining: findings.slice(NARRATIVE_FINDINGS),
  };
}
