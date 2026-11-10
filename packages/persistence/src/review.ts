/**
 * The human review queue.
 *
 * Evidence gets flagged `needs_human_review` when it could damage someone or
 * when we are not certain it is them. Until now nothing consumed that flag,
 * which `docs/SAFEGUARDS.md` lists as a blocker on showing findings to paying
 * customers. This is what consumes it.
 *
 * ## The access rule
 *
 * Reviewing is the only operation in this system that crosses the account
 * boundary, so it is the one place the usual protection — every query scoped
 * to an account — cannot apply. What replaces it:
 *
 *   - A reviewer can read **only records flagged for review**. There is no
 *     method here that returns an account, a scan, or a customer's other
 *     evidence. The narrowness is in the API, not in a reviewer's restraint.
 *   - Every read is logged against the reviewer, not just every decision. A
 *     log of decisions alone misses someone who read fifty records and
 *     decided nothing, which is the access pattern worth noticing.
 *   - A decision without a written rationale is refused. A judgement that
 *     moves somebody's risk level and says nothing about why cannot be
 *     reviewed by anyone else.
 */
import type { EvidenceRecord, ReviewOutcome, ReviewStatus } from '@rep/domain';
import { type Db, newId, transaction } from './db.ts';
import { recordEvent } from './events.ts';

export type StaffRole = 'reviewer' | 'admin';

export interface Staff {
  id: string;
  email: string;
  role: StaffRole;
  createdAt: string;
}

/** Proof the caller is acting as a named, active member of staff. */
export interface ReviewerScope {
  reviewerId: string;
  role: StaffRole;
}

export interface QueueItem {
  evidenceId: string;
  scanId: string;
  accountId: string;
  title: string;
  excerpt: string;
  sourceName: string;
  sourceUrl: string;
  classification: string;
  findingStatus?: string;
  severity?: number;
  severityRationale?: string;
  identityConfidence: number;
  identityStatus: string;
  sourceReliability: string;
  retrievedAt: string;
  /** Why it is in the queue at all, in words. */
  flaggedBecause: string;
}

export interface ReviewDecision {
  id: string;
  scanId: string;
  evidenceId: string;
  reviewerId: string;
  outcome: ReviewOutcome;
  rationale: string;
  decidedAt: string;
  /**
   * Set when this judgement was made on an earlier scan and is being
   * applied to a later one, because the source and its text are unchanged.
   *
   * Carried rather than copied: there is still exactly one decision row,
   * made once by a named person on a particular day, and this says which
   * scan they were looking at. A report that presented it as a fresh
   * judgement would be inventing a review that never happened.
   */
  carriedFromScanId?: string;
}

/** The review status an outcome leaves on the record. */
export const STATUS_FOR_OUTCOME: Record<ReviewOutcome, ReviewStatus> = {
  uphold: 'reviewer_upheld',
  downgrade_to_allegation: 'reviewer_downgraded',
  reject_not_this_person: 'reviewer_rejected',
  reject_not_harm: 'reviewer_rejected',
};

const MIN_RATIONALE = 10;

/** Finding statuses that put a record in front of a person on their own. */
const ADVERSE = `('confirmed_finding','requires_review','allegation','disputed')`;

/**
 * Records queued only because we were unsure they were the customer, where
 * the customer has since told us.
 *
 * The first fulfillment rehearsal timed one engagement: three records
 * reached the review queue, and two of them had already been answered by the
 * customer on her own report — she had pressed "This is me" on both — and
 * were still being shown to a reviewer under the words "we are not certain
 * this result is about the customer". Two thirds of the review minutes in
 * that engagement went on a question that was settled before the reviewer
 * opened it.
 *
 * It is not only wasted time. Reviewing is the one operation in this system
 * that crosses the account boundary (rule 16o), so each of those was a
 * logged crossing that did not need to happen, and the access log is
 * supposed to mean something.
 *
 * The customer is the authority on whether a result is about them, so their
 * answer closes that question outright. It closes *only* that question: a
 * record carrying adverse language stays in the queue however confidently
 * they claim it, because "yes that is me" is not a judgement about what the
 * source says.
 */
/**
 * The same source and the same words, judged on an earlier scan.
 *
 * Without this the re-run puts every already-decided record back in front
 * of a person: the decision is keyed to a scan, and a re-audit makes a new
 * one. The second rehearsal measured it at three records re-queued out of
 * three, which is the entire queue doing work that was already done.
 *
 * Matched on url and excerpt together, within the account. If the page has
 * been rewritten since, the earlier judgement was about text that is no
 * longer there, so it comes back for review. That is the conservative
 * direction, and the direction a reviewer would want.
 */
const ALREADY_JUDGED_ELSEWHERE = `
  EXISTS (
    SELECT 1
      FROM review_decisions d
      JOIN evidence theirs
        ON theirs.scan_id = d.scan_id AND theirs.id = d.evidence_id
     WHERE d.account_id = e.account_id
       AND d.scan_id <> e.scan_id
       AND theirs.source_url = e.source_url
       AND theirs.excerpt    = e.excerpt
  )
`;

const ONLY_IDENTITY_AND_CUSTOMER_ANSWERED = `
  EXISTS (
    SELECT 1 FROM identity_decisions c
     WHERE c.scan_id = e.scan_id AND c.evidence_id = e.id
  )
  AND (e.finding_status IS NULL OR e.finding_status NOT IN ${ADVERSE})
`;

export class ReviewRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /* ---------------------------------------------------------- staff */

  createStaff(email: string, role: StaffRole): Staff {
    const staff: Staff = {
      id: newId('staff'),
      email: email.trim().toLowerCase(),
      role,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare('INSERT INTO staff (id, email, role, created_at) VALUES (?, ?, ?, ?)')
      .run(staff.id, staff.email, staff.role, staff.createdAt);

    return staff;
  }

  /** Resolves an active member of staff. A disabled one is nobody. */
  scopeFor(staffId: string): ReviewerScope | null {
    const row = this.db
      .prepare('SELECT id, role FROM staff WHERE id = ? AND disabled_at IS NULL')
      .get(staffId) as { id: string; role: StaffRole } | undefined;

    return row ? { reviewerId: row.id, role: row.role } : null;
  }

  /**
   * Takes someone's access away.
   *
   * Their live sessions go with them, in the same transaction. A session
   * outliving the decision to remove access is the same bug as not removing
   * it — the rule already written down for account deletion (16i), applied to
   * the one role that can read across accounts.
   *
   * `StaffAuthRepository.scopeForSession` also requires an active staff row,
   * so this is the half that can be forgotten without consequence rather
   * than the half that is load-bearing.
   */
  disableStaff(staffId: string): void {
    const now = new Date().toISOString();

    transaction(this.db, () => {
      this.db.prepare('UPDATE staff SET disabled_at = ? WHERE id = ?').run(now, staffId);
      this.db
        .prepare(
          'UPDATE staff_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL'
        )
        .run(now, staffId);
    });
  }

  /* ---------------------------------------------------------- queue */

  /**
   * The records awaiting a human, oldest first.
   *
   * Returns flagged evidence and nothing else — no account details, no
   * sibling results, no customer identity beyond what is already in the
   * record being judged. A reviewer deciding whether a disbarment notice
   * is the right Jensen Adoni does not need their billing history.
   */
  queue(scope: ReviewerScope, limit = 50): QueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, s.id AS scan_id
           FROM evidence e
           JOIN scans s ON s.id = e.scan_id
          WHERE e.review_status = 'needs_human_review'
            AND NOT EXISTS (
              SELECT 1 FROM review_decisions d
               WHERE d.scan_id = e.scan_id AND d.evidence_id = e.id
            )
            AND NOT (${ALREADY_JUDGED_ELSEWHERE})
            AND NOT (${ONLY_IDENTITY_AND_CUSTOMER_ANSWERED})
          ORDER BY e.retrieved_at
          LIMIT ?`
      )
      .all(limit);

    const items = rows.map((raw) => {
      const e = raw as Record<string, unknown>;
      return {
        evidenceId: String(e.id),
        scanId: String(e.scan_id),
        accountId: String(e.account_id),
        title: String(e.title),
        excerpt: String(e.excerpt),
        sourceName: String(e.source_name),
        sourceUrl: String(e.source_url),
        classification: String(e.classification),
        findingStatus: (e.finding_status as string) ?? undefined,
        severity: e.severity === null ? undefined : Number(e.severity),
        severityRationale: (e.severity_rationale as string) ?? undefined,
        identityConfidence: Number(e.identity_confidence),
        identityStatus: String(e.identity_status),
        sourceReliability: String(e.source_reliability),
        retrievedAt: String(e.retrieved_at),
        flaggedBecause: explainFlag(
          e.finding_status as string | null,
          String(e.identity_status)
        ),
      };
    });

    for (const item of items) {
      this.logAccess(scope, item.accountId, item.scanId, item.evidenceId, 'listed');
    }

    return items;
  }

  /** How many are waiting. Safe to show on a dashboard; names nobody. */
  pendingCount(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM evidence e
          WHERE e.review_status = 'needs_human_review'
            AND NOT EXISTS (
              SELECT 1 FROM review_decisions d
               WHERE d.scan_id = e.scan_id AND d.evidence_id = e.id
            )
            AND NOT (${ALREADY_JUDGED_ELSEWHERE})
            AND NOT (${ONLY_IDENTITY_AND_CUSTOMER_ANSWERED})`
      )
      .get();
    return Number((row as { n: number }).n);
  }

  /* ------------------------------------------------------- deciding */

  /**
   * Records a reviewer's judgement and applies it to the record.
   *
   * The decision row and the evidence update happen together: a decision
   * that did not take effect, or a record changed with no decision behind
   * it, are both states nobody could explain later.
   */
  decide(
    scope: ReviewerScope,
    scanId: string,
    evidenceId: string,
    outcome: ReviewOutcome,
    rationale: string
  ): void {
    const reason = rationale.trim();
    if (reason.length < MIN_RATIONALE) {
      throw new Error(
        'A review decision needs a written reason. It changes what a customer is told about themselves.'
      );
    }

    const row = this.db
      .prepare('SELECT account_id, finding_status FROM evidence WHERE scan_id = ? AND id = ?')
      .get(scanId, evidenceId) as
      | { account_id: string; finding_status: string | null }
      | undefined;

    if (!row) throw new Error('Evidence not found.');

    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO review_decisions
             (id, scan_id, account_id, evidence_id, reviewer_id, outcome, rationale, decided_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId('rev'),
          scanId,
          row.account_id,
          evidenceId,
          scope.reviewerId,
          outcome,
          reason,
          new Date().toISOString()
        );

      this.logAccess(scope, row.account_id, scanId, evidenceId, `decided:${outcome}`);

      recordEvent(this.db, {
        accountId: row.account_id,
        actor: `reviewer:${scope.reviewerId}`,
        action: 'evidence.reviewed',
        subjectType: 'evidence',
        subjectId: evidenceId,
        // The rationale is deliberately not copied here. It lives in
        // review_decisions; duplicating it would put the same judgement in
        // two places with two retention stories.
        metadata: { scanId, outcome },
      });
    });
  }

  /** Decisions made on one scan, newest first. */
  decisionsFor(scanId: string): ReviewDecision[] {
    return this.db
      .prepare(
        `SELECT id, scan_id, evidence_id, reviewer_id, outcome, rationale, decided_at
           FROM review_decisions WHERE scan_id = ?
          ORDER BY decided_at DESC, rowid DESC`
      )
      .all(scanId)
      .map((raw) => {
        const d = raw as Record<string, string>;
        return {
          id: d.id,
          scanId: d.scan_id,
          evidenceId: d.evidence_id,
          reviewerId: d.reviewer_id,
          outcome: d.outcome as ReviewOutcome,
          rationale: d.rationale,
          decidedAt: d.decided_at,
        };
      });
  }

  /**
   * Judgements made on an earlier scan that still apply to this one.
   *
   * The second fulfillment rehearsal found that re-running an audit
   * re-queued every record a reviewer had already decided. Decisions are
   * keyed on `(scan_id, evidence_id)`, which is right — a decision is about
   * one record in one scan — but the consequence was that the same
   * classifier error went back in front of a person on every re-audit, for
   * ever, and the customer's report lost a judgement that had been made
   * about them in writing.
   *
   * ## What makes two records the same record
   *
   * The source URL **and** the excerpt, within one account. The URL alone
   * is not enough: a reviewer read a particular sentence and decided what
   * it established, and if the page has since been rewritten then the
   * judgement was about text that is no longer there. Requiring the excerpt
   * to match means a changed source goes back to a human, which is the
   * conservative direction and the only one worth defaulting to.
   *
   * ## What this is not
   *
   * Not a new decision, and not a copy of one. The row stays where it was,
   * made once by a named person on a stated day; this maps it onto the
   * later scan's evidence id and marks it as carried, so the report can say
   * a prior judgement is being applied rather than implying somebody looked
   * again this morning.
   */
  carriedDecisions(accountId: string, scanId: string): ReviewDecision[] {
    return this.db
      .prepare(
        `SELECT d.id, d.scan_id, mine.id AS evidence_id, d.reviewer_id,
                d.outcome, d.rationale, d.decided_at
           FROM review_decisions d
           JOIN evidence theirs
             ON theirs.scan_id = d.scan_id AND theirs.id = d.evidence_id
           JOIN evidence mine
             ON mine.account_id = theirs.account_id
            AND mine.source_url = theirs.source_url
            AND mine.excerpt    = theirs.excerpt
          WHERE d.account_id = ?
            AND mine.scan_id = ?
            AND d.scan_id <> ?
          ORDER BY d.decided_at DESC, d.rowid DESC`
      )
      .all(accountId, scanId, scanId)
      .map((raw) => {
        const d = raw as Record<string, string>;
        return {
          id: d.id,
          scanId,
          evidenceId: d.evidence_id,
          reviewerId: d.reviewer_id,
          outcome: d.outcome as ReviewOutcome,
          rationale: d.rationale,
          decidedAt: d.decided_at,
          carriedFromScanId: d.scan_id,
        };
      });
  }

  /* ------------------------------------------------------- the log */

  private logAccess(
    scope: ReviewerScope,
    accountId: string,
    scanId: string,
    evidenceId: string | null,
    action: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO review_access_log
           (id, reviewer_id, account_id, scan_id, evidence_id, action, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId('acc'),
        scope.reviewerId,
        accountId,
        scanId,
        evidenceId,
        action,
        new Date().toISOString()
      );
  }

  /** What a reviewer has looked at. For an access audit. */
  accessLog(reviewerId: string, limit = 200) {
    return this.db
      .prepare(
        `SELECT reviewer_id, account_id, scan_id, evidence_id, action, occurred_at
           FROM review_access_log WHERE reviewer_id = ?
          ORDER BY occurred_at DESC LIMIT ?`
      )
      .all(reviewerId, limit) as Array<{
      reviewer_id: string;
      account_id: string;
      scan_id: string;
      evidence_id: string | null;
      action: string;
      occurred_at: string;
    }>;
  }
}

/** Says, in words, why a record is in the queue. */
/**
 * Why this record is in front of a reviewer, worst reason first.
 *
 * Identity used to be tested before everything else, so a record carrying
 * adverse language and an unsure identity was introduced as "we are not
 * certain this result is about the customer". The second rehearsal caught
 * it: a board certification misread as a disciplinary finding was handed to
 * a reviewer under a heading about name matching, which is the question that
 * matters less and the one that invites the quicker answer.
 *
 * A reviewer is told the most consequential reason they are looking at
 * something, and the identity doubt is added to it rather than replacing it.
 */
function explainFlag(findingStatus: string | null, identityStatus: string): string {
  const unsure = identityStatus === 'uncertain' || identityStatus === 'probable';
  const maybe = unsure ? ' We are also not certain it is about this customer.' : '';

  if (findingStatus === 'requires_review') {
    return (
      'Adverse language was detected and nothing has established what it means. ' +
      'Read the source before deciding: upholding this tells the customer it is settled.' +
      maybe
    );
  }
  if (findingStatus === 'confirmed_finding') {
    return (
      'Classified as an established finding, which is the most damaging thing we can say.' +
      maybe
    );
  }
  if (unsure && !findingStatus) {
    return 'We are not certain this result is about the customer.';
  }
  if (findingStatus === 'allegation') {
    return 'An unsettled claim. Whether it is reported as one matters.' + maybe;
  }
  if (findingStatus === 'disputed') {
    return 'Sources contradict each other.' + maybe;
  }
  if (findingStatus === 'corrected' || findingStatus === 'retracted') {
    return 'The source withdrew or corrected this.' + maybe;
  }
  if (unsure) return 'We are not certain this result is about the customer.';
  return 'Flagged for a human to look at.';
}

/** Applies review decisions to evidence, the way customer decisions are applied. */
export function applyReviewDecisions(
  evidence: EvidenceRecord[],
  decisions: ReviewDecision[]
): EvidenceRecord[] {
  if (decisions.length === 0) return evidence;

  /**
   * Newest decision per record wins; the rest are history.
   *
   * The caller hands these newest-first, including a rowid tiebreaker —
   * two decisions can land in the same millisecond, and a timestamp alone
   * then leaves which one is current up to the query planner.
   */
  const latest = new Map<string, ReviewDecision>();
  for (const d of [...decisions].reverse()) latest.set(d.evidenceId, d);

  return evidence.map((e) => {
    const d = latest.get(e.id);
    if (!d) return e;

    const base = { ...e, reviewStatus: STATUS_FOR_OUTCOME[d.outcome] };

    switch (d.outcome) {
      /**
       * Upholding is what promotes a detection into a finding.
       *
       * The classifier no longer writes `confirmed_finding` for anything —
       * it detects adverse language and says so. A record sitting at
       * `requires_review` has been read by a named person who wrote down why
       * it stands, and that written act is the "explicit, reviewable
       * evidence basis" the status was created to require.
       *
       * Any other status is left exactly as it was: upholding an allegation
       * affirms that it is an allegation, and does not quietly settle it.
       * Corroboration across independent sources is the other route to
       * confirmed, and it belongs in risk.ts where the sources can be
       * counted.
       */
      case 'uphold':
        return e.findingStatus === 'requires_review'
          ? { ...base, findingStatus: 'confirmed_finding' as const }
          : base;
      case 'downgrade_to_allegation':
        return { ...base, findingStatus: 'allegation' as const };
      case 'reject_not_this_person':
        return { ...base, identityStatus: 'rejected' as const, identityConfidence: 0 };
      case 'reject_not_harm':
        return {
          ...base,
          classification: 'commentary' as const,
          findingStatus: 'opinion' as const,
          severity: undefined,
        };
    }
  });
}
