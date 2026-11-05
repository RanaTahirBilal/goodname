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

/**
 * Who actually decides whether this gets done.
 *
 * The distinction that matters to somebody holding the report. Two
 * recommendations can be equally important and weeks apart in how long
 * they take, because one is a form the customer fills in this afternoon
 * and the other waits on an editor who has never heard of them.
 *
 * Reporting it is not a ranking of value. The weakest dimension is still
 * the weakest dimension; this says what can be started today.
 */
export type Control =
  /** Entirely theirs: a profile they own, a page on their own site. */
  | 'yours'
  /** Theirs to ask for, somebody else's to grant: corrections, removals. */
  | 'shared'
  /** Not theirs at all: whether a publication writes about them. */
  | 'not_yours';

export interface Recommendation {
  id: string;
  priority: 'now' | 'soon' | 'later';
  title: string;
  why: string;
  /** Evidence ids, where the recommendation came from evidence. */
  evidenceIds: string[];
  /** What this does not promise. Stated, not implied. */
  caveat?: string;
  /** Who decides whether it happens. */
  control: Control;
  /**
   * What tends to work for this *kind* of problem.
   *
   * Fixed per category and identical for every customer, like the meanings
   * in `findings.ts`. It is general professional practice, not an
   * observation about this person's results — which is exactly why it is
   * safe to state without having computed it.
   */
  how?: string;
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
      control: 'yours',
      how: 'Nobody else can settle this. The results are listed with what each one says, and two buttons.',
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
        control: 'shared',
        how: 'Accurate material you publish alongside it is the part you control. Whether a source amends anything is theirs.',
        caveat: 'We do not promise removal or suppression of accurate published findings.',
      });
    } else if (f.status === 'allegation') {
      out.push({
        id: `allegation-${f.evidenceId}`,
        priority: 'soon',
        title: `An unsettled claim is visible: ${f.headline}`,
        why: 'This is reported but not established. If it was resolved, a correction request to the source is usually the strongest option.',
        evidenceIds: [f.evidenceId],
        control: 'shared',
        how: 'A correction request works best when it is specific, documented and sent to the person who wrote it.',
        caveat: 'Whether a source corrects or updates a story is their decision, not ours.',
      });
    } else if (f.status === 'disputed') {
      out.push({
        id: `disputed-${f.evidenceId}`,
        priority: 'soon',
        title: `Sources disagree about: ${f.headline}`,
        why: 'We found contradictory coverage. Deciding which is accurate needs your input before anything is acted on.',
        evidenceIds: [f.evidenceId, ...(f.contradictingSources ? [] : [])],
        control: 'yours',
        how: 'Tell us which account is right. Until then we report the disagreement rather than picking a side.',
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
      control: 'shared',
      how: 'Each broker has its own opt-out. They are quick individually and there are a lot of them.',
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
        control: CONTROL[d.code],
        how: HOW[d.code],
        caveat: CAVEAT[d.code],
      });
    }
  } else {
    out.push({
      id: 'insufficient',
      priority: 'now',
      title: 'Give us a little more to work with',
      why: presence.whatWouldHelp.join(' '),
      evidenceIds: [],
      control: 'yours',
    });
  }

  /**
   * Priority first, then what can be started without anyone's permission.
   *
   * Importance and sequence are different questions, and sorting on one
   * answers the other badly. Earning independent coverage is often the
   * largest gap in a presence and is also the slowest thing on the list,
   * because it waits on an editor; completing a profile is smaller and
   * can be done this afternoon. Ordering by importance alone puts the
   * months-long item at the top of the page and the afternoon's work
   * underneath it, which is how a report that is right reads as useless.
   *
   * Priority still leads, so nothing urgent is demoted for being
   * inconvenient. Control only breaks ties inside a band.
   */
  const order = { now: 0, soon: 1, later: 2 };
  const reach: Record<Control, number> = { yours: 0, shared: 1, not_yours: 2 };

  return out.sort(
    (a, b) =>
      order[a.priority] - order[b.priority] || reach[a.control] - reach[b.control]
  );
}

/**
 * Who decides, per dimension.
 *
 * Source authority is the one that is not the customer's to settle: a
 * publication writes about somebody or it does not. Everything else is
 * theirs, which is why it is worth saying so rather than presenting five
 * equivalent-looking tasks.
 */
const CONTROL: Record<string, Control> = {
  D: 'yours',
  P: 'yours',
  C: 'yours',
  H: 'yours',
  A: 'not_yours',
};

/**
 * What tends to work, per dimension.
 *
 * General professional practice, identical for every customer. None of it
 * is derived from this person's results, and none of it promises an
 * outcome — it is the answer to "fine, but how", which a report that stops
 * at "earn independent coverage" leaves the reader to guess at.
 */
const HOW: Record<string, string> = {
  D: 'A page you own is the only source in a search result that you control outright. One is a large improvement over none.',
  P: 'The large professional networks and your field’s own directories are usually what a search for a name returns first, and they are yours to complete.',
  A: 'Coverage somebody chose to give you is what a reader, and an assistant reading over their shoulder, treats as independent. Speaking, writing and being quoted are the usual routes.',
  H: 'These are mechanical: a page that loads, says who it is about, and can be read by the crawlers that feed search results and assistants.',
  C: 'Pick one wording for your name, role, employer and city, then make every profile match it. Sources that disagree are what make an assistant hedge about you.',
};

/**
 * What each one does not promise, per dimension.
 *
 * `A` carries the ceiling the whole list sits under, and it is said on the
 * recommendation rather than in a footnote, because it is the thing a
 * customer most needs to hear before paying for anything.
 */
const CAVEAT: Record<string, string | undefined> = {
  D: 'A page nobody links to rarely ranks on its own. Publishing one is the floor, not the finish.',
  A: 'Nobody can promise coverage, and we do not. What can be prepared is the material and the reasons somebody would write about you.',
  P: undefined,
  H: undefined,
  C: undefined,
};

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
