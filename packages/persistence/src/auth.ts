/**
 * Passwordless authentication.
 *
 * Email plus a single-use code. No passwords, which means no hashing choices
 * to get wrong, no reset flow to attack, and nothing reusable to leak — the
 * cheapest way to avoid a whole category of mistakes.
 *
 * Three properties the tests hold this to:
 *
 *   1. **Nothing usable is stored.** Codes and session tokens are kept as
 *      SHA-256 hashes. A database dump does not hand anyone a way in.
 *   2. **The response never reveals whether an address is registered.**
 *      Requesting a code looks identical for a known and an unknown email.
 *   3. **Sessions are rows.** Revoking one actually ends it, which a signed
 *      stateless token cannot promise.
 *
 * Codes are six digits, which is low entropy on its own. It is made safe by
 * short expiry, single use, and a hard attempt limit per code — not by the
 * code itself. That trade is deliberate: a 32-character code nobody can read
 * off their phone gets pasted into the wrong window instead.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  constantTimeEqual as equal,
  normaliseEmail,
  plusSeconds,
  sha256 as hash,
} from './crypto.ts';
import { type Db, newId, transaction } from './db.ts';
import { recordEvent } from './events.ts';
import type { AccountScope } from './repository.ts';

export const CODE_TTL_SECONDS = 10 * 60;
export const MAX_CODE_ATTEMPTS = 5;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** How many codes one address may request inside the TTL window. */
export const MAX_CODES_PER_WINDOW = 3;

export interface SignInRequest {
  /** The code to deliver. Never stored, never logged, never returned to a client. */
  code: string;
  email: string;
  expiresAt: string;
}

export type VerifyResult =
  | { ok: true; sessionToken: string; accountId: string; claimed: boolean; orphanedScans: number }
  | { ok: false; reason: 'invalid_or_expired' | 'too_many_attempts' };

export class AuthRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /* --------------------------------------------------------- requesting */

  /**
   * Issues a code.
   *
   * Deliberately does **not** say whether the address has an account — the
   * account is created on verification, not here, so there is nothing to
   * disclose. `claimAccountId` is an anonymous session account to attach on
   * success, so a visitor's first audit is not lost when they sign in.
   */
  requestCode(email: string, claimAccountId?: string | null): SignInRequest | { throttled: true } {
    const address = normaliseEmail(email);
    const now = new Date().toISOString();
    const since = plusSeconds(now, -CODE_TTL_SECONDS);

    const recent = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM sign_in_tokens WHERE email = ? AND created_at >= ?'
      )
      .get(address, since);

    if (Number((recent as { n: number }).n) >= MAX_CODES_PER_WINDOW) {
      return { throttled: true };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = plusSeconds(now, CODE_TTL_SECONDS);

    this.db
      .prepare(
        `INSERT INTO sign_in_tokens (id, email, token_hash, created_at, expires_at, claim_account)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(newId('tok'), address, hash(code), now, expiresAt, claimAccountId ?? null);

    return { code, email: address, expiresAt };
  }

  /* ---------------------------------------------------------- verifying */

  verifyCode(email: string, code: string): VerifyResult {
    const address = normaliseEmail(email);
    const now = new Date().toISOString();

    const rows = this.db
      .prepare(
        `SELECT id, token_hash, expires_at, consumed_at, attempts, claim_account
           FROM sign_in_tokens
          WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC`
      )
      .all(address, now) as Array<{
      id: string;
      token_hash: string;
      expires_at: string;
      consumed_at: string | null;
      attempts: number;
      claim_account: string | null;
    }>;

    if (rows.length === 0) return { ok: false, reason: 'invalid_or_expired' };

    const candidate = hash(code);

    for (const row of rows) {
      if (row.attempts >= MAX_CODE_ATTEMPTS) continue;

      if (!equal(row.token_hash, candidate)) {
        // Count the failure against this code, so guessing burns the code
        // rather than the attacker's patience.
        this.db
          .prepare('UPDATE sign_in_tokens SET attempts = attempts + 1 WHERE id = ?')
          .run(row.id);
        continue;
      }

      return transaction(this.db, () => {
        this.db
          .prepare('UPDATE sign_in_tokens SET consumed_at = ? WHERE id = ?')
          .run(now, row.id);

        const { accountId, claimed, orphanedScans } = this.resolveAccount(
          address,
          row.claim_account,
          now
        );
        const sessionToken = this.createSession(accountId, now);

        recordEvent(this.db, {
          accountId,
          actor: 'customer',
          action: 'auth.signed_in',
          subjectType: 'account',
          subjectId: accountId,
          metadata: { claimed, orphanedScans },
        });

        return { ok: true as const, sessionToken, accountId, claimed, orphanedScans };
      });
    }

    const exhausted = rows.every((r) => r.attempts >= MAX_CODE_ATTEMPTS);
    return { ok: false, reason: exhausted ? 'too_many_attempts' : 'invalid_or_expired' };
  }

  /**
   * Finds or creates the account behind a verified address.
   *
   * When the visitor already has an anonymous session account and the address
   * is new, that account is claimed — their first audit carries over rather
   * than disappearing at the moment they sign up.
   *
   * When the address already has an account, we sign into **that** one.
   * Merging two accounts' scans is a destructive operation with no undo, so
   * instead we count what is left behind and let the caller say so plainly.
   */
  private resolveAccount(
    email: string,
    claimAccountId: string | null,
    now: string
  ): { accountId: string; claimed: boolean; orphanedScans: number } {
    const existing = this.db
      .prepare("SELECT id FROM accounts WHERE email = ? AND kind = 'email' AND deleted_at IS NULL")
      .get(email) as { id: string } | undefined;

    if (existing) {
      const orphaned = claimAccountId
        ? Number(
            (
              this.db
                .prepare('SELECT COUNT(*) AS n FROM scans WHERE account_id = ?')
                .get(claimAccountId) as { n: number }
            ).n
          )
        : 0;
      return { accountId: existing.id, claimed: false, orphanedScans: orphaned };
    }

    if (claimAccountId) {
      const anon = this.db
        .prepare("SELECT id FROM accounts WHERE id = ? AND kind = 'session' AND deleted_at IS NULL")
        .get(claimAccountId) as { id: string } | undefined;

      if (anon) {
        this.db
          .prepare(
            "UPDATE accounts SET email = ?, kind = 'email', email_verified_at = ? WHERE id = ?"
          )
          .run(email, now, anon.id);

        recordEvent(this.db, {
          accountId: anon.id,
          actor: 'customer',
          action: 'account.claimed',
          subjectType: 'account',
          subjectId: anon.id,
        });

        return { accountId: anon.id, claimed: true, orphanedScans: 0 };
      }
    }

    const accountId = newId('acct');
    this.db
      .prepare(
        "INSERT INTO accounts (id, email, created_at, kind, email_verified_at) VALUES (?, ?, ?, 'email', ?)"
      )
      .run(accountId, email, now, now);

    recordEvent(this.db, {
      accountId,
      actor: 'system',
      action: 'account.created',
      subjectType: 'account',
      subjectId: accountId,
    });

    return { accountId, claimed: false, orphanedScans: 0 };
  }

  /* ----------------------------------------------------------- sessions */

  createSession(accountId: string, now = new Date().toISOString()): string {
    const token = randomBytes(32).toString('base64url');

    this.db
      .prepare(
        `INSERT INTO sessions (id, account_id, token_hash, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId('sess'),
        accountId,
        hash(token),
        now,
        now,
        plusSeconds(now, SESSION_TTL_SECONDS)
      );

    return token;
  }

  /** Resolves a session token to a scope, or null. Expired and revoked fail. */
  scopeForSession(token: string): (AccountScope & { verified: boolean; email: string }) | null {
    const now = new Date().toISOString();

    const row = this.db
      .prepare(
        `SELECT s.id AS session_id, s.account_id, a.email, a.kind, a.email_verified_at
           FROM sessions s
           JOIN accounts a ON a.id = s.account_id
          WHERE s.token_hash = ?
            AND s.revoked_at IS NULL
            AND s.expires_at > ?
            AND a.deleted_at IS NULL`
      )
      .get(hash(token), now) as
      | {
          session_id: string;
          account_id: string;
          email: string;
          kind: string;
          email_verified_at: string | null;
        }
      | undefined;

    if (!row) return null;

    this.db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .run(now, row.session_id);

    return {
      accountId: row.account_id,
      actor: 'customer',
      verified: row.kind === 'email' && row.email_verified_at !== null,
      email: row.email,
    };
  }

  revokeSession(token: string): boolean {
    const result = this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), hash(token));
    return Number(result.changes) > 0;
  }

  /** Ends every session for an account — "sign out everywhere". */
  revokeAllSessions(scope: AccountScope): number {
    const result = this.db
      .prepare(
        'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL'
      )
      .run(new Date().toISOString(), scope.accountId);

    recordEvent(this.db, {
      accountId: scope.accountId,
      actor: scope.actor,
      action: 'auth.sessions_revoked',
      subjectType: 'account',
      subjectId: scope.accountId,
      metadata: { count: Number(result.changes) },
    });

    return Number(result.changes);
  }

  /** Creates an anonymous account for a first-time visitor. */
  createAnonymousAccount(): { accountId: string; sessionToken: string } {
    const accountId = newId('acct');
    const now = new Date().toISOString();

    this.db
      .prepare(
        "INSERT INTO accounts (id, email, created_at, kind) VALUES (?, ?, ?, 'session')"
      )
      .run(accountId, `session:${randomBytes(16).toString('hex')}`, now);

    recordEvent(this.db, {
      accountId,
      actor: 'system',
      action: 'account.created',
      subjectType: 'account',
      subjectId: accountId,
      metadata: { kind: 'session' },
    });

    return { accountId, sessionToken: this.createSession(accountId, now) };
  }

  /** Removes consumed and expired codes. They are single-use by then anyway. */
  pruneTokens(now = new Date().toISOString()): number {
    const result = this.db
      .prepare('DELETE FROM sign_in_tokens WHERE expires_at < ? OR consumed_at IS NOT NULL')
      .run(now);
    return Number(result.changes);
  }
}
