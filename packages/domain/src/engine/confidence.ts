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
 * Prominence-weighted over every record bearing the person's name, including
 * the ones we rejected.
 *
 * Averaging only the records that passed the bar would make this structurally
 * incapable of falling below the `probable` threshold, and the flag it feeds
 * would never fire. The question is "how sure are we which of these is you",
 * and the results we rejected are exactly what makes that uncertain.
 */
export function identityConfidence(records: EvidenceRecord[]): number {
  const named = records.filter((r) => r.identityConfidence > 0);
  if (named.length === 0) return 0;

  const weights = named.map((r) => prominence(r.position));
  const total = weights.reduce((s, w) => s + w, 0);

  if (total === 0) return meanOrNull(named.map((r) => r.identityConfidence)) ?? 0;

  return named.reduce((s, r, i) => s + r.identityConfidence * weights[i], 0) / total;
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

  const notes: string[] = [];
  if (band === 'low') {
    notes.push(
      'Several prominent results carrying your name may not be you. Confirming or rejecting them will change this report.'
    );
  } else if (band === 'moderate') {
    notes.push('Most results are attributable to you, but some need your confirmation.');
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
