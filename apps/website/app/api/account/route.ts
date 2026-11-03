/**
 * GET /api/account — what this account is, and whether it is on its way out.
 *
 * The page that offers export and deletion needs to know three things before
 * it can say anything true: whether there is a session, whether the address
 * is verified, and whether a deletion is already pending. Asking for them
 * separately would let the page render a "Delete" button for a quarter of a
 * second on an account that is already scheduled.
 */
import { NextResponse } from 'next/server';
import { store } from '../../../src/server/db.ts';
import { currentScope } from '../../../src/server/session.ts';

export async function GET() {
  const scope = await currentScope();
  if (!scope) return NextResponse.json({ signedIn: false }, { status: 200 });

  const { repo } = store();

  return NextResponse.json(
    {
      signedIn: true,
      verified: scope.verified,
      // An anonymous account has an opaque identifier, not an address.
      email: scope.verified ? scope.email : null,
      scans: repo.listScans(scope).length,
      pendingDeletion: repo.deletionStatus(scope),
    },
    { status: 200 }
  );
}
