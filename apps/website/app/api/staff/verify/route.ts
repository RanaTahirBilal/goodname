/**
 * POST /api/staff/verify — exchanges a code for a staff session.
 *
 * One failure message, deliberately. Distinguishing "no such reviewer" from
 * "wrong code" would hand back the enumeration the request step refuses to
 * give away.
 */
import { NextRequest, NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { setStaffCookie } from '../../../../src/server/staffSession.ts';

export async function POST(req: NextRequest) {
  let body: { email?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';

  if (!email || !code) {
    return NextResponse.json(
      { status: 'invalid', message: 'Enter your address and the code.' },
      { status: 400 }
    );
  }

  const result = store().staffAuth.verifyCode(email, code);

  if (!result.ok) {
    return NextResponse.json(
      { status: 'rejected', message: 'That did not work. Request a new code.' },
      { status: 401 }
    );
  }

  await setStaffCookie(result.sessionToken);

  return NextResponse.json(
    {
      status: 'signed_in',
      email: result.email,
      role: result.scope.role,
      // Said out loud: a staff session is short, and the interface should
      // show when it ends rather than dropping someone mid-decision.
      expiresAt: result.expiresAt,
    },
    { status: 200 }
  );
}
