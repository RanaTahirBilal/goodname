/**
 * Session handling.
 *
 * The cookie holds an opaque session token. Only its hash is in the database,
 * so a dump does not hand anyone a working session, and revoking a row ends
 * the session immediately — which a signed stateless token cannot promise.
 *
 * The scope is always derived from the cookie, server side. It is never read
 * from a request body or a query parameter, because a client-supplied account
 * id is how cross-tenant reads happen.
 */
import { cookies } from 'next/headers';
import type { AccountScope } from '@rep/persistence';
import { store } from './db.ts';

const COOKIE = 'rep_session';
const MAX_AGE = 60 * 60 * 24 * 30;

export interface SessionScope extends AccountScope {
  /** True only for an account that has verified an email address. */
  verified: boolean;
  email: string;
  anonymous: boolean;
}

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE,
};

/** The current session, or null. Creates nothing. */
export async function currentScope(): Promise<SessionScope | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const scope = store().auth.scopeForSession(token);
  if (!scope) return null;

  return { ...scope, anonymous: !scope.verified };
}

/**
 * The current session, creating an anonymous one if needed.
 *
 * A visitor can run their first audit without signing up — the funnel dies
 * otherwise. The safeguards already escalate on the second *different* name,
 * which is the behaviour that actually matters, so requiring an account up
 * front would cost conversion without buying protection.
 */
export async function ensureScope(): Promise<SessionScope> {
  const existing = await currentScope();
  if (existing) return existing;

  const { auth } = store();
  const created = auth.createAnonymousAccount();

  (await cookies()).set(COOKIE, created.sessionToken, cookieOptions);

  return {
    accountId: created.accountId,
    actor: 'customer',
    verified: false,
    email: '',
    anonymous: true,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, cookieOptions);
}

export async function clearSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? null;
  jar.delete(COOKIE);
  return token;
}
