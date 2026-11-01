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
 */
import type { AttemptStore, AuditAttempt } from '@rep/domain';
import { type Db, newId, toJson, fromJson } from './db.ts';

/** Matches the normalisation the domain gate uses for distinct-subject counts. */
const normaliseName = (n: string): string =>
  n.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).join(' ');

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

  /**
   * Removes attempts older than the retention window.
   *
   * Attempt rows hold a name someone typed, which is personal data with no
   * reason to be kept once it can no longer affect a rate-limit decision.
   */
  prune(olderThanIso: string): number {
    const before = this.count();
    this.db.prepare('DELETE FROM audit_attempts WHERE attempted_at < ?').run(olderThanIso);
    return before - this.count();
  }

  private count(): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM audit_attempts').get();
    return Number((r as { n: number }).n);
  }
}
