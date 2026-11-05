/**
 * A durable attempt store for the self-audit safeguards.
 *
 * Replaces the in-memory one, which reset on deploy and was per-instance —
 * meaning the enumeration limits could be cleared by waiting for a restart or
 * by hitting a different server. That was listed as a launch blocker in
 * docs/SAFEGUARDS.md; this closes it.
 *
 * It stores the subject name twice on purpose: `subject_key` is normalised
 * for counting distinct people, and `subject_name` is what was actually typed,
 * which is what an abuse review needs to look at.
 *
 * ## Why this file has no `prune`
 *
 * It had one, with a test, and nothing called it — so `audit_attempts` was
 * the one table in the system holding a person's name with no clock on it
 * (OQ-28). A method nobody calls is not a retention policy, in the same way
 * that an unreachable export route is not a customer right.
 *
 * The sweep now lives in `enforceRetention` alongside every other period,
 * where it runs hourly because the server started. The rule is that the
 * retention story for a table is readable in one file, not assembled from a
 * method here and a caller somewhere else.
 */
import type { AttemptStore, AuditAttempt } from '@rep/domain';
import { type Db, newId, toJson, fromJson } from './db.ts';

/** Matches the normalisation the domain gate uses for distinct-subject counts. */
const normaliseName = (n: string): string =>
  n.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).join(' ');

/**
 * The requester id for a signed-in customer.
 *
 * `audit_attempts` has no `account_id` — it cannot, because its job is to
 * notice one requester working through a list of different names, and that
 * question is not askable from inside a single account. It is keyed on this
 * string instead.
 *
 * Which makes the derivation load-bearing in two places that must agree: the
 * audit route writes rows under it, and `deleteAccount` removes them by it.
 * If they ever disagreed, deletion would silently leave the rows behind and
 * nothing would fail. So there is one definition, here, and both import it.
 */
export const requesterIdFor = (accountId: string): string => `account:${accountId}`;

export class SqliteAttemptStore implements AttemptStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async recent(requesterId: string, sinceIso: string): Promise<AuditAttempt[]> {
    const rows = this.db
      .prepare(
        `SELECT requester_id, subject_name, purpose, attempted_at
           FROM audit_attempts
          WHERE requester_id = ? AND attempted_at >= ?
          ORDER BY attempted_at DESC`
      )
      .all(requesterId, sinceIso);

    return rows.map((raw) => {
      const a = raw as Record<string, string>;
      return {
        requesterId: a.requester_id,
        subjectName: a.subject_name,
        purpose: fromJson(a.purpose, {} as AuditAttempt['purpose']),
        at: a.attempted_at,
      };
    });
  }

  async record(attempt: AuditAttempt): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit_attempts
           (id, requester_id, subject_key, subject_name, purpose, attempted_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId('att'),
        attempt.requesterId,
        normaliseName(attempt.subjectName),
        attempt.subjectName,
        toJson(attempt.purpose),
        attempt.at
      );
  }

}
