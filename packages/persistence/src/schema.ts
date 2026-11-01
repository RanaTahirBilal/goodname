/**
 * Schema migrations, applied in order and recorded.
 *
 * Every table that holds customer data carries `account_id`, and every query
 * in the repository filters on it. There is no "get by id" that does not also
 * take an account — the isolation is in the API shape, not in a convention
 * that the next caller has to remember.
 *
 * SQLite via `node:sqlite` rather than Postgres, because no database has been
 * provisioned and none can be from here. The SQL is deliberately plain so the
 * move to Postgres is a driver change: no SQLite-specific types, no `INSERT
 * OR REPLACE`, no implicit rowid dependence.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE accounts (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        deleted_at    TEXT
      );
      CREATE UNIQUE INDEX idx_accounts_email ON accounts (email) WHERE deleted_at IS NULL;

      CREATE TABLE professional_identities (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL REFERENCES accounts(id),
        full_name     TEXT NOT NULL,
        profession    TEXT NOT NULL,
        employer      TEXT,
        city          TEXT,
        region        TEXT,
        credentials   TEXT NOT NULL DEFAULT '[]',
        website_url   TEXT,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_identities_account ON professional_identities (account_id);

      CREATE TABLE scans (
        id                TEXT PRIMARY KEY,
        account_id        TEXT NOT NULL REFERENCES accounts(id),
        identity_id       TEXT NOT NULL REFERENCES professional_identities(id),
        status            TEXT NOT NULL,
        provider          TEXT NOT NULL,
        is_fixture        INTEGER NOT NULL,
        window_size       INTEGER NOT NULL,
        queries           TEXT NOT NULL,
        purpose           TEXT NOT NULL,
        requester_id      TEXT NOT NULL,
        coverage_note     TEXT,
        partial_coverage  INTEGER NOT NULL DEFAULT 0,
        failure           TEXT,
        started_at        TEXT NOT NULL,
        completed_at      TEXT,
        -- Lets a retried request return the original scan rather than
        -- spending another provider call and creating a duplicate record.
        idempotency_key   TEXT
      );
      CREATE INDEX idx_scans_account ON scans (account_id, started_at DESC);
      CREATE UNIQUE INDEX idx_scans_idempotency
        ON scans (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE evidence (
        id                    TEXT NOT NULL,
        scan_id               TEXT NOT NULL REFERENCES scans(id),
        account_id            TEXT NOT NULL REFERENCES accounts(id),
        source_url            TEXT NOT NULL,
        source_name           TEXT NOT NULL,
        domain                TEXT NOT NULL,
        retrieved_at          TEXT NOT NULL,
        published_at          TEXT,
        title                 TEXT NOT NULL,
        excerpt               TEXT NOT NULL,
        position              INTEGER,
        provenance            TEXT NOT NULL,
        provider_name         TEXT NOT NULL,
        identity_confidence   REAL NOT NULL,
        identity_status       TEXT NOT NULL,
        identity_signals      TEXT NOT NULL,
        source_reliability    TEXT NOT NULL,
        authority             REAL NOT NULL,
        classification        TEXT NOT NULL,
        classification_conf   REAL NOT NULL,
        classification_reason TEXT NOT NULL,
        finding_status        TEXT,
        severity              INTEGER,
        severity_rationale    TEXT,
        review_status         TEXT NOT NULL,
        contradicted_by       TEXT,
        correction_of         TEXT,
        story_cluster_id      TEXT,
        duplicate_of          TEXT,
        independent_sources   INTEGER,
        PRIMARY KEY (scan_id, id)
      );
      CREATE INDEX idx_evidence_account ON evidence (account_id, scan_id);

      -- A customer saying "this is me" or "this is not me" changes the score,
      -- so it is an auditable decision, not a UI preference.
      CREATE TABLE identity_decisions (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL REFERENCES accounts(id),
        scan_id       TEXT NOT NULL REFERENCES scans(id),
        evidence_id   TEXT NOT NULL,
        decision      TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
        decided_at    TEXT NOT NULL,
        decided_by    TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_decisions_unique
        ON identity_decisions (scan_id, evidence_id);
      CREATE INDEX idx_decisions_account ON identity_decisions (account_id, scan_id);

      -- Snapshots are immutable. A rescore after a customer decision writes a
      -- new row; history is never restated.
      CREATE TABLE presence_snapshots (
        id                    TEXT PRIMARY KEY,
        account_id            TEXT NOT NULL REFERENCES accounts(id),
        scan_id               TEXT NOT NULL REFERENCES scans(id),
        status                TEXT NOT NULL,
        methodology_version   TEXT NOT NULL,
        score                 INTEGER,
        coverage              REAL NOT NULL,
        payload               TEXT NOT NULL,
        computed_at           TEXT NOT NULL,
        reason                TEXT NOT NULL
      );
      CREATE INDEX idx_presence_account ON presence_snapshots (account_id, scan_id, computed_at DESC);

      CREATE TABLE risk_snapshots (
        id                    TEXT PRIMARY KEY,
        account_id            TEXT NOT NULL REFERENCES accounts(id),
        scan_id               TEXT NOT NULL REFERENCES scans(id),
        methodology_version   TEXT NOT NULL,
        level                 TEXT NOT NULL,
        payload               TEXT NOT NULL,
        assessed_at           TEXT NOT NULL,
        reason                TEXT NOT NULL
      );
      CREATE INDEX idx_risk_account ON risk_snapshots (account_id, scan_id, assessed_at DESC);

      -- Rate limiting and enumeration detection. Survives restarts, which the
      -- in-memory store did not.
      CREATE TABLE audit_attempts (
        id              TEXT PRIMARY KEY,
        requester_id    TEXT NOT NULL,
        subject_key     TEXT NOT NULL,
        subject_name    TEXT NOT NULL,
        purpose         TEXT NOT NULL,
        attempted_at    TEXT NOT NULL
      );
      CREATE INDEX idx_attempts_requester ON audit_attempts (requester_id, attempted_at DESC);

      CREATE TABLE audit_events (
        id            TEXT PRIMARY KEY,
        account_id    TEXT,
        actor         TEXT NOT NULL,
        action        TEXT NOT NULL,
        subject_type  TEXT NOT NULL,
        subject_id    TEXT,
        metadata      TEXT NOT NULL DEFAULT '{}',
        occurred_at   TEXT NOT NULL
      );
      CREATE INDEX idx_events_account ON audit_events (account_id, occurred_at DESC);

      -- Survives account deletion on purpose: proof that a deletion happened,
      -- holding no personal data.
      CREATE TABLE deletion_log (
        id            TEXT PRIMARY KEY,
        account_ref   TEXT NOT NULL,
        rows_removed  TEXT NOT NULL,
        deleted_at    TEXT NOT NULL
      );
    `,
  },

  {
    version: 2,
    name: 'authentication',
    sql: `
      -- Accounts gain a real identity. Existing rows hold an opaque
      -- 'session:...' identifier in "email"; "kind" tells them apart so a
      -- browser session is never mistaken for a verified person.
      ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'session';
      ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;

      /**
       * Single-use sign-in codes.
       *
       * Only the hash is stored. A database dump therefore does not hand
       * anyone a working code — the same reason a password would be hashed,
       * except there is no password here to leak in the first place.
       */
      CREATE TABLE sign_in_tokens (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        token_hash    TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL,
        consumed_at   TEXT,
        attempts      INTEGER NOT NULL DEFAULT 0,
        -- The anonymous account to attach on success, when there is one.
        claim_account TEXT
      );
      CREATE INDEX idx_tokens_email ON sign_in_tokens (email, created_at DESC);

      -- Sessions are rows, not signed blobs, so revoking one actually ends it.
      CREATE TABLE sessions (
        id            TEXT PRIMARY KEY,
        account_id    TEXT NOT NULL REFERENCES accounts(id),
        token_hash    TEXT NOT NULL UNIQUE,
        created_at    TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        expires_at    TEXT NOT NULL,
        revoked_at    TEXT
      );
      CREATE INDEX idx_sessions_account ON sessions (account_id, created_at DESC);

      /**
       * Where "sent" email goes.
       *
       * No mail provider is configured. Writing the message to a table and
       * saying so is honest; pretending to send it is not, and a silent
       * no-op would look like a working product right up until a real
       * customer never received anything.
       */
      CREATE TABLE email_outbox (
        id            TEXT PRIMARY KEY,
        to_email      TEXT NOT NULL,
        subject       TEXT NOT NULL,
        body          TEXT NOT NULL,
        delivered_via TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_outbox_email ON email_outbox (to_email, created_at DESC);
    `,
  },

  {
    version: 3,
    name: 'background_jobs',
    sql: `
      /**
       * Work that cannot run inside a request.
       *
       * The cheapest search provider averages five minutes per batch, so an
       * audit against a real provider can never be synchronous. See
       * docs/SEARCH_PROVIDERS.md.
       *
       * Two columns carry the retry rules rather than leaving them to each
       * caller's memory:
       *
       *   "attempts" / "max_attempts" bound the loop, so a permanently
       *   failing job stops rather than burning provider quota forever.
       *
       *   "side_effects_sent" marks the point of no return. An audit is a
       *   read, so retrying costs money and nothing else. A job that posts a
       *   correction request to a third party is not, and must set this the
       *   moment it sends — a retry after that would send twice.
       */
      CREATE TABLE jobs (
        id                 TEXT PRIMARY KEY,
        account_id         TEXT NOT NULL REFERENCES accounts(id),
        type               TEXT NOT NULL,
        status             TEXT NOT NULL CHECK (
                             status IN ('queued','running','succeeded','failed')
                           ),
        payload            TEXT NOT NULL DEFAULT '{}',
        attempts           INTEGER NOT NULL DEFAULT 0,
        max_attempts       INTEGER NOT NULL DEFAULT 3,
        side_effects_sent  INTEGER NOT NULL DEFAULT 0,
        last_error         TEXT,
        -- Claimable only once the clock passes this. Carries the backoff.
        available_at       TEXT NOT NULL,
        created_at         TEXT NOT NULL,
        started_at         TEXT,
        finished_at        TEXT,
        -- The scan, content asset or case this job is doing work for.
        subject_type       TEXT,
        subject_id         TEXT
      );

      CREATE INDEX idx_jobs_claimable ON jobs (status, available_at);
      CREATE INDEX idx_jobs_account ON jobs (account_id, created_at DESC);
      CREATE INDEX idx_jobs_subject ON jobs (subject_type, subject_id);
    `,
  },

  {
    version: 4,
    name: 'human_review',
    sql: `
      /**
       * Internal reviewers. Separate from accounts on purpose: a customer and
       * a member of staff are different kinds of thing, and merging them is
       * how a customer ends up one boolean away from reading other people's
       * evidence.
       */
      CREATE TABLE staff (
        id           TEXT PRIMARY KEY,
        email        TEXT NOT NULL,
        role         TEXT NOT NULL CHECK (role IN ('reviewer','admin')),
        created_at   TEXT NOT NULL,
        disabled_at  TEXT
      );
      CREATE UNIQUE INDEX idx_staff_email ON staff (email) WHERE disabled_at IS NULL;

      /**
       * What a reviewer concluded about one flagged record.
       *
       * Append-only. A reviewer changing their mind writes a second row, so
       * the sequence of judgements survives — which matters when the question
       * later is "who decided this was a finding, and on what basis".
       *
       * "rationale" is required by the repository, not by the column, because
       * a decision that moves someone's risk level without a stated reason is
       * not reviewable by anybody else.
       */
      CREATE TABLE review_decisions (
        id            TEXT PRIMARY KEY,
        scan_id       TEXT NOT NULL REFERENCES scans(id),
        account_id    TEXT NOT NULL REFERENCES accounts(id),
        evidence_id   TEXT NOT NULL,
        reviewer_id   TEXT NOT NULL REFERENCES staff(id),
        outcome       TEXT NOT NULL CHECK (outcome IN (
                        'uphold',
                        'downgrade_to_allegation',
                        'reject_not_this_person',
                        'reject_not_harm'
                      )),
        rationale     TEXT NOT NULL,
        decided_at    TEXT NOT NULL
      );
      CREATE INDEX idx_review_scan ON review_decisions (scan_id, evidence_id, decided_at DESC);
      CREATE INDEX idx_review_reviewer ON review_decisions (reviewer_id, decided_at DESC);

      /**
       * Every time a reviewer reads customer evidence.
       *
       * Reviewing is the one operation in this system that crosses the
       * account boundary, so it is the one that needs a record of who looked
       * at what. A log that only captures decisions misses the reviewer who
       * read fifty records and decided nothing.
       */
      CREATE TABLE review_access_log (
        id           TEXT PRIMARY KEY,
        reviewer_id  TEXT NOT NULL REFERENCES staff(id),
        account_id   TEXT NOT NULL,
        scan_id      TEXT NOT NULL,
        evidence_id  TEXT,
        action       TEXT NOT NULL,
        occurred_at  TEXT NOT NULL
      );
      CREATE INDEX idx_review_access ON review_access_log (reviewer_id, occurred_at DESC);
    `,
  },
  {
    version: 5,
    name: 'staff_authentication',
    sql: `
      /**
       * Sign-in codes for staff.
       *
       * Separate from "sign_in_tokens" on purpose, and the difference is the
       * whole point of the table: a customer code creates an account when it
       * is verified, and a staff code never can. A row here only exists if an
       * active staff row already existed when it was requested, so there is
       * no path from "knows an address" to "is staff".
       *
       * It carries "staff_id" rather than an email so a code cannot outlive
       * the identity it was issued for: delete or disable the staff row and
       * the foreign key, not a later lookup, is what stops the code working.
       */
      CREATE TABLE staff_sign_in_tokens (
        id            TEXT PRIMARY KEY,
        staff_id      TEXT NOT NULL REFERENCES staff(id),
        token_hash    TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL,
        consumed_at   TEXT,
        attempts      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_staff_tokens ON staff_sign_in_tokens (staff_id, created_at DESC);

      /**
       * Staff sessions. Rows, like customer sessions, so revoking one ends it.
       *
       * Deliberately short-lived compared with a customer session. A customer
       * session left open on a laptop exposes that customer's own report; a
       * staff session left open exposes the queue, which is other people's
       * evidence. The two are not worth the same convenience.
       */
      CREATE TABLE staff_sessions (
        id            TEXT PRIMARY KEY,
        staff_id      TEXT NOT NULL REFERENCES staff(id),
        token_hash    TEXT NOT NULL UNIQUE,
        created_at    TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        expires_at    TEXT NOT NULL,
        revoked_at    TEXT
      );
      CREATE INDEX idx_staff_sessions ON staff_sessions (staff_id, created_at DESC);
    `,
  },
  {
    version: 6,
    name: 'retention',
    sql: `
      /**
       * When the evidence behind a scan was aged out.
       *
       * Not a status. The scan still completed, and saying otherwise would
       * rewrite history to describe our own housekeeping. "status" stays
       * "complete"; this column says we no longer hold what it found, so the
       * report can tell the customer that rather than rendering an empty
       * page that looks like a search finding nothing.
       */
      ALTER TABLE scans ADD COLUMN evidence_expired_at TEXT;

      CREATE INDEX idx_evidence_retrieved ON evidence (retrieved_at);
      CREATE INDEX idx_outbox_created ON email_outbox (created_at);
      CREATE INDEX idx_jobs_finished ON jobs (finished_at);
      CREATE INDEX idx_sessions_expiry ON sessions (expires_at);
    `,
  },
];
