/**
 * The scan repository.
 *
 * Account isolation is in the API shape: every method takes an `AccountScope`
 * and every query filters on `account_id`. There is deliberately no
 * `getScan(id)` — a caller cannot read another account's scan by guessing an
 * id, because the method to do so does not exist. Relying on each caller to
 * remember a `WHERE account_id = ?` is how cross-tenant leaks happen.
 *
 * Snapshots are append-only. A rescore after a customer decision writes a new
 * row rather than updating the old one, so a score is never silently
 * restated.
 */
import type {
  AuditPurpose,
  EvidenceRecord,
  PresenceScore,
  ProfessionalIdentity,
  RiskAssessment,
} from '@rep/domain';
import { type Db, newId, toJson, fromJson, bool, transaction } from './db.ts';
import { recordEvent } from './events.ts';

/** Proof that the caller has established which account it is acting for. */
export interface AccountScope {
  accountId: string;
  /** Who is acting: the customer, an admin, or the system. */
  actor: string;
}

export interface Account {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * `pending` exists because a scan is now created before its work runs. The
 * row is the thing the customer can be given a link to while a background
 * job is still fetching results.
 */
export type ScanStatus = 'pending' | 'complete' | 'search_failed';

export interface ScanSummary {
  id: string;
  status: ScanStatus;
  provider: string;
  isFixture: boolean;
  window: number;
  queries: string[];
  purpose: AuditPurpose;
  coverageNote?: string;
  partialCoverage: boolean;
  failure?: { reason: string; message: string };
  startedAt: string;
  completedAt?: string;
  /**
   * Set when the evidence behind this scan was aged out by retention.
   *
   * Not a status: the scan did complete, and saying otherwise would rewrite
   * what happened to describe our own housekeeping. A caller rendering a
   * report must check this, because rebuilding from no evidence produces
   * something that reads exactly like a search that found nothing.
   */
  evidenceExpiredAt?: string;
  identity: ProfessionalIdentity;
}

export interface StoredScan extends ScanSummary {
  evidence: EvidenceRecord[];
  decisions: IdentityDecision[];
}

export interface IdentityDecision {
  evidenceId: string;
  decision: 'confirmed' | 'rejected';
  decidedAt: string;
  decidedBy: string;
}

export interface SaveScanInput {
  identity: ProfessionalIdentity;
  status: ScanStatus;
  provider: string;
  isFixture: boolean;
  window: number;
  queries: string[];
  purpose: AuditPurpose;
  requesterId: string;
  coverageNote?: string;
  partialCoverage?: boolean;
  failure?: { reason: string; message: string };
  evidence?: EvidenceRecord[];
  /** Re-sending the same key returns the original scan instead of re-running. */
  idempotencyKey?: string;
}

const row = <T>(v: unknown): T => v as T;

/**
 * Every table holding rows keyed to an account, in deletion order.
 *
 * Children before parents, because foreign keys are enforced. Exported so a
 * test can hold it against the schema: a new table with an account_id that
 * nobody added here is a deletion request that fails outright, which is how
 * both `jobs` and `review_decisions` came to be missing from it.
 *
 * `sessions` is here for a reason beyond the constraint — a live session
 * outliving a deletion request would mean the browser that asked for the
 * deletion was still signed in afterwards.
 */
export const ACCOUNT_OWNED_TABLES = [
  'identity_decisions',
  'presence_snapshots',
  'risk_snapshots',
  // Before `evidence` and `scans`: a review decision references the scan it
  // was made on. Leaving it out meant a customer whose evidence had been
  // reviewed could not be deleted at all — the foreign key refused, the
  // transaction rolled back, and the request failed with nothing removed.
  'review_decisions',
  /**
   * Jobs hold the identity in their payload: the name, employer and city we
   * searched for. That is the personal data a deletion request is about,
   * sitting in a row nobody thinks of as customer data — and it has a
   * foreign key too, so leaving it out broke deletion for every account that
   * had ever run an audit through the site, which is all of them.
   */
  'jobs',
  'evidence',
  'scans',
  'professional_identities',
  'sessions',
  'audit_events',
] as const;

export class ScanRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /* --------------------------------------------------------- accounts */

  createAccount(email: string): Account {
    const account: Account = {
      id: newId('acct'),
      email,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)')
      .run(account.id, account.email, account.createdAt);

    recordEvent(this.db, {
      accountId: account.id,
      actor: 'system',
      action: 'account.created',
      subjectType: 'account',
      subjectId: account.id,
    });

    return account;
  }

  /** Looks up an active account. Deleted accounts are not findable. */
  findAccountByEmail(email: string): Account | null {
    const r = this.db
      .prepare('SELECT id, email, created_at FROM accounts WHERE email = ? AND deleted_at IS NULL')
      .get(email);

    if (!r) return null;
    const a = row<{ id: string; email: string; created_at: string }>(r);
    return { id: a.id, email: a.email, createdAt: a.created_at };
  }

  /* ------------------------------------------------------------ scans */

  /** Returns an existing scan id when this key has already been used. */
  findByIdempotencyKey(scope: AccountScope, key: string): string | null {
    const r = this.db
      .prepare('SELECT id FROM scans WHERE account_id = ? AND idempotency_key = ?')
      .get(scope.accountId, key);
    return r ? row<{ id: string }>(r).id : null;
  }

  saveScan(scope: AccountScope, input: SaveScanInput): string {
    return transaction(this.db, () => {
      const identityId = newId('pid');
      const now = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO professional_identities
             (id, account_id, full_name, profession, employer, city, region, credentials, website_url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          identityId,
          scope.accountId,
          input.identity.fullName,
          input.identity.profession,
          input.identity.employer ?? null,
          input.identity.city ?? null,
          input.identity.region ?? null,
          toJson(input.identity.credentials ?? []),
          input.identity.websiteUrl ?? null,
          now
        );

      const scanId = newId('scan');

      this.db
        .prepare(
          `INSERT INTO scans
             (id, account_id, identity_id, status, provider, is_fixture, window_size,
              queries, purpose, requester_id, coverage_note, partial_coverage, failure,
              started_at, completed_at, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          scanId,
          scope.accountId,
          identityId,
          input.status,
          input.provider,
          input.isFixture ? 1 : 0,
          input.window,
          toJson(input.queries),
          toJson(input.purpose),
          input.requesterId,
          input.coverageNote ?? null,
          input.partialCoverage ? 1 : 0,
          input.failure ? toJson(input.failure) : null,
          now,
          input.status === 'complete' ? now : null,
          input.idempotencyKey ?? null
        );

      for (const e of input.evidence ?? []) {
        this.insertEvidence(scope.accountId, scanId, e);
      }

      recordEvent(this.db, {
        accountId: scope.accountId,
        actor: scope.actor,
        action: 'scan.created',
        subjectType: 'scan',
        subjectId: scanId,
        metadata: {
          status: input.status,
          provider: input.provider,
          isFixture: input.isFixture,
          evidenceCount: input.evidence?.length ?? 0,
        },
      });

      return scanId;
    });
  }

  private insertEvidence(accountId: string, scanId: string, e: EvidenceRecord): void {
    this.db
      .prepare(
        `INSERT INTO evidence
           (id, scan_id, account_id, source_url, source_name, domain, retrieved_at, published_at,
            title, excerpt, position, provenance, provider_name, identity_confidence,
            identity_status, identity_signals, source_reliability, authority, classification,
            classification_conf, classification_reason, finding_status, severity,
            severity_rationale, review_status, contradicted_by, correction_of,
            story_cluster_id, duplicate_of, independent_sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        e.id, scanId, accountId, e.sourceUrl, e.sourceName, e.domain, e.retrievedAt,
        e.publishedAt ?? null, e.title, e.excerpt, e.position ?? null, e.provenance,
        e.providerName, e.identityConfidence, e.identityStatus, toJson(e.identitySignals),
        e.sourceReliability, e.authority, e.classification, e.classificationConfidence,
        e.classificationRationale, e.findingStatus ?? null, e.severity ?? null,
        e.severityRationale ?? null, e.reviewStatus,
        e.contradictedBy ? toJson(e.contradictedBy) : null, e.correctionOf ?? null,
        e.storyClusterId ?? null, e.duplicateOf ?? null, e.independentSourcesInCluster ?? null
      );
  }

  listScans(scope: AccountScope, limit = 25): ScanSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, i.full_name, i.profession, i.employer, i.city, i.region,
                i.credentials, i.website_url
           FROM scans s
           JOIN professional_identities i ON i.id = s.identity_id
          WHERE s.account_id = ?
          ORDER BY s.started_at DESC
          LIMIT ?`
      )
      .all(scope.accountId, limit);

    return rows.map((r) => this.toSummary(r));
  }

  /** Scoped read. There is no unscoped variant, on purpose. */
  getScan(scope: AccountScope, scanId: string): StoredScan | null {
    const r = this.db
      .prepare(
        `SELECT s.*, i.full_name, i.profession, i.employer, i.city, i.region,
                i.credentials, i.website_url
           FROM scans s
           JOIN professional_identities i ON i.id = s.identity_id
          WHERE s.account_id = ? AND s.id = ?`
      )
      .get(scope.accountId, scanId);

    if (!r) return null;

    return {
      ...this.toSummary(r),
      evidence: this.getEvidence(scope, scanId),
      decisions: this.getDecisions(scope, scanId),
    };
  }

  getEvidence(scope: AccountScope, scanId: string): EvidenceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM evidence
          WHERE account_id = ? AND scan_id = ?
          ORDER BY COALESCE(position, 9999), id`
      )
      .all(scope.accountId, scanId);

    return rows.map((raw) => {
      const e = row<Record<string, unknown>>(raw);
      return {
        id: String(e.id),
        sourceUrl: String(e.source_url),
        sourceName: String(e.source_name),
        domain: String(e.domain),
        retrievedAt: String(e.retrieved_at),
        publishedAt: (e.published_at as string) ?? undefined,
        title: String(e.title),
        excerpt: String(e.excerpt),
        position: e.position === null ? undefined : Number(e.position),
        provenance: e.provenance as EvidenceRecord['provenance'],
        providerName: String(e.provider_name),
        identityConfidence: Number(e.identity_confidence),
        identityStatus: e.identity_status as EvidenceRecord['identityStatus'],
        identitySignals: fromJson<string[]>(e.identity_signals as string, []),
        sourceReliability: e.source_reliability as EvidenceRecord['sourceReliability'],
        authority: Number(e.authority),
        classification: e.classification as EvidenceRecord['classification'],
        classificationConfidence: Number(e.classification_conf),
        classificationRationale: String(e.classification_reason),
        findingStatus: (e.finding_status as EvidenceRecord['findingStatus']) ?? undefined,
        severity: e.severity === null ? undefined : Number(e.severity),
        severityRationale: (e.severity_rationale as string) ?? undefined,
        reviewStatus: e.review_status as EvidenceRecord['reviewStatus'],
        contradictedBy: e.contradicted_by
          ? fromJson<string[]>(e.contradicted_by as string, [])
          : undefined,
        correctionOf: (e.correction_of as string) ?? undefined,
        storyClusterId: (e.story_cluster_id as string) ?? undefined,
        duplicateOf: (e.duplicate_of as string) ?? undefined,
        independentSourcesInCluster:
          e.independent_sources === null ? undefined : Number(e.independent_sources),
      };
    });
  }

  private toSummary(raw: unknown): ScanSummary {
    const s = row<Record<string, unknown>>(raw);
    return {
      id: String(s.id),
      status: s.status as ScanStatus,
      provider: String(s.provider),
      isFixture: bool(s.is_fixture),
      window: Number(s.window_size),
      queries: fromJson<string[]>(s.queries as string, []),
      purpose: fromJson<AuditPurpose>(s.purpose as string, {} as AuditPurpose),
      coverageNote: (s.coverage_note as string) ?? undefined,
      partialCoverage: bool(s.partial_coverage),
      failure: s.failure
        ? fromJson<{ reason: string; message: string }>(s.failure as string, {
            reason: 'unknown',
            message: '',
          })
        : undefined,
      startedAt: String(s.started_at),
      completedAt: (s.completed_at as string) ?? undefined,
      evidenceExpiredAt: (s.evidence_expired_at as string) ?? undefined,
      identity: {
        fullName: String(s.full_name),
        profession: s.profession as ProfessionalIdentity['profession'],
        employer: (s.employer as string) ?? undefined,
        city: (s.city as string) ?? undefined,
        region: (s.region as string) ?? undefined,
        credentials: fromJson<string[]>(s.credentials as string, []),
        websiteUrl: (s.website_url as string) ?? undefined,
      },
    };
  }

  /* -------------------------------------------------------- decisions */

  /**
   * Records a customer saying whether an uncertain result is them.
   *
   * Changing a decision overwrites the previous one for that result, and both
   * the write and the overwrite are logged — the decision moves a score, so
   * who said what and when has to be reconstructable.
   */
  recordDecision(
    scope: AccountScope,
    scanId: string,
    evidenceId: string,
    decision: 'confirmed' | 'rejected'
  ): void {
    const scan = this.db
      .prepare('SELECT id FROM scans WHERE account_id = ? AND id = ?')
      .get(scope.accountId, scanId);
    if (!scan) throw new Error('Scan not found for this account.');

    const exists = this.db
      .prepare('SELECT id FROM evidence WHERE account_id = ? AND scan_id = ? AND id = ?')
      .get(scope.accountId, scanId, evidenceId);
    if (!exists) throw new Error('Evidence not found for this scan.');

    transaction(this.db, () => {
      this.db
        .prepare('DELETE FROM identity_decisions WHERE scan_id = ? AND evidence_id = ?')
        .run(scanId, evidenceId);

      this.db
        .prepare(
          `INSERT INTO identity_decisions
             (id, account_id, scan_id, evidence_id, decision, decided_at, decided_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId('dec'),
          scope.accountId,
          scanId,
          evidenceId,
          decision,
          new Date().toISOString(),
          scope.actor
        );

      recordEvent(this.db, {
        accountId: scope.accountId,
        actor: scope.actor,
        action: 'identity.decided',
        subjectType: 'evidence',
        subjectId: evidenceId,
        metadata: { scanId, decision },
      });
    });
  }

  /**
   * Fills in a pending scan once its job has run.
   *
   * Separate from `saveScan` because the scan row is created in the request
   * (so the customer gets an id immediately) and finished later by a worker.
   * Writing evidence and flipping the status in one transaction means a scan
   * is never readable as complete-but-empty.
   */
  completeScan(
    scope: AccountScope,
    scanId: string,
    input: {
      status: Exclude<ScanStatus, 'pending'>;
      evidence?: EvidenceRecord[];
      coverageNote?: string;
      partialCoverage?: boolean;
      failure?: { reason: string; message: string };
    }
  ): void {
    const exists = this.db
      .prepare("SELECT id FROM scans WHERE account_id = ? AND id = ?")
      .get(scope.accountId, scanId);
    if (!exists) throw new Error('Scan not found for this account.');

    transaction(this.db, () => {
      const now = new Date().toISOString();

      // Clear any evidence from an earlier attempt. A retried scan replaces
      // its results rather than accumulating two runs' worth.
      this.db
        .prepare('DELETE FROM evidence WHERE account_id = ? AND scan_id = ?')
        .run(scope.accountId, scanId);

      for (const e of input.evidence ?? []) {
        this.insertEvidence(scope.accountId, scanId, e);
      }

      this.db
        .prepare(
          `UPDATE scans
              SET status = ?, completed_at = ?, coverage_note = ?,
                  partial_coverage = ?, failure = ?
            WHERE account_id = ? AND id = ?`
        )
        .run(
          input.status,
          now,
          input.coverageNote ?? null,
          input.partialCoverage ? 1 : 0,
          input.failure ? toJson(input.failure) : null,
          scope.accountId,
          scanId
        );

      recordEvent(this.db, {
        accountId: scope.accountId,
        actor: scope.actor,
        action: 'scan.completed',
        subjectType: 'scan',
        subjectId: scanId,
        metadata: { status: input.status, evidenceCount: input.evidence?.length ?? 0 },
      });
    });
  }

  getDecisions(scope: AccountScope, scanId: string): IdentityDecision[] {
    const rows = this.db
      .prepare(
        `SELECT evidence_id, decision, decided_at, decided_by
           FROM identity_decisions
          WHERE account_id = ? AND scan_id = ?`
      )
      .all(scope.accountId, scanId);

    return rows.map((raw) => {
      const d = row<Record<string, string>>(raw);
      return {
        evidenceId: d.evidence_id,
        decision: d.decision as 'confirmed' | 'rejected',
        decidedAt: d.decided_at,
        decidedBy: d.decided_by,
      };
    });
  }

  /* -------------------------------------------------------- snapshots */

  savePresence(
    scope: AccountScope,
    scanId: string,
    presence: PresenceScore,
    reason: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO presence_snapshots
           (id, account_id, scan_id, status, methodology_version, score, coverage, payload, computed_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId('pres'),
        scope.accountId,
        scanId,
        presence.status,
        presence.methodologyVersion,
        presence.status === 'scored' ? presence.score : null,
        presence.coverage,
        toJson(presence),
        presence.computedAt,
        reason
      );
  }

  saveRisk(scope: AccountScope, scanId: string, risk: RiskAssessment, reason: string): void {
    this.db
      .prepare(
        `INSERT INTO risk_snapshots
           (id, account_id, scan_id, methodology_version, level, payload, assessed_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId('risk'),
        scope.accountId,
        scanId,
        risk.methodologyVersion,
        risk.level,
        toJson(risk),
        risk.assessedAt,
        reason
      );
  }

  /** Snapshot history, newest first, so a customer can see what changed. */
  presenceHistory(scope: AccountScope, scanId: string): Array<{
    score: number | null;
    coverage: number;
    methodologyVersion: string;
    computedAt: string;
    reason: string;
  }> {
    return this.db
      .prepare(
        `SELECT score, coverage, methodology_version, computed_at, reason
           FROM presence_snapshots
          WHERE account_id = ? AND scan_id = ?
          ORDER BY computed_at DESC, rowid DESC`
      )
      .all(scope.accountId, scanId)
      .map((raw) => {
        const p = row<Record<string, unknown>>(raw);
        return {
          score: p.score === null ? null : Number(p.score),
          coverage: Number(p.coverage),
          methodologyVersion: String(p.methodology_version),
          computedAt: String(p.computed_at),
          reason: String(p.reason),
        };
      });
  }

  /* ------------------------------------------------- export & deletion */

  /** Everything we hold for this account, for a data export request. */
  exportAccount(scope: AccountScope): Record<string, unknown> {
    const tables = [
      'professional_identities',
      'scans',
      'evidence',
      'identity_decisions',
      'presence_snapshots',
      'risk_snapshots',
      'audit_events',
    ];

    const data: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      account: this.db
        .prepare('SELECT id, email, created_at FROM accounts WHERE id = ?')
        .get(scope.accountId),
    };

    for (const t of tables) {
      data[t] = this.db.prepare(`SELECT * FROM ${t} WHERE account_id = ?`).all(scope.accountId);
    }

    /**
     * An audit event's actor is `reviewer:<staff id>` when a member of staff
     * acted. That identifies an employee to the customer, which an export of
     * the customer's own data is not the place for — the customer is
     * entitled to know a reviewer acted, not which one.
     */
    data.audit_events = (data.audit_events as Array<Record<string, unknown>>).map((e) => ({
      ...e,
      actor: String(e.actor).startsWith('reviewer:') ? 'reviewer' : e.actor,
    }));

    /**
     * A reviewer's judgement is a statement about this customer, so it
     * belongs in their export. Which member of staff made it does not: that
     * identifies an employee, not the person asking. The outcome and the
     * reasoning are what they are entitled to see.
     */
    data.review_decisions = this.db
      .prepare(
        `SELECT scan_id, evidence_id, outcome, rationale, decided_at
           FROM review_decisions WHERE account_id = ?
          ORDER BY decided_at`
      )
      .all(scope.accountId);

    recordEvent(this.db, {
      accountId: scope.accountId,
      actor: scope.actor,
      action: 'account.exported',
      subjectType: 'account',
      subjectId: scope.accountId,
    });

    return data;
  }

  /**
   * Hard-deletes everything for an account.
   *
   * The audit events go too — they name the account and what it did, which is
   * exactly the personal data a deletion request is about. What survives is a
   * row in `deletion_log` holding a reference and row counts and no personal
   * data, so we can show a deletion happened without keeping what was deleted.
   */
  deleteAccount(scope: AccountScope): Record<string, number> {
    return transaction(this.db, () => {
      const counts: Record<string, number> = {};

      // Sign-in codes are keyed on the address, not the account, so they are
      // cleared by email before the account row goes.
      const account = this.db
        .prepare('SELECT email FROM accounts WHERE id = ?')
        .get(scope.accountId) as { email: string } | undefined;

      if (account) {
        const removed = this.db
          .prepare('DELETE FROM sign_in_tokens WHERE email = ?')
          .run(account.email);
        counts.sign_in_tokens = Number(removed.changes);
      }

      const order = ACCOUNT_OWNED_TABLES;

      for (const t of order) {
        const before = this.db
          .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE account_id = ?`)
          .get(scope.accountId);
        counts[t] = Number(row<{ n: number }>(before!).n);
        this.db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(scope.accountId);
      }

      /**
       * The access log is anonymised rather than deleted.
       *
       * It records that a named reviewer read a customer's evidence, which is
       * the accountability for the one operation that crosses the account
       * boundary. Deleting it along with the evidence would destroy the record
       * of who looked at what at precisely the moment that record matters.
       *
       * Keeping it as written would be worse in the other direction: a row
       * naming an account we have just promised to erase. So the account id
       * becomes the same one-way reference the deletion log uses — who read
       * how much, and when, survives; whose it was does not.
       */
      const anonymised = this.db
        .prepare('UPDATE review_access_log SET account_id = ? WHERE account_id = ?')
        .run(hashRef(scope.accountId), scope.accountId);
      counts.review_access_log_anonymised = Number(anonymised.changes);

      this.db.prepare('DELETE FROM accounts WHERE id = ?').run(scope.accountId);
      counts.accounts = 1;

      this.db
        .prepare(
          'INSERT INTO deletion_log (id, account_ref, rows_removed, deleted_at) VALUES (?, ?, ?, ?)'
        )
        .run(newId('del'), hashRef(scope.accountId), toJson(counts), new Date().toISOString());

      return counts;
    });
  }
}

/**
 * A one-way reference for the deletion log.
 *
 * Keeping the raw account id would defeat the point of deleting the account.
 * This is enough to answer "was this account deleted" when someone presents
 * the id, and useless for anything else.
 */
function hashRef(accountId: string): string {
  let h = 0;
  for (let i = 0; i < accountId.length; i++) {
    h = (Math.imul(31, h) + accountId.charCodeAt(i)) | 0;
  }
  return `ref_${(h >>> 0).toString(36)}`;
}
