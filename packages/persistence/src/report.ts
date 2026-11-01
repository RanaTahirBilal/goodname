/**
 * Reconstitutes a report from stored evidence.
 *
 * The three outputs are derived, so they are recomputed on read rather than
 * stored and served. Storing a rendered report would mean a customer decision
 * silently invalidates it, and the version they see depends on whether
 * anything happened to refresh a cache.
 *
 * Snapshots are still written on every scoring run, but as history — what the
 * score was, when, and why it changed — not as the source of truth for what
 * to display.
 */
import { rescore, type EvidenceRecord, type ScoredOutputs } from '@rep/domain';
import type { IdentityDecision, StoredScan } from './repository.ts';
import { applyReviewDecisions, type ReviewDecision } from './review.ts';

/**
 * Applies the customer's confirmations and rejections to the evidence.
 *
 * The customer is the authority on whether a result is about them, so a
 * decision overrides our estimate outright rather than nudging it. The
 * original confidence and the signals that produced it stay on the record,
 * so the report can still show why we were unsure.
 */
export function applyDecisions(
  evidence: EvidenceRecord[],
  decisions: IdentityDecision[]
): EvidenceRecord[] {
  if (decisions.length === 0) return evidence;

  const byId = new Map(decisions.map((d) => [d.evidenceId, d]));

  return evidence.map((e) => {
    const decision = byId.get(e.id);
    if (!decision) return e;

    const confirmed = decision.decision === 'confirmed';

    return {
      ...e,
      identityStatus: confirmed ? 'confirmed' : 'rejected',
      identityConfidence: confirmed ? 0.99 : 0,
      reviewStatus: confirmed ? 'customer_confirmed' : 'customer_rejected',
      identitySignals: [
        ...e.identitySignals,
        confirmed ? 'You confirmed this is you.' : 'You told us this is not you.',
      ],
    };
  });
}

export interface RebuiltReport extends ScoredOutputs {
  scanId: string;
  evidence: EvidenceRecord[];
  decisionCount: number;
  reviewCount: number;
}

export function rebuildReport(
  scan: StoredScan,
  options: {
    websiteChecks?: { key: string; passed: boolean }[];
    brokerAssessmentRan?: boolean;
    hasRichEntity?: boolean;
    /** Reviewer judgements on this scan, newest last. */
    reviews?: ReviewDecision[];
  } = {}
): RebuiltReport {
  /**
   * Order matters: a reviewer's judgement is applied first, then the
   * customer's. The customer is the authority on whether a result is about
   * them, so their "not me" stands even over a reviewer who upheld it.
   */
  const reviewed = applyReviewDecisions(scan.evidence, options.reviews ?? []);
  const evidence = applyDecisions(reviewed, scan.decisions);

  const scored = rescore({
    identity: scan.identity,
    evidence,
    websiteChecks: options.websiteChecks,
    brokerAssessmentRan: options.brokerAssessmentRan,
    hasRichEntity: options.hasRichEntity,
  });

  return {
    ...scored,
    scanId: scan.id,
    evidence,
    decisionCount: scan.decisions.length,
    reviewCount: options.reviews?.length ?? 0,
  };
}
