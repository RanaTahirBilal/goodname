/**
 * Output C — how much any of this can be relied on.
 *
 * Two different uncertainties, kept apart because they have different fixes:
 *
 *   - **Identity confidence**: is this the right person? Fixed by the customer
 *     confirming or rejecting results.
 *   - **Evidence coverage**: how much of the presence model we could evaluate.
 *     Fixed by connecting a website or more profiles.
 *
 * Reporting one number for both would tell a customer their report is "72%
 * reliable", which is not a thing they can do anything about.
 */
import type { ConfidenceReport, EvidenceRecord, SourceReliability } from '../contracts/types.ts';
import { prominence, meanOrNull } from './metrics.ts';

export const CONFIDENCE_BANDS = { high: 0.85, moderate: 0.6 } as const;

/**
 * How much of what we found is about this person, and how sure we are of
 * the part that is.
 *
 * Those are two questions and this used to answer only the second, which is
 * how a report could read "high" while five of its six results were
 * somebody else. The old version filtered on `identityConfidence > 0` —
 * intended to drop results that never bore the name, and in practice
 * dropping every result we had *rejected*, because a rejection scores
 * exactly zero. The average was then taken over the survivors, which is to
 * say over the matches, which is to say it could not fall. Its own comment
 * claimed the opposite; the filter was four lines below it.
 *
 *   share   = how much of the named evidence we could attribute
 *   quality = how sure we are of those attributions
 *
 * and the answer is the product, because both have to hold. One confident
 * match among five contradictions is not a confident report, and five
 * tentative matches with nothing against them is not one either.
 *
 * Prominence weights the share rather than the verdict. A wrong-person
 * result at position one contests more than one at position thirty, which
 * is a statement about how much it matters, not about whether it is them —
 * the distinction the old weighting lost.
 *
 * Unresolved results count against the share. They genuinely are
 * unresolved, and this is what gives the "Is this you?" prompt a purpose:
 * answering it moves the number, in whichever direction is true.
 */
export function identityConfidence(records: EvidenceRecord[]): number {
  const attributed = records.filter(
    (r) => r.identityStatus === 'confirmed' || r.identityStatus === 'probable'
  );
  if (attributed.length === 0) return 0;

  const weigh = (rs: EvidenceRecord[]) =>
    rs.reduce((s, r) => s + prominence(r.position), 0);

  const named = records.filter((r) =>
    ['confirmed', 'probable', 'uncertain', 'rejected'].includes(r.identityStatus)
  );

  const namedWeight = weigh(named);
  const attributedWeight = weigh(attributed);

  // Everything carries zero prominence only when nothing has a position at
  // all, which a provider can do. Counting by record is the honest
  // fallback: it is the same question with a blunter instrument.
  const share =
    namedWeight === 0
      ? attributed.length / Math.max(named.length, 1)
      : attributedWeight / namedWeight;

  const quality =
    attributedWeight === 0
      ? (meanOrNull(attributed.map((r) => r.identityConfidence)) ?? 0)
      : attributed.reduce(
          (s, r) => s + r.identityConfidence * prominence(r.position),
          0
        ) / attributedWeight;

  return share * quality;
}

const bandFor = (c: number): ConfidenceReport['band'] =>
  c >= CONFIDENCE_BANDS.high ? 'high' : c >= CONFIDENCE_BANDS.moderate ? 'moderate' : 'low';

const EMPTY_MIX: Record<SourceReliability, number> = {
  official: 0,
  high: 0,
  moderate: 0,
  low: 0,
  unknown: 0,
};

export function buildConfidence(
  allRecords: EvidenceRecord[],
  evidenceCoverage: number
): ConfidenceReport {
  const confidence = identityConfidence(allRecords);
  const band = bandFor(confidence);

  const attributed = allRecords.filter(
    (r) => r.identityStatus === 'confirmed' || r.identityStatus === 'probable'
  );
  const awaiting = allRecords.filter(
    (r) => r.identityStatus === 'uncertain' || r.identityStatus === 'probable'
  );
  const rejected = allRecords.filter((r) => r.identityStatus === 'rejected');

  const mix = { ...EMPTY_MIX };
  for (const r of attributed) mix[r.sourceReliability]++;

  /**
   * Which of the two things went wrong, not merely that something did.
   *
   * The band is a share times a quality, so a low one has two quite
   * different causes and they call for different actions. Most of the
   * evidence being somebody else's is not a thing the customer can fix by
   * confirming anything, and telling them to confirm results would be
   * advice that cannot work. A few unresolved ones is exactly what they
   * can fix, in about a minute.
   */
  const notes: string[] = [];
  const contested = rejected.length;
  const unresolved = allRecords.filter((r) => r.identityStatus === 'uncertain').length;

  if (attributed.length === 0 && unresolved === 0) {
    // Nothing attributed and nothing to ask about: the only honest message,
    // and there is no action to offer with it.
    notes.push(
      'Nothing we found is attributable to you, so there is no report to be confident about yet.'
    );
  } else if (attributed.length === 0) {
    /**
     * Nothing attributed *yet*, but results are waiting on an answer.
     *
     * The bleak note above fits the arithmetic here and is the wrong thing
     * to say: there is something the customer can do, it takes a minute,
     * and it is the whole reason the "Is this you?" prompt exists. Telling
     * somebody their report is empty when a question of theirs would fill
     * it is accurate and useless.
     */
    notes.push(
      'Several prominent results carrying your name may not be you. Confirming or rejecting them will change this report.'
    );
  } else if (band === 'low' && contested > attributed.length) {
    notes.push(
      `Most of what we found is about somebody else: ${contested} of these results are not you. ` +
        (attributed.length === 1
          ? 'The figures here are built from the one that is.'
          : `The figures here are built from the ${attributed.length} that are.`)
    );
  } else if (band === 'low') {
    notes.push(
      'Several prominent results carrying your name may not be you. Confirming or rejecting them will change this report.'
    );
  } else if (band === 'moderate') {
    /**
     * Counted the way the figures beside it are counted.
     *
     * `awaiting` is uncertain *and* probable — a probable match is in the
     * score and still worth asking about — and it is the number the report
     * prints as "Need confirming". Saying a different one in the sentence
     * directly above that figure would read as an arithmetic error.
     */
    /**
     * What answering actually does, which is not always what it said.
     *
     * The sentence was "answering moves this figure", and the figure
     * printed beside it is the attribution count. A `probable` match is
     * already inside that count, so confirming one cannot move it: the
     * customer answers, nothing visibly changes, and the report has made a
     * small promise it could not keep on the screen where it is asking
     * them to trust its arithmetic.
     *
     * `uncertain` results are outside the count and do move it. So the two
     * cases are told apart, and where only probables are waiting the
     * sentence says the true and still useful thing: answering does not
     * change who is counted, it changes how sure the count is.
     */
    const movable = awaiting.filter((r) => r.identityStatus === 'uncertain').length;

    notes.push(
      awaiting.length === 0
        ? 'Most results are attributable to you, but some need your confirmation.'
        : movable > 0
          ? `Most results are attributable to you. ${awaiting.length} still need your confirmation, and answering moves this figure.`
          : `Most results are attributable to you. ${awaiting.length} ${awaiting.length === 1 ? 'is' : 'are'} already counted here and still worth confirming: answering will not change the count, it will change how sure of it we are.`
    );
  } else {
    notes.push('The results are confidently attributable to you.');
  }

  if (evidenceCoverage < 1) {
    notes.push(
      `We could evaluate ${Math.round(evidenceCoverage * 100)}% of the presence model with the evidence available.`
    );
  }

  return {
    identityConfidence: confidence,
    band,
    attributed: attributed.length,
    awaitingConfirmation: awaiting.length,
    rejected: rejected.length,
    evidenceCoverage,
    sourceReliabilityMix: mix,
    needsHumanReview: allRecords
      .filter((r) => r.reviewStatus === 'needs_human_review')
      .map((r) => r.id),
    note: notes.join(' '),
  };
}
