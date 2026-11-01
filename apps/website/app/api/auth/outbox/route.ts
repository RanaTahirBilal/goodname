/**
 * GET /api/auth/outbox — the most recent sign-in code for an address.
 *
 * **This endpoint hands out sign-in codes.** It exists only because no mail
 * provider is configured and there would otherwise be no way to complete a
 * sign-in at all.
 *
 * It is guarded twice, and both guards have to hold:
 *   - the build must not be production, and
 *   - the configured deliverer must not actually send mail.
 *
 * The moment a real provider is wired in, the second guard closes this on its
 * own without anyone having to remember to delete the file. Until then it is
 * a development affordance that would be a critical hole in production, which
 * is why it fails closed rather than relying on a comment telling someone to
 * remove it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readOutbox } from '@rep/persistence';
import { store } from '../../../../src/server/db.ts';

export async function GET(req: NextRequest) {
  const { db, email: deliverer } = store();

  if (process.env.NODE_ENV === 'production' || deliverer.reallySends) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const address = req.nextUrl.searchParams.get('email');
  if (!address) return NextResponse.json({ error: 'Missing email.' }, { status: 400 });

  const latest = readOutbox(db, address, 1)[0];
  if (!latest) return NextResponse.json({ code: null }, { status: 200 });

  const match = /code is (\d{6})/.exec(latest.body);

  return NextResponse.json(
    { code: match?.[1] ?? null, createdAt: latest.created_at, devOnly: true },
    { status: 200 }
  );
}
