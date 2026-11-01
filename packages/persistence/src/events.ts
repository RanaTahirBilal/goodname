/**
 * The audit log.
 *
 * Records what happened, who did it and to what. Deliberately records no
 * payloads: logging the evidence excerpt alongside the event would put the
 * same personal data in two places with two different retention stories.
 */
import { type Db, newId, toJson, fromJson } from './db.ts';

export interface AuditEventInput {
  /** Null for events that are not about a customer, such as a failed gate. */
  accountId?: string | null;
  actor: string;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent extends Required<Omit<AuditEventInput, 'metadata'>> {
  id: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export function recordEvent(db: Db, input: AuditEventInput): void {
  db.prepare(
    `INSERT INTO audit_events
       (id, account_id, actor, action, subject_type, subject_id, metadata, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId('evt'),
    input.accountId ?? null,
    input.actor,
    input.action,
    input.subjectType,
    input.subjectId ?? null,
    toJson(input.metadata ?? {}),
    new Date().toISOString()
  );
}

/** Scoped read, like everything else that touches customer data. */
export function listEvents(db: Db, accountId: string, limit = 100): AuditEvent[] {
  return db
    .prepare(
      `SELECT * FROM audit_events
        WHERE account_id = ?
        ORDER BY occurred_at DESC, rowid DESC
        LIMIT ?`
    )
    .all(accountId, limit)
    .map((raw) => {
      const e = raw as Record<string, unknown>;
      return {
        id: String(e.id),
        accountId: (e.account_id as string) ?? null,
        actor: String(e.actor),
        action: String(e.action),
        subjectType: String(e.subject_type),
        subjectId: (e.subject_id as string) ?? null,
        metadata: fromJson<Record<string, unknown>>(e.metadata as string, {}),
        occurredAt: String(e.occurred_at),
      } as AuditEvent;
    });
}
