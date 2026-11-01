/**
 * GET /api/staff/me — who the queue thinks you are.
 *
 * Returns `{ staff: null }` rather than a 401 when nobody is signed in: the
 * review page calls this to decide whether to show a sign-in form, and a
 * failed request is not the same thing as a signed-out one.
 */
import { NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { currentStaff, currentStaffToken } from '../../../../src/server/staffSession.ts';

export async function GET() {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ staff: null }, { status: 200 });

  const token = await currentStaffToken();

  return NextResponse.json(
    {
      staff: { email: staff.email, role: staff.role },
      pending: store().review.pendingCount(),
      sessions: store().staffAuth.sessions(staff.reviewerId, token ?? undefined),
    },
    { status: 200 }
  );
}
