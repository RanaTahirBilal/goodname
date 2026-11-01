/**
 * POST /api/staff/request — issues a review-queue sign-in code.
 *
 * **One response, always.** Not 404 for an unknown address, not 429 when
 * throttled, not a different sentence for staff: the same 200 and the same
 * words whatever happened. Anything else turns this endpoint into a way to
 * ask "does this person work here", and for a company that reads other
 * people's reputation evidence, the list of who does is worth having.
 *
 * Nothing is created here. A code is only written against a staff row that
 * already exists and is not disabled.
 */
import { NextRequest, NextResponse } from 'next/server';
import { staffSignInEmail, STAFF_CODE_TTL_SECONDS } from '@rep/persistence';
import { store } from '../../../../src/server/db.ts';

const looksLikeEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 320;

/** The only thing this endpoint ever says. */
const SAME_ANSWER = {
  status: 'requested',
  message:
    'If that address belongs to an active reviewer, a code is on its way. It expires in 10 minutes.',
} as const;

export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // A malformed address is the one thing worth saying, because it cannot
  // belong to anybody and the reviewer has simply mistyped it.
  if (!looksLikeEmail(body.email)) {
    return NextResponse.json(
      { status: 'invalid', message: 'Enter an email address.' },
      { status: 400 }
    );
  }

  const { staffAuth, email: deliverer } = store();
  const issued = staffAuth.requestCode(body.email);

  if (issued.issued) {
    const message = staffSignInEmail(
      issued.code,
      Math.round(STAFF_CODE_TTL_SECONDS / 60)
    );
    await deliverer.send({ to: issued.email, ...message });
  }

  return NextResponse.json(SAME_ANSWER, { status: 200 });
}
