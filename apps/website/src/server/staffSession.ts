/**
 * The staff session cookie.
 *
 * A **different cookie name over a different table** from the customer
 * session. That separation is the point: a customer session can never be
 * mistaken for staff access, and a reviewer who is also a customer of the
 * product holds two sessions that grant two different things. Signing out of
 * one does not sign out of the other, which is the honest behaviour — they
 * are not the same identity.
 *
 * `sameSite: 'lax'` is what stands in for a CSRF token here. A cross-site
 * POST does not carry a lax cookie, so another origin cannot make a reviewer's
 * browser record a decision. The decision routes are POST only for the same
 * reason: a GET would be reachable from an image tag.
 */
import { cookies } from 'next/headers';
import type { StaffRole } from '@rep/persistence';
import { STAFF_SESSION_TTL_SECONDS } from '@rep/persistence';
import { store } from './db.ts';

const COOKIE = 'rep_staff';

export interface StaffScope {
  reviewerId: string;
  role: StaffRole;
  email: string;
}

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: STAFF_SESSION_TTL_SECONDS,
};

/** The signed-in member of staff, or null. Creates nothing. */
export async function currentStaff(): Promise<StaffScope | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  return store().staffAuth.scopeForSession(token);
}

/** The raw token, for the one case that needs it: marking the current session. */
export async function currentStaffToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function setStaffCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, cookieOptions);
}

export async function clearStaffCookie(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? null;
  jar.delete(COOKIE);
  return token;
}
