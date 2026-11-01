/**
 * Prioritised recommendations.
 *
 * Every recommendation names the evidence that prompted it. A suggestion with
 * no evidence behind it is a guess, and at these prices a customer is
 * entitled to ask "why are you telling me this?" and get an answer.
 *
 * Nothing here promises an outcome. We can say what is missing and what is
 * worth doing; we cannot promise a ranking, a removal or a score.
 */
import type {
  ConfidenceReport,
  PresenceScore,
  RiskAssessment,
} from '../contracts/types.ts';

export interface Recommendation {
  id: string;
  priority: 'now' | 'soon' | 'later';
  title: string;
  why: string;
  /** Evidence ids, where the recommendation came from evidence. */
  evidenceIds: string[];
  /** What this does not promise. Stated, not implied. */
  caveat?: string;
}

export function recommend(
  presence: PresenceScore,
  risk: RiskAssessment,
  confidence: ConfidenceReport
): Recommendation[] {
  const out: Recommendation[] = [];

  // Identity first. Every other number is conditional on it being the right
  // person, so a low-confidence report is not worth acting on yet.
  if (confidence.band === 'low' && confidence.awaitingConfirmation > 0) {
    out.push({
      id: 'confirm-identity',
      priority: 'now',
      title: `Confirm or reject ${confidence.awaitingConfirmation} result${confidence.awaitingConfirmation > 1 ? 's' : ''}`,
      why: 'Several prominent results carry your name but may be someone else. Until you tell us, the rest of this report is provisional.',
      evidenceIds: [],
    });
  }

  for (const f of risk.findings) {
    if (f.status === 'confirmed_finding') {
      out.push({
        id: `review-${f.evidenceId}`,
        priority: 'now',
        title: `Review an established finding: ${f.headline}`,
        why: `${f.sourceName} carries this, and it ranks prominently. Established findings are rarely removable, so the realistic work is building accurate material around it.`,
        evidenceIds: [f.evidenceId],
        caveat: 'We do not promise removal or suppression of accurate published findings.',
      });
    } else if (f.status === 'allegation') {
      out.push({
        id: `allegation-${f.evidenceId}`,
        priority: 'soon',
        title: `An unsettled claim is visible: ${f.headline}`,
        why: 'This is reported but not established. If it was resolved, a correction request to the source is usually the strongest option.',
        evidenceIds: [f.evidenceId],
        caveat: 'Whether a source corrects or updates a story is their decision, not ours.',
      });
    } else if (f.status === 'disputed') {
      out.push({
        id: `disputed-${f.evidenceId}`,
        priority: 'soon',
        title: `Sources disagree about: ${f.headline}`,
        why: 'We found contradictory coverage. Deciding which is accurate needs your input before anything is acted on.',
        evidenceIds: [f.evidenceId, ...(f.contradictingSources ? [] : [])],
      });
    }
  }

  if (risk.privacy.level === 'elevated' || risk.privacy.level === 'high') {
    out.push({
      id: 'privacy-exposure',
      priority: 'soon',
      title: `Remove ${risk.privacy.exposedListings} data-broker listings`,
      why: risk.privacy.note,
      evidenceIds: risk.privacy.evidenceIds,
      caveat: 'Brokers re-list. Removal is ongoing work, not a one-time fix.',
    });
  }

  if (presence.status === 'scored') {
    const weak = presence.dimensions
      .filter((d) => d.applicable && (d.value as number) < 0.6)
      .sort((a, b) => (a.value as number) - (b.value as number));

    for (const d of weak.slice(0, 3)) {
      out.push({
        id: `presence-${d.code}`,
        priority: d.weight >= 0.24 ? 'soon' : 'later',
        title: titleFor(d.code),
        why: d.explanation,
        evidenceIds: d.evidenceIds,
      });
    }
  } else {
    out.push({
      id: 'insufficient',
      priority: 'now',
      title: 'Give us a little more to work with',
      why: presence.whatWouldHelp.join(' '),
      evidenceIds: [],
    });
  }

  const order = { now: 0, soon: 1, later: 2 };
  return out.sort((a, b) => order[a.priority] - order[b.priority]);
}

const titleFor = (code: string): string => {
  switch (code) {
    case 'D':
      return 'Publish pages you control for your own name';
    case 'P':
      return 'Complete the professional profiles you are missing';
    case 'A':
      return 'Earn independent coverage from credible sources';
    case 'H':
      return 'Fix the technical problems on your website';
    case 'C':
      return 'Make your details consistent across profiles';
    default:
      return 'Improve your professional presence';
  }
};
