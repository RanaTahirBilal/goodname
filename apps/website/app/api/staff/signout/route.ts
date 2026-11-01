/**
 * POST /api/staff/signout — ends this staff session, or all of them.
 *
 * Revokes the row as well as dropping the cookie. Clearing the cookie alone
 * would leave a live session anyone holding the token could still use, which
 * is exactly the failure sessions-as-rows exist to avoid.
 */
import { NextRequest, NextResponse } from 'next/server';
import { store } from '../../../../src/server/db.ts';
import { clearStaffCookie, currentStaff } from '../../../../src/server/staffSession.ts';

export async function POST(req: NextRequest) {
  let everywhere = false;
  try {
    const body = (await req.json()) as { everywhere?: unknown };
    everywhere = body.everywhere === true;
  } catch {
    // No body is fine: sign out of this session only.
  }

  const staff = await currentStaff();
  const token = await clearStaffCookie();

  const { staffAuth } = store();
  if (everywhere && staff) {
    staffAuth.revokeAllSessions(staff.reviewerId);
  } else if (token) {
    staffAuth.revokeSession(token);
  }

  return NextResponse.json({ status: 'signed_out', everywhere }, { status: 200 });
}
