/**
 * Staff sign-in.
 *
 * Same passwordless mechanism as customer sign-in — email, a single-use code,
 * sessions as rows — with one rule reversed, and it is the rule that matters:
 *
 *   **Verifying a code never creates a member of staff.**
 *
 * Customer sign-in creates the account on verification, which is right: an
 * email address is proof enough to own your own report. Staff access crosses
 * the account boundary, so the same behaviour would mean anyone who can
 * receive mail could grant themselves the ability to read other people's
 * evidence. A code is only ever issued against a staff row that already
 * exists and is not disabled; there is no self-service path in. Staff are
 * created out of band, by `npm run staff` on the server.
 *
 * The second difference is lifetime. A customer session lasts 30 days; a
 * staff session lasts 12 hours. A customer session left open on a laptop
 * exposes that customer's own report. A staff session left open exposes the
 * queue, which is other people's evidence.
 *
 * What is kept identical to the customer flow, on purpose:
 *   - nothing usable is stored: codes and session tokens are SHA-256 hashes
 *   - the response to a code request never says whether the address is staff
 *   - a disabled staff member is nobody, immediately, with no cache to expire
 */
import { randomBytes, randomInt } from 'node:crypto';
import { constantTimeEqual, normaliseEmail, plusSeconds, sha256 } from './crypto.ts';
import { type Db, newId, transaction } from './db.ts';
import type { ReviewerScope, StaffRole } from './review.ts';

export const STAFF_CODE_TTL_SECONDS = 10 * 60;
export const STAFF_MAX_CODE_ATTEMPTS = 5;
/** Twelve hours. Roughly a shift, and nothing like a customer's 30 days. */
export const STAFF_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const STAFF_MAX_CODES_PER_WINDOW = 3;

export interface StaffCodeIssued {
  issued: true;
  /** Never stored, never logged, never returned to a browser. */
  code: string;
  email: string;
  staffId: string;
  expiresAt: string;
}

/**
 * No code was issued, and the caller is not told which of the two reasons
 * applies — the address is not staff, or it has asked too often. Both come
 * back from the route as the same sentence.
 */
export interface StaffCodeWithheld {
  issued: false;
}

export type StaffVerifyResult =
  | { ok: true; sessionToken: string; scope: ReviewerScope; email: string; expiresAt: string }
  | { ok: false };

export interface StaffSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export class StaffAuthRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /* --------------------------------------------------------- requesting */

  /**
   * Issues a code to an active member of staff, or withholds one.
   *
   * An unknown address produces no row, no mail and no error. The caller is
   * expected to answer identically either way: anything else turns this into
   * a way to enumerate who works here, which for a reputation product is a
   * list worth having.
   */
  requestCode(email: string): StaffCodeIssued | StaffCodeWithheld {
    const address = normaliseEmail(email);
    const now = new Date().toISOString();

    const staff = this.db
      .prepare('SELECT id FROM staff WHERE email = ? AND disabled_at IS NULL')
      .get(address) as { id: string } | undefined;

    // The one branch this whole file exists for.
    if (!staff) return { issued: false };

    const since = plusSeconds(now, -STAFF_CODE_TTL_SECONDS);
    const recent = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM staff_sign_in_tokens WHERE staff_id = ? AND created_at >= ?'
      )
      .get(staff.id, since) as { n: number };

    if (Number(recent.n) >= STAFF_MAX_CODES_PER_WINDOW) return { issued: false };

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = plusSeconds(now, STAFF_CODE_TTL_SECONDS);

    this.db
      .prepare(
        `INSERT INTO staff_sign_in_tokens (id, staff_id, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(newId('stok'), staff.id, sha256(code), now, expiresAt);

    return { issued: true, code, email: address, staffId: staff.id, expiresAt };
  }

  /* ---------------------------------------------------------- verifying */

  /**
   * Exchanges a code for a staff session.
   *
   * One failure result, not several. Telling the caller apart "no such
   * reviewer" from "wrong code" would hand them the enumeration the request
   * step refuses to give.
   */
  verifyCode(email: string, code: string): StaffVerifyResult {
    const address = normaliseEmail(email);
    const now = new Date().toISOString();

    const staff = this.db
      .prepare('SELECT id, role FROM staff WHERE email = ? AND disabled_at IS NULL')
      .get(address) as { id: string; role: StaffRole } | undefined;

    if (!staff) return { ok: false };

    const rows = this.db
      .prepare(
        `SELECT id, token_hash, attempts FROM staff_sign_in_tokens
          WHERE staff_id = ? AND consumed_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC`
      )
      .all(staff.id, now) as Array<{ id: string; token_hash: string; attempts: number }>;

    const candidate = sha256(code);

    for (const row of rows) {
      if (row.attempts >= STAFF_MAX_CODE_ATTEMPTS) continue;

      if (!constantTimeEqual(row.token_hash, candidate)) {
        // Guessing burns the code rather than the guesser's patience.
        this.db
          .prepare('UPDATE staff_sign_in_tokens SET attempts = attempts + 1 WHERE id = ?')
          .run(row.id);
        continue;
      }

      return transaction(this.db, () => {
        this.db
          .prepare('UPDATE staff_sign_in_tokens SET consumed_at = ? WHERE id = ?')
          .run(now, row.id);

        const sessionToken = this.createSession(staff.id, now);

        return {
          ok: true as const,
          sessionToken,
          scope: { reviewerId: staff.id, role: staff.role },
          email: address,
          expiresAt: plusSeconds(now, STAFF_SESSION_TTL_SECONDS),
        };
      });
    }

    return { ok: false };
  }

  /* ----------------------------------------------------------- sessions */

  createSession(staffId: string, now = new Date().toISOString()): string {
    const token = randomBytes(32).toString('base64url');

    this.db
      .prepare(
        `INSERT INTO staff_sessions
           (id, staff_id, token_hash, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId('ssess'),
        staffId,
        sha256(token),
        now,
        now,
        plusSeconds(now, STAFF_SESSION_TTL_SECONDS)
      );

    return token;
  }

  /**
   * Resolves a staff session token to a reviewer scope, or null.
   *
   * The join requires the staff row to be active, so disabling someone ends
   * their access on their next request without anyone having to find and
   * revoke their sessions. `disableStaff` revokes them as well; this is the
   * half that cannot be forgotten.
   */
  scopeForSession(token: string): (ReviewerScope & { email: string }) | null {
    const now = new Date().toISOString();

    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, st.id AS staff_id, st.role, st.email
           FROM staff_sessions s
           JOIN staff st ON st.id = s.staff_id
          WHERE s.token_hash = ?
            AND s.revoked_at IS NULL
            AND s.expires_at > ?
            AND st.disabled_at IS NULL`
      )
      .get(sha256(token), now) as
      | { session_id: string; staff_id: string; role: StaffRole; email: string }
      | undefined;

    if (!row) return null;

    this.db
      .prepare('UPDATE staff_sessions SET last_seen_at = ? WHERE id = ?')
      .run(now, row.session_id);

    return { reviewerId: row.staff_id, role: row.role, email: row.email };
  }

  revokeSession(token: string): boolean {
    const result = this.db
      .prepare(
        'UPDATE staff_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL'
      )
      .run(new Date().toISOString(), sha256(token));
    return Number(result.changes) > 0;
  }

  /** Ends every session a member of staff holds. */
  revokeAllSessions(staffId: string): number {
    const result = this.db
      .prepare(
        'UPDATE staff_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL'
      )
      .run(new Date().toISOString(), staffId);
    return Number(result.changes);
  }

  /** A reviewer's own live sessions, so they can see where they are signed in. */
  sessions(staffId: string, currentToken?: string): StaffSession[] {
    const now = new Date().toISOString();
    const currentHash = currentToken ? sha256(currentToken) : null;

    return this.db
      .prepare(
        `SELECT id, token_hash, created_at, last_seen_at, expires_at
           FROM staff_sessions
          WHERE staff_id = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC`
      )
      .all(staffId, now)
      .map((raw) => {
        const r = raw as Record<string, string>;
        return {
          id: r.id,
          createdAt: r.created_at,
          lastSeenAt: r.last_seen_at,
          expiresAt: r.expires_at,
          current: currentHash !== null && r.token_hash === currentHash,
        };
      });
  }

  /** Removes consumed and expired codes. They are single-use by then anyway. */
  pruneTokens(now = new Date().toISOString()): number {
    const result = this.db
      .prepare(
        'DELETE FROM staff_sign_in_tokens WHERE expires_at < ? OR consumed_at IS NOT NULL'
      )
      .run(now);
    return Number(result.changes);
  }
}

export const staffSignInEmail = (
  code: string,
  minutes: number
): { subject: string; body: string } => ({
  subject: 'Your review queue sign-in code',
  body:
    `Your sign-in code is ${code}\n\n` +
    `It expires in ${minutes} minutes and can only be used once.\n\n` +
    `This code signs you in to the internal review queue, which contains ` +
    `customers' evidence. If you did not ask to sign in, tell someone — a ` +
    `code was requested against your staff account.`,
});
