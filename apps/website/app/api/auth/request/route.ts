/**
 * POST /api/auth/request — issues a sign-in code.
 *
 * The response is the same whether or not the address has an account. It has
 * to be: a different message for a known address turns this endpoint into a
 * way to test whether someone is a customer, which for a reputation product
 * is a particularly bad thing to leak.
 *
 * No mail provider is configured, so the code is written to the outbox table
 * and the response says `delivered: false`. The UI shows that plainly rather
 * than telling someone to check an inbox that will stay empty.
 */
import { NextRequest, NextResponse } from 'next/server';
import { signInEmail, CODE_TTL_SECONDS } from '@rep/persistence';
import { store } from '../../../../src/server/db.ts';
import { currentScope } from '../../../../src/server/session.ts';

/** Shape-only. Address validity is the mail provider's problem, not a regex's. */
const looksLikeEmail = (v: unknown): v is string =>
  typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.length <= 320;

export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (!looksLikeEmail(body.email)) {
    return NextResponse.json(
      { status: 'invalid', message: 'Enter an email address.' },
      { status: 400 }
    );
  }

  const { auth, email: deliverer } = store();

  // If they already have an anonymous session with a scan in it, that account
  // is offered up to be claimed so their first audit is not lost.
  const existing = await currentScope();
  const claimAccountId = existing?.anonymous ? existing.accountId : null;

  const requested = auth.requestCode(body.email, claimAccountId);

  if ('throttled' in requested) {
    return NextResponse.json(
      {
        status: 'throttled',
        message:
          'A few codes have already been sent to that address. Wait a few minutes before asking for another.',
      },
      { status: 429 }
    );
  }

  const message = signInEmail(requested.code, Math.round(CODE_TTL_SECONDS / 60));
  const delivery = await deliverer.send({ to: requested.email, ...message });

  return NextResponse.json(
    {
      status: 'sent',
      email: requested.email,
      expiresAt: requested.expiresAt,
      // The truth, passed through to the interface.
      delivered: delivery.delivered,
      via: delivery.via,
    },
    { status: 200 }
  );
}
