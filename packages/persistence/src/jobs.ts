/**
 * The background job queue.
 *
 * Exists because the audit cannot stay inside an HTTP request once a real
 * search provider is connected: the cheapest option averages five minutes
 * per batch, and even the fast tier is several seconds times three calls
 * plus classification. See docs/SEARCH_PROVIDERS.md.
 *
 * Deliberately small. A queue in the same database as the data it works on
 * can claim a job and write its result in one transaction, which is the
 * property that makes "did this run twice?" answerable. A separate broker
 * buys throughput this product does not need yet and costs exactly that
 * guarantee.
 *
 * What it does not do: run across machines. One process polls; if two did,
 * the claim below would still be safe (SQLite serialises writers) but
 * neither would know about the other's health. That is a real limit, written
 * down rather than discovered later.
 */
import { type Db, newId, toJson, fromJson, bool, transaction } from './db.ts';
import { recordEvent } from './events.ts';
import type { AccountScope } from './repository.ts';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  id: string;
  accountId: string;
  type: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  sideEffectsSent: boolean;
  lastError?: string;
  availableAt: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  subjectType?: string;
  subjectId?: string;
}

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  subjectType?: string;
  subjectId?: string;
  /** Delay before the job becomes claimable. */
  delaySeconds?: number;
}

/**
 * Exponential, so a provider having a bad minute is not hammered.
 * 2s, 8s, 32s — capped, because a job that has failed three times needs a
 * person, not another attempt.
 */
export const backoffSeconds = (attempts: number): number =>
  Math.min(300, 2 * 4 ** Math.max(0, attempts - 1));

const plusSeconds = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString();

const toRecord = (raw: unknown): JobRecord => {
  const j = raw as Record<string, unknown>;
  return {
    id: String(j.id),
    accountId: String(j.account_id),
    type: String(j.type),
    status: j.status as JobStatus,
    payload: fromJson<Record<string, unknown>>(j.payload as string, {}),
    attempts: Number(j.attempts),
    maxAttempts: Number(j.max_attempts),
    sideEffectsSent: bool(j.side_effects_sent),
    lastError: (j.last_error as string) ?? undefined,
    availableAt: String(j.available_at),
    createdAt: String(j.created_at),
    startedAt: (j.started_at as string) ?? undefined,
    finishedAt: (j.finished_at as string) ?? undefined,
    subjectType: (j.subject_type as string) ?? undefined,
    subjectId: (j.subject_id as string) ?? undefined,
  };
};

export class JobQueue {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  enqueue(scope: AccountScope, input: EnqueueInput): string {
    const now = new Date().toISOString();
    const id = newId('job');

    this.db
      .prepare(
        `INSERT INTO jobs
           (id, account_id, type, status, payload, max_attempts,
            available_at, created_at, subject_type, subject_id)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        scope.accountId,
        input.type,
        toJson(input.payload ?? {}),
        input.maxAttempts ?? 3,
        plusSeconds(now, input.delaySeconds ?? 0),
        now,
        input.subjectType ?? null,
        input.subjectId ?? null
      );

    recordEvent(this.db, {
      accountId: scope.accountId,
      actor: scope.actor,
      action: 'job.enqueued',
      subjectType: 'job',
      subjectId: id,
      metadata: { type: input.type },
    });

    return id;
  }

  /**
   * Takes the next due job and marks it running, in one transaction.
   *
   * Claim and mark have to be atomic or two workers hand the same job to two
   * providers and the customer is billed twice for one scan. SQLite
   * serialises writers, so the transaction is the whole mechanism.
   */
  claim(now = new Date().toISOString()): JobRecord | null {
    return transaction(this.db, () => {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs
            WHERE status = 'queued' AND available_at <= ?
            ORDER BY created_at
            LIMIT 1`
        )
        .get(now);

      if (!row) return null;

      const job = toRecord(row);

      this.db
        .prepare(
          `UPDATE jobs
              SET status = 'running', started_at = ?, attempts = attempts + 1
            WHERE id = ? AND status = 'queued'`
        )
        .run(now, job.id);

      return { ...job, status: 'running' as JobStatus, attempts: job.attempts + 1, startedAt: now };
    });
  }

  succeed(jobId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE jobs SET status = 'succeeded', finished_at = ?, last_error = NULL WHERE id = ?"
      )
      .run(now, jobId);
  }

  /**
   * Records a failure and decides whether to retry.
   *
   * A job that has already sent something to a third party is never retried,
   * whatever its attempt count. Re-running a search costs money; re-sending a
   * correction request to a publisher sends it twice, and that one cannot be
   * taken back.
   */
  fail(jobId: string, error: string): { willRetry: boolean } {
    const now = new Date().toISOString();

    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!row) return { willRetry: false };

    const job = toRecord(row);
    const exhausted = job.attempts >= job.maxAttempts;
    const willRetry = !exhausted && !job.sideEffectsSent;

    if (willRetry) {
      this.db
        .prepare(
          "UPDATE jobs SET status = 'queued', last_error = ?, available_at = ? WHERE id = ?"
        )
        .run(error, plusSeconds(now, backoffSeconds(job.attempts)), jobId);
    } else {
      this.db
        .prepare("UPDATE jobs SET status = 'failed', last_error = ?, finished_at = ? WHERE id = ?")
        .run(error, now, jobId);

      recordEvent(this.db, {
        accountId: job.accountId,
        actor: 'system',
        action: 'job.failed',
        subjectType: 'job',
        subjectId: jobId,
        metadata: {
          type: job.type,
          attempts: job.attempts,
          reason: job.sideEffectsSent ? 'side_effects_already_sent' : 'attempts_exhausted',
        },
      });
    }

    return { willRetry };
  }

  /**
   * Marks the point of no return. A job calls this the instant it sends
   * anything outward, before awaiting the response — a crash between sending
   * and recording is exactly the case that causes a duplicate.
   */
  markSideEffectsSent(jobId: string): void {
    this.db.prepare('UPDATE jobs SET side_effects_sent = 1 WHERE id = ?').run(jobId);
  }

  /** Scoped read, like everything else that touches customer data. */
  get(scope: AccountScope, jobId: string): JobRecord | null {
    const row = this.db
      .prepare('SELECT * FROM jobs WHERE account_id = ? AND id = ?')
      .get(scope.accountId, jobId);
    return row ? toRecord(row) : null;
  }

  /** The job doing work for a given subject, newest first. */
  forSubject(scope: AccountScope, subjectType: string, subjectId: string): JobRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs
          WHERE account_id = ? AND subject_type = ? AND subject_id = ?
          ORDER BY created_at DESC LIMIT 1`
      )
      .get(scope.accountId, subjectType, subjectId);
    return row ? toRecord(row) : null;
  }

  /**
   * Returns jobs stuck in `running` past a timeout to the queue.
   *
   * A process that dies mid-job leaves it claimed forever. Without this, one
   * crash silently costs a customer their audit and nothing ever says so.
   */
  reclaimStalled(olderThanSeconds = 600, now = new Date().toISOString()): number {
    const cutoff = plusSeconds(now, -olderThanSeconds);

    const stalled = this.db
      .prepare("SELECT * FROM jobs WHERE status = 'running' AND started_at < ?")
      .all(cutoff)
      .map(toRecord);

    let reclaimed = 0;
    for (const job of stalled) {
      // A job that already sent something outward is not safe to re-run just
      // because the process died. It needs a person.
      if (job.sideEffectsSent || job.attempts >= job.maxAttempts) {
        this.db
          .prepare(
            "UPDATE jobs SET status = 'failed', finished_at = ?, last_error = ? WHERE id = ?"
          )
          .run(now, 'Worker stopped before the job finished.', job.id);
        continue;
      }

      this.db
        .prepare("UPDATE jobs SET status = 'queued', available_at = ? WHERE id = ?")
        .run(now, job.id);
      reclaimed++;
    }

    return reclaimed;
  }

  /** Queue depth, for an operations view. */
  counts(): Record<JobStatus, number> {
    const out: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    };
    for (const raw of this.db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all()) {
      const r = raw as { status: JobStatus; n: number };
      out[r.status] = Number(r.n);
    }
    return out;
  }
}
