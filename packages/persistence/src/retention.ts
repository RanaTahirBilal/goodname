/**
 * Retention: what ages out, when, and what deliberately does not.
 *
 * `docs/SAFEGUARDS.md` listed this as the gap that blocks holding real
 * customer data — export and hard deletion were implemented and tested, but
 * nothing aged anything out on its own. An audit run once and forgotten held
 * its evidence for ever.
 *
 * ## The distinction the whole policy rests on
 *
 * **The evidence excerpt is the personal data. The score is not.**
 *
 * An evidence row holds a title, an excerpt and a URL about an identified
 * person — and, when a broker listing turns up, their home address, phone
 * number and relatives. A presence snapshot holds a number, a coverage
 * fraction and a methodology version. The first is a dossier if you keep it
 * long enough. The second is not personal data in any meaningful sense once
 * the evidence behind it is gone.
 *
 * So evidence expires and the snapshots stay. The customer keeps the history
 * of what their score was and when; we stop holding the quotations.
 *
 * ## What that costs, said plainly
 *
 * Reports are recomputed from evidence on read (rule 16d), so an expired scan
 * cannot be re-rendered. That is the price of not keeping the excerpts, and
 * the report says so rather than rendering an empty page — a report with no
 * evidence looks exactly like a search that found nothing, which is the
 * confusion rule 14 exists to prevent.
 *
 * ## What does not expire on this clock
 *
 *   - **The access log.** It records that a named reviewer read a customer's
 *     evidence. Deleting it when the evidence goes would destroy the record
 *     of who looked at what, at the point it matters most. It outlives the
 *     evidence by design and is anonymised, not deleted, when an account is.
 *   - **The deletion log.** It holds a one-way reference and row counts, and
 *     exists to show a deletion happened.
 *   - **Anything belonging to a live account that is younger than its
 *     period.** Retention never deletes to save space.
 *
 * Nothing here is a legal opinion. The periods below are defensible defaults
 * chosen so the behaviour exists and is testable; `docs/OPEN_QUESTIONS.md`
 * OQ-6 holds the question for a lawyer, and changing a number here is a
 * one-line change once they answer.
 */
import { type Db, transaction } from './db.ts';

export interface RetentionPolicy {
  /** Days from retrieval before an evidence excerpt is deleted. */
  evidenceDays: number;
  /** Days a reviewer's decision and its rationale are kept. */
  reviewDecisionDays: number;
  /** Days the reviewer access log is kept. Outlives the evidence. */
  accessLogDays: number;
  /** Days a finished job row is kept. Its payload holds the identity. */
  finishedJobDays: number;
  /** Days an expired or revoked session row is kept. */
  deadSessionDays: number;
  /** Days a sent message is kept in the outbox. In development it holds codes. */
  outboxDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  /**
   * Six months. Long enough to compare this audit with the last one, which
   * is the product's reason to keep anything at all; short enough that we are
   * not quietly accumulating a file on someone who ran one audit in March.
   */
  evidenceDays: 180,

  /**
   * Two years, and deliberately longer than the evidence it concerns. A
   * reviewer's judgement is the record of a decision made about a person by a
   * member of staff; it should be answerable for longer than the material it
   * was made on.
   */
  reviewDecisionDays: 730,
  accessLogDays: 730,

  /** Operational rows. Short, because none of them is evidence of anything. */
  finishedJobDays: 30,
  deadSessionDays: 30,
  outboxDays: 30,
};

export interface RetentionResult {
  ranAt: string;
  /** Scans whose evidence was aged out on this pass. */
  scansExpired: number;
  evidenceDeleted: number;
  reviewDecisionsDeleted: number;
  accessLogDeleted: number;
  jobsDeleted: number;
  sessionsDeleted: number;
  staffSessionsDeleted: number;
  signInTokensDeleted: number;
  staffSignInTokensDeleted: number;
  outboxDeleted: number;
}

const daysBefore = (iso: string, days: number): string =>
  new Date(Date.parse(iso) - days * 86_400_000).toISOString();

/**
 * Runs one retention pass.
 *
 * `now` is a parameter so the tests can age data without sleeping, and so a
 * dry run can be reasoned about. Everything happens in one transaction: a
 * pass that deleted the evidence and failed before marking the scan would
 * leave a report that renders as "nothing found".
 */
export function enforceRetention(
  db: Db,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  now = new Date().toISOString()
): RetentionResult {
  return transaction(db, () => {
    const result: RetentionResult = {
      ranAt: now,
      scansExpired: 0,
      evidenceDeleted: 0,
      reviewDecisionsDeleted: 0,
      accessLogDeleted: 0,
      jobsDeleted: 0,
      sessionsDeleted: 0,
      staffSessionsDeleted: 0,
      signInTokensDeleted: 0,
      staffSignInTokensDeleted: 0,
      outboxDeleted: 0,
    };

    /* ----------------------------------------------------- the evidence */

    const evidenceCutoff = daysBefore(now, policy.evidenceDays);

    /**
     * A scan expires as a unit.
     *
     * Deleting individual rows as each passed its own date would leave a
     * report built from whatever happened to be newest — a partial view
     * presented as a complete one, which is the failure rule 14 names. The
     * scan's own oldest evidence decides, so a report is either whole or
     * gone.
     */
    const expiring = db
      .prepare(
        `SELECT scan_id FROM evidence
          WHERE scan_id IN (SELECT id FROM scans WHERE evidence_expired_at IS NULL)
          GROUP BY scan_id
         HAVING MAX(retrieved_at) < ?`
      )
      .all(evidenceCutoff)
      .map((r) => String((r as { scan_id: string }).scan_id));

    for (const scanId of expiring) {
      const removed = db.prepare('DELETE FROM evidence WHERE scan_id = ?').run(scanId);
      result.evidenceDeleted += Number(removed.changes);

      /**
       * The customer's own "this is / is not me" goes with it.
       *
       * It names an evidence row that no longer exists, and on its own it
       * says nothing anybody can act on. Keeping it would leave a decision
       * about a quotation we have deleted.
       */
      db.prepare('DELETE FROM identity_decisions WHERE scan_id = ?').run(scanId);

      db.prepare('UPDATE scans SET evidence_expired_at = ? WHERE id = ?').run(now, scanId);
      result.scansExpired++;
    }

    /* ------------------------------------------------ staff accountability */

    const decisionCutoff = daysBefore(now, policy.reviewDecisionDays);
    result.reviewDecisionsDeleted = Number(
      db.prepare('DELETE FROM review_decisions WHERE decided_at < ?').run(decisionCutoff).changes
    );

    const accessCutoff = daysBefore(now, policy.accessLogDays);
    result.accessLogDeleted = Number(
      db.prepare('DELETE FROM review_access_log WHERE occurred_at < ?').run(accessCutoff).changes
    );

    /* -------------------------------------------------------- operational */

    const jobCutoff = daysBefore(now, policy.finishedJobDays);
    result.jobsDeleted = Number(
      db
        .prepare(
          `DELETE FROM jobs
            WHERE status IN ('succeeded','failed')
              AND finished_at IS NOT NULL AND finished_at < ?`
        )
        .run(jobCutoff).changes
    );

    const sessionCutoff = daysBefore(now, policy.deadSessionDays);
    for (const [table, key] of [
      ['sessions', 'sessionsDeleted'],
      ['staff_sessions', 'staffSessionsDeleted'],
    ] as const) {
      result[key] = Number(
        db
          .prepare(
            `DELETE FROM ${table}
              WHERE (expires_at < ? ) OR (revoked_at IS NOT NULL AND revoked_at < ?)`
          )
          .run(sessionCutoff, sessionCutoff).changes
      );
    }

    // Sign-in codes are single-use and short-lived; once consumed or expired
    // they are nothing but a hash of a number nobody can use.
    result.signInTokensDeleted = Number(
      db
        .prepare('DELETE FROM sign_in_tokens WHERE expires_at < ? OR consumed_at IS NOT NULL')
        .run(now).changes
    );
    result.staffSignInTokensDeleted = Number(
      db
        .prepare(
          'DELETE FROM staff_sign_in_tokens WHERE expires_at < ? OR consumed_at IS NOT NULL'
        )
        .run(now).changes
    );

    const outboxCutoff = daysBefore(now, policy.outboxDays);
    result.outboxDeleted = Number(
      db.prepare('DELETE FROM email_outbox WHERE created_at < ?').run(outboxCutoff).changes
    );

    return result;
  });
}

/**
 * What a pass would do, without doing it.
 *
 * Retention deletes customer data on a timer, which is the kind of job that
 * should be inspectable before it is trusted. This answers "what is about to
 * go" without a transaction to roll back.
 */
export function retentionPreview(
  db: Db,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  now = new Date().toISOString()
): { scansExpiring: number; evidenceExpiring: number; oldestEvidence: string | null } {
  const cutoff = daysBefore(now, policy.evidenceDays);

  const scans = db
    .prepare(
      `SELECT scan_id, COUNT(*) AS n FROM evidence
        WHERE scan_id IN (SELECT id FROM scans WHERE evidence_expired_at IS NULL)
        GROUP BY scan_id
       HAVING MAX(retrieved_at) < ?`
    )
    .all(cutoff) as Array<{ scan_id: string; n: number }>;

  const oldest = db.prepare('SELECT MIN(retrieved_at) AS m FROM evidence').get() as {
    m: string | null;
  };

  return {
    scansExpiring: scans.length,
    evidenceExpiring: scans.reduce((sum, s) => sum + Number(s.n), 0),
    oldestEvidence: oldest.m,
  };
}
