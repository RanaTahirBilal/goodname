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
import {
  rescore,
  type EvidenceRecord,
  type PresenceScore,
  type RiskAssessment,
  type ScoredOutputs,
} from '@rep/domain';
import type { AccountScope as Scope, IdentityDecision, StoredScan } from './repository.ts';
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

/* --------------------------------------------- assessments over time */

export interface Reassessment {
  /** The methodology that produced the number the customer last saw. */
  from: string;
  to: string;
  previousScore: number | null;
  currentScore: number | null;
  previousAt: string;
  reason: string;
}

/**
 * Keeps the snapshot history honest about a report that is rebuilt on read.
 *
 * There are three versions of the truth in this system and they are not
 * always the same one:
 *
 *   1. the evidence and decisions as they stood when the audit ran,
 *   2. what the current engine makes of that evidence,
 *   3. the report somebody is looking at now.
 *
 * Rule 16d says derived outputs are recomputed on read, and that is right
 * while a scan is live — a customer answering "this is not me" has to change
 * the number straight away, and a stored report would go stale the moment
 * they did. A durable report route is what exposes the other half: reopen an
 * audit from March after the scoring engine has changed, and (3) silently
 * stops matching what (1) ever produced. The date on the page still says
 * March. For a product that assesses someone's professional reputation,
 * a number changing under an old date with no new evidence is not a
 * refinement, it is a different claim wearing the same timestamp.
 *
 * So the recomputation stays, and every divergence from the last recorded
 * assessment becomes an event. The snapshot table is append-only (rule 16c),
 * which means the history can carry this without anything being rewritten:
 * the old number keeps its date and its methodology version, the new one
 * gets its own row and a reason, and the report can show that a
 * reassessment happened rather than quietly presenting the result of one.
 *
 * Returns what changed, or null when nothing did — which is the common case
 * and costs one read.
 */
export function reconcileAssessment(
  repo: {
    presenceHistory: (
      scope: Scope,
      scanId: string
    ) => Array<{
      score: number | null;
      coverage: number;
      methodologyVersion: string;
      computedAt: string;
      reason: string;
    }>;
    savePresence: (scope: Scope, scanId: string, presence: PresenceScore, reason: string) => void;
    saveRisk: (scope: Scope, scanId: string, risk: RiskAssessment, reason: string) => void;
  },
  scope: Scope,
  scanId: string,
  rebuilt: { presence: PresenceScore; risk: RiskAssessment }
): Reassessment | null {
  const history = repo.presenceHistory(scope, scanId);
  const last = history[0];

  // No history at all: nothing to diverge from. The scan's own scoring run
  // writes the first row, and a scan with none is not something to fix here.
  if (!last) return null;

  const currentScore = rebuilt.presence.status === 'scored' ? rebuilt.presence.score : null;
  const versionChanged = last.methodologyVersion !== rebuilt.presence.methodologyVersion;
  const scoreChanged = last.score !== currentScore;

  if (!versionChanged && !scoreChanged) return null;

  /**
   * Why it moved, in the words the customer will read.
   *
   * A methodology change is the one worth naming explicitly: it is the only
   * reason a number moves with no new evidence and no decision by anybody,
   * and it is the one a reader would otherwise assume could not happen.
   */
  const reason = versionChanged
    ? `methodology ${last.methodologyVersion} → ${rebuilt.presence.methodologyVersion}`
    : 'recomputed from the evidence as it now stands';

  repo.savePresence(scope, scanId, rebuilt.presence, reason);
  repo.saveRisk(scope, scanId, rebuilt.risk, reason);

  return {
    from: last.methodologyVersion,
    to: rebuilt.presence.methodologyVersion,
    previousScore: last.score,
    currentScore,
    previousAt: last.computedAt,
    reason,
  };
}
