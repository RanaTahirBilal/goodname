/**
 * POST /api/auth/verify — exchanges a code for a session.
 *
 * Failures are deliberately vague about which part was wrong. "That code is
 * not valid, or it has expired" covers both, because distinguishing them
 * tells someone probing whether an address has a live code outstanding.
 */
import { NextRequest, NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { setSessionCookie } from '../../../../src/server/session.ts';

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
      { status: 'invalid', message: 'Enter the code we generated for you.' },
      { status: 400 }
    );
  }

  const result = store().auth.verifyCode(email, code);

  if (!result.ok) {
    return NextResponse.json(
      {
        status: 'rejected',
        message:
          result.reason === 'too_many_attempts'
            ? 'Too many attempts on that code. Request a new one.'
            : 'That code is not valid, or it has expired.',
      },
      { status: 401 }
    );
  }

  await setSessionCookie(result.sessionToken);

  return NextResponse.json(
    {
      status: 'signed_in',
      claimed: result.claimed,
      // Said out loud rather than hidden: merging two accounts has no undo,
      // so scans left on the anonymous account stay where they are.
      orphanedScans: result.orphanedScans,
    },
    { status: 200 }
  );
}
