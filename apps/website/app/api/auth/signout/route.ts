/**
 * POST /api/auth/signout — ends the session.
 *
 * Revokes the row as well as clearing the cookie. Clearing only the cookie
 * would leave a working token in anyone's hands who had already copied it.
 */
import { NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { clearSessionCookie } from '../../../../src/server/session.ts';

export async function POST() {
  const token = await clearSessionCookie();
  if (token) store().auth.revokeSession(token);
  return NextResponse.json({ status: 'signed_out' }, { status: 200 });
}
