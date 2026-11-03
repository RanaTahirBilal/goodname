/**
 * POST /api/account/delete — schedule deletion.
 * DELETE /api/account/delete — call it off.
 *
 * Scheduled, not immediate: `api-contract.md` section 12 specifies a 30-day
 * grace period and a cancellation window, which is also what the app stores
 * require of in-app deletion. The hard purge runs later, on the worker's
 * sweep.
 *
 * `confirm: "DELETE"` is required in the body. Not security — a session
 * cookie is what authorises this — but a deliberate step, because the
 * action is irreversible once the grace period ends and an accidental POST
 * should not start that clock.
 */
import { NextRequest, NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { currentScope } from '../../../../src/server/session.ts';

export async function POST(req: NextRequest) {
  const scope = await currentScope();
  if (!scope) {
    return NextResponse.json({ error: 'No session.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.confirm !== 'DELETE') {
    return NextResponse.json(
      {
        error: 'Confirmation required.',
        message: 'Send { "confirm": "DELETE" } to schedule deletion of this account.',
      },
      { status: 400 }
    );
  }

  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined;
  const status = store().repo.requestDeletion(scope, reason);

  /**
   * The session is left alone, and that is the point of a grace period.
   *
   * Signing them out here would be tidier and would also mean the only way
   * back in is a sign-in code — which, with no mail provider (OQ-14),
   * nobody can receive. Somebody who deleted by accident would be locked
   * out of cancelling their own deletion.
   */
  return NextResponse.json({ status: 'scheduled', ...status }, { status: 200 });
}

export async function DELETE() {
  const scope = await currentScope();
  if (!scope) {
    return NextResponse.json({ error: 'No session.' }, { status: 401 });
  }

  const cancelled = store().repo.cancelDeletion(scope);

  return NextResponse.json(
    cancelled
      ? { status: 'cancelled' }
      : { status: 'nothing_pending' },
    { status: 200 }
  );
}
